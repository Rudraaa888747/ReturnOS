package com.returnos.disposition;

import com.returnos.inspection.FunctionalTestResult;
import com.returnos.inspection.PackagingCondition;
import com.returnos.inspection.PhysicalCondition;
import com.returnos.returns.ReturnReason;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.temporal.ChronoUnit;
import java.util.Comparator;
import java.util.List;
import org.springframework.stereotype.Component;

/**
 * Deterministic disposition engine. Evaluates every channel for eligibility
 * and economics, then recommends the eligible candidate with the best net
 * recovery (ties broken by a fixed channel priority, never at random).
 * Pure logic, no I/O - trivially unit-testable.
 */
@Component
public class DispositionEngine {

    /** Tie-break priority when two eligible candidates yield the same net. */
    private static final List<Disposition> PRIORITY = List.of(
            Disposition.RESTOCK,
            Disposition.RETURN_TO_VENDOR,
            Disposition.REFURBISH,
            Disposition.RESELL,
            Disposition.LIQUIDATE,
            Disposition.RECYCLE,
            Disposition.SCRAP);

    private final DispositionProperties properties;
    private final RecoveryCalculator recoveryCalculator;

    public DispositionEngine(DispositionProperties properties, RecoveryCalculator recoveryCalculator) {
        this.properties = properties;
        this.recoveryCalculator = recoveryCalculator;
    }

    public DispositionResult evaluate(DispositionInput input) {
        List<DispositionCandidate> candidates = List.of(
                restock(input),
                resell(input),
                refurbish(input),
                returnToVendor(input),
                liquidate(input),
                recycle(input),
                scrap(input));
        Disposition recommended = candidates.stream()
                .filter(DispositionCandidate::eligible)
                .max(Comparator.comparing(DispositionCandidate::netRecovery)
                        .thenComparing(c -> -PRIORITY.indexOf(c.disposition())))
                .map(DispositionCandidate::disposition)
                .orElse(Disposition.LIQUIDATE);
        return new DispositionResult(recommended, candidates, input.evaluatedAt());
    }

    private DispositionCandidate restock(DispositionInput input) {
        if (input.physicalCondition() == PhysicalCondition.EXCELLENT
                || input.physicalCondition() == PhysicalCondition.GOOD) {
            if (input.packagingCondition() == PackagingCondition.SEALED
                    || input.packagingCondition() == PackagingCondition.OPENED) {
                if (input.accessoriesComplete()
                        && input.functionalTestResult() == FunctionalTestResult.PASSED) {
                    return priced(
                            Disposition.RESTOCK, input, properties.getRestockRate(), BigDecimal.ZERO,
                            "Item is functional with intact packaging and complete accessories.");
                }
                return ineligible(
                        Disposition.RESTOCK, "Restock requires complete accessories and a passed functional test.");
            }
            return ineligible(Disposition.RESTOCK, "Restock requires sealed or opened (undamaged) packaging.");
        }
        return ineligible(Disposition.RESTOCK, "Restock requires excellent or good physical condition.");
    }

    private DispositionCandidate resell(DispositionInput input) {
        if (input.functionalTestResult() != FunctionalTestResult.PASSED) {
            return ineligible(Disposition.RESELL, "As-is resale requires a passed functional test.");
        }
        if (!input.accessoriesComplete()) {
            return ineligible(Disposition.RESELL, "As-is resale requires complete accessories.");
        }
        if (input.physicalCondition() == PhysicalCondition.DAMAGED) {
            return ineligible(Disposition.RESELL, "Damaged items cannot be resold as-is.");
        }
        return priced(
                Disposition.RESELL, input, properties.getResellRate(), BigDecimal.ZERO,
                "Functional item with acceptable condition can be resold as-is (open-box).");
    }

    private DispositionCandidate refurbish(DispositionInput input) {
        boolean fixable = input.functionalTestResult() == FunctionalTestResult.FAILED
                || input.physicalCondition() == PhysicalCondition.FAIR
                || input.physicalCondition() == PhysicalCondition.DAMAGED
                || input.packagingCondition() == PackagingCondition.DAMAGED
                || input.packagingCondition() == PackagingCondition.MISSING
                || !input.accessoriesComplete();
        if (!fixable) {
            return ineligible(Disposition.REFURBISH, "Nothing to refurbish: item is already in resalable shape.");
        }
        if (input.physicalCondition() == PhysicalCondition.DAMAGED
                && input.functionalTestResult() == FunctionalTestResult.FAILED) {
            return ineligible(
                    Disposition.REFURBISH, "Damaged and non-functional items are beyond refurbishment.");
        }
        return priced(
                Disposition.REFURBISH, input, properties.getRefurbishRate(), properties.getRefurbishmentCost(),
                "Refurbishment is expected to preserve more recovery value than liquidation.");
    }

    private DispositionCandidate returnToVendor(DispositionInput input) {
        if (input.primaryReason() != ReturnReason.DEFECTIVE && input.primaryReason() != ReturnReason.DAMAGED) {
            return ineligible(
                    Disposition.RETURN_TO_VENDOR, "Vendor returns require a defective or damaged reason.");
        }
        if (input.deliveredAt() == null) {
            return ineligible(Disposition.RETURN_TO_VENDOR, "Vendor return needs a known delivery date.");
        }
        long daysSinceDelivery = ChronoUnit.DAYS.between(input.deliveredAt(), input.evaluatedAt());
        if (daysSinceDelivery > properties.getVendorWindowDays()) {
            return ineligible(
                    Disposition.RETURN_TO_VENDOR,
                    "Vendor window (" + properties.getVendorWindowDays() + " days) has expired.");
        }
        return priced(
                Disposition.RETURN_TO_VENDOR, input, properties.getVendorRate(), BigDecimal.ZERO,
                "Defective item inside the vendor window qualifies for vendor credit.");
    }

    private DispositionCandidate liquidate(DispositionInput input) {
        return priced(
                Disposition.LIQUIDATE, input, properties.getLiquidateRate(), BigDecimal.ZERO,
                "Liquidation always applies as the fallback channel.");
    }

    private DispositionCandidate recycle(DispositionInput input) {
        if (input.physicalCondition() != PhysicalCondition.DAMAGED
                && input.functionalTestResult() != FunctionalTestResult.FAILED) {
            return ineligible(Disposition.RECYCLE, "Recycling is for damaged or non-functional items.");
        }
        return priced(
                Disposition.RECYCLE, input, properties.getRecycleRate(), BigDecimal.ZERO,
                "Material recovery applies to damaged or non-functional items.");
    }

    private DispositionCandidate scrap(DispositionInput input) {
        if (input.physicalCondition() == PhysicalCondition.DAMAGED
                && input.functionalTestResult() == FunctionalTestResult.FAILED) {
            return priced(
                    Disposition.SCRAP, input, BigDecimal.ZERO, BigDecimal.ZERO,
                    "Irreparable item: damaged and non-functional, no recovery value.");
        }
        return ineligible(Disposition.SCRAP, "Item is not irreparable.");
    }

    private DispositionCandidate priced(
            Disposition disposition, DispositionInput input, BigDecimal rate, BigDecimal refurbCost, String reason) {
        BigDecimal recovery = input.goodsValue().multiply(rate).setScale(2, RoundingMode.HALF_UP);
        RecoveryBreakdown breakdown = recoveryCalculator.calculate(
                recovery,
                properties.getProcessingCost(),
                properties.getShippingCost(),
                refurbCost);
        return new DispositionCandidate(
                disposition, true, breakdown.recoveryValue(), breakdown.processingCost(),
                breakdown.shippingCost(), breakdown.refurbishmentCost(), breakdown.netRecovery(), reason);
    }

    private DispositionCandidate ineligible(Disposition disposition, String reason) {
        BigDecimal zero = BigDecimal.ZERO.setScale(2);
        return new DispositionCandidate(
                disposition, false, zero, zero, zero, zero, zero, reason);
    }
}
