package com.returnos;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import com.returnos.audit.AuditAction;
import com.returnos.audit.AuditLogRepository;
import com.returnos.auth.UserPrincipal;
import com.returnos.inspection.InspectionDtos;
import com.returnos.inspection.FunctionalTestResult;
import com.returnos.inspection.InspectionService;
import com.returnos.inspection.PackagingCondition;
import com.returnos.inspection.PhysicalCondition;
import com.returnos.order.OrderDtos;
import com.returnos.order.OrderService;
import com.returnos.product.Product;
import com.returnos.product.ProductRepository;
import com.returnos.returns.ReceiveMode;
import com.returnos.returns.ReturnDtos;
import com.returnos.returns.ReturnReason;
import com.returnos.returns.ReturnService;
import com.returnos.returns.ReturnStatus;
import com.returnos.user.Role;
import com.returnos.user.User;
import com.returnos.user.UserRepository;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.annotation.Transactional;
import org.testcontainers.DockerClientFactory;
import org.testcontainers.containers.PostgreSQLContainer;

/**
 * Full application verification against REAL PostgreSQL:
 * Spring Boot startup, Flyway V1 migration, Hibernate {@code ddl-auto=validate}
 * agreement with the Flyway schema, repository persistence and the complete
 * return lifecycle (request, approve, ship, receive, inspect) with audit.
 *
 * <p>Requires Docker. Aborts (skips) automatically when Docker is unavailable -
 * it never fakes a pass. Run with Docker via:
 * {@code ./mvnw test -Dtest='PostgresMigrationTest,PostgresLifecycleTest'}
 */
@SpringBootTest
@ActiveProfiles("test")
@Transactional
class PostgresLifecycleTest {

    private static PostgreSQLContainer<?> postgres;

    @BeforeAll
    static void startPostgres() {
        assumeTrue(
                DockerClientFactory.instance().isDockerAvailable(),
                "Docker unavailable - skipping real-PostgreSQL lifecycle test");
        postgres = new PostgreSQLContainer<>("postgres:16-alpine");
        postgres.start();
    }

    @DynamicPropertySource
    static void postgresProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> postgres.getJdbcUrl());
        registry.add("spring.datasource.username", () -> postgres.getUsername());
        registry.add("spring.datasource.password", () -> postgres.getPassword());
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        registry.add("spring.flyway.enabled", () -> "true");
        registry.add("spring.jpa.hibernate.ddl-auto", () -> "validate");
    }

    @Autowired
    private Flyway flyway;

    @Autowired
    private UserRepository users;

    @Autowired
    private ProductRepository products;

    @Autowired
    private OrderService orderService;

    @Autowired
    private ReturnService returnService;

    @Autowired
    private InspectionService inspectionService;

    @Autowired
    private AuditLogRepository auditLogs;

    @Autowired
    private PasswordEncoder passwordEncoder;

    @AfterEach
    void clearAuthentication() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void startupAppliesFlywayAndPersistsBasicEntities() {
        // Context loaded => Flyway migrated and Hibernate validate agreed with the schema.
        assertThat(flyway.info().applied()).isNotEmpty();

        User user = users.save(new User(
                "pg-customer+" + UUID.randomUUID() + "@returnos.test",
                passwordEncoder.encode("Customer123!"),
                "PG Customer",
                Role.CUSTOMER));
        assertThat(users.findById(user.getId())).isPresent();

        Product product = products.save(new Product(
                "SKU-PG-" + UUID.randomUUID().toString().substring(0, 8),
                "PG Widget",
                "electronics",
                "Persisted against real PostgreSQL",
                new BigDecimal("199.00"),
                true));
        assertThat(products.findById(product.getId())).isPresent();
    }

    @Test
    void fullReturnLifecyclePersistsOnPostgres() {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        User customer = users.save(new User(
                "pg-cust-" + suffix + "@returnos.test",
                passwordEncoder.encode("Customer123!"),
                "PG Customer",
                Role.CUSTOMER));
        User staff = users.save(new User(
                "pg-staff-" + suffix + "@returnos.test",
                passwordEncoder.encode("Staff12345!"),
                "PG Staff",
                Role.WAREHOUSE_STAFF));
        Product product = products.save(new Product(
                "SKU-PG-LC-" + suffix, "PG Lifecycle Widget", "electronics", "Lifecycle test",
                new BigDecimal("499.00"), true));

        authenticateAs(customer);
        OrderDtos.OrderResponse order = orderService.create(new OrderDtos.CreateOrderRequest(
                List.of(new OrderDtos.CreateOrderItemRequest(product.getId(), 1))));
        UUID orderItemId = order.items().get(0).id();

        authenticateAs(staff);
        orderService.markDelivered(order.id());

        authenticateAs(customer);
        ReturnDtos.ReturnResponse created = returnService.create(new ReturnDtos.CreateReturnRequest(
                order.id(),
                List.of(new ReturnDtos.CreateReturnItemRequest(
                        orderItemId, 1, ReturnReason.DEFECTIVE, "Dead on arrival"))));
        UUID returnId = created.id();

        authenticateAs(staff);
        assertThat(returnService.approve(returnId).status()).isEqualTo(ReturnStatus.APPROVED);

        authenticateAs(customer);
        assertThat(returnService.markInTransit(returnId).status()).isEqualTo(ReturnStatus.IN_TRANSIT);

        authenticateAs(staff);
        assertThat(returnService.receive(returnId, ReceiveMode.SHIPPED).status())
                .isEqualTo(ReturnStatus.INSPECTION_PENDING);

        InspectionDtos.InspectionResponse inspection = inspectionService.create(
                returnId,
                new InspectionDtos.CreateInspectionRequest(
                        PhysicalCondition.DAMAGED,
                        PackagingCondition.OPENED,
                        true,
                        FunctionalTestResult.FAILED,
                        "Cracked casing",
                        "Inspected on real PostgreSQL"));
        assertThat(inspection.returnId()).isEqualTo(returnId);

        assertThat(returnService.getById(returnId).status()).isEqualTo(ReturnStatus.INSPECTION_COMPLETED);
        assertThat(auditLogs.findAll())
                .anyMatch(l -> l.getAction() == AuditAction.RETURN_RECEIVED
                        && l.getEntityId().equals(returnId.toString())
                        && l.getReason() != null
                        && l.getReason().contains("carrier shipment"));
    }

    private void authenticateAs(User user) {
        UserPrincipal principal = UserPrincipal.from(user);
        SecurityContextHolder.getContext()
                .setAuthentication(new UsernamePasswordAuthenticationToken(
                        principal, null, principal.getAuthorities()));
    }
}
