package com.returnos.inventory;

import com.returnos.audit.AuditAction;
import com.returnos.audit.AuditService;
import com.returnos.common.exception.BusinessException;
import com.returnos.common.exception.ResourceNotFoundException;
import com.returnos.common.security.SecurityUtils;
import com.returnos.disposition.Disposition;
import com.returnos.execution.DispositionExecution;
import com.returnos.execution.DispositionExecutionRepository;
import com.returnos.execution.ExecutionStatus;
import com.returnos.returns.Return;
import com.returnos.user.Role;
import com.returnos.user.User;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class InventoryRecoveryService {

    private static final Logger log = LoggerFactory.getLogger(InventoryRecoveryService.class);

    private final InventoryRecoveryRepository recoveries;
    private final DispositionExecutionRepository executions;
    private final AuditService auditService;
    private final SecurityUtils securityUtils;

    public InventoryRecoveryService(
            InventoryRecoveryRepository recoveries,
            DispositionExecutionRepository executions,
            AuditService auditService,
            SecurityUtils securityUtils) {
        this.recoveries = recoveries;
        this.executions = executions;
        this.auditService = auditService;
        this.securityUtils = securityUtils;
    }

    @Transactional
    public InventoryDtos.InventoryRecoveryResponse restock(
            UUID returnId, Integer quantity, Integer recoveredQuantity, String destination) {
        User actor = securityUtils.currentUser();
        requireStaffOrAdmin(actor);

        DispositionExecution execution = loadInProgressExecution(returnId);
        if (execution.getDisposition() != Disposition.RESTOCK) {
            throw new BusinessException(
                    "DISPOSITION_MISMATCH",
                    "Inventory recovery requires final disposition RESTOCK, found: " + execution.getDisposition());
        }
        if (recoveries.existsByExecutionId(execution.getId())) {
            throw new BusinessException(
                    "DUPLICATE_RESTOCK", "Inventory already recovered for execution: " + execution.getId());
        }

        Return productReturn = execution.getProductReturn();
        int totalQty = productReturn.getItems().stream().mapToInt(item -> item.getQuantity()).sum();
        int qty = quantity != null ? quantity : totalQty;
        int recovered = recoveredQuantity != null ? recoveredQuantity : qty;
        if (qty <= 0 || qty > totalQty) {
            throw new BusinessException(
                    "INVALID_QUANTITY",
                    "Restock quantity must be between 1 and the returned total " + totalQty);
        }
        if (recovered < 0 || recovered > qty) {
            throw new BusinessException(
                    "INVALID_QUANTITY", "Recovered quantity must be between 0 and " + qty);
        }
        if (productReturn.getItems().isEmpty()) {
            throw new BusinessException("INVALID_RETURN", "Return has no items to restock");
        }

        InventoryRecovery recovery = new InventoryRecovery(
                execution,
                productReturn,
                productReturn.getItems().get(0).getProduct(),
                qty,
                recovered,
                destination.trim(),
                actor);
        try {
            recoveries.saveAndFlush(recovery);
        } catch (DataIntegrityViolationException e) {
            throw new BusinessException(
                    "DUPLICATE_RESTOCK", "Inventory already recovered for execution: " + execution.getId());
        }
        auditService.log(
                AuditAction.RESTOCK_COMPLETED, "InventoryRecovery", recovery.getId().toString(),
                actor.getEmail(), "Restocked " + recovered + " unit(s) to " + destination.trim(),
                "returnId=" + returnId);
        log.info(
                "operation=restock returnId={} executionId={} actor={} outcome=RESTOCKED",
                returnId, execution.getId(), actor.getEmail());
        return InventoryDtos.InventoryRecoveryResponse.from(recovery);
    }

    private DispositionExecution loadInProgressExecution(UUID returnId) {
        DispositionExecution execution = executions
                .findByProductReturnId(returnId)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "EXECUTION_NOT_FOUND", "No execution for return: " + returnId));
        if (execution.getStatus() != ExecutionStatus.IN_PROGRESS) {
            throw new BusinessException(
                    "EXECUTION_NOT_IN_PROGRESS",
                    "Channel records require an IN_PROGRESS execution. Current status: " + execution.getStatus());
        }
        return execution;
    }

    private void requireStaffOrAdmin(User user) {
        if (user.getRole() != Role.WAREHOUSE_STAFF && user.getRole() != Role.ADMIN) {
            throw new BusinessException("FORBIDDEN", "Only warehouse staff or admin can record restocking");
        }
    }
}
