package com.returnos.order;

import com.returnos.common.exception.BusinessException;
import com.returnos.common.exception.InvalidStateException;
import com.returnos.common.exception.ResourceNotFoundException;
import com.returnos.common.security.SecurityUtils;
import com.returnos.product.Product;
import com.returnos.product.ProductRepository;
import com.returnos.user.Role;
import com.returnos.user.User;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class OrderService {

    private static final SecureRandom RANDOM = new SecureRandom();
    private static final String ALPHANUM = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    private final OrderRepository orders;
    private final ProductRepository products;
    private final SecurityUtils securityUtils;

    public OrderService(OrderRepository orders, ProductRepository products, SecurityUtils securityUtils) {
        this.orders = orders;
        this.products = products;
        this.securityUtils = securityUtils;
    }

    @Transactional
    public OrderDtos.OrderResponse create(OrderDtos.CreateOrderRequest request) {
        User customer = securityUtils.currentUser();
        if (request.items() == null || request.items().isEmpty()) {
            throw new BusinessException("EMPTY_ORDER", "Order must contain at least one item");
        }
        Order order = new Order(generateOrderNumber(), customer);
        for (OrderDtos.CreateOrderItemRequest itemReq : request.items()) {
            Product product = products.findById(itemReq.productId())
                    .orElseThrow(() -> new ResourceNotFoundException(
                            "PRODUCT_NOT_FOUND", "Product not found: " + itemReq.productId()));
            if (!product.isActive()) {
                throw new BusinessException("PRODUCT_INACTIVE", "Product is not active: " + product.getSku());
            }
            if (itemReq.quantity() <= 0) {
                throw new BusinessException("INVALID_QUANTITY", "Quantity must be positive");
            }
            order.addItem(new OrderItem(product, itemReq.quantity()));
        }
        order.recalculate();
        orders.save(order);
        return OrderDtos.OrderResponse.from(order);
    }

    @Transactional(readOnly = true)
    public OrderDtos.OrderResponse getById(UUID id) {
        User current = securityUtils.currentUser();
        Order order = orders.findWithItemsById(id)
                .orElseThrow(() -> new ResourceNotFoundException("ORDER_NOT_FOUND", "Order not found: " + id));
        enforceVisibility(order, current);
        return OrderDtos.OrderResponse.from(order);
    }

    @Transactional(readOnly = true)
    public Page<OrderDtos.OrderResponse> list(Pageable pageable) {
        User current = securityUtils.currentUser();
        Page<Order> page;
        if (current.getRole() == Role.CUSTOMER) {
            page = orders.findByCustomerId(current.getId(), pageable);
        } else {
            page = orders.findAll(pageable);
        }
        return page.map(OrderDtos.OrderResponse::from);
    }

    @Transactional
    public OrderDtos.OrderResponse markDelivered(UUID id) {
        User current = securityUtils.currentUser();
        requireStaffOrAdmin(current);
        Order order = orders.findWithItemsById(id)
                .orElseThrow(() -> new ResourceNotFoundException("ORDER_NOT_FOUND", "Order not found: " + id));
        if (order.getStatus() != OrderStatus.PLACED) {
            throw new InvalidStateException("Only PLACED orders can be marked delivered");
        }
        order.setStatus(OrderStatus.DELIVERED);
        order.setDeliveredAt(Instant.now());
        return OrderDtos.OrderResponse.from(order);
    }

    @Transactional
    public OrderDtos.OrderResponse cancel(UUID id) {
        User current = securityUtils.currentUser();
        Order order = orders.findWithItemsById(id)
                .orElseThrow(() -> new ResourceNotFoundException("ORDER_NOT_FOUND", "Order not found: " + id));
        if (current.getRole() == Role.CUSTOMER
                && !order.getCustomer().getId().equals(current.getId())) {
            throw new BusinessException("FORBIDDEN", "You can only cancel your own orders");
        }
        if (order.getStatus() != OrderStatus.PLACED) {
            throw new InvalidStateException("Only PLACED orders can be cancelled");
        }
        order.setStatus(OrderStatus.CANCELLED);
        return OrderDtos.OrderResponse.from(order);
    }

    private void enforceVisibility(Order order, User current) {
        if (current.getRole() == Role.CUSTOMER
                && !order.getCustomer().getId().equals(current.getId())) {
            throw new BusinessException("FORBIDDEN", "You can only view your own orders");
        }
    }

    private void requireStaffOrAdmin(User user) {
        if (user.getRole() != Role.WAREHOUSE_STAFF && user.getRole() != Role.ADMIN) {
            throw new BusinessException("FORBIDDEN", "Only warehouse staff or admin can perform this action");
        }
    }

    private String generateOrderNumber() {
        String candidate;
        do {
            StringBuilder sb = new StringBuilder("ORD-");
            for (int i = 0; i < 10; i++) {
                sb.append(ALPHANUM.charAt(RANDOM.nextInt(ALPHANUM.length())));
            }
            candidate = sb.toString();
        } while (orders.existsByOrderNumber(candidate));
        return candidate;
    }
}
