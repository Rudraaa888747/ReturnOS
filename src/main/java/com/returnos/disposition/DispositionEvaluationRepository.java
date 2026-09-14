package com.returnos.disposition;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface DispositionEvaluationRepository extends JpaRepository<DispositionEvaluation, UUID> {

    @EntityGraph(attributePaths = {"candidates", "productReturn", "evaluatedBy", "finalizedBy"})
    Optional<DispositionEvaluation> findByProductReturnId(UUID returnId);

    boolean existsByProductReturnId(UUID returnId);

    long countByFinalDispositionIsNotNull();

    @Query("""
            SELECT e.finalDisposition, COUNT(e) FROM DispositionEvaluation e
            WHERE e.finalDisposition IS NOT NULL GROUP BY e.finalDisposition
            """)
    List<Object[]> countByFinalDisposition();
}
