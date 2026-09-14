package com.returnos.analytics;

import java.math.BigDecimal;
import java.util.Map;

public final class AnalyticsDtos {

    private AnalyticsDtos() {}

    public record ReturnsAnalyticsResponse(
            long totalReturns,
            long evaluated,
            long finalized,
            Map<String, Long> byFinalDisposition,
            long executionsTotal,
            long executionsCompleted,
            long executionsFailed,
            double executionCompletionRate,
            double avgExecutionSeconds) {}

    public record RecoveryAnalyticsResponse(
            BigDecimal expectedRecovery,
            BigDecimal actualRecovered,
            BigDecimal netRecovered,
            long vendorClaimsTotal,
            long vendorClaimsSettled,
            double vendorSettlementRate,
            BigDecimal vendorExpectedCredit,
            BigDecimal vendorActualCredit,
            long restockRecords,
            long restockQuantity,
            long recycleCount,
            long scrapCount,
            long liquidationRecords,
            BigDecimal liquidationActual) {}
}
