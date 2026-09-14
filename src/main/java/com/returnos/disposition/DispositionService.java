package com.returnos.disposition;

import com.returnos.audit.AuditAction;
import com.returnos.audit.AuditService;
import com.returnos.common.exception.BusinessException;
import com.returnos.common.exception.InvalidStateException;
import com.returnos.common.exception.ResourceNotFoundException;
import com.returnos.common.security.SecurityUtils;
import com.returnos.inspection.Inspection;
import com.returnos.inspection.InspectionRepository;
import com.returnos.execution.DispositionExecution;
import com.returnos.execution.DispositionExecutionRepository;
import com.returnos.returns.Return;
import com.returnos.returns.ReturnReason;
import com.returnos.returns.ReturnRepository;
import com.returnos.returns.ReturnStatus;
import com.returnos.user.Role;
import com.returnos.user.User;
import java.math.BigDecimal;
import java.util.Comparator;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class DispositionService {

    private final ReturnRepository returns;
    private final InspectionRepository inspections;
    private final DispositionEvaluationRepository evaluations;
    private final DispositionExecutionRepository executions;
    private final DispositionEngine engine;
    private final AuditService auditService;
    private final SecurityUtils securityUtils;

    public DispositionService(
            ReturnRepository returns,
            InspectionRepository inspections,
            DispositionEvaluationRepository evaluations,
            DispositionExecutionRepository executions,
            DispositionEngine engine,
            AuditService auditService,
            SecurityUtils securityUtils) {
        this.returns = returns;
        this.inspections = inspections;
        this.evaluations = evaluations;
        this.executions = executions;
        this.engine = engine;
        this.auditService = auditService;
        this.securityUtils = securityUtils;
    }

    public record EvaluateOutcome(DispositionDtos.EvaluationResponse response, boolean created) {}

    @Transactional
    public EvaluateOutcome evaluate(UUID returnId) {
        User actor = securityUtils.currentUser();
        requireStaffOrAdmin(actor, "evaluate return disposition");

        Return productReturn = loadCompletedReturn(returnId);
        return evaluations
                .findByProductReturnId(returnId)
                .map(existing -> new EvaluateOutcome(DispositionDtos.EvaluationResponse.from(existing), false))
                .orElseGet(() -> new EvaluateOutcome(persistEvaluation(productReturn, actor), true));
    }

    @Transactional(readOnly = true)
    public DispositionDtos.EvaluationResponse get(UUID returnId) {
        User current = securityUtils.currentUser();
        Return productReturn = returns.findWithItemsById(returnId)
                .orElseThrow(() -> new ResourceNotFoundException("RETURN_NOT_FOUND", "Return not found: " + returnId));
        enforceVisibility(productReturn, current);
        return evaluations
                .findByProductReturnId(returnId)
                .map(DispositionDtos.EvaluationResponse::from)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "DISPOSITION_NOT_FOUND", "Return disposition has not been evaluated yet: " + returnId));
    }

    @Transactional
    public DispositionDtos.EvaluationResponse finalizeDisposition(
            UUID returnId, Disposition disposition, String overrideReason) {
        User actor = securityUtils.currentUser();
        requireStaffOrAdmin(actor, "record the final disposition");

        DispositionEvaluation evaluation = loadUnfinalizedEvaluation(returnId);
        Disposition target = disposition != null ? disposition : evaluation.getRecommended();
        boolean isOverride = target != evaluation.getRecommended();
        if (isOverride) {
            requireAdmin(actor);
            requireOverrideReason(overrideReason);
            evaluation.setOverridden(true);
            evaluation.setOverrideReason(overrideReason.trim());
            auditService.log(
                    AuditAction.DISPOSITION_OVERRIDDEN, "Return", returnId.toString(),
                    actor.getEmail(),
                    "Disposition overridden from " + evaluation.getRecommended() + " to " + target,
                    "overrideReason=" + overrideReason.trim());
        }
        evaluation.setFinalDisposition(target);
        evaluation.setFinalizedBy(actor);
        evaluation.setFinalizedAt(java.time.Instant.now());
        auditService.log(
                AuditAction.FINAL_DISPOSITION_RECORDED, "Return", returnId.toString(),
                actor.getEmail(), "Final disposition recorded: " + target,
                "final=" + target + ",overridden=" + evaluation.isOverridden());
        // Hand the finalized disposition to operations: a PENDING execution row
        // is created once so the execution workflow has something to start.
        if (!executions.existsByProductReturnId(returnId)) {
            executions.save(new DispositionExecution(evaluation.getProductReturn(), target));
        }
        return DispositionDtos.EvaluationResponse.from(evaluation);
    }

    @Transactional
    public DispositionDtos.EvaluationResponse override(UUID returnId, Disposition disposition, String reason) {
        User actor = securityUtils.currentUser();
        requireAdmin(actor);
        if (disposition == null) {
            throw new BusinessException("INVALID_DISPOSITION", "Override disposition must be provided");
        }
        DispositionEvaluation evaluation = loadUnfinalizedEvaluation(returnId);
        if (disposition == evaluation.getRecommended()) {
            throw new BusinessException(
                    "NOT_AN_OVERRIDE",
                    "Disposition matches the recommendation; use finalize instead of override");
        }
        return finalizeDisposition(returnId, disposition, reason);
    }

    private DispositionDtos.EvaluationResponse persistEvaluation(Return productReturn, User actor) {
        Inspection inspection = inspections
                .findByProductReturnId(productReturn.getId())
                .orElseThrow(() -> new ResourceNotFoundException(
                        "INSPECTION_NOT_FOUND",
                        "Inspection not found for return: " + productReturn.getId()));

        BigDecimal goodsValue = productReturn.getItems().stream()
                .map(item -> item.getProduct().getPrice() != null
                        ? item.getProduct().getPrice().multiply(BigDecimal.valueOf(item.getQuantity()))
                        : BigDecimal.ZERO)
                .reduce(BigDecimal.ZERO, BigDecimal::add);

        DispositionInput input = new DispositionInput(
                inspection.getPhysicalCondition(),
                inspection.getPackagingCondition(),
                inspection.isAccessoriesComplete(),
                inspection.getFunctionalTestResult(),
                goodsValue,
                primaryReason(productReturn),
                productReturn.getOrder().getDeliveredAt(),
                java.time.Instant.now());
        DispositionResult result = engine.evaluate(input);

        DispositionEvaluation evaluation = new DispositionEvaluation(
                productReturn, result.recommended(), actor, result.evaluatedAt());
        result.candidates()
                .forEach(c -> evaluation.addCandidate(new EvaluationCandidate(
                        c.disposition(), c.eligible(), c.recoveryValue(), c.processingCost(),
                        c.shippingCost(), c.refurbishmentCost(), c.netRecovery(), c.reason())));
        evaluations.save(evaluation);

        DispositionCandidate recommended = result.candidates().stream()
                .filter(c -> c.disposition() == result.recommended())
                .findFirst()
                .orElseThrow();
        auditService.log(
                AuditAction.DISPOSITION_EVALUATED, "Return", productReturn.getId().toString(),
                actor.getEmail(), "Disposition evaluated, recommended " + result.recommended(),
                "recommended=" + result.recommended() + ",netRecovery=" + recommended.netRecovery());
        auditService.log(
                AuditAction.DISPOSITION_RECOMMENDED, "Return", productReturn.getId().toString(),
                actor.getEmail(), "System recommends " + result.recommended(),
                "netRecovery=" + recommended.netRecovery());
        return DispositionDtos.EvaluationResponse.from(evaluation);
    }

    /** Deterministic primary reason: most frequent, ties broken alphabetically. */
    private ReturnReason primaryReason(Return productReturn) {
        Map<ReturnReason, Long> counts = productReturn.getItems().stream()
                .map(item -> item.getReason())
                .collect(Collectors.groupingBy(Function.identity(), Collectors.counting()));
        return counts.entrySet().stream()
                .max(Comparator.comparingLong((Map.Entry<ReturnReason, Long> e) -> e.getValue())
                        .thenComparing(e -> e.getKey().name()))
                .map(Map.Entry::getKey)
                .orElse(ReturnReason.OTHER);
    }

    private Return loadCompletedReturn(UUID returnId) {
        Return productReturn = returns.findWithItemsById(returnId)
                .orElseThrow(() -> new ResourceNotFoundException("RETURN_NOT_FOUND", "Return not found: " + returnId));
        if (productReturn.getStatus() != ReturnStatus.INSPECTION_COMPLETED) {
            throw new InvalidStateException(
                    "INSPECTION_INCOMPLETE",
                    "Disposition requires a completed inspection. Current status: " + productReturn.getStatus());
        }
        return productReturn;
    }

    private DispositionEvaluation loadUnfinalizedEvaluation(UUID returnId) {
        returns.findWithItemsById(returnId)
                .orElseThrow(() -> new ResourceNotFoundException("RETURN_NOT_FOUND", "Return not found: " + returnId));
        DispositionEvaluation evaluation = evaluations
                .findByProductReturnId(returnId)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "DISPOSITION_NOT_FOUND", "Return disposition has not been evaluated yet: " + returnId));
        if (evaluation.getFinalDisposition() != null) {
            throw new BusinessException(
                    "ALREADY_FINALIZED",
                    "Final disposition already recorded: " + evaluation.getFinalDisposition());
        }
        return evaluation;
    }

    private void enforceVisibility(Return productReturn, User current) {
        if (current.getRole() == Role.CUSTOMER
                && !productReturn.getCustomer().getId().equals(current.getId())) {
            throw new BusinessException("FORBIDDEN", "You can only view your own returns");
        }
    }

    private void requireStaffOrAdmin(User user, String action) {
        if (user.getRole() != Role.WAREHOUSE_STAFF && user.getRole() != Role.ADMIN) {
            throw new BusinessException("FORBIDDEN", "Only warehouse staff or admin can " + action);
        }
    }

    private void requireAdmin(User user) {
        if (user.getRole() != Role.ADMIN) {
            throw new BusinessException("FORBIDDEN", "Only admins can override the disposition recommendation");
        }
    }

    private void requireOverrideReason(String reason) {
        if (reason == null || reason.isBlank()) {
            throw new BusinessException("OVERRIDE_REASON_REQUIRED", "Override requires a non-empty reason");
        }
    }
}
