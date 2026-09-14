package com.returnos.task;

import com.returnos.common.exception.InvalidStateException;
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
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "operational_tasks")
public class OperationalTask {

    @Id
    @Column(nullable = false, updatable = false)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "return_id", nullable = false)
    private Return productReturn;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "execution_id")
    private DispositionExecution execution;

    @Enumerated(EnumType.STRING)
    @Column(name = "task_type", nullable = false, length = 32)
    private TaskType type;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private TaskStatus status = TaskStatus.OPEN;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private TaskPriority priority = TaskPriority.MEDIUM;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "assignee_id")
    private User assignee;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "created_by")
    private User createdBy;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "started_at")
    private Instant startedAt;

    @Column(name = "completed_at")
    private Instant completedAt;

    @Column(length = 2000)
    private String notes;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Version
    private long version;

    protected OperationalTask() {}

    public OperationalTask(
            Return productReturn,
            DispositionExecution execution,
            TaskType type,
            TaskPriority priority,
            User assignee,
            User createdBy,
            String notes) {
        this.id = UUID.randomUUID();
        this.productReturn = productReturn;
        this.execution = execution;
        this.type = type;
        this.priority = priority != null ? priority : TaskPriority.MEDIUM;
        this.assignee = assignee;
        this.createdBy = createdBy;
        this.notes = notes;
        this.status = TaskStatus.OPEN;
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

    public void transitionTo(TaskStatus target) {
        if (status == target) {
            return;
        }
        if (!status.canTransitionTo(target)) {
            throw new InvalidStateException(
                    "INVALID_TRANSITION", "Cannot transition task from " + status + " to " + target);
        }
        this.status = target;
    }

    public UUID getId() { return id; }
    public Return getProductReturn() { return productReturn; }
    public DispositionExecution getExecution() { return execution; }
    public TaskType getType() { return type; }
    public TaskStatus getStatus() { return status; }
    public TaskPriority getPriority() { return priority; }
    public User getAssignee() { return assignee; }
    public User getCreatedBy() { return createdBy; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getStartedAt() { return startedAt; }
    public Instant getCompletedAt() { return completedAt; }
    public String getNotes() { return notes; }

    public void setAssignee(User assignee) { this.assignee = assignee; }
    public void setStartedAt(Instant startedAt) { this.startedAt = startedAt; }
    public void setCompletedAt(Instant completedAt) { this.completedAt = completedAt; }
    public void setNotes(String notes) { this.notes = notes; }
}
