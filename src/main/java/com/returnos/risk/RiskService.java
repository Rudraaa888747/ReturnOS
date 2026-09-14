package com.returnos.risk;

import com.returnos.audit.AuditAction;
import com.returnos.audit.AuditService;
import com.returnos.common.exception.BusinessException;
import com.returnos.common.exception.InvalidStateException;
import com.returnos.common.exception.ResourceNotFoundException;
import com.returnos.common.security.SecurityUtils;
import com.returnos.returns.Return;
import com.returnos.returns.ReturnItemRepository;
import com.returnos.returns.ReturnReason;
import com.returnos.returns.ReturnRepository;
import com.returnos.returns.ReturnStatus;
import com.returnos.user.Role;
import com.returnos.user.User;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class RiskService {

    private final ReturnRepository returns;
    private final ReturnItemRepository returnItems;
    private final RiskAssessmentRepository assessments;
    private final RiskAssessmentEngine engine;
    private final RiskEngineProperties properties;
    private final AuditService auditService;
    private final SecurityUtils securityUtils;

    public RiskService(
            ReturnRepository returns,
            ReturnItemRepository returnItems,
            RiskAssessmentRepository assessments,
            RiskAssessmentEngine engine,
            RiskEngineProperties properties,
            AuditService auditService,
            SecurityUtils securityUtils) {
        this.returns = returns;
        this.returnItems = returnItems;
        this.assessments = assessments;
        this.engine = engine;
        this.properties = properties;
        this.auditService = auditService;
        this.securityUtils = securityUtils;
    }

    public record AssessOutcome(RiskDtos.RiskAssessmentResponse response, boolean created) {}

    @Transactional
    public AssessOutcome assess(UUID returnId) {
        User actor = securityUtils.currentUser();
        requireStaffOrAdmin(actor);

        Return productReturn = returns.findWithItemsById(returnId)
                .orElseThrow(() -> new ResourceNotFoundException("RETURN_NOT_FOUND", "Return not found: " + returnId));
        requireInspectionCompleted(productReturn);

        return assessments
                .findByProductReturnId(returnId)
                .map(existing -> new AssessOutcome(RiskDtos.RiskAssessmentResponse.from(existing), false))
                .orElseGet(() -> new AssessOutcome(persistAssessment(productReturn, actor), true));
    }

    @Transactional(readOnly = true)
    public RiskDtos.RiskAssessmentResponse get(UUID returnId) {
        User current = securityUtils.currentUser();
        Return productReturn = returns.findWithItemsById(returnId)
                .orElseThrow(() -> new ResourceNotFoundException("RETURN_NOT_FOUND", "Return not found: " + returnId));
        enforceVisibility(productReturn, current);
        return assessments
                .findByProductReturnId(returnId)
                .map(RiskDtos.RiskAssessmentResponse::from)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "RISK_NOT_FOUND", "No risk assessment for return: " + returnId));
    }

    private RiskDtos.RiskAssessmentResponse persistAssessment(Return productReturn, User actor) {
        Instant now = Instant.now();
        Instant windowStart = now.minus(properties.getRecentWindowDays(), ChronoUnit.DAYS);
        UUID customerId = productReturn.getCustomer().getId();

        // Counts include the return being assessed, so exclude it for "previous" semantics.
        int recent = (int) Math.max(
                0, returns.countByCustomerIdAndCreatedAtAfter(customerId, windowStart) - 1);
        int lifetime =
                (int) Math.max(0, returns.countByCustomerId(customerId) - 1);
        BigDecimal orderValue = productReturn.getOrder().getSubtotal() != null
                ? productReturn.getOrder().getSubtotal()
                : BigDecimal.ZERO;
        List<ReturnReason> reasons =
                productReturn.getItems().stream().map(item -> item.getReason()).toList();
        boolean repeatProduct = productReturn.getItems().stream()
                .anyMatch(item -> returnItems.countOtherActiveReturnsWithProduct(
                                customerId, item.getProduct().getId(), productReturn.getId())
                        > 0);

        RiskAssessmentContext context = new RiskAssessmentContext(
                productReturn.getId(),
                customerId,
                recent,
                lifetime,
                orderValue,
                reasons,
                repeatProduct,
                productReturn.getItems().size());
        RiskResult result = engine.assess(context);

        RiskAssessment assessment = new RiskAssessment(
                productReturn, result.score(), result.level(), actor, result.assessedAt());
        result.contributions()
                .forEach(c -> assessment.addFactor(new RiskFactor(c.ruleCode(), c.points(), c.explanation())));
        assessments.save(assessment);

        auditService.log(
                AuditAction.RISK_ASSESSMENT_CREATED, "Return", productReturn.getId().toString(),
                actor.getEmail(), "Risk assessed as " + result.level() + " (score " + result.score() + ")",
                "score=" + result.score() + ",level=" + result.level());
        return RiskDtos.RiskAssessmentResponse.from(assessment);
    }

    private void requireInspectionCompleted(Return productReturn) {
        if (productReturn.getStatus() != ReturnStatus.INSPECTION_COMPLETED) {
            throw new InvalidStateException(
                    "INSPECTION_INCOMPLETE",
                    "Risk assessment requires a completed inspection. Current status: "
                            + productReturn.getStatus());
        }
    }

    private void enforceVisibility(Return productReturn, User current) {
        if (current.getRole() == Role.CUSTOMER
                && !productReturn.getCustomer().getId().equals(current.getId())) {
            throw new BusinessException("FORBIDDEN", "You can only view your own returns");
        }
    }

    private void requireStaffOrAdmin(User user) {
        if (user.getRole() != Role.WAREHOUSE_STAFF && user.getRole() != Role.ADMIN) {
            throw new BusinessException("FORBIDDEN", "Only warehouse staff or admin can assess return risk");
        }
    }
}
