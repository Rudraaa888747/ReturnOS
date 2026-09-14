package com.returnos.vendor;

import java.math.BigDecimal;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface VendorClaimRepository extends JpaRepository<VendorClaim, UUID> {

    Optional<VendorClaim> findByExecutionId(UUID executionId);

    Optional<VendorClaim> findByProductReturnId(UUID returnId);

    boolean existsByExecutionId(UUID executionId);

    long countByStatus(VendorClaimStatus status);

    @Query("SELECT COALESCE(SUM(c.expectedCredit), 0) FROM VendorClaim c")
    BigDecimal sumExpectedCredit();

    @Query("SELECT COALESCE(SUM(c.actualCredit), 0) FROM VendorClaim c")
    BigDecimal sumActualCredit();
}
