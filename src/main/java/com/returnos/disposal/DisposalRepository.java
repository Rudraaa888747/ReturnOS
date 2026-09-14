package com.returnos.disposal;

import com.returnos.disposition.Disposition;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface DisposalRepository extends JpaRepository<DisposalRecord, UUID> {

    Optional<DisposalRecord> findByExecutionId(UUID executionId);

    Optional<DisposalRecord> findByProductReturnId(UUID returnId);

    boolean existsByExecutionId(UUID executionId);

    long countByDisposition(Disposition disposition);
}
