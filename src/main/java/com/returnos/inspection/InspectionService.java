package com.returnos.inspection;

import com.returnos.audit.AuditAction;
import com.returnos.audit.AuditService;
import com.returnos.common.exception.BusinessException;
import com.returnos.common.exception.InvalidStateException;
import com.returnos.common.exception.ResourceNotFoundException;
import com.returnos.common.security.SecurityUtils;
import com.returnos.returns.Return;
import com.returnos.returns.ReturnRepository;
import com.returnos.returns.ReturnStatus;
import com.returnos.user.Role;
import com.returnos.user.User;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class InspectionService {

    private final InspectionRepository inspections;
    private final ReturnRepository returns;
    private final AuditService auditService;
    private final SecurityUtils securityUtils;

    public InspectionService(
            InspectionRepository inspections,
            ReturnRepository returns,
            AuditService auditService,
            SecurityUtils securityUtils) {
        this.inspections = inspections;
        this.returns = returns;
        this.auditService = auditService;
        this.securityUtils = securityUtils;
    }

    @Transactional
    public InspectionDtos.InspectionResponse create(UUID returnId, InspectionDtos.CreateInspectionRequest request) {
        User staff = securityUtils.currentUser();
        requireStaffOrAdmin(staff);

        Return productReturn = returns.findWithItemsById(returnId)
                .orElseThrow(() -> new ResourceNotFoundException("RETURN_NOT_FOUND", "Return not found: " + returnId));

        if (inspections.existsByProductReturnId(returnId)) {
            throw new BusinessException("INSPECTION_EXISTS", "Inspection already exists for return: " + returnId);
        }

        // Allowed states: RECEIVED, INSPECTION_PENDING, INSPECTION_IN_PROGRESS.
        // Walk the state machine explicitly so audit trail shows STARTED then COMPLETED.
        if (productReturn.getStatus() == ReturnStatus.RECEIVED) {
            productReturn.transitionTo(ReturnStatus.INSPECTION_PENDING);
        }
        if (productReturn.getStatus() == ReturnStatus.INSPECTION_PENDING) {
            productReturn.transitionTo(ReturnStatus.INSPECTION_IN_PROGRESS);
            auditService.log(
                    AuditAction.INSPECTION_STARTED, "Return", productReturn.getId().toString(),
                    staff.getEmail(), "Inspection started", null);
        }
        if (productReturn.getStatus() != ReturnStatus.INSPECTION_IN_PROGRESS) {
            throw new InvalidStateException(
                    "Inspection is only possible for RECEIVED, INSPECTION_PENDING or INSPECTION_IN_PROGRESS returns. "
                            + "Current status: " + productReturn.getStatus());
        }

        Inspection inspection = new Inspection(
                productReturn,
                request.physicalCondition(),
                request.packagingCondition(),
                request.accessoriesComplete(),
                request.functionalTestResult(),
                request.visibleDamage(),
                request.notes(),
                staff);
        inspections.save(inspection);

        productReturn.transitionTo(ReturnStatus.INSPECTION_COMPLETED);
        auditService.log(
                AuditAction.INSPECTION_COMPLETED, "Return", productReturn.getId().toString(),
                staff.getEmail(), "Inspection completed", request.physicalCondition().name());

        return InspectionDtos.InspectionResponse.from(inspection);
    }

    @Transactional(readOnly = true)
    public InspectionDtos.InspectionResponse getByReturnId(UUID returnId) {
        User current = securityUtils.currentUser();
        Return productReturn = returns.findWithItemsById(returnId)
                .orElseThrow(() -> new ResourceNotFoundException("RETURN_NOT_FOUND", "Return not found: " + returnId));
        if (current.getRole() == Role.CUSTOMER
                && !productReturn.getCustomer().getId().equals(current.getId())) {
            throw new BusinessException("FORBIDDEN", "You can only view your own returns");
        }
        Inspection inspection = inspections.findByProductReturnId(returnId)
                .orElseThrow(() -> new ResourceNotFoundException("INSPECTION_NOT_FOUND", "Inspection not found"));
        return InspectionDtos.InspectionResponse.from(inspection);
    }

    private void requireStaffOrAdmin(User user) {
        if (user.getRole() != Role.WAREHOUSE_STAFF && user.getRole() != Role.ADMIN) {
            throw new BusinessException("FORBIDDEN", "Only warehouse staff or admin can inspect returns");
        }
    }
}
