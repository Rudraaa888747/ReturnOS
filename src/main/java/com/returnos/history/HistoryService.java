package com.returnos.history;

import com.returnos.audit.AuditLog;
import com.returnos.audit.AuditLogRepository;
import com.returnos.common.exception.BusinessException;
import com.returnos.common.exception.ResourceNotFoundException;
import com.returnos.common.security.SecurityUtils;
import com.returnos.disposal.DisposalRepository;
import com.returnos.disposition.DispositionEvaluationRepository;
import com.returnos.execution.DispositionExecution;
import com.returnos.execution.DispositionExecutionRepository;
import com.returnos.inspection.InspectionRepository;
import com.returnos.inventory.InventoryRecoveryRepository;
import com.returnos.recovery.RecoveryRecordRepository;
import com.returnos.returns.Return;
import com.returnos.returns.ReturnRepository;
import com.returnos.risk.RiskAssessmentRepository;
import com.returnos.task.OperationalTask;
import com.returnos.task.OperationalTaskRepository;
import com.returnos.user.Role;
import com.returnos.user.User;
import com.returnos.vendor.VendorClaimRepository;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class HistoryService {

    private static final int MAX_EVENTS_PER_ENTITY = 200;

    private final ReturnRepository returns;
    private final InspectionRepository inspections;
    private final RiskAssessmentRepository riskAssessments;
    private final DispositionEvaluationRepository evaluations;
    private final DispositionExecutionRepository executions;
    private final InventoryRecoveryRepository inventoryRecoveries;
    private final VendorClaimRepository vendorClaims;
    private final RecoveryRecordRepository recoveryRecords;
    private final DisposalRepository disposals;
    private final OperationalTaskRepository tasks;
    private final AuditLogRepository auditLogs;
    private final SecurityUtils securityUtils;

    public HistoryService(
            ReturnRepository returns,
            InspectionRepository inspections,
            RiskAssessmentRepository riskAssessments,
            DispositionEvaluationRepository evaluations,
            DispositionExecutionRepository executions,
            InventoryRecoveryRepository inventoryRecoveries,
            VendorClaimRepository vendorClaims,
            RecoveryRecordRepository recoveryRecords,
            DisposalRepository disposals,
            OperationalTaskRepository tasks,
            AuditLogRepository auditLogs,
            SecurityUtils securityUtils) {
        this.returns = returns;
        this.inspections = inspections;
        this.riskAssessments = riskAssessments;
        this.evaluations = evaluations;
        this.executions = executions;
        this.inventoryRecoveries = inventoryRecoveries;
        this.vendorClaims = vendorClaims;
        this.recoveryRecords = recoveryRecords;
        this.disposals = disposals;
        this.tasks = tasks;
        this.auditLogs = auditLogs;
        this.securityUtils = securityUtils;
    }

    @Transactional(readOnly = true)
    public HistoryDtos.ReturnHistoryResponse getHistory(UUID returnId) {
        User current = securityUtils.currentUser();
        Return productReturn = returns.findWithItemsById(returnId)
                .orElseThrow(() -> new ResourceNotFoundException("RETURN_NOT_FOUND", "Return not found: " + returnId));
        if (current.getRole() == Role.CUSTOMER
                && !productReturn.getCustomer().getId().equals(current.getId())) {
            throw new BusinessException("FORBIDDEN", "You can only view your own returns");
        }
        boolean includeActor = current.getRole() != Role.CUSTOMER;

        var inspection = inspections.findByProductReturnId(returnId).orElse(null);
        var risk = riskAssessments.findByProductReturnId(returnId).orElse(null);
        var evaluation = evaluations.findByProductReturnId(returnId).orElse(null);
        var execution = executions.findByProductReturnId(returnId).orElse(null);
        var restock = execution != null
                ? inventoryRecoveries.findByExecutionId(execution.getId()).orElse(null)
                : null;
        var claim = execution != null ? vendorClaims.findByExecutionId(execution.getId()).orElse(null) : null;
        var recovery = execution != null
                ? recoveryRecords.findByExecutionId(execution.getId()).orElse(null)
                : null;
        var disposal = execution != null ? disposals.findByExecutionId(execution.getId()).orElse(null) : null;
        var taskList = tasks.findByProductReturnId(returnId);

        List<HistoryDtos.HistoryEvent> events = collectEvents(returnId, execution, taskList, includeActor);

        return new HistoryDtos.ReturnHistoryResponse(
                productReturn.getId(),
                productReturn.getReturnNumber(),
                productReturn.getStatus(),
                productReturn.getRequestedAt(),
                productReturn.getCreatedAt(),
                inspection != null
                        ? new HistoryDtos.InspectionSummary(
                                inspection.getPhysicalCondition(),
                                inspection.getPackagingCondition(),
                                inspection.getFunctionalTestResult(),
                                inspection.getInspectedAt())
                        : null,
                risk != null
                        ? new HistoryDtos.RiskSummary(risk.getScore(), risk.getLevel(), risk.getAssessedAt())
                        : null,
                evaluation != null
                        ? new HistoryDtos.DispositionSummary(
                                evaluation.getRecommended(),
                                evaluation.getFinalDisposition(),
                                evaluation.isOverridden(),
                                evaluation.getEvaluatedAt(),
                                evaluation.getFinalizedAt())
                        : null,
                execution != null
                        ? new HistoryDtos.ExecutionSummary(
                                execution.getStatus(),
                                execution.getStartedAt(),
                                execution.getCompletedAt(),
                                execution.getDurationSeconds(),
                                execution.getFailureReason())
                        : null,
                restock != null
                        ? new HistoryDtos.RestockSummary(
                                restock.getQuantity(), restock.getRecoveredQuantity(), restock.getDestination())
                        : null,
                claim != null
                        ? new HistoryDtos.VendorSummary(
                                claim.getStatus(), claim.getExpectedCredit(), claim.getActualCredit())
                        : null,
                recovery != null
                        ? new HistoryDtos.RecoverySummary(
                                recovery.getStatus(),
                                recovery.getExpectedRecovery(),
                                recovery.getActualRecovered(),
                                recovery.getNetRecovered())
                        : null,
                disposal != null
                        ? new HistoryDtos.DisposalSummary(
                                disposal.getDisposition(), disposal.getQuantity(), disposal.getActualRecovery())
                        : null,
                taskList.stream()
                        .map(t -> new HistoryDtos.TaskSummary(t.getId(), t.getType(), t.getStatus()))
                        .toList(),
                events);
    }

    private List<HistoryDtos.HistoryEvent> collectEvents(
            UUID returnId, DispositionExecution execution, List<OperationalTask> taskList, boolean includeActor) {
        List<AuditLog> logs = new ArrayList<>(
                auditLogs
                        .findByEntityTypeAndEntityIdOrderByCreatedAtAsc(
                                "Return", returnId.toString(), PageRequest.of(0, MAX_EVENTS_PER_ENTITY))
                        .getContent());
        if (execution != null) {
            logs.addAll(auditLogs
                    .findByEntityTypeAndEntityIdOrderByCreatedAtAsc(
                            "DispositionExecution", execution.getId().toString(), PageRequest.of(0, MAX_EVENTS_PER_ENTITY))
                    .getContent());
            inventoryRecoveries.findByExecutionId(execution.getId()).ifPresent(r -> logs.addAll(
                    entityLogs("InventoryRecovery", r.getId())));
            vendorClaims.findByExecutionId(execution.getId()).ifPresent(c -> logs.addAll(
                    entityLogs("VendorClaim", c.getId())));
            recoveryRecords.findByExecutionId(execution.getId()).ifPresent(r -> logs.addAll(
                    entityLogs("RecoveryRecord", r.getId())));
            disposals.findByExecutionId(execution.getId()).ifPresent(d -> logs.addAll(
                    entityLogs("DisposalRecord", d.getId())));
        }
        for (OperationalTask task : taskList) {
            logs.addAll(entityLogs("OperationalTask", task.getId()));
        }
        return logs.stream()
                .sorted(Comparator.comparing(AuditLog::getCreatedAt))
                .map(l -> new HistoryDtos.HistoryEvent(
                        l.getAction(), l.getCreatedAt(), includeActor ? l.getPerformedBy() : null, l.getReason()))
                .toList();
    }

    private List<AuditLog> entityLogs(String entityType, UUID entityId) {
        return auditLogs
                .findByEntityTypeAndEntityIdOrderByCreatedAtAsc(
                        entityType, entityId.toString(), PageRequest.of(0, MAX_EVENTS_PER_ENTITY))
                .getContent();
    }
}
