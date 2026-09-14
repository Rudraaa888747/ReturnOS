package com.returnos.analytics;

import com.returnos.common.exception.BusinessException;
import com.returnos.common.security.SecurityUtils;
import com.returnos.disposal.DisposalRepository;
import com.returnos.disposition.Disposition;
import com.returnos.disposition.DispositionEvaluationRepository;
import com.returnos.execution.DispositionExecutionRepository;
import com.returnos.execution.ExecutionStatus;
import com.returnos.inventory.InventoryRecoveryRepository;
import com.returnos.recovery.RecoveryRecordRepository;
import com.returnos.returns.ReturnRepository;
import com.returnos.user.Role;
import com.returnos.vendor.VendorClaimRepository;
import com.returnos.vendor.VendorClaimStatus;
import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AnalyticsService {

    private final ReturnRepository returns;
    private final DispositionEvaluationRepository evaluations;
    private final DispositionExecutionRepository executions;
    private final RecoveryRecordRepository recoveryRecords;
    private final VendorClaimRepository vendorClaims;
    private final InventoryRecoveryRepository inventoryRecoveries;
    private final DisposalRepository disposals;
    private final SecurityUtils securityUtils;

    public AnalyticsService(
            ReturnRepository returns,
            DispositionEvaluationRepository evaluations,
            DispositionExecutionRepository executions,
            RecoveryRecordRepository recoveryRecords,
            VendorClaimRepository vendorClaims,
            InventoryRecoveryRepository inventoryRecoveries,
            DisposalRepository disposals,
            SecurityUtils securityUtils) {
        this.returns = returns;
        this.evaluations = evaluations;
        this.executions = executions;
        this.recoveryRecords = recoveryRecords;
        this.vendorClaims = vendorClaims;
        this.inventoryRecoveries = inventoryRecoveries;
        this.disposals = disposals;
        this.securityUtils = securityUtils;
    }

    @Transactional(readOnly = true)
    public AnalyticsDtos.ReturnsAnalyticsResponse returnsSummary() {
        requireAdmin();
        Map<String, Long> byDisposition = new LinkedHashMap<>();
        evaluations.countByFinalDisposition().forEach(row -> byDisposition.put(
                ((Disposition) row[0]).name(), (Long) row[1]));
        long execTotal = executions.count();
        long execCompleted = executions.countByStatus(ExecutionStatus.COMPLETED);
        long execFailed = executions.countByStatus(ExecutionStatus.FAILED);
        Double avgDuration = executions.averageDurationSeconds();
        return new AnalyticsDtos.ReturnsAnalyticsResponse(
                returns.count(),
                evaluations.count(),
                evaluations.countByFinalDispositionIsNotNull(),
                byDisposition,
                execTotal,
                execCompleted,
                execFailed,
                execTotal == 0 ? 0.0 : (double) execCompleted / execTotal,
                avgDuration != null ? avgDuration : 0.0);
    }

    @Transactional(readOnly = true)
    public AnalyticsDtos.RecoveryAnalyticsResponse recoverySummary() {
        requireAdmin();
        // Single-scalar aggregates only: portable across PostgreSQL and H2,
        // unlike multi-column selects whose row mapping differs per database.
        long vendorTotal = vendorClaims.count();
        long vendorSettled = vendorClaims.countByStatus(VendorClaimStatus.SETTLED);
        Long restockQty = inventoryRecoveries.sumRecoveredQuantity();
        return new AnalyticsDtos.RecoveryAnalyticsResponse(
                toMoney(recoveryRecords.sumExpectedRecovery()),
                toMoney(recoveryRecords.sumActualRecovered()),
                toMoney(recoveryRecords.sumNetRecovered()),
                vendorTotal,
                vendorSettled,
                vendorTotal == 0 ? 0.0 : (double) vendorSettled / vendorTotal,
                toMoney(vendorClaims.sumExpectedCredit()),
                toMoney(vendorClaims.sumActualCredit()),
                inventoryRecoveries.count(),
                restockQty != null ? restockQty : 0L,
                disposals.countByDisposition(Disposition.RECYCLE),
                disposals.countByDisposition(Disposition.SCRAP),
                recoveryRecords.countByDisposition(Disposition.LIQUIDATE),
                toMoney(recoveryRecords.sumActualByDisposition(Disposition.LIQUIDATE)));
    }

    /**
     * SUM() result types differ per database (BigDecimal on PostgreSQL, other
     * numeric holders on H2), so convert defensively without string parsing.
     */
    private BigDecimal toMoney(Object value) {
        if (value == null) {
            return BigDecimal.ZERO;
        }
        if (value instanceof BigDecimal decimal) {
            return decimal.setScale(2, java.math.RoundingMode.HALF_UP);
        }
        if (value instanceof Number number) {
            return BigDecimal.valueOf(number.doubleValue()).setScale(2, java.math.RoundingMode.HALF_UP);
        }
        try {
            return new BigDecimal(value.toString()).setScale(2, java.math.RoundingMode.HALF_UP);
        } catch (NumberFormatException e) {
            return BigDecimal.ZERO;
        }
    }

    private void requireAdmin() {
        if (securityUtils.currentUser().getRole() != Role.ADMIN) {
            throw new BusinessException("FORBIDDEN", "Analytics endpoints require ADMIN role");
        }
    }
}
