package com.returnos.recovery;

import com.returnos.disposition.Disposition;
import java.math.BigDecimal;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface RecoveryRecordRepository extends JpaRepository<RecoveryRecord, UUID> {

    Optional<RecoveryRecord> findByExecutionId(UUID executionId);

    Optional<RecoveryRecord> findByProductReturnId(UUID returnId);

    boolean existsByExecutionId(UUID executionId);

    @Query("SELECT COALESCE(SUM(r.expectedRecovery), 0) FROM RecoveryRecord r")
    BigDecimal sumExpectedRecovery();

    @Query("SELECT COALESCE(SUM(r.actualRecovered), 0) FROM RecoveryRecord r")
    BigDecimal sumActualRecovered();

    @Query("SELECT COALESCE(SUM(r.netRecovered), 0) FROM RecoveryRecord r")
    BigDecimal sumNetRecovered();

    @Query("SELECT COUNT(r) FROM RecoveryRecord r WHERE r.disposition = :disposition")
    long countByDisposition(@Param("disposition") Disposition disposition);

    @Query("SELECT COALESCE(SUM(r.actualRecovered), 0) FROM RecoveryRecord r WHERE r.disposition = :disposition")
    BigDecimal sumActualByDisposition(@Param("disposition") Disposition disposition);
}
