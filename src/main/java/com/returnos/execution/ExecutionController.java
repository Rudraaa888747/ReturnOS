package com.returnos.execution;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/returns/{returnId}/execution")
@Tag(name = "Execution")
public class ExecutionController {

    private final ExecutionService executionService;

    public ExecutionController(ExecutionService executionService) {
        this.executionService = executionService;
    }

    @GetMapping
    @Operation(
            summary = "Get disposition execution (own returns for customers, all for staff/admin)",
            description = "Returns the operational execution record for the finalized disposition, "
                    + "or 404 when execution has not started yet.")
    public ResponseEntity<ExecutionDtos.ExecutionResponse> get(@PathVariable UUID returnId) {
        return ResponseEntity.ok(executionService.get(returnId));
    }

    @PostMapping("/start")
    @Operation(
            summary = "Start disposition execution (staff/admin)",
            description = "Moves the pending execution to IN_PROGRESS. Requires a recorded final "
                    + "disposition. Idempotent while IN_PROGRESS; finished executions are rejected.")
    public ResponseEntity<ExecutionDtos.ExecutionResponse> start(
            @PathVariable UUID returnId,
            @Valid @RequestBody(required = false) ExecutionDtos.StartExecutionRequest request) {
        UUID assigneeId = request != null ? request.assigneeId() : null;
        String notes = request != null ? request.notes() : null;
        return ResponseEntity.ok(executionService.start(returnId, assigneeId, notes));
    }

    @PostMapping("/complete")
    @Operation(
            summary = "Complete disposition execution (staff/admin)",
            description = "Marks the execution COMPLETED after verifying the record matching the "
                    + "final disposition exists (inventory recovery, submitted vendor claim, sold/settled "
                    + "recovery, completed refurbishment task, or disposal record). A return is "
                    + "operationally complete only after this step.")
    public ResponseEntity<ExecutionDtos.ExecutionResponse> complete(@PathVariable UUID returnId) {
        return ResponseEntity.ok(executionService.complete(returnId));
    }

    @PostMapping("/fail")
    @Operation(
            summary = "Fail disposition execution (staff/admin)",
            description = "Marks an in-progress execution FAILED. A non-empty reason is mandatory "
                    + "and is stored on the record and in the audit trail.")
    public ResponseEntity<ExecutionDtos.ExecutionResponse> fail(
            @PathVariable UUID returnId, @Valid @RequestBody ExecutionDtos.FailExecutionRequest request) {
        return ResponseEntity.ok(executionService.fail(returnId, request.reason()));
    }
}
