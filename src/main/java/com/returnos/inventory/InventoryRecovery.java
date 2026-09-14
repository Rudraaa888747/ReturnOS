package com.returnos.inventory;

import com.returnos.execution.DispositionExecution;
import com.returnos.product.Product;
import com.returnos.returns.Return;
import com.returnos.user.User;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.OneToOne;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "inventory_recoveries")
public class InventoryRecovery {

    @Id
    @Column(nullable = false, updatable = false)
    private UUID id;

    @OneToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "execution_id", nullable = false, unique = true)
    private DispositionExecution execution;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "return_id", nullable = false)
    private Return productReturn;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "product_id", nullable = false)
    private Product product;

    @Column(nullable = false)
    private int quantity;

    @Column(name = "recovered_quantity", nullable = false)
    private int recoveredQuantity;

    @Column(nullable = false, length = 255)
    private String destination;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private InventoryAction action = InventoryAction.RESTOCKED;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "recorded_by")
    private User recordedBy;

    @Column(name = "recorded_at", nullable = false)
    private Instant recordedAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Version
    private long version;

    protected InventoryRecovery() {}

    public InventoryRecovery(
            DispositionExecution execution,
            Return productReturn,
            Product product,
            int quantity,
            int recoveredQuantity,
            String destination,
            User recordedBy) {
        this.id = UUID.randomUUID();
        this.execution = execution;
        this.productReturn = productReturn;
        this.product = product;
        this.quantity = quantity;
        this.recoveredQuantity = recoveredQuantity;
        this.destination = destination;
        this.action = InventoryAction.RESTOCKED;
        this.recordedBy = recordedBy;
        this.recordedAt = Instant.now();
        this.createdAt = Instant.now();
    }

    @PrePersist
    void prePersist() {
        if (id == null) id = UUID.randomUUID();
        if (createdAt == null) createdAt = Instant.now();
        if (recordedAt == null) recordedAt = Instant.now();
    }

    public UUID getId() { return id; }
    public DispositionExecution getExecution() { return execution; }
    public Return getProductReturn() { return productReturn; }
    public Product getProduct() { return product; }
    public int getQuantity() { return quantity; }
    public int getRecoveredQuantity() { return recoveredQuantity; }
    public String getDestination() { return destination; }
    public InventoryAction getAction() { return action; }
    public User getRecordedBy() { return recordedBy; }
    public Instant getRecordedAt() { return recordedAt; }
}
