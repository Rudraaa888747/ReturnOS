package com.returnos.execution;

import com.returnos.audit.AuditAction;
import com.returnos.audit.AuditService;
import com.returnos.common.exception.BusinessException;
import com.returnos.common.exception.InvalidStateException;
import com.returnos.common.exception.ResourceNotFoundException;
import com.returnos.common.observability.OperationsMetrics;
import com.returnos.common.security.SecurityUtils;
import com.returnos.disposition.Disposition;
import com.returnos.disposition.DispositionEvaluation;
import com.returnos.disposition.DispositionEvaluationRepository;
import com.returnos.disposal.DisposalRepository;
import com.returnos.inventory.InventoryRecoveryRepository;
import com.returnos.recovery.RecoveryRecord;
import com.returnos.recovery.RecoveryRecordRepository;
import com.returnos.recovery.RecoveryStatus;
import com.returnos.returns.Return;
import com.returnos.returns.ReturnRepository;
import com.returnos.task.OperationalTaskRepository;
import com.returnos.task.TaskStatus;
import com.returnos.task.TaskType;
import com.returnos.user.Role;
import com.returnos.user.User;
import com.returnos.user.UserRepository;
import com.returnos.vendor.VendorClaim;
import com.returnos.vendor.VendorClaimRepository;
import com.returnos.vendor.VendorClaimStatus;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ExecutionService {

    private static final Logger log = LoggerFactory.getLogger(ExecutionService.class);

    private final DispositionExecutionRepository executions;
    private final DispositionEvaluationRepository evaluations;
    private final ReturnRepository returns;
    private final UserRepository users;
    private final InventoryRecoveryRepository inventoryRecoveries;
    private final VendorClaimRepository vendorClaims;
    private final RecoveryRecordRepository recoveryRecords;
    private final DisposalRepository disposals;
    private final OperationalTaskRepository tasks;
    private final AuditService auditService;
    private final SecurityUtils securityUtils;
    private final OperationsMetrics metrics;

    public ExecutionService(
            DispositionExecutionRepository executions,
            DispositionEvaluationRepository evaluations,
            ReturnRepository returns,
            UserRepository users,
            InventoryRecoveryRepository inventoryRecoveries,
            VendorClaimRepository vendorClaims,
            RecoveryRecordRepository recoveryRecords,
            DisposalRepository disposals,
            OperationalTaskRepository tasks,
            AuditService auditService,
            SecurityUtils securityUtils,
            OperationsMetrics metrics) {
        this.executions = executions;
        this.evaluations = evaluations;
        this.returns = returns;
        this.users = users;
        this.inventoryRecoveries = inventoryRecoveries;
        this.vendorClaims = vendorClaims;
        this.recoveryRecords = recoveryRecords;
        this.disposals = disposals;
        this.tasks = tasks;
        this.auditService = auditService;
        this.securityUtils = securityUtils;
        this.metrics = metrics;
    }

    @Transactional
    public ExecutionDtos.ExecutionResponse start(UUID returnId, UUID assigneeId, String notes) {
        User actor = securityUtils.currentUser();
        requireStaffOrAdmin(actor);

        DispositionEvaluation evaluation = evaluations
                .findByProductReturnId(returnId)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "DISPOSITION_NOT_FOUND", "Return disposition has not been evaluated yet: " + returnId));
        if (evaluation.getFinalDisposition() == null) {
            throw new InvalidStateException(
                    "DISPOSITION_NOT_FINALIZED",
                    "Execution requires a recorded final disposition for return: " + returnId);
        }

        Optional<DispositionExecution> existing = executions.findByProductReturnId(returnId);
        if (existing.isPresent()) {
            DispositionExecution execution = existing.get();
            if (execution.getStatus() == ExecutionStatus.IN_PROGRESS) {
                return ExecutionDtos.ExecutionResponse.from(execution);
            }
            if (execution.getStatus() != ExecutionStatus.PENDING) {
                throw new BusinessException(
                        "EXECUTION_ALREADY_FINISHED",
                        "Execution already finished with status: " + execution.getStatus());
            }
            return beginExecution(execution, assigneeId, notes, actor);
        }

        // Finalized before Phase 3 was deployed: no auto-created PENDING row exists.
        Return productReturn = evaluation.getProductReturn();
        DispositionExecution execution =
                new DispositionExecution(productReturn, evaluation.getFinalDisposition());
        executions.save(execution);
        return beginExecution(execution, assigneeId, notes, actor);
    }

    @Transactional
    public ExecutionDtos.ExecutionResponse complete(UUID returnId) {
        User actor = securityUtils.currentUser();
        requireStaffOrAdmin(actor);

        DispositionExecution execution = loadInProgressExecution(returnId);
        requireChannelRecord(execution);
        execution.transitionTo(ExecutionStatus.COMPLETED);
        finishExecution(execution);
        auditService.log(
                AuditAction.DISPOSITION_EXECUTION_COMPLETED, "DispositionExecution", execution.getId().toString(),
                actor.getEmail(), "Execution completed for disposition " + execution.getDisposition(),
                "returnId=" + returnId);
        metrics.executionCompleted();
        log.info(
                "operation=execution-complete returnId={} executionId={} actor={} outcome=COMPLETED",
                returnId, execution.getId(), actor.getEmail());
        return ExecutionDtos.ExecutionResponse.from(execution);
    }

    @Transactional
    public ExecutionDtos.ExecutionResponse fail(UUID returnId, String reason) {
        User actor = securityUtils.currentUser();
        requireStaffOrAdmin(actor);
        if (reason == null || reason.isBlank()) {
            throw new BusinessException("FAILURE_REASON_REQUIRED", "Failure reason must be provided");
        }

        DispositionExecution execution = loadInProgressExecution(returnId);
        execution.transitionTo(ExecutionStatus.FAILED);
        execution.setFailureReason(reason.trim());
        finishExecution(execution);
        auditService.log(
                AuditAction.DISPOSITION_EXECUTION_FAILED, "DispositionExecution", execution.getId().toString(),
                actor.getEmail(), "Execution failed: " + reason.trim(), "returnId=" + returnId);
        metrics.executionFailed();
        log.info(
                "operation=execution-fail returnId={} executionId={} actor={} outcome=FAILED",
                returnId, execution.getId(), actor.getEmail());
        return ExecutionDtos.ExecutionResponse.from(execution);
    }

    @Transactional(readOnly = true)
    public ExecutionDtos.ExecutionResponse get(UUID returnId) {
        User current = securityUtils.currentUser();
        Return productReturn = returns.findWithItemsById(returnId)
                .orElseThrow(() -> new ResourceNotFoundException("RETURN_NOT_FOUND", "Return not found: " + returnId));
        enforceVisibility(productReturn, current);
        return executions
                .findByProductReturnId(returnId)
                .map(ExecutionDtos.ExecutionResponse::from)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "EXECUTION_NOT_FOUND", "No execution for return: " + returnId));
    }

    private ExecutionDtos.ExecutionResponse beginExecution(
            DispositionExecution execution, UUID assigneeId, String notes, User actor) {
        execution.transitionTo(ExecutionStatus.IN_PROGRESS);
        execution.setStartedAt(Instant.now());
        execution.setAssignee(resolveAssignee(assigneeId, actor));
        if (notes != null && !notes.isBlank()) {
            execution.setNotes(notes.trim());
        }
        auditService.log(
                AuditAction.DISPOSITION_EXECUTION_STARTED, "DispositionExecution", execution.getId().toString(),
                actor.getEmail(), "Execution started for disposition " + execution.getDisposition(),
                "returnId=" + execution.getProductReturn().getId());
        metrics.executionStarted();
        log.info(
                "operation=execution-start returnId={} executionId={} actor={} outcome=IN_PROGRESS",
                execution.getProductReturn().getId(), execution.getId(), actor.getEmail());
        return ExecutionDtos.ExecutionResponse.from(execution);
    }

    private DispositionExecution loadInProgressExecution(UUID returnId) {
        DispositionExecution execution = executions
                .findByProductReturnId(returnId)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "EXECUTION_NOT_FOUND", "No execution for return: " + returnId));
        if (execution.getStatus() != ExecutionStatus.IN_PROGRESS) {
            throw new InvalidStateException(
                    "INVALID_TRANSITION",
                    "Only IN_PROGRESS executions can be completed or failed. Current status: "
                            + execution.getStatus());
        }
        return execution;
    }

    /**
     * Disposition-specific completion gate: a return is operationally complete
     * only when the record matching its final disposition exists.
     */
    private void requireChannelRecord(DispositionExecution execution) {
        UUID executionId = execution.getId();
        Disposition disposition = execution.getDisposition();
        switch (disposition) {
            case RESTOCK -> {
                if (!inventoryRecoveries.existsByExecutionId(executionId)) {
                    throw new BusinessException(
                            "CHANNEL_RECORD_MISSING", "RESTOCK requires a recorded inventory recovery");
                }
            }
            case RETURN_TO_VENDOR -> {
                VendorClaim claim = vendorClaims
                        .findByExecutionId(executionId)
                        .orElseThrow(() -> new BusinessException(
                                "CHANNEL_RECORD_MISSING", "RETURN_TO_VENDOR requires a vendor claim"));
                if (claim.getStatus() == VendorClaimStatus.DRAFT) {
                    throw new BusinessException(
                            "CHANNEL_RECORD_MISSING", "Vendor claim must be submitted before completion");
                }
            }
            case RESELL, LIQUIDATE -> {
                RecoveryRecord record = recoveryRecords
                        .findByExecutionId(executionId)
                        .orElseThrow(() -> new BusinessException(
                                "CHANNEL_RECORD_MISSING", disposition + " requires a recovery record"));
                if (record.getStatus() != RecoveryStatus.SOLD && record.getStatus() != RecoveryStatus.SETTLED) {
                    throw new BusinessException(
                            "CHANNEL_RECORD_MISSING", "Recovery must be sold or settled before completion");
                }
            }
            case REFURBISH -> {
                if (tasks.countByExecutionIdAndTypeAndStatus(executionId, TaskType.REFURBISH_ITEM, TaskStatus.COMPLETED)
                        == 0) {
                    throw new BusinessException(
                            "CHANNEL_RECORD_MISSING",
                            "REFURBISH requires a completed refurbishment task for this execution");
                }
            }
            case RECYCLE, SCRAP -> {
                if (!disposals.existsByExecutionId(executionId)) {
                    throw new BusinessException(
                            "CHANNEL_RECORD_MISSING", disposition + " requires a completed disposal record");
                }
            }
        }
    }

    private void finishExecution(DispositionExecution execution) {
        Instant end = Instant.now();
        execution.setCompletedAt(end);
        if (execution.getStartedAt() != null) {
            execution.setDurationSeconds(ChronoUnit.SECONDS.between(execution.getStartedAt(), end));
        }
    }

    private User resolveAssignee(UUID assigneeId, User actor) {
        if (assigneeId == null) {
            return actor;
        }
        return users.findById(assigneeId)
                .orElseThrow(() -> new ResourceNotFoundException("USER_NOT_FOUND", "Assignee not found: " + assigneeId));
    }

    private void enforceVisibility(Return productReturn, User current) {
        if (current.getRole() == Role.CUSTOMER
                && !productReturn.getCustomer().getId().equals(current.getId())) {
            throw new BusinessException("FORBIDDEN", "You can only view your own returns");
        }
    }

    private void requireStaffOrAdmin(User user) {
        if (user.getRole() != Role.WAREHOUSE_STAFF && user.getRole() != Role.ADMIN) {
            throw new BusinessException("FORBIDDEN", "Only warehouse staff or admin can execute operations");
        }
    }
}
