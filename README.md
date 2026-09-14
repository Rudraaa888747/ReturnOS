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
* Integration (H2): auth/authorization, full return lifecycle, inspection, audit
  (`AuthIntegrationTest`, `ReturnLifecycleIntegrationTest`)
* `PostgresMigrationTest` runs the Flyway baseline against real PostgreSQL;
  skipped automatically when Docker is unavailable.

## Lifecycle

`REQUESTED → APPROVED / REJECTED`, then
`APPROVED → IN_TRANSIT → RECEIVED → INSPECTION_PENDING → INSPECTION_IN_PROGRESS → INSPECTION_COMPLETED`.
Invalid transitions return `422 INVALID_TRANSITION`. Returns are versioned
(`@Version`) for optimistic locking; concurrent updates return `409`.

Note: `POST /api/v1/returns/{id}/ship` (mark in-transit) is a small addition to the
suggested endpoint list so the customer-ships step is explicit; `receive` also accepts
direct `APPROVED → RECEIVED` for counter returns.

## Structure

`com.returnos`: `auth` · `user` · `product` · `order` · `returns` · `policy` ·
`inspection` · `audit` · `common/{config,exception,security}`

Flyway `V1__init.sql` is the schema source of truth (`ddl-auto=validate` in prod).
