# ReturnOS — Phase 1

Product-return lifecycle backend (modular monolith). Phase 1 covers the basic lifecycle
up to warehouse inspection. No disposition/risk engine yet (Phase 2).

## Tech

Java 21 · Spring Boot 4.x · Maven · Spring Web / Data JPA / Security · PostgreSQL ·
Flyway · JWT · Bean Validation · OpenAPI (springdoc) · Actuator · JUnit 5 + Mockito ·
H2 (tests) · Testcontainers (Postgres migration test, Docker-gated)

## Quick start

```bash
cp .env.example .env        # fill in real values, never commit secrets
docker compose up -d        # starts postgres:16 on localhost:5432
./mvnw spring-boot:run -Dspring-boot.run.profiles=dev
```

Dev profile seeds sample users/products/orders (`DevDataSeeder`, dev-only):

| user | password |
|---|---|
| customer@returnos.dev | Customer123! |
| staff@returnos.dev | Staff12345! |
| admin@returnos.dev | Admin12345! |

Swagger UI: http://localhost:8080/swagger-ui.html · Health: `/actuator/health`

## Run tests

```bash
./mvnw test
```

* Unit: policy rules, state machine (`ReturnPolicyServiceTest`, `ReturnStatusTest`)
* Integration (H2): auth/authorization, return lifecycle incl. customer status
  pagination, shipment vs counter receive modes, inspection, audit
  (`AuthIntegrationTest`, `ReturnLifecycleIntegrationTest`)
* Real PostgreSQL (Docker-gated, see below): `PostgresMigrationTest`,
  `PostgresLifecycleTest`

## Real PostgreSQL verification (required before Phase 2)

The app targets PostgreSQL + Flyway (`ddl-auto=validate`). H2 is only used for fast
unit/integration feedback (Flyway stays disabled there because Flyway 11 ships no H2
database module); real-database proof comes from the container tests, which abort
with "skipped" instead of passing when Docker is unavailable.

```bash
docker compose up -d   # postgres:16-alpine, db/user/password = returnos, port 5432

# Postgres-only verification (migration + full lifecycle on real PostgreSQL):
./mvnw test -Dtest='PostgresMigrationTest,PostgresLifecycleTest'

# Full suite with Docker: H2 tests + both PostgreSQL tests actually run.
./mvnw test

# Run the app itself against local PostgreSQL:
cp .env.example .env   # fill in real values, never commit secrets
./mvnw spring-boot:run -Dspring-boot.run.profiles=dev
```

`PostgresLifecycleTest` boots the whole Spring context against the container with
Flyway enabled and `ddl-auto=validate`, so a green run proves startup, migration,
Hibernate/Flyway schema agreement, repository persistence and return-lifecycle
persistence on real PostgreSQL.

## Lifecycle

`REQUESTED → APPROVED / REJECTED`, then
`APPROVED → IN_TRANSIT → RECEIVED → INSPECTION_PENDING → INSPECTION_IN_PROGRESS → INSPECTION_COMPLETED`.
Invalid transitions return `422 INVALID_TRANSITION`. Returns are versioned
(`@Version`) for optimistic locking; concurrent updates return `409`.

Receiving has two explicit channels via the required `mode` field on
`POST /api/v1/returns/{id}/receive` (`{"mode":"SHIPPED"}` or `{"mode":"COUNTER"}`):

* shipment: `APPROVED → IN_TRANSIT` (`.../ship`) `→ RECEIVED` (mode `SHIPPED`)
* counter/drop-off: `APPROVED → RECEIVED` directly (mode `COUNTER`, no shipping step)

The wrong mode for the current status is rejected with `422 INVALID_TRANSITION`,
and the `RETURN_RECEIVED` audit entry records which channel was used
("via carrier shipment" vs "via counter/drop-off").

## Structure

`com.returnos`: `auth` · `user` · `product` · `order` · `returns` · `policy` ·
`inspection` · `audit` · `common/{config,exception,security}`

Flyway `V1__init.sql` is the schema source of truth (`ddl-auto=validate` in prod).
