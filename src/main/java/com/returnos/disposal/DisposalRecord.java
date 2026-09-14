package com.returnos.disposal;

import com.returnos.disposition.Disposition;
import com.returnos.execution.DispositionExecution;
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
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "disposal_records")
public class DisposalRecord {

    @Id
    @Column(nullable = false, updatable = false)
    private UUID id;

    @OneToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "execution_id", nullable = false, unique = true)
    private DispositionExecution execution;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "return_id", nullable = false)
    private Return productReturn;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private Disposition disposition;

    @Column(nullable = false)
    private int quantity;

    @Column(length = 255)
    private String partner;

    @Column(name = "estimated_recovery", nullable = false, precision = 12, scale = 2)
    private BigDecimal estimatedRecovery;

    @Column(name = "actual_recovery", precision = 12, scale = 2)
    private BigDecimal actualRecovery;

    @Column(name = "processing_cost", nullable = false, precision = 12, scale = 2)
    private BigDecimal processingCost;

    @Column(name = "completed_at", nullable = false)
    private Instant completedAt;

    @Column(length = 2000)
    private String notes;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "completed_by")
    private User completedBy;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Version
    private long version;

    protected DisposalRecord() {}

    public DisposalRecord(
            DispositionExecution execution,
            Return productReturn,
            Disposition disposition,
            int quantity,
            String partner,
            BigDecimal estimatedRecovery,
            BigDecimal actualRecovery,
            BigDecimal processingCost,
            String notes,
            User completedBy) {
        this.id = UUID.randomUUID();
        this.execution = execution;
        this.productReturn = productReturn;
        this.disposition = disposition;
        this.quantity = quantity;
        this.partner = partner;
        this.estimatedRecovery = estimatedRecovery;
        this.actualRecovery = actualRecovery;
        this.processingCost = processingCost;
        this.notes = notes;
        this.completedBy = completedBy;
        this.completedAt = Instant.now();
        this.createdAt = Instant.now();
    }

    @PrePersist
    void prePersist() {
        if (id == null) id = UUID.randomUUID();
        if (createdAt == null) createdAt = Instant.now();
        if (completedAt == null) completedAt = Instant.now();
    }

    public UUID getId() { return id; }
    public DispositionExecution getExecution() { return execution; }
    public Return getProductReturn() { return productReturn; }
    public Disposition getDisposition() { return disposition; }
    public int getQuantity() { return quantity; }
    public String getPartner() { return partner; }
    public BigDecimal getEstimatedRecovery() { return estimatedRecovery; }
    public BigDecimal getActualRecovery() { return actualRecovery; }
    public BigDecimal getProcessingCost() { return processingCost; }
    public Instant getCompletedAt() { return completedAt; }
    public String getNotes() { return notes; }
    public User getCompletedBy() { return completedBy; }
}
