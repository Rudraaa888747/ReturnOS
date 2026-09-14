package com.returnos.policy;

import static org.assertj.core.api.Assertions.assertThat;

import com.returnos.order.OrderStatus;
import com.returnos.returns.ReturnReason;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class ReturnPolicyServiceTest {

    private ReturnPolicyService policyService;

    @BeforeEach
    void setUp() {
        ReturnPolicyProperties props = new ReturnPolicyProperties();
        props.setReturnWindowDays(30);
        props.setChangedMindWindowDays(14);
        props.setBlockedCategories(List.of("final-sale"));
        policyService = new ReturnPolicyService(props);
    }

    @Test
    void eligibleWhenWithinWindow() {
        EligibilityResult result = policyService.evaluateSimple(
                OrderStatus.DELIVERED,
                Instant.now().minus(5, ChronoUnit.DAYS),
                "electronics",
                true,
                ReturnReason.DEFECTIVE,
                Instant.now());

        assertThat(result.eligible()).isTrue();
        assertThat(result.reason()).contains("within the allowed return window");
    }

    @Test
    void ineligibleWhenWindowExpired() {
        EligibilityResult result = policyService.evaluateSimple(
                OrderStatus.DELIVERED,
                Instant.now().minus(40, ChronoUnit.DAYS),
                "electronics",
                true,
                ReturnReason.DEFECTIVE,
                Instant.now());

        assertThat(result.eligible()).isFalse();
        assertThat(result.reason()).contains("expired");
    }

    @Test
    void ineligibleWhenOrderNotDelivered() {
        EligibilityResult result = policyService.evaluateSimple(
                OrderStatus.PLACED, null, "electronics", true, ReturnReason.DAMAGED, Instant.now());

        assertThat(result.eligible()).isFalse();
        assertThat(result.reason()).contains("delivered");
    }

    @Test
    void ineligibleWhenOrderCancelled() {
        EligibilityResult result = policyService.evaluateSimple(
                OrderStatus.CANCELLED,
                Instant.now().minus(2, ChronoUnit.DAYS),
                "electronics",
                true,
                ReturnReason.DAMAGED,
                Instant.now());

        assertThat(result.eligible()).isFalse();
        assertThat(result.reason()).contains("cancelled");
    }

    @Test
    void ineligibleForBlockedCategory() {
        EligibilityResult result = policyService.evaluateSimple(
                OrderStatus.DELIVERED,
                Instant.now().minus(2, ChronoUnit.DAYS),
                "final-sale",
                true,
                ReturnReason.DAMAGED,
                Instant.now());

        assertThat(result.eligible()).isFalse();
        assertThat(result.reason()).contains("not eligible");
    }

    @Test
    void changedMindHasShorterWindow() {
        // 20 days ago: ok for DEFECTIVE (30d window) but expired for CHANGED_MIND (14d)
        EligibilityResult defective = policyService.evaluateSimple(
                OrderStatus.DELIVERED,
                Instant.now().minus(20, ChronoUnit.DAYS),
                "apparel",
                true,
                ReturnReason.DEFECTIVE,
                Instant.now());
        EligibilityResult changedMind = policyService.evaluateSimple(
                OrderStatus.DELIVERED,
                Instant.now().minus(20, ChronoUnit.DAYS),
                "apparel",
                true,
                ReturnReason.CHANGED_MIND,
                Instant.now());

        assertThat(defective.eligible()).isTrue();
        assertThat(changedMind.eligible()).isFalse();
    }

    @Test
    void ineligibleWhenProductInactive() {
        EligibilityResult result = policyService.evaluateSimple(
                OrderStatus.DELIVERED,
                Instant.now().minus(2, ChronoUnit.DAYS),
                "electronics",
                false,
                ReturnReason.DAMAGED,
                Instant.now());

        assertThat(result.eligible()).isFalse();
    }
}
