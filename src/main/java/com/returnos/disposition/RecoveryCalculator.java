package com.returnos.disposition;

import com.returnos.common.exception.BusinessException;
import java.math.BigDecimal;
import java.math.RoundingMode;
import org.springframework.stereotype.Component;

/**
 * Dedicated money math for disposition economics. Never uses floating point;
 * every amount is normalised to scale 2 (HALF_UP) and negative inputs are
 * rejected because costs and recovery values cannot be negative.
 */
@Component
public class RecoveryCalculator {

    public RecoveryBreakdown calculate(
            BigDecimal recoveryValue,
            BigDecimal processingCost,
            BigDecimal shippingCost,
            BigDecimal refurbishmentCost) {
        BigDecimal recovery = money("recoveryValue", recoveryValue);
        BigDecimal processing = money("processingCost", processingCost);
        BigDecimal shipping = money("shippingCost", shippingCost);
        BigDecimal refurbishment = money("refurbishmentCost", refurbishmentCost);
        BigDecimal net = recovery.subtract(processing).subtract(shipping).subtract(refurbishment);
        return new RecoveryBreakdown(recovery, processing, shipping, refurbishment, scale(net));
    }

    /**
     * Normalises a single provided amount to scale 2, rejecting null/negative
     * values. Reused by operational services so money rules stay in one place.
     */
    public BigDecimal amount(String field, BigDecimal value) {
        return money(field, value);
    }

    private BigDecimal money(String field, BigDecimal value) {
        if (value == null) {
            throw new BusinessException("INVALID_AMOUNT", field + " must be provided");
        }
        if (value.compareTo(BigDecimal.ZERO) < 0) {
            throw new BusinessException("NEGATIVE_AMOUNT", field + " cannot be negative: " + value);
        }
        return scale(value);
    }

    private BigDecimal scale(BigDecimal value) {
        return value.setScale(2, RoundingMode.HALF_UP);
    }
}
