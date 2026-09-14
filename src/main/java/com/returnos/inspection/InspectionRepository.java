package com.returnos.inspection;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface InspectionRepository extends JpaRepository<Inspection, UUID> {
    Optional<Inspection> findByProductReturnId(UUID returnId);
    boolean existsByProductReturnId(UUID returnId);
}
