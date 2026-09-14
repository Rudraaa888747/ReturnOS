package com.returnos.returns;

import com.returnos.order.OrderItem;
import com.returnos.product.Product;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import java.util.UUID;

@Entity
@Table(name = "return_items")
public class ReturnItem {

    @Id
    @Column(nullable = false, updatable = false)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "return_id", nullable = false)
    private Return productReturn;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "order_item_id", nullable = false)
    private OrderItem orderItem;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "product_id", nullable = false)
    private Product product;

    @Column(nullable = false)
    private int quantity;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private ReturnReason reason;

    @Column(length = 1000)
    private String description;

    protected ReturnItem() {}

    public ReturnItem(OrderItem orderItem, Product product, int quantity, ReturnReason reason, String description) {
        this.id = UUID.randomUUID();
        this.orderItem = orderItem;
        this.product = product;
        this.quantity = quantity;
        this.reason = reason;
        this.description = description;
    }

    public UUID getId() { return id; }
    public Return getProductReturn() { return productReturn; }
    public OrderItem getOrderItem() { return orderItem; }
    public Product getProduct() { return product; }
    public int getQuantity() { return quantity; }
    public ReturnReason getReason() { return reason; }
    public String getDescription() { return description; }

    void setProductReturn(Return productReturn) { this.productReturn = productReturn; }
}
