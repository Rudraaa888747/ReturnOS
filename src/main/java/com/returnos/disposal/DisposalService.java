package com.returnos.disposal;

import com.returnos.audit.AuditAction;
import com.returnos.audit.AuditService;
import com.returnos.common.exception.BusinessException;
import com.returnos.common.exception.ResourceNotFoundException;
import com.returnos.common.security.SecurityUtils;
import com.returnos.disposition.Disposition;
import com.returnos.disposition.RecoveryCalculator;
import com.returnos.execution.DispositionExecution;
import com.returnos.execution.DispositionExecutionRepository;
import com.returnos.execution.ExecutionStatus;
import com.returnos.user.Role;
import com.returnos.user.User;
import java.math.BigDecimal;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class DisposalService {

    private static final Logger log = LoggerFactory.getLogger(DisposalService.class);

    private final DisposalRepository disposals;
    private final DispositionExecutionRepository executions;
    private final RecoveryCalculator amounts;
    private final AuditService auditService;
    private final SecurityUtils securityUtils;

    public DisposalService(
            DisposalRepository disposals,
            DispositionExecutionRepository executions,
            RecoveryCalculator amounts,
            AuditService auditService,
            SecurityUtils securityUtils) {
        this.disposals = disposals;
        this.executions = executions;
        this.amounts = amounts;
        this.auditService = auditService;
        this.securityUtils = securityUtils;
    }

    @Transactional
    public DisposalDtos.DisposalResponse complete(
            UUID returnId,
            Integer quantity,
            String partner,
            BigDecimal estimatedRecovery,
            BigDecimal actualRecovery,
            BigDecimal processingCost,
            String notes) {
        User actor = securityUtils.currentUser();
        requireStaffOrAdmin(actor);

        DispositionExecution execution = executions
                .findByProductReturnId(returnId)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "EXECUTION_NOT_FOUND", "No execution for return: " + returnId));
        if (execution.getDisposition() != Disposition.RECYCLE
                && execution.getDisposition() != Disposition.SCRAP) {
            throw new BusinessException(
                    "DISPOSITION_MISMATCH",
                    "Disposal requires final disposition RECYCLE or SCRAP, found: " + execution.getDisposition());
        }
        if (execution.getStatus() != ExecutionStatus.IN_PROGRESS) {
            throw new BusinessException(
                    "EXECUTION_NOT_IN_PROGRESS",
                    "Disposal requires an IN_PROGRESS execution. Current status: " + execution.getStatus());
        }
        if (disposals.existsByExecutionId(execution.getId())) {
            throw new BusinessException(
                    "DUPLICATE_DISPOSAL", "Disposal already recorded for execution: " + execution.getId());
        }

        int totalQty = execution.getProductReturn().getItems().stream()
                .mapToInt(item -> item.getQuantity())
                .sum();
        int qty = quantity != null ? quantity : totalQty;
        if (qty <= 0 || qty > totalQty) {
            throw new BusinessException(
                    "INVALID_QUANTITY", "Disposal quantity must be between 1 and the returned total " + totalQty);
        }

        DisposalRecord record = new DisposalRecord(
                execution,
                execution.getProductReturn(),
                execution.getDisposition(),
                qty,
                partner != null && !partner.isBlank() ? partner.trim() : null,
                estimatedRecovery != null ? amounts.amount("estimatedRecovery", estimatedRecovery) : BigDecimal.ZERO,
                actualRecovery != null ? amounts.amount("actualRecovery", actualRecovery) : null,
                processingCost != null ? amounts.amount("processingCost", processingCost) : BigDecimal.ZERO,
                notes,
                actor);
        try {
            disposals.saveAndFlush(record);
        } catch (DataIntegrityViolationException e) {
            throw new BusinessException(
                    "DUPLICATE_DISPOSAL", "Disposal already recorded for execution: " + execution.getId());
        }
        AuditAction action = execution.getDisposition() == Disposition.RECYCLE
                ? AuditAction.RECYCLING_COMPLETED
                : AuditAction.SCRAP_COMPLETED;
        auditService.log(
                action, "DisposalRecord", record.getId().toString(),
                actor.getEmail(), execution.getDisposition() + " completed for " + qty + " unit(s)",
                "returnId=" + returnId);
        log.info(
                "operation=disposal returnId={} recordId={} actor={} outcome={}",
                returnId, record.getId(), actor.getEmail(), execution.getDisposition());
        return DisposalDtos.DisposalResponse.from(record);
    }

    private void requireStaffOrAdmin(User user) {
        if (user.getRole() != Role.WAREHOUSE_STAFF && user.getRole() != Role.ADMIN) {
            throw new BusinessException("FORBIDDEN", "Only warehouse staff or admin can record disposal");
        }
    }
}
