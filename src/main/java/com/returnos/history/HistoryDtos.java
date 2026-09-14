package com.returnos.history;

import com.returnos.audit.AuditAction;
import com.returnos.disposition.Disposition;
import com.returnos.execution.ExecutionStatus;
import com.returnos.inspection.FunctionalTestResult;
import com.returnos.inspection.PackagingCondition;
import com.returnos.inspection.PhysicalCondition;
import com.returnos.recovery.RecoveryStatus;
import com.returnos.returns.ReturnStatus;
import com.returnos.risk.RiskLevel;
import com.returnos.task.TaskStatus;
import com.returnos.task.TaskType;
import com.returnos.vendor.VendorClaimStatus;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public final class HistoryDtos {

    private HistoryDtos() {}

    public record HistoryEvent(
            AuditAction action,
            Instant timestamp,
            String actor,
            String reason) {}

    public record InspectionSummary(
            PhysicalCondition physicalCondition,
            PackagingCondition packagingCondition,
            FunctionalTestResult functionalTestResult,
            Instant inspectedAt) {}

    public record RiskSummary(int score, RiskLevel level, Instant assessedAt) {}

    public record DispositionSummary(
            Disposition recommended,
            Disposition finalDisposition,
            boolean overridden,
            Instant evaluatedAt,
            Instant finalizedAt) {}

    public record ExecutionSummary(
            ExecutionStatus status,
            Instant startedAt,
            Instant completedAt,
            Long durationSeconds,
            String failureReason) {}

    public record RestockSummary(int quantity, int recoveredQuantity, String destination) {}

    public record VendorSummary(
            VendorClaimStatus status, BigDecimal expectedCredit, BigDecimal actualCredit) {}

    public record RecoverySummary(
            RecoveryStatus status, BigDecimal expectedRecovery, BigDecimal actualRecovered, BigDecimal netRecovered) {}

    public record DisposalSummary(Disposition disposition, int quantity, BigDecimal actualRecovery) {}

    public record TaskSummary(UUID id, TaskType type, TaskStatus status) {}

    public record ReturnHistoryResponse(
            UUID returnId,
            String returnNumber,
            ReturnStatus status,
            Instant requestedAt,
            Instant createdAt,
            InspectionSummary inspection,
            RiskSummary risk,
            DispositionSummary disposition,
            ExecutionSummary execution,
            RestockSummary restock,
            VendorSummary vendorClaim,
            RecoverySummary recovery,
            DisposalSummary disposal,
            List<TaskSummary> tasks,
            List<HistoryEvent> events) {}
}
