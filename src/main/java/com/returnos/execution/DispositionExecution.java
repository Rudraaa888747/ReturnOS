package com.returnos.execution;

import com.returnos.common.exception.InvalidStateException;
import com.returnos.disposition.Disposition;
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
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "disposition_executions")
public class DispositionExecution {

    @Id
    @Column(nullable = false, updatable = false)
    private UUID id;

    @OneToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "return_id", nullable = false, unique = true)
    private Return productReturn;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private Disposition disposition;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private ExecutionStatus status = ExecutionStatus.PENDING;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "assignee_id")
    private User assignee;

    @Column(name = "started_at")
    private Instant startedAt;

    @Column(name = "completed_at")
    private Instant completedAt;

    @Column(name = "duration_seconds")
    private Long durationSeconds;

    @Column(name = "failure_reason", length = 1000)
    private String failureReason;

    @Column(length = 2000)
    private String notes;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Version
    private long version;

    protected DispositionExecution() {}

    public DispositionExecution(Return productReturn, Disposition disposition) {
        this.id = UUID.randomUUID();
        this.productReturn = productReturn;
        this.disposition = disposition;
        this.status = ExecutionStatus.PENDING;
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

    public void transitionTo(ExecutionStatus target) {
        if (status == target) {
            return;
        }
        if (!status.canTransitionTo(target)) {
            throw new InvalidStateException(
                    "INVALID_TRANSITION",
                    "Cannot transition execution from " + status + " to " + target);
        }
        this.status = target;
    }

    public UUID getId() { return id; }
    public Return getProductReturn() { return productReturn; }
    public Disposition getDisposition() { return disposition; }
    public ExecutionStatus getStatus() { return status; }
    public User getAssignee() { return assignee; }
    public Instant getStartedAt() { return startedAt; }
    public Instant getCompletedAt() { return completedAt; }
    public Long getDurationSeconds() { return durationSeconds; }
    public String getFailureReason() { return failureReason; }
    public String getNotes() { return notes; }
    public Instant getCreatedAt() { return createdAt; }

    public void setAssignee(User assignee) { this.assignee = assignee; }
    public void setStartedAt(Instant startedAt) { this.startedAt = startedAt; }
    public void setCompletedAt(Instant completedAt) { this.completedAt = completedAt; }
    public void setDurationSeconds(Long durationSeconds) { this.durationSeconds = durationSeconds; }
    public void setFailureReason(String failureReason) { this.failureReason = failureReason; }
    public void setNotes(String notes) { this.notes = notes; }
}
