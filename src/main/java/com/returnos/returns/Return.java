package com.returnos.returns;

import com.returnos.common.exception.InvalidStateException;
import com.returnos.order.Order;
import com.returnos.user.User;
import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.OneToMany;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Entity
@Table(name = "returns")
public class Return {

    @Id
    @Column(nullable = false, updatable = false)
    private UUID id;

    @Column(name = "return_number", nullable = false, unique = true, length = 64)
    private String returnNumber;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "order_id", nullable = false)
    private Order order;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "customer_id", nullable = false)
    private User customer;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private ReturnStatus status = ReturnStatus.REQUESTED;

    @Column(name = "requested_at", nullable = false)
    private Instant requestedAt;

    @Column(name = "approved_at")
    private Instant approvedAt;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "approved_by")
    private User approvedBy;

    @Column(name = "rejected_at")
    private Instant rejectedAt;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "rejected_by")
    private User rejectedBy;

    @Column(name = "rejection_reason", length = 1000)
    private String rejectionReason;

    @Column(name = "received_at")
    private Instant receivedAt;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "received_by")
    private User receivedBy;

    @OneToMany(mappedBy = "productReturn", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<ReturnItem> items = new ArrayList<>();

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Version
    private long version;

    protected Return() {}

    public Return(String returnNumber, Order order, User customer) {
        this.id = UUID.randomUUID();
        this.returnNumber = returnNumber;
        this.order = order;
        this.customer = customer;
        this.status = ReturnStatus.REQUESTED;
        this.requestedAt = Instant.now();
        this.createdAt = Instant.now();
        this.updatedAt = Instant.now();
    }

    @PrePersist
    void prePersist() {
        if (id == null) id = UUID.randomUUID();
        if (createdAt == null) createdAt = Instant.now();
        if (requestedAt == null) requestedAt = Instant.now();
        updatedAt = Instant.now();
    }

    @PreUpdate
    void preUpdate() {
        updatedAt = Instant.now();
    }

    public void addItem(ReturnItem item) {
        items.add(item);
        item.setProductReturn(this);
    }

    public void transitionTo(ReturnStatus target) {
        if (status == target) {
            return;
        }
        if (!status.canTransitionTo(target)) {
            throw new InvalidStateException(
                    "INVALID_TRANSITION",
                    "Cannot transition return from " + status + " to " + target);
        }
        this.status = target;
    }

    public UUID getId() { return id; }
    public String getReturnNumber() { return returnNumber; }
    public Order getOrder() { return order; }
    public User getCustomer() { return customer; }
    public ReturnStatus getStatus() { return status; }
    public Instant getRequestedAt() { return requestedAt; }
    public Instant getApprovedAt() { return approvedAt; }
    public User getApprovedBy() { return approvedBy; }
    public Instant getRejectedAt() { return rejectedAt; }
    public User getRejectedBy() { return rejectedBy; }
    public String getRejectionReason() { return rejectionReason; }
    public Instant getReceivedAt() { return receivedAt; }
    public User getReceivedBy() { return receivedBy; }
    public List<ReturnItem> getItems() { return items; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }

    public void setApprovedAt(Instant approvedAt) { this.approvedAt = approvedAt; }
    public void setApprovedBy(User approvedBy) { this.approvedBy = approvedBy; }
    public void setRejectedAt(Instant rejectedAt) { this.rejectedAt = rejectedAt; }
    public void setRejectedBy(User rejectedBy) { this.rejectedBy = rejectedBy; }
    public void setRejectionReason(String rejectionReason) { this.rejectionReason = rejectionReason; }
    public void setReceivedAt(Instant receivedAt) { this.receivedAt = receivedAt; }
    public void setReceivedBy(User receivedBy) { this.receivedBy = receivedBy; }
}
