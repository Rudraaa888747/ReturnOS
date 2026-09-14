package com.returnos.vendor;

import com.returnos.audit.AuditAction;
import com.returnos.audit.AuditService;
import com.returnos.common.exception.BusinessException;
import com.returnos.common.exception.InvalidStateException;
import com.returnos.common.exception.ResourceNotFoundException;
import com.returnos.common.observability.OperationsMetrics;
import com.returnos.common.security.SecurityUtils;
import com.returnos.disposition.Disposition;
import com.returnos.disposition.RecoveryCalculator;
import com.returnos.execution.DispositionExecution;
import com.returnos.execution.DispositionExecutionRepository;
import com.returnos.execution.ExecutionStatus;
import com.returnos.returns.Return;
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
public class VendorClaimService {

    private static final Logger log = LoggerFactory.getLogger(VendorClaimService.class);

    private final VendorClaimRepository claims;
    private final DispositionExecutionRepository executions;
    private final RecoveryCalculator amounts;
    private final AuditService auditService;
    private final SecurityUtils securityUtils;
    private final OperationsMetrics metrics;

    public VendorClaimService(
            VendorClaimRepository claims,
            DispositionExecutionRepository executions,
            RecoveryCalculator amounts,
            AuditService auditService,
            SecurityUtils securityUtils,
            OperationsMetrics metrics) {
        this.claims = claims;
        this.executions = executions;
        this.amounts = amounts;
        this.auditService = auditService;
        this.securityUtils = securityUtils;
        this.metrics = metrics;
    }

    @Transactional
    public VendorDtos.VendorClaimResponse create(
            UUID returnId, String vendorReference, BigDecimal expectedCredit, String notes) {
        User actor = securityUtils.currentUser();
        requireStaffOrAdmin(actor);

        DispositionExecution execution = loadInProgressVendorExecution(returnId);
        if (claims.existsByExecutionId(execution.getId())) {
            throw new BusinessException(
                    "DUPLICATE_CLAIM", "Vendor claim already exists for execution: " + execution.getId());
        }
        Return productReturn = execution.getProductReturn();
        if (productReturn.getItems().isEmpty()) {
            throw new BusinessException("INVALID_RETURN", "Return has no items to claim");
        }
        int quantity = productReturn.getItems().stream().mapToInt(item -> item.getQuantity()).sum();

        VendorClaim claim = new VendorClaim(
                execution,
                productReturn,
                productReturn.getItems().get(0).getProduct(),
                quantity,
                productReturn.getItems().get(0).getReason(),
                vendorReference != null ? vendorReference.trim() : null,
                expectedCredit != null ? amounts.amount("expectedCredit", expectedCredit) : null,
                notes,
                actor);
        try {
            claims.saveAndFlush(claim);
        } catch (DataIntegrityViolationException e) {
            throw new BusinessException(
                    "DUPLICATE_CLAIM", "Vendor claim already exists for execution: " + execution.getId());
        }
        audit(AuditAction.VENDOR_CLAIM_CREATED, claim, actor, "Vendor claim opened in DRAFT");
        log.info(
                "operation=vendor-claim-create returnId={} claimId={} actor={} outcome=DRAFT",
                returnId, claim.getId(), actor.getEmail());
        return VendorDtos.VendorClaimResponse.from(claim);
    }

    @Transactional(readOnly = true)
    public VendorDtos.VendorClaimResponse get(UUID returnId) {
        User current = securityUtils.currentUser();
        VendorClaim claim = claims.findByProductReturnId(returnId)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "VENDOR_CLAIM_NOT_FOUND", "No vendor claim for return: " + returnId));
        if (current.getRole() == Role.CUSTOMER
                && !claim.getProductReturn().getCustomer().getId().equals(current.getId())) {
            throw new BusinessException("FORBIDDEN", "You can only view your own returns");
        }
        return VendorDtos.VendorClaimResponse.from(claim);
    }

    @Transactional
    public VendorDtos.VendorClaimResponse submit(UUID returnId) {
        return transition(returnId, VendorClaimStatus.SUBMITTED, AuditAction.VENDOR_CLAIM_SUBMITTED, "submitted");
    }

    @Transactional
    public VendorDtos.VendorClaimResponse acknowledge(UUID returnId) {
        return transition(returnId, VendorClaimStatus.ACKNOWLEDGED, null, "acknowledged");
    }

    @Transactional
    public VendorDtos.VendorClaimResponse approve(UUID returnId) {
        return transition(returnId, VendorClaimStatus.APPROVED, AuditAction.VENDOR_CLAIM_APPROVED, "approved");
    }

    @Transactional
    public VendorDtos.VendorClaimResponse reject(UUID returnId, String reason) {
        User actor = securityUtils.currentUser();
        requireStaffOrAdmin(actor);
        if (reason == null || reason.isBlank()) {
            throw new BusinessException("REJECTION_REASON_REQUIRED", "Rejection reason must be provided");
        }
        VendorClaim claim = loadClaim(returnId);
        claim.transitionTo(VendorClaimStatus.REJECTED);
        claim.setDecidedAt(Instant.now());
        audit(AuditAction.VENDOR_CLAIM_REJECTED, claim, actor, "Vendor claim rejected: " + reason.trim());
        log.info(
                "operation=vendor-claim-reject returnId={} claimId={} actor={} outcome=REJECTED",
                returnId, claim.getId(), actor.getEmail());
        return VendorDtos.VendorClaimResponse.from(claim);
    }

    @Transactional
    public VendorDtos.VendorClaimResponse settle(UUID returnId, BigDecimal actualCredit, String notes) {
        User actor = securityUtils.currentUser();
        requireStaffOrAdmin(actor);

        VendorClaim claim = loadClaim(returnId);
        if (claim.getStatus() != VendorClaimStatus.APPROVED) {
            throw new InvalidStateException(
                    "INVALID_TRANSITION",
                    "Only APPROVED claims can be settled. Current status: " + claim.getStatus());
        }
        claim.transitionTo(VendorClaimStatus.SETTLED);
        BigDecimal actual = actualCredit != null
                ? amounts.amount("actualCredit", actualCredit)
                : claim.getExpectedCredit();
        claim.setActualCredit(actual);
        if (notes != null && !notes.isBlank()) {
            claim.setNotes(notes.trim());
        }
        claim.setSettledAt(Instant.now());
        audit(AuditAction.VENDOR_CLAIM_SETTLED, claim, actor, "Vendor claim settled for credit " + actual);
        metrics.vendorSettled();
        log.info(
                "operation=vendor-claim-settle returnId={} claimId={} actor={} outcome=SETTLED",
                returnId, claim.getId(), actor.getEmail());
        return VendorDtos.VendorClaimResponse.from(claim);
    }

    private VendorDtos.VendorClaimResponse transition(
            UUID returnId, VendorClaimStatus target, AuditAction auditAction, String outcome) {
        User actor = securityUtils.currentUser();
        requireStaffOrAdmin(actor);

        VendorClaim claim = loadClaim(returnId);
        claim.transitionTo(target);
        Instant now = Instant.now();
        if (target == VendorClaimStatus.SUBMITTED) {
            claim.setSubmittedAt(now);
        } else if (target == VendorClaimStatus.ACKNOWLEDGED) {
            claim.setAcknowledgedAt(now);
        } else if (target == VendorClaimStatus.APPROVED) {
            claim.setDecidedAt(now);
        }
        if (auditAction != null) {
            audit(auditAction, claim, actor, "Vendor claim " + outcome);
        }
        log.info(
                "operation=vendor-claim-transition returnId={} claimId={} actor={} outcome={}",
                returnId, claim.getId(), actor.getEmail(), target);
        return VendorDtos.VendorClaimResponse.from(claim);
    }

    private VendorClaim loadClaim(UUID returnId) {
        return claims.findByProductReturnId(returnId)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "VENDOR_CLAIM_NOT_FOUND", "No vendor claim for return: " + returnId));
    }

    private DispositionExecution loadInProgressVendorExecution(UUID returnId) {
        DispositionExecution execution = executions
                .findByProductReturnId(returnId)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "EXECUTION_NOT_FOUND", "No execution for return: " + returnId));
        if (execution.getDisposition() != Disposition.RETURN_TO_VENDOR) {
            throw new BusinessException(
                    "DISPOSITION_MISMATCH",
                    "Vendor claims require final disposition RETURN_TO_VENDOR, found: "
                            + execution.getDisposition());
        }
        if (execution.getStatus() != ExecutionStatus.IN_PROGRESS) {
            throw new BusinessException(
                    "EXECUTION_NOT_IN_PROGRESS",
                    "Vendor claims require an IN_PROGRESS execution. Current status: " + execution.getStatus());
        }
        return execution;
    }

    private void audit(AuditAction action, VendorClaim claim, User actor, String reason) {
        auditService.log(
                action, "VendorClaim", claim.getId().toString(), actor.getEmail(), reason,
                "returnId=" + claim.getProductReturn().getId());
    }

    private void requireStaffOrAdmin(User user) {
        if (user.getRole() != Role.WAREHOUSE_STAFF && user.getRole() != Role.ADMIN) {
            throw new BusinessException("FORBIDDEN", "Only warehouse staff or admin can manage vendor claims");
        }
    }
}
