package com.returnos;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.sql.DriverManager;
import java.util.HashSet;
import java.util.Set;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.testcontainers.DockerClientFactory;
import org.testcontainers.containers.PostgreSQLContainer;

/**
 * Verifies the Flyway baseline migration against real PostgreSQL.
 * Skipped automatically when Docker is unavailable (e.g. local dev without Docker).
 * Run in CI with Docker enabled.
 */
class PostgresMigrationTest {

    @Test
    void flywayBaselineAppliesOnPostgres() throws Exception {
        assumeTrue(
                DockerClientFactory.instance().isDockerAvailable(),
                "Docker unavailable - skipping real-PostgreSQL migration test");

        try (PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine")) {
            postgres.start();

            Flyway flyway = Flyway.configure()
                    .dataSource(postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword())
                    .locations("classpath:db/migration")
                    .load();
            var result = flyway.migrate();
            assertThat(result.migrationsExecuted).isGreaterThan(0);

            Set<String> tables = new HashSet<>();
            try (var connection = DriverManager.getConnection(
                            postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword());
                    var rs = connection
                            .createStatement()
                            .executeQuery("select tablename from pg_tables where schemaname = 'public'")) {
                while (rs.next()) {
                    tables.add(rs.getString(1));
                }
            }

            assertThat(tables)
                    .contains(
                            "app_users",
                            "products",
                            "customer_orders",
                            "order_items",
                            "returns",
                            "return_items",
                            "inspections",
                            "audit_logs",
                            "risk_assessments",
                            "risk_factors",
                            "disposition_evaluations",
                            "disposition_candidates",
                            "disposition_executions",
                            "inventory_recoveries",
                            "vendor_claims",
                            "recovery_records",
                            "disposal_records",
                            "operational_tasks");
        }
    }
}
