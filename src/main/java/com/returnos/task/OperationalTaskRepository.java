package com.returnos.task;

import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;

public interface OperationalTaskRepository extends JpaRepository<OperationalTask, UUID> {

    @EntityGraph(attributePaths = {"productReturn", "execution", "assignee"})
    Page<OperationalTask> findByAssigneeId(UUID assigneeId, Pageable pageable);

    @EntityGraph(attributePaths = {"productReturn", "execution", "assignee"})
    Page<OperationalTask> findByStatus(TaskStatus status, Pageable pageable);

    @EntityGraph(attributePaths = {"productReturn", "execution", "assignee"})
    Page<OperationalTask> findByAssigneeIdAndStatus(UUID assigneeId, TaskStatus status, Pageable pageable);

    List<OperationalTask> findByProductReturnId(UUID returnId);

    long countByExecutionIdAndTypeAndStatus(UUID executionId, TaskType type, TaskStatus status);
}
