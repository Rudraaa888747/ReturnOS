package com.returnos.execution;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface DispositionExecutionRepository extends JpaRepository<DispositionExecution, UUID> {

    @EntityGraph(attributePaths = {"productReturn", "assignee"})
    Optional<DispositionExecution> findByProductReturnId(UUID returnId);

    boolean existsByProductReturnId(UUID returnId);

    long countByStatus(ExecutionStatus status);

    @Query("SELECT AVG(e.durationSeconds) FROM DispositionExecution e WHERE e.durationSeconds IS NOT NULL")
    Double averageDurationSeconds();
}
