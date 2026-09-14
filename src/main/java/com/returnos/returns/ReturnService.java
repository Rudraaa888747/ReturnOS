package com.returnos.returns;

import com.returnos.audit.AuditAction;
import com.returnos.audit.AuditService;
import com.returnos.common.exception.BusinessException;
import com.returnos.common.exception.InvalidStateException;
import com.returnos.common.exception.ResourceNotFoundException;
import com.returnos.common.security.SecurityUtils;
import com.returnos.order.Order;
import com.returnos.order.OrderRepository;
import com.returnos.policy.EligibilityResult;
import com.returnos.policy.ReturnPolicyService;
import com.returnos.user.Role;
import com.returnos.user.User;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ReturnService {

    private static final SecureRandom RANDOM = new SecureRandom();
    private static final String ALPHANUM = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    private final ReturnRepository returns;
    private final ReturnItemRepository returnItems;
    private final OrderRepository orders;
    private final ReturnPolicyService policyService;
    private final AuditService auditService;
    private final SecurityUtils securityUtils;

    public ReturnService(
            ReturnRepository returns,
            ReturnItemRepository returnItems,
            OrderRepository orders,
            ReturnPolicyService policyService,
            AuditService auditService,
            SecurityUtils securityUtils) {
        this.returns = returns;
        this.returnItems = returnItems;
        this.orders = orders;
        this.policyService = policyService;
        this.auditService = auditService;
        this.securityUtils = securityUtils;
    }

    @Transactional
    public ReturnDtos.ReturnResponse create(ReturnDtos.CreateReturnRequest request) {
        User customer = securityUtils.currentUser();

        Order order = orders.findWithItemsById(request.orderId())
                .orElseThrow(() -> new ResourceNotFoundException("ORDER_NOT_FOUND", "Order not found"));

        if (customer.getRole() == Role.CUSTOMER
                && !order.getCustomer().getId().equals(customer.getId())) {
            throw new BusinessException("FORBIDDEN", "You can only return your own orders");
        }

        if (request.items() == null || request.items().isEmpty()) {
            throw new BusinessException("EMPTY_RETURN", "Return must contain at least one item");
        }

        Map<UUID, com.returnos.order.OrderItem> orderItemById = order.getItems().stream()
                .collect(Collectors.toMap(com.returnos.order.OrderItem::getId, oi -> oi));

        List<ReturnPolicyService.ItemEligibility> eligibilityItems = new ArrayList<>();
        for (ReturnDtos.CreateReturnItemRequest itemReq : request.items()) {
            com.returnos.order.OrderItem orderItem = orderItemById.get(itemReq.orderItemId());
            if (orderItem == null) {
                throw new BusinessException(
                        "INVALID_ORDER_ITEM", "Order item does not belong to order: " + itemReq.orderItemId());
            }
            long alreadyReturned = returnItems.sumActiveReturnedQuantity(order.getId(), orderItem.getId());
            if (alreadyReturned + itemReq.quantity() > orderItem.getQuantity()) {
                throw new BusinessException(
                        "QUANTITY_EXCEEDED",
                        "Return quantity for " + orderItem.getProduct().getSku()
                                + " exceeds remaining returnable quantity. Ordered: " + orderItem.getQuantity()
                                + ", already requested: " + alreadyReturned);
            }
            eligibilityItems.add(new ReturnPolicyService.ItemEligibility(
                    orderItem.getProduct().getSku(),
                    orderItem.getProduct().getCategory(),
                    orderItem.getProduct().isActive(),
                    itemReq.quantity(),
                    orderItem.getQuantity(),
                    itemReq.reason()));
        }

        EligibilityResult eligibility = policyService.evaluate(order, eligibilityItems, Instant.now());
        if (!eligibility.eligible()) {
            throw new BusinessException("RETURN_NOT_ELIGIBLE", eligibility.reason());
        }

        Return productReturn = new Return(generateReturnNumber(), order, order.getCustomer());
        for (ReturnDtos.CreateReturnItemRequest itemReq : request.items()) {
            com.returnos.order.OrderItem orderItem = orderItemById.get(itemReq.orderItemId());
            ReturnItem returnItem = new ReturnItem(
                    orderItem, orderItem.getProduct(), itemReq.quantity(), itemReq.reason(), itemReq.description());
            productReturn.addItem(returnItem);
        }
        returns.save(productReturn);

        auditService.log(
                AuditAction.RETURN_CREATED, "Return", productReturn.getId().toString(),
                customer.getEmail(), "Return requested for order " + order.getOrderNumber(), null);

        return ReturnDtos.ReturnResponse.from(productReturn);
    }

    @Transactional(readOnly = true)
    public ReturnDtos.ReturnResponse getById(UUID id) {
        User current = securityUtils.currentUser();
        Return productReturn = returns.findWithItemsById(id)
                .orElseThrow(() -> new ResourceNotFoundException("RETURN_NOT_FOUND", "Return not found: " + id));
        enforceVisibility(productReturn, current);
        return ReturnDtos.ReturnResponse.from(productReturn);
    }

    @Transactional(readOnly = true)
    public Page<ReturnDtos.ReturnResponse> list(ReturnStatus status, Pageable pageable) {
        User current = securityUtils.currentUser();
        Page<Return> page;
        if (current.getRole() == Role.CUSTOMER) {
            page = status != null
                    ? returns.findByCustomerIdAndStatus(current.getId(), status, pageable)
                    : returns.findByCustomerId(current.getId(), pageable);
        } else if (status != null) {
            page = returns.findByStatus(status, pageable);
        } else {
            page = returns.findAll(pageable);
        }
        return page.map(ReturnDtos.ReturnResponse::from);
    }

    @Transactional
    public ReturnDtos.ReturnResponse approve(UUID id) {
        User staff = securityUtils.currentUser();
        requireStaffOrAdmin(staff);
        Return productReturn = loadForUpdate(id);
        if (productReturn.getStatus() != ReturnStatus.REQUESTED) {
            throw new InvalidStateException("INVALID_TRANSITION", "Only REQUESTED returns can be approved");
        }
        productReturn.transitionTo(ReturnStatus.APPROVED);
        productReturn.setApprovedAt(Instant.now());
        productReturn.setApprovedBy(staff);
        auditService.log(
                AuditAction.RETURN_APPROVED, "Return", productReturn.getId().toString(),
                staff.getEmail(), "Return approved", null);
        return ReturnDtos.ReturnResponse.from(productReturn);
    }

    @Transactional
    public ReturnDtos.ReturnResponse reject(UUID id, String reason) {
        User staff = securityUtils.currentUser();
        requireStaffOrAdmin(staff);
        Return productReturn = loadForUpdate(id);
        if (productReturn.getStatus() != ReturnStatus.REQUESTED) {
            throw new InvalidStateException("INVALID_TRANSITION", "Only REQUESTED returns can be rejected");
        }
        productReturn.transitionTo(ReturnStatus.REJECTED);
        productReturn.setRejectedAt(Instant.now());
        productReturn.setRejectedBy(staff);
        productReturn.setRejectionReason(reason);
        auditService.log(
                AuditAction.RETURN_REJECTED, "Return", productReturn.getId().toString(),
                staff.getEmail(), reason, null);
        return ReturnDtos.ReturnResponse.from(productReturn);
    }

    @Transactional
    public ReturnDtos.ReturnResponse markInTransit(UUID id) {
        User current = securityUtils.currentUser();
        Return productReturn = loadForUpdate(id);
        enforceVisibility(productReturn, current);
        if (productReturn.getStatus() != ReturnStatus.APPROVED) {
            throw new InvalidStateException("INVALID_TRANSITION", "Only APPROVED returns can be marked in transit");
        }
        productReturn.transitionTo(ReturnStatus.IN_TRANSIT);
        auditService.log(
                AuditAction.RETURN_SHIPPED, "Return", productReturn.getId().toString(),
                current.getEmail(), "Return shipment started", null);
        return ReturnDtos.ReturnResponse.from(productReturn);
    }

    @Transactional
    public ReturnDtos.ReturnResponse receive(UUID id, ReceiveMode mode) {
        User staff = securityUtils.currentUser();
        requireStaffOrAdmin(staff);
        if (mode == null) {
            throw new BusinessException("RECEIVE_MODE_REQUIRED", "Receive mode is required: SHIPPED or COUNTER");
        }
        Return productReturn = loadForUpdate(id);
        if (mode == ReceiveMode.SHIPPED && productReturn.getStatus() != ReturnStatus.IN_TRANSIT) {
            throw new InvalidStateException(
                    "INVALID_TRANSITION",
                    "Only IN_TRANSIT returns can be received as carrier shipment (mode SHIPPED). "
                            + "Counter/drop-off returns must use mode COUNTER. Current status: "
                            + productReturn.getStatus());
        }
        if (mode == ReceiveMode.COUNTER && productReturn.getStatus() != ReturnStatus.APPROVED) {
            throw new InvalidStateException(
                    "INVALID_TRANSITION",
                    "Only APPROVED returns can be received as counter/drop-off (mode COUNTER). "
                            + "Shipped returns must use mode SHIPPED. Current status: "
                            + productReturn.getStatus());
        }
        ReturnStatus fromStatus = productReturn.getStatus();
        productReturn.transitionTo(ReturnStatus.RECEIVED);
        productReturn.setReceivedAt(Instant.now());
        productReturn.setReceivedBy(staff);
        // Move to inspection queue in the same transaction so warehouse can inspect next.
        productReturn.transitionTo(ReturnStatus.INSPECTION_PENDING);
        String auditReason = mode == ReceiveMode.SHIPPED
                ? "Return received via carrier shipment"
                : "Return received via counter/drop-off";
        auditService.log(
                AuditAction.RETURN_RECEIVED, "Return", productReturn.getId().toString(),
                staff.getEmail(), auditReason, "mode=" + mode + ",fromStatus=" + fromStatus);
        return ReturnDtos.ReturnResponse.from(productReturn);
    }

    /** Package-private hook for InspectionService to load a managed entity. */
    @Transactional
    public Return loadForUpdate(UUID id) {
        return returns.findWithItemsById(id)
                .orElseThrow(() -> new ResourceNotFoundException("RETURN_NOT_FOUND", "Return not found: " + id));
    }

    private void enforceVisibility(Return productReturn, User current) {
        if (current.getRole() == Role.CUSTOMER
                && !productReturn.getCustomer().getId().equals(current.getId())) {
            throw new BusinessException("FORBIDDEN", "You can only view your own returns");
        }
    }

    private void requireStaffOrAdmin(User user) {
        if (user.getRole() != Role.WAREHOUSE_STAFF && user.getRole() != Role.ADMIN) {
            throw new BusinessException("FORBIDDEN", "Only warehouse staff or admin can perform this action");
        }
    }

    private String generateReturnNumber() {
        String candidate;
        do {
            StringBuilder sb = new StringBuilder("RET-");
            for (int i = 0; i < 10; i++) {
                sb.append(ALPHANUM.charAt(RANDOM.nextInt(ALPHANUM.length())));
            }
            candidate = sb.toString();
        } while (returns.existsByReturnNumber(candidate));
        return candidate;
    }
}
