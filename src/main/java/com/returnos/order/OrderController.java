package com.returnos.order;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/orders")
@Tag(name = "Orders")
public class OrderController {

    private final OrderService orderService;

    public OrderController(OrderService orderService) {
        this.orderService = orderService;
    }

    @PostMapping
    @Operation(summary = "Place a new order (customer)")
    public ResponseEntity<OrderDtos.OrderResponse> create(@Valid @RequestBody OrderDtos.CreateOrderRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(orderService.create(request));
    }

    @GetMapping
    @Operation(summary = "List orders (own orders for customers, all for staff/admin)")
    public ResponseEntity<Page<OrderDtos.OrderResponse>> list(@PageableDefault(size = 20) Pageable pageable) {
        return ResponseEntity.ok(orderService.list(pageable));
    }

    @GetMapping("/{id}")
    @Operation(summary = "Get order by id")
    public ResponseEntity<OrderDtos.OrderResponse> getById(@PathVariable UUID id) {
        return ResponseEntity.ok(orderService.getById(id));
    }

    @PostMapping("/{id}/deliver")
    @Operation(summary = "Mark order delivered (staff/admin)")
    public ResponseEntity<OrderDtos.OrderResponse> deliver(@PathVariable UUID id) {
        return ResponseEntity.ok(orderService.markDelivered(id));
    }

    @PostMapping("/{id}/cancel")
    @Operation(summary = "Cancel a placed order")
    public ResponseEntity<OrderDtos.OrderResponse> cancel(@PathVariable UUID id) {
        return ResponseEntity.ok(orderService.cancel(id));
    }
}
