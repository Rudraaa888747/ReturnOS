package com.returnos.recovery;

import com.returnos.common.exception.InvalidStateException;
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
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "recovery_records")
public class RecoveryRecord {

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

    @Column(nullable = false, length = 255)
    private String channel;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private RecoveryStatus status = RecoveryStatus.PENDING;

    @Column(name = "listed_value", precision = 12, scale = 2)
    private BigDecimal listedValue;

    @Column(name = "expected_recovery", nullable = false, precision = 12, scale = 2)
    private BigDecimal expectedRecovery;

    @Column(name = "actual_recovered", precision = 12, scale = 2)
    private BigDecimal actualRecovered;

    @Column(nullable = false, precision = 12, scale = 2)
    private BigDecimal fees = BigDecimal.ZERO;

    @Column(name = "net_recovered", nullable = false, precision = 12, scale = 2)
    private BigDecimal netRecovered;

    @Column(length = 2000)
    private String notes;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "recorded_by")
    private User recordedBy;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "listed_at")
    private Instant listedAt;

    @Column(name = "sold_at")
    private Instant soldAt;

    @Column(name = "settled_at")
    private Instant settledAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Version
    private long version;

    protected RecoveryRecord() {}

    public RecoveryRecord(
            DispositionExecution execution,
            Return productReturn,
            Disposition disposition,
            String channel,
            BigDecimal listedValue,
            BigDecimal expectedRecovery,
            String notes,
            User recordedBy) {
        this.id = UUID.randomUUID();
        this.execution = execution;
        this.productReturn = productReturn;
        this.disposition = disposition;
        this.channel = channel;
        this.status = RecoveryStatus.PENDING;
        this.listedValue = listedValue;
        this.expectedRecovery = expectedRecovery;
        this.fees = BigDecimal.ZERO;
        this.netRecovered = expectedRecovery;
        this.notes = notes;
        this.recordedBy = recordedBy;
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

    public void transitionTo(RecoveryStatus target) {
        if (status == target) {
            return;
        }
        if (!status.canTransitionTo(target)) {
            throw new InvalidStateException(
                    "INVALID_TRANSITION", "Cannot transition recovery from " + status + " to " + target);
        }
        this.status = target;
    }

    public UUID getId() { return id; }
    public DispositionExecution getExecution() { return execution; }
    public Return getProductReturn() { return productReturn; }
    public Disposition getDisposition() { return disposition; }
    public String getChannel() { return channel; }
    public RecoveryStatus getStatus() { return status; }
    public BigDecimal getListedValue() { return listedValue; }
    public BigDecimal getExpectedRecovery() { return expectedRecovery; }
    public BigDecimal getActualRecovered() { return actualRecovered; }
    public BigDecimal getFees() { return fees; }
    public BigDecimal getNetRecovered() { return netRecovered; }
    public String getNotes() { return notes; }
    public User getRecordedBy() { return recordedBy; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getListedAt() { return listedAt; }
    public Instant getSoldAt() { return soldAt; }
    public Instant getSettledAt() { return settledAt; }

    public void setActualRecovered(BigDecimal actualRecovered) { this.actualRecovered = actualRecovered; }
    public void setFees(BigDecimal fees) { this.fees = fees; }
    public void setNetRecovered(BigDecimal netRecovered) { this.netRecovered = netRecovered; }
    public void setListedAt(Instant listedAt) { this.listedAt = listedAt; }
    public void setSoldAt(Instant soldAt) { this.soldAt = soldAt; }
    public void setSettledAt(Instant settledAt) { this.settledAt = settledAt; }
    public void setNotes(String notes) { this.notes = notes; }
}
