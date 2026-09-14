package com.returnos.disposition;

import java.math.BigDecimal;

/** Economics + eligibility of one possible disposition. Ineligible options stay visible with a reason. */
public record DispositionCandidate(
        Disposition disposition,
        boolean eligible,
        BigDecimal recoveryValue,
        BigDecimal processingCost,
        BigDecimal shippingCost,
        BigDecimal refurbishmentCost,
        BigDecimal netRecovery,
        String reason) {}
