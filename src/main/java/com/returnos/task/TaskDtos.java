package com.returnos.task;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.UUID;

public final class TaskDtos {

    private TaskDtos() {}

    public record TaskResponse(
            UUID id,
            UUID returnId,
            UUID executionId,
            TaskType type,
            TaskStatus status,
            TaskPriority priority,
            UUID assigneeId,
            UUID createdBy,
            Instant createdAt,
            Instant startedAt,
            Instant completedAt,
            String notes) {
        public static TaskResponse from(OperationalTask task) {
            return new TaskResponse(
                    task.getId(),
                    task.getProductReturn().getId(),
                    task.getExecution() != null ? task.getExecution().getId() : null,
                    task.getType(),
                    task.getStatus(),
                    task.getPriority(),
                    task.getAssignee() != null ? task.getAssignee().getId() : null,
                    task.getCreatedBy() != null ? task.getCreatedBy().getId() : null,
                    task.getCreatedAt(),
                    task.getStartedAt(),
                    task.getCompletedAt(),
                    task.getNotes());
        }
    }

    @Schema(description = "Creates warehouse work bound to a return (and optionally its execution).")
    public record CreateTaskRequest(
            @NotNull UUID returnId,
            @NotNull TaskType type,
            TaskPriority priority,
            UUID assigneeId,
            UUID executionId,
            @Size(max = 2000) String notes) {}

    public record AssignTaskRequest(@NotNull UUID userId) {}
}
