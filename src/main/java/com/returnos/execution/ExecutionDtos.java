package com.returnos.execution;

import com.returnos.disposition.Disposition;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.UUID;

public final class ExecutionDtos {

    private ExecutionDtos() {}

    public record ExecutionResponse(
            UUID id,
            UUID returnId,
            Disposition disposition,
            ExecutionStatus status,
            UUID assigneeId,
            Instant startedAt,
            Instant completedAt,
            Long durationSeconds,
            String failureReason,
            String notes,
            Instant createdAt) {
        public static ExecutionResponse from(DispositionExecution execution) {
            return new ExecutionResponse(
                    execution.getId(),
                    execution.getProductReturn().getId(),
                    execution.getDisposition(),
                    execution.getStatus(),
                    execution.getAssignee() != null ? execution.getAssignee().getId() : null,
                    execution.getStartedAt(),
                    execution.getCompletedAt(),
                    execution.getDurationSeconds(),
                    execution.getFailureReason(),
                    execution.getNotes(),
                    execution.getCreatedAt());
        }
    }

    @Schema(description = "Starts execution. Assignee defaults to the caller when omitted.")
    public record StartExecutionRequest(
            @Schema(description = "Warehouse user executing the work") UUID assigneeId,
            @Size(max = 2000) String notes) {}

    @Schema(description = "Fails an in-progress execution. Reason is mandatory and audited.")
    public record FailExecutionRequest(
            @NotBlank @Size(min = 3, max = 1000) String reason) {}
}
