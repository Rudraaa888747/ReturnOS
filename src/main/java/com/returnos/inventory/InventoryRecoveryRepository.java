package com.returnos.inventory;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface InventoryRecoveryRepository extends JpaRepository<InventoryRecovery, UUID> {

    Optional<InventoryRecovery> findByExecutionId(UUID executionId);

    boolean existsByExecutionId(UUID executionId);

    @Query("SELECT COALESCE(SUM(i.recoveredQuantity), 0) FROM InventoryRecovery i")
    Long sumRecoveredQuantity();
}
