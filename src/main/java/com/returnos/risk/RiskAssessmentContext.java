package com.returnos.risk;

import com.returnos.returns.ReturnReason;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

/**
 * Snapshot of everything the risk rules may consider. Built by the service
 * layer purely from ReturnOS data - no external signals are invented.
 */
public record RiskAssessmentContext(
        UUID returnId,
        UUID customerId,
        int recentReturnCount,
        int lifetimeReturnCount,
        BigDecimal orderValue,
        List<ReturnReason> reasons,
        boolean repeatProduct,
        int distinctItemCount) {

    public RiskAssessmentContext {
        orderValue = orderValue != null ? orderValue : BigDecimal.ZERO;
        reasons = reasons != null ? List.copyOf(reasons) : List.of();
    }
}
