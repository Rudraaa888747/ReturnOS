package com.returnos.vendor;

import com.returnos.common.exception.InvalidStateException;
import com.returnos.execution.DispositionExecution;
import com.returnos.product.Product;
import com.returnos.returns.Return;
import com.returnos.returns.ReturnReason;
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
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "vendor_claims")
public class VendorClaim {

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

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private ReturnReason reason;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private VendorClaimStatus status = VendorClaimStatus.DRAFT;

    @Column(name = "vendor_reference", length = 255)
    private String vendorReference;

    @Column(name = "expected_credit", precision = 12, scale = 2)
    private BigDecimal expectedCredit;

    @Column(name = "actual_credit", precision = 12, scale = 2)
    private BigDecimal actualCredit;

    @Column(length = 2000)
    private String notes;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "created_by")
    private User createdBy;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "submitted_at")
    private Instant submittedAt;

    @Column(name = "acknowledged_at")
    private Instant acknowledgedAt;

    @Column(name = "decided_at")
    private Instant decidedAt;

    @Column(name = "settled_at")
    private Instant settledAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Version
    private long version;

    protected VendorClaim() {}

    public VendorClaim(
            DispositionExecution execution,
            Return productReturn,
            Product product,
            int quantity,
            ReturnReason reason,
            String vendorReference,
            BigDecimal expectedCredit,
            String notes,
            User createdBy) {
        this.id = UUID.randomUUID();
        this.execution = execution;
        this.productReturn = productReturn;
        this.product = product;
        this.quantity = quantity;
        this.reason = reason;
        this.status = VendorClaimStatus.DRAFT;
        this.vendorReference = vendorReference;
        this.expectedCredit = expectedCredit;
        this.notes = notes;
        this.createdBy = createdBy;
        this.createdAt = Instant.now();
        this.updatedAt = Instant.now();
    }

    @PrePersist
    void prePersist() {
        if (id == null) id = UUID.randomUUID();
        if (createdAt == null) createdAt = Instant.now();
        updatedAt = Instant.now();
    }

    @PreUpdate
    void preUpdate() {
        updatedAt = Instant.now();
    }

    public void transitionTo(VendorClaimStatus target) {
        if (status == target) {
            return;
        }
        if (!status.canTransitionTo(target)) {
            throw new InvalidStateException(
                    "INVALID_TRANSITION", "Cannot transition vendor claim from " + status + " to " + target);
        }
        this.status = target;
    }

    public UUID getId() { return id; }
    public DispositionExecution getExecution() { return execution; }
    public Return getProductReturn() { return productReturn; }
    public Product getProduct() { return product; }
    public int getQuantity() { return quantity; }
    public ReturnReason getReason() { return reason; }
    public VendorClaimStatus getStatus() { return status; }
    public String getVendorReference() { return vendorReference; }
    public BigDecimal getExpectedCredit() { return expectedCredit; }
    public BigDecimal getActualCredit() { return actualCredit; }
    public String getNotes() { return notes; }
    public User getCreatedBy() { return createdBy; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getSubmittedAt() { return submittedAt; }
    public Instant getAcknowledgedAt() { return acknowledgedAt; }
    public Instant getDecidedAt() { return decidedAt; }
    public Instant getSettledAt() { return settledAt; }

    public void setActualCredit(BigDecimal actualCredit) { this.actualCredit = actualCredit; }
    public void setSubmittedAt(Instant submittedAt) { this.submittedAt = submittedAt; }
    public void setAcknowledgedAt(Instant acknowledgedAt) { this.acknowledgedAt = acknowledgedAt; }
    public void setDecidedAt(Instant decidedAt) { this.decidedAt = decidedAt; }
    public void setSettledAt(Instant settledAt) { this.settledAt = settledAt; }
    public void setNotes(String notes) { this.notes = notes; }
}
