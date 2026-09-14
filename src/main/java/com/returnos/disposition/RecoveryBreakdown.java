package com.returnos.disposition;

import java.math.BigDecimal;

/** Itemised money math for one disposition candidate. All values scale 2. */
public record RecoveryBreakdown(
        BigDecimal recoveryValue,
        BigDecimal processingCost,
        BigDecimal shippingCost,
        BigDecimal refurbishmentCost,
        BigDecimal netRecovery) {}
