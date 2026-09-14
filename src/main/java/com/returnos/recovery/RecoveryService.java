package com.returnos.recovery;

import com.returnos.audit.AuditAction;
import com.returnos.audit.AuditService;
import com.returnos.common.exception.BusinessException;
import com.returnos.common.exception.InvalidStateException;
import com.returnos.common.exception.ResourceNotFoundException;
import com.returnos.common.observability.OperationsMetrics;
import com.returnos.common.security.SecurityUtils;
import com.returnos.disposition.Disposition;
import com.returnos.disposition.DispositionCandidate;
import com.returnos.disposition.DispositionEvaluation;
import com.returnos.disposition.DispositionEvaluationRepository;
import com.returnos.disposition.RecoveryBreakdown;
import com.returnos.disposition.RecoveryCalculator;
import com.returnos.execution.DispositionExecution;
import com.returnos.execution.DispositionExecutionRepository;
import com.returnos.execution.ExecutionStatus;
import com.returnos.user.Role;
import com.returnos.user.User;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class RecoveryService {

    private static final Logger log = LoggerFactory.getLogger(RecoveryService.class);

    private final RecoveryRecordRepository records;
    private final DispositionExecutionRepository executions;
    private final DispositionEvaluationRepository evaluations;
    private final RecoveryCalculator calculator;
    private final AuditService auditService;
    private final SecurityUtils securityUtils;
    private final OperationsMetrics metrics;

    public RecoveryService(
            RecoveryRecordRepository records,
            DispositionExecutionRepository executions,
            DispositionEvaluationRepository evaluations,
            RecoveryCalculator calculator,
            AuditService auditService,
            SecurityUtils securityUtils,
            OperationsMetrics metrics) {
        this.records = records;
        this.executions = executions;
        this.evaluations = evaluations;
        this.calculator = calculator;
        this.auditService = auditService;
        this.securityUtils = securityUtils;
        this.metrics = metrics;
    }

    @Transactional
    public RecoveryDtos.RecoveryResponse create(
            UUID returnId, String channel, BigDecimal listedValue, BigDecimal expectedRecovery, String notes) {
        User actor = securityUtils.currentUser();
        requireStaffOrAdmin(actor);

        DispositionExecution execution = loadInProgressSaleExecution(returnId);
        if (records.existsByExecutionId(execution.getId())) {
            throw new BusinessException(
                    "DUPLICATE_RECOVERY", "Recovery record already exists for execution: " + execution.getId());
        }
        BigDecimal expected = expectedRecovery != null
                ? calculator.amount("expectedRecovery", expectedRecovery)
                : evaluationNet(execution);
        RecoveryRecord record = new RecoveryRecord(
                execution,
                execution.getProductReturn(),
                execution.getDisposition(),
                channel.trim(),
                listedValue != null ? calculator.amount("listedValue", listedValue) : null,
                expected,
                notes,
                actor);
        try {
            records.saveAndFlush(record);
        } catch (DataIntegrityViolationException e) {
            throw new BusinessException(
                    "DUPLICATE_RECOVERY", "Recovery record already exists for execution: " + execution.getId());
        }
        log.info(
                "operation=recovery-create returnId={} recordId={} actor={} outcome=PENDING",
                returnId, record.getId(), actor.getEmail());
        return RecoveryDtos.RecoveryResponse.from(record);
    }

    @Transactional(readOnly = true)
    public RecoveryDtos.RecoveryResponse get(UUID returnId) {
        User current = securityUtils.currentUser();
        RecoveryRecord record = records.findByProductReturnId(returnId)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "RECOVERY_NOT_FOUND", "No recovery record for return: " + returnId));
        if (current.getRole() == Role.CUSTOMER
                && !record.getProductReturn().getCustomer().getId().equals(current.getId())) {
            throw new BusinessException("FORBIDDEN", "You can only view your own returns");
        }
        return RecoveryDtos.RecoveryResponse.from(record);
    }

    @Transactional
    public RecoveryDtos.RecoveryResponse list(UUID returnId) {
        User actor = securityUtils.currentUser();
        requireStaffOrAdmin(actor);

        RecoveryRecord record = loadRecord(returnId);
        record.transitionTo(RecoveryStatus.LISTED);
        record.setListedAt(Instant.now());
        audit(AuditAction.RECOVERY_LISTED, record, actor, "Recovery listed on channel " + record.getChannel());
        log.info(
                "operation=recovery-list returnId={} recordId={} actor={} outcome=LISTED",
                returnId, record.getId(), actor.getEmail());
        return RecoveryDtos.RecoveryResponse.from(record);
    }

    @Transactional
    public RecoveryDtos.RecoveryResponse sell(UUID returnId, BigDecimal actualRecovered, BigDecimal fees, String notes) {
        User actor = securityUtils.currentUser();
        requireStaffOrAdmin(actor);

        RecoveryRecord record = loadRecord(returnId);
        record.transitionTo(RecoveryStatus.SOLD);
        BigDecimal actual = calculator.amount("actualRecovered", actualRecovered);
        BigDecimal feeAmount = fees != null ? calculator.amount("fees", fees) : BigDecimal.ZERO;
        RecoveryBreakdown breakdown = calculator.calculate(actual, feeAmount, BigDecimal.ZERO, BigDecimal.ZERO);
        record.setActualRecovered(breakdown.recoveryValue());
        record.setFees(breakdown.processingCost());
        record.setNetRecovered(breakdown.netRecovery());
        record.setSoldAt(Instant.now());
        if (notes != null && !notes.isBlank()) {
            record.setNotes(notes.trim());
        }
        audit(AuditAction.RECOVERY_SOLD, record, actor, "Recovery sold, actual " + breakdown.recoveryValue());
        log.info(
                "operation=recovery-sell returnId={} recordId={} actor={} outcome=SOLD",
                returnId, record.getId(), actor.getEmail());
        return RecoveryDtos.RecoveryResponse.from(record);
    }

    @Transactional
    public RecoveryDtos.RecoveryResponse settle(UUID returnId) {
        User actor = securityUtils.currentUser();
        requireStaffOrAdmin(actor);

        RecoveryRecord record = loadRecord(returnId);
        if (record.getStatus() != RecoveryStatus.SOLD) {
            throw new InvalidStateException(
                    "INVALID_TRANSITION",
                    "Only SOLD recoveries can be settled. Current status: " + record.getStatus());
        }
        record.transitionTo(RecoveryStatus.SETTLED);
        record.setSettledAt(Instant.now());
        audit(AuditAction.RECOVERY_SETTLED, record, actor, "Recovery settled, net " + record.getNetRecovered());
        metrics.recoverySettled();
        log.info(
                "operation=recovery-settle returnId={} recordId={} actor={} outcome=SETTLED",
                returnId, record.getId(), actor.getEmail());
        return RecoveryDtos.RecoveryResponse.from(record);
    }

    @Transactional
    public RecoveryDtos.RecoveryResponse fail(UUID returnId, String reason) {
        User actor = securityUtils.currentUser();
        requireStaffOrAdmin(actor);
        if (reason == null || reason.isBlank()) {
            throw new BusinessException("FAILURE_REASON_REQUIRED", "Failure reason must be provided");
        }
        RecoveryRecord record = loadRecord(returnId);
        record.transitionTo(RecoveryStatus.FAILED);
        record.setNotes(reason.trim());
        log.info(
                "operation=recovery-fail returnId={} recordId={} actor={} outcome=FAILED",
                returnId, record.getId(), actor.getEmail());
        return RecoveryDtos.RecoveryResponse.from(record);
    }

    @Transactional
    public RecoveryDtos.RecoveryResponse correct(
            UUID returnId, BigDecimal actualRecovered, BigDecimal fees, String reason) {
        User actor = securityUtils.currentUser();
        requireAdmin(actor);
        if (reason == null || reason.isBlank()) {
            throw new BusinessException("CORRECTION_REASON_REQUIRED", "Correction reason must be provided");
        }
        RecoveryRecord record = loadRecord(returnId);
        if (record.getStatus() != RecoveryStatus.SOLD && record.getStatus() != RecoveryStatus.SETTLED) {
            throw new InvalidStateException(
                    "INVALID_TRANSITION", "Only SOLD or SETTLED recoveries can be corrected");
        }
        BigDecimal oldActual = record.getActualRecovered();
        BigDecimal oldFees = record.getFees();
        if (actualRecovered != null) {
            record.setActualRecovered(calculator.amount("actualRecovered", actualRecovered));
        }
        if (fees != null) {
            record.setFees(calculator.amount("fees", fees));
        }
        RecoveryBreakdown breakdown = calculator.calculate(
                record.getActualRecovered() != null ? record.getActualRecovered() : BigDecimal.ZERO,
                record.getFees(),
                BigDecimal.ZERO,
                BigDecimal.ZERO);
        record.setNetRecovered(breakdown.netRecovery());
        auditService.log(
                AuditAction.OPERATIONAL_CORRECTION, "RecoveryRecord", record.getId().toString(),
                actor.getEmail(), "Recovery corrected: " + reason.trim(),
                "returnId=" + returnId + ",actual " + oldActual + "->" + record.getActualRecovered()
                        + ",fees " + oldFees + "->" + record.getFees());
        log.info(
                "operation=recovery-correct returnId={} recordId={} actor={} outcome=CORRECTED",
                returnId, record.getId(), actor.getEmail());
        return RecoveryDtos.RecoveryResponse.from(record);
    }

    /** Defaults expected recovery to the evaluated net of the final channel. */
    private BigDecimal evaluationNet(DispositionExecution execution) {
        return evaluations
                .findByProductReturnId(execution.getProductReturn().getId())
                .flatMap(evaluation -> evaluation.getCandidates().stream()
                        .filter(c -> c.getDisposition() == execution.getDisposition())
                        .map(c -> c.getNetRecovery())
                        .findFirst())
                .orElse(BigDecimal.ZERO);
    }

    private RecoveryRecord loadRecord(UUID returnId) {
        return records.findByProductReturnId(returnId)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "RECOVERY_NOT_FOUND", "No recovery record for return: " + returnId));
    }

    private DispositionExecution loadInProgressSaleExecution(UUID returnId) {
        DispositionExecution execution = executions
                .findByProductReturnId(returnId)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "EXECUTION_NOT_FOUND", "No execution for return: " + returnId));
        if (execution.getDisposition() != Disposition.RESELL
                && execution.getDisposition() != Disposition.LIQUIDATE) {
            throw new BusinessException(
                    "DISPOSITION_MISMATCH",
                    "Recovery records require final disposition RESELL or LIQUIDATE, found: "
                            + execution.getDisposition());
        }
        if (execution.getStatus() != ExecutionStatus.IN_PROGRESS) {
            throw new BusinessException(
                    "EXECUTION_NOT_IN_PROGRESS",
                    "Recovery records require an IN_PROGRESS execution. Current status: " + execution.getStatus());
        }
        return execution;
    }

    private void audit(AuditAction action, RecoveryRecord record, User actor, String reason) {
        auditService.log(
                action, "RecoveryRecord", record.getId().toString(), actor.getEmail(), reason,
                "returnId=" + record.getProductReturn().getId());
    }

    private void requireStaffOrAdmin(User user) {
        if (user.getRole() != Role.WAREHOUSE_STAFF && user.getRole() != Role.ADMIN) {
            throw new BusinessException("FORBIDDEN", "Only warehouse staff or admin can manage recoveries");
        }
    }

    private void requireAdmin(User user) {
        if (user.getRole() != Role.ADMIN) {
            throw new BusinessException("FORBIDDEN", "Only admins can correct operational records");
        }
    }
}
