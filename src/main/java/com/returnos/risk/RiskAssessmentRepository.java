package com.returnos.risk;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;

public interface RiskAssessmentRepository extends JpaRepository<RiskAssessment, UUID> {

    @EntityGraph(attributePaths = {"factors", "productReturn", "assessedBy"})
    Optional<RiskAssessment> findByProductReturnId(UUID returnId);

    boolean existsByProductReturnId(UUID returnId);
}
