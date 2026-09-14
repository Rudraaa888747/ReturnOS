package com.returnos.task;

import com.returnos.audit.AuditAction;
import com.returnos.audit.AuditService;
import com.returnos.common.exception.BusinessException;
import com.returnos.common.exception.ResourceNotFoundException;
import com.returnos.common.observability.OperationsMetrics;
import com.returnos.common.security.SecurityUtils;
import com.returnos.execution.DispositionExecution;
import com.returnos.execution.DispositionExecutionRepository;
import com.returnos.returns.Return;
import com.returnos.returns.ReturnRepository;
import com.returnos.user.Role;
import com.returnos.user.User;
import com.returnos.user.UserRepository;
import java.time.Instant;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class TaskService {

    private static final Logger log = LoggerFactory.getLogger(TaskService.class);

    private final OperationalTaskRepository tasks;
    private final ReturnRepository returns;
    private final DispositionExecutionRepository executions;
    private final UserRepository users;
    private final AuditService auditService;
    private final SecurityUtils securityUtils;
    private final OperationsMetrics metrics;

    public TaskService(
            OperationalTaskRepository tasks,
            ReturnRepository returns,
            DispositionExecutionRepository executions,
            UserRepository users,
            AuditService auditService,
            SecurityUtils securityUtils,
            OperationsMetrics metrics) {
        this.tasks = tasks;
        this.returns = returns;
        this.executions = executions;
        this.users = users;
        this.auditService = auditService;
        this.securityUtils = securityUtils;
        this.metrics = metrics;
    }

    @Transactional
    public TaskDtos.TaskResponse create(
            UUID returnId, TaskType type, TaskPriority priority,
            UUID assigneeId, UUID executionId, String notes) {
        User actor = securityUtils.currentUser();
        requireStaffOrAdmin(actor);

        Return productReturn = returns.findWithItemsById(returnId)
                .orElseThrow(() -> new ResourceNotFoundException("RETURN_NOT_FOUND", "Return not found: " + returnId));
        DispositionExecution execution = null;
        if (executionId != null) {
            execution = executions
                    .findById(executionId)
                    .orElseThrow(() -> new ResourceNotFoundException(
                            "EXECUTION_NOT_FOUND", "Execution not found: " + executionId));
            if (!execution.getProductReturn().getId().equals(returnId)) {
                throw new BusinessException(
                        "EXECUTION_MISMATCH", "Execution does not belong to return: " + returnId);
            }
        }
        User assignee = assigneeId != null ? loadUser(assigneeId) : null;

        OperationalTask task =
                new OperationalTask(productReturn, execution, type, priority, assignee, actor, notes);
        tasks.save(task);
        if (assignee != null) {
            auditService.log(
                    AuditAction.TASK_ASSIGNED, "OperationalTask", task.getId().toString(),
                    actor.getEmail(), "Task assigned to " + assignee.getEmail(),
                    "returnId=" + returnId + ",type=" + type);
        }
        log.info(
                "operation=task-create returnId={} taskId={} actor={} outcome=OPEN",
                returnId, task.getId(), actor.getEmail());
        return TaskDtos.TaskResponse.from(task);
    }

    @Transactional(readOnly = true)
    public Page<TaskDtos.TaskResponse> list(Boolean mine, TaskStatus status, Pageable pageable) {
        User current = securityUtils.currentUser();
        requireStaffOrAdmin(current);
        Page<OperationalTask> page;
        if (Boolean.TRUE.equals(mine) && status != null) {
            page = tasks.findByAssigneeIdAndStatus(current.getId(), status, pageable);
        } else if (Boolean.TRUE.equals(mine)) {
            page = tasks.findByAssigneeId(current.getId(), pageable);
        } else if (status != null) {
            page = tasks.findByStatus(status, pageable);
        } else {
            page = tasks.findAll(pageable);
        }
        return page.map(TaskDtos.TaskResponse::from);
    }

    @Transactional
    public TaskDtos.TaskResponse start(UUID taskId) {
        User actor = securityUtils.currentUser();
        requireStaffOrAdmin(actor);
        OperationalTask task = loadTask(taskId);
        task.transitionTo(TaskStatus.IN_PROGRESS);
        task.setStartedAt(Instant.now());
        log.info(
                "operation=task-start returnId={} taskId={} actor={} outcome=IN_PROGRESS",
                task.getProductReturn().getId(), task.getId(), actor.getEmail());
        return TaskDtos.TaskResponse.from(task);
    }

    @Transactional
    public TaskDtos.TaskResponse complete(UUID taskId) {
        User actor = securityUtils.currentUser();
        requireStaffOrAdmin(actor);
        OperationalTask task = loadTask(taskId);
        requireCompleter(task, actor);
        task.transitionTo(TaskStatus.COMPLETED);
        task.setCompletedAt(Instant.now());
        auditService.log(
                AuditAction.TASK_COMPLETED, "OperationalTask", task.getId().toString(),
                actor.getEmail(), "Task completed: " + task.getType(),
                "returnId=" + task.getProductReturn().getId());
        metrics.taskCompleted();
        log.info(
                "operation=task-complete returnId={} taskId={} actor={} outcome=COMPLETED",
                task.getProductReturn().getId(), task.getId(), actor.getEmail());
        return TaskDtos.TaskResponse.from(task);
    }

    @Transactional
    public TaskDtos.TaskResponse cancel(UUID taskId) {
        User actor = securityUtils.currentUser();
        requireStaffOrAdmin(actor);
        OperationalTask task = loadTask(taskId);
        requireCompleter(task, actor);
        task.transitionTo(TaskStatus.CANCELLED);
        auditService.log(
                AuditAction.TASK_CANCELLED, "OperationalTask", task.getId().toString(),
                actor.getEmail(), "Task cancelled: " + task.getType(),
                "returnId=" + task.getProductReturn().getId());
        log.info(
                "operation=task-cancel returnId={} taskId={} actor={} outcome=CANCELLED",
                task.getProductReturn().getId(), task.getId(), actor.getEmail());
        return TaskDtos.TaskResponse.from(task);
    }

    @Transactional
    public TaskDtos.TaskResponse assign(UUID taskId, UUID userId) {
        User actor = securityUtils.currentUser();
        requireAdmin(actor);
        OperationalTask task = loadTask(taskId);
        User assignee = loadUser(userId);
        task.setAssignee(assignee);
        auditService.log(
                AuditAction.TASK_ASSIGNED, "OperationalTask", task.getId().toString(),
                actor.getEmail(), "Task reassigned to " + assignee.getEmail(),
                "returnId=" + task.getProductReturn().getId() + ",type=" + task.getType());
        log.info(
                "operation=task-assign returnId={} taskId={} actor={} outcome=ASSIGNED",
                task.getProductReturn().getId(), task.getId(), actor.getEmail());
        return TaskDtos.TaskResponse.from(task);
    }

    private OperationalTask loadTask(UUID taskId) {
        return tasks.findById(taskId)
                .orElseThrow(() -> new ResourceNotFoundException("TASK_NOT_FOUND", "Task not found: " + taskId));
    }

    private User loadUser(UUID userId) {
        return users.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("USER_NOT_FOUND", "User not found: " + userId));
    }

    /** The assignee owns completion; unassigned tasks are completable by any operator; admins always. */
    private void requireCompleter(OperationalTask task, User actor) {
        if (actor.getRole() == Role.ADMIN) {
            return;
        }
        if (task.getAssignee() != null && !task.getAssignee().getId().equals(actor.getId())) {
            throw new BusinessException(
                    "FORBIDDEN", "Only the assigned user or an admin can change this task");
        }
    }

    private void requireStaffOrAdmin(User user) {
        if (user.getRole() != Role.WAREHOUSE_STAFF && user.getRole() != Role.ADMIN) {
            throw new BusinessException("FORBIDDEN", "Only warehouse staff or admin can manage tasks");
        }
    }

    private void requireAdmin(User user) {
        if (user.getRole() != Role.ADMIN) {
            throw new BusinessException("FORBIDDEN", "Only admins can reassign tasks");
        }
    }
}
