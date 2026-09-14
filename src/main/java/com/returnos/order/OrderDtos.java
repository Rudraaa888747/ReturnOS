package com.returnos.order;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public final class OrderDtos {

    private OrderDtos() {}

    public record CreateOrderItemRequest(@NotNull UUID productId, @Min(1) int quantity) {}

    public record CreateOrderRequest(@NotEmpty List<CreateOrderItemRequest> items) {}

    public record OrderItemResponse(
            UUID id, UUID productId, String productName, String sku,
            int quantity, BigDecimal unitPrice, BigDecimal lineTotal) {
        public static OrderItemResponse from(OrderItem item) {
            return new OrderItemResponse(
                    item.getId(),
                    item.getProduct().getId(),
                    item.getProduct().getName(),
                    item.getProduct().getSku(),
                    item.getQuantity(),
                    item.getUnitPrice(),
                    item.getLineTotal());
        }
    }

    public record OrderResponse(
            UUID id, String orderNumber, UUID customerId, OrderStatus status,
            BigDecimal subtotal, Instant deliveredAt, Instant createdAt,
            List<OrderItemResponse> items) {
        public static OrderResponse from(Order order) {
            List<OrderItemResponse> itemDtos =
                    order.getItems().stream().map(OrderItemResponse::from).toList();
            return new OrderResponse(
                    order.getId(),
                    order.getOrderNumber(),
                    order.getCustomer().getId(),
                    order.getStatus(),
                    order.getSubtotal(),
                    order.getDeliveredAt(),
                    order.getCreatedAt(),
                    itemDtos);
        }
    }
}
