package com.returnos.task;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/operations/tasks")
@Tag(name = "Tasks")
public class TaskController {

    private final TaskService taskService;

    public TaskController(TaskService taskService) {
        this.taskService = taskService;
    }

    @GetMapping
    @Operation(
            summary = "List operational tasks (staff/admin)",
            description = "Use mine=true to see only work assigned to the caller, or returnId to see "
                    + "work for one return. Customers are denied: tasks are warehouse operations.")
    public ResponseEntity<Page<TaskDtos.TaskResponse>> list(
            @RequestParam(required = false) UUID returnId,
            @RequestParam(required = false) Boolean mine,
            @RequestParam(required = false) TaskStatus status,
            @PageableDefault(size = 20) Pageable pageable) {
        return ResponseEntity.ok(taskService.list(returnId, mine, status, pageable));
    }

    @PostMapping
    @Operation(
            summary = "Create operational task (staff/admin)",
            description = "Creates return-bound warehouse work, optionally linked to a disposition "
                    + "execution of the same return.")
    public ResponseEntity<TaskDtos.TaskResponse> create(@Valid @RequestBody TaskDtos.CreateTaskRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(taskService.create(
                        request.returnId(), request.type(), request.priority(),
                        request.assigneeId(), request.executionId(), request.notes()));
    }

    @PostMapping("/{id}/start")
    @Operation(summary = "Start task (staff/admin)", description = "OPEN → IN_PROGRESS.")
    public ResponseEntity<TaskDtos.TaskResponse> start(@PathVariable UUID id) {
        return ResponseEntity.ok(taskService.start(id));
    }

    @PostMapping("/{id}/complete")
    @Operation(
            summary = "Complete task (assignee or admin)",
            description = "Only the assigned user (or an admin, or any operator when unassigned) "
                    + "may complete a task. Customers are always denied.")
    public ResponseEntity<TaskDtos.TaskResponse> complete(@PathVariable UUID id) {
        return ResponseEntity.ok(taskService.complete(id));
    }

    @PostMapping("/{id}/cancel")
    @Operation(summary = "Cancel task (assignee or admin)", description = "OPEN/IN_PROGRESS → CANCELLED.")
    public ResponseEntity<TaskDtos.TaskResponse> cancel(@PathVariable UUID id) {
        return ResponseEntity.ok(taskService.cancel(id));
    }

    @PostMapping("/{id}/assign")
    @Operation(summary = "Reassign task (admin only)", description = "Admins can reassign any task. Audited.")
    public ResponseEntity<TaskDtos.TaskResponse> assign(
            @PathVariable UUID id, @Valid @RequestBody TaskDtos.AssignTaskRequest request) {
        return ResponseEntity.ok(taskService.assign(id, request.userId()));
    }
}
