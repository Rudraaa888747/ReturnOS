package com.returnos.disposition;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;

public interface DispositionEvaluationRepository extends JpaRepository<DispositionEvaluation, UUID> {

    @EntityGraph(attributePaths = {"candidates", "productReturn", "evaluatedBy", "finalizedBy"})
    Optional<DispositionEvaluation> findByProductReturnId(UUID returnId);

    boolean existsByProductReturnId(UUID returnId);
}
