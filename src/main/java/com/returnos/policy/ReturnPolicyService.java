package com.returnos.policy;

import com.returnos.order.Order;
import com.returnos.order.OrderStatus;
import com.returnos.returns.ReturnReason;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

/**
 * Phase 1 policy: small set of configurable, explainable rules.
 * Phase 2 will replace/extend this with a risk + disposition engine.
 */
@Service
public class ReturnPolicyService {

    private final ReturnPolicyProperties properties;

    public ReturnPolicyService(ReturnPolicyProperties properties) {
        this.properties = properties;
    }

    public EligibilityResult evaluate(Order order, List<ItemEligibility> items, Instant now) {
        if (order.getStatus() == OrderStatus.CANCELLED) {
            return EligibilityResult.fail("Order is cancelled and not eligible for return.");
        }
        if (order.getStatus() != OrderStatus.DELIVERED) {
            return EligibilityResult.fail("Order must be delivered before requesting a return.");
        }
        if (order.getDeliveredAt() == null) {
            return EligibilityResult.fail("Order delivery date is missing; cannot evaluate return window.");
        }

        long daysSinceDelivery = ChronoUnit.DAYS.between(order.getDeliveredAt(), now);
        if (daysSinceDelivery < 0) {
            return EligibilityResult.fail("Order delivery date is in the future; cannot evaluate return window.");
        }

        // Per-item checks first so messages are specific.
        for (ItemEligibility item : items) {
            if (!item.productActive()) {
                return EligibilityResult.fail(
                        "Product " + item.sku() + " is no longer eligible for return.");
            }
            if (isBlockedCategory(item.category())) {
                return EligibilityResult.fail(
                        "Category '" + item.category() + "' is not eligible for returns.");
            }
            int window = windowFor(item.reason());
            if (daysSinceDelivery > window) {
                if (item.reason() == ReturnReason.CHANGED_MIND) {
                    return EligibilityResult.fail("Changed-mind return window (" + window
                            + " days) has expired. Delivered " + daysSinceDelivery + " days ago.");
                }
                return EligibilityResult.fail("Return window has expired. Delivered " + daysSinceDelivery
                        + " days ago; allowed window is " + window + " days.");
            }
            if (item.quantity() <= 0) {
                return EligibilityResult.fail("Return quantity must be positive.");
            }
            if (item.quantity() > item.orderedQuantity()) {
                return EligibilityResult.fail("Return quantity for " + item.sku()
                        + " exceeds ordered quantity (" + item.orderedQuantity() + ").");
            }
        }

        return EligibilityResult.ok("Return requested within the allowed return window.");
    }

    private int windowFor(ReturnReason reason) {
        if (reason == ReturnReason.CHANGED_MIND) {
            return Math.min(properties.getChangedMindWindowDays(), properties.getReturnWindowDays());
        }
        return properties.getReturnWindowDays();
    }

    private boolean isBlockedCategory(String category) {
        if (category == null) {
            return false;
        }
        List<String> blocked = properties.getBlockedCategories();
        if (blocked == null || blocked.isEmpty()) {
            return false;
        }
        return blocked.stream().anyMatch(b -> b.equalsIgnoreCase(category.trim()));
    }

    public record ItemEligibility(
            String sku,
            String category,
            boolean productActive,
            int quantity,
            int orderedQuantity,
            ReturnReason reason) {}

    /** Convenience overload for tests: evaluate a single generic item. */
    public EligibilityResult evaluateSimple(
            OrderStatus status, Instant deliveredAt, String category,
            boolean productActive, ReturnReason reason, Instant now) {
        Map<String, Object> fake = Map.of();
        // Build minimal check without an Order entity.
        if (status == OrderStatus.CANCELLED) {
            return EligibilityResult.fail("Order is cancelled and not eligible for return.");
        }
        if (status != OrderStatus.DELIVERED) {
            return EligibilityResult.fail("Order must be delivered before requesting a return.");
        }
        if (deliveredAt == null) {
            return EligibilityResult.fail("Order delivery date is missing; cannot evaluate return window.");
        }
        long days = ChronoUnit.DAYS.between(deliveredAt, now);
        int window = windowFor(reason);
        if (!productActive) {
            return EligibilityResult.fail("Product is no longer eligible for return.");
        }
        if (isBlockedCategory(category)) {
            return EligibilityResult.fail("Category '" + category + "' is not eligible for returns.");
        }
        if (days > window) {
            return EligibilityResult.fail("Return window has expired.");
        }
        return EligibilityResult.ok("Return requested within the allowed return window.");
    }
}
