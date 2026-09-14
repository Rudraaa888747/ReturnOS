# ReturnOS — Phase 1 + Phase 2

Product-return lifecycle backend (modular monolith). Phase 1 covers the basic lifecycle
up to warehouse inspection. Phase 2 adds the risk + disposition/recovery decision
platform after inspection (deterministic, explainable, no ML).

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

## Phase 2 — risk + disposition (after INSPECTION_COMPLETED)

* Risk: `POST /api/v1/returns/{id}/risk/assess` (201 first, 200 repeat), `GET .../risk`.
  Rule-based score 0-100 → LOW/MEDIUM/HIGH with per-rule explanations. Operational
  attention signal only — never a fraud accusation. Tunables: `RISK_*` in `.env.example`.
* Disposition: `POST .../disposition/evaluate` (201/200), `GET .../disposition`,
  `POST .../disposition/finalize` (`{}` accepts the recommendation),
  `POST .../disposition/override` (admin only, reason mandatory).
  7 channels evaluated (RESTOCK/REFURBISH/RESELL/RETURN_TO_VENDOR/LIQUIDATE/RECYCLE/SCRAP),
  best eligible net recovery wins; economics in `DISPOSITION_*` vars.
* Money math: BigDecimal, scale 2 HALF_UP, negative inputs rejected.
* Audit: `RISK_ASSESSMENT_CREATED`, `DISPOSITION_EVALUATED/RECOMMENDED/OVERRIDDEN`,
  `FINAL_DISPOSITION_RECORDED`. Original recommendation is never overwritten.

## Phase 3 — operational execution (after FINAL DISPOSITION)

* Execution: `POST /api/v1/returns/{id}/execution/start|complete|fail`, `GET .../execution`.
  PENDING (auto-created at finalize) → IN_PROGRESS → COMPLETED/FAILED. Completion
  requires the channel record matching the final disposition; `duration_seconds`
  is stored for analytics. Optimistic locking (`@Version`) everywhere.
* Channels: `POST .../restock` (unique per execution), vendor claim
  `POST .../vendor-claim` + `/submit|acknowledge|approve|reject|settle`
  (DRAFT→…→SETTLED), `POST .../recovery` + `/list|sell|settle|fail|correct`
  (expected vs actual, admin corrections audited), `POST .../disposal/complete`.
  Repeats are rejected by checks + unique constraints — no double counting.
* Tasks: `/api/v1/operations/tasks` (+ `?mine`, `?status`), `/{id}/start|complete|cancel|assign`.
  Only assignee/admin complete; customers denied; reassigns audited.
* History: `GET /api/v1/returns/{id}/history` — lifecycle + risk + disposition +
  execution + channels + tasks + chronological audit events (actors hidden from customers).
* Analytics (admin): `GET /api/v1/admin/analytics/returns|recovery` — DB-level
  aggregations (disposition mix, completion rate, avg execution time, expected vs
  actual recovery, vendor settlement, restock, recycle/scrap).
* Observability: Actuator `returnOps` health details + `returnos.*` Micrometer
  counters (executions, settlements, tasks). Structured logs carry return/execution/actor.

## Frontend — ReturnOS web app (`frontend/`)

React 19 + TypeScript + Vite + react-router, hand-rolled "Dock Ledger" design
system (CSS tokens, no UI template), lucide icons, hand-drawn SVG charts,
Vitest + Testing Library. Real backend APIs only — no mocked data.

```bash
cd frontend
cp .env.example .env        # optional; empty = use Vite proxy below
npm install
npm run dev                 # http://localhost:5173, /api proxied to :8080
npm test                    # frontend tests (20)
npm run build               # production bundle in frontend/dist
```

Backend serves the API on :8080 (see Quick start). Browsers need CORS, allowed
via `CORS_ALLOWED_ORIGINS` (default `http://localhost:5173`, see `.env.example`).
Demo logins: customer@returnos.dev / staff@returnos.dev / admin@returnos.dev
(passwords in Quick start). JWT lives in `sessionStorage`; no refresh tokens.

Role homes: `/` customer dashboard · `/ops` warehouse · `/admin` control center.
Full customer journey (request → approve → receive → inspect → risk →
disposition → finalize → execute → settle) is clickable end-to-end in the UI.

## Structure

`com.returnos`: `auth` · `user` · `product` · `order` · `returns` · `policy` ·
`inspection` · `audit` · `common/{config,exception,security}`

Flyway `V1__init.sql` is the schema source of truth (`ddl-auto=validate` in prod).
