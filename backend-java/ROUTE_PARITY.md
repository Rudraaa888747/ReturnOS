# API parity checklist

Source inventory: `tools/route_inventory.ps1` (121 TypeScript routes). Status
means behavior, validation, response shape, and authorization—not merely an
existing controller.

| Area | Source routes | Status | Tested |
|---|---:|---|---|
| Health | 1 | Implemented | Build only |
| Auth | 5 | Implemented (`signup`, `login`, `forgot`, `reset`, `me`; `resetToken` returned only outside `prod`/`production` profiles, mirroring TS `NODE_ENV` gate) | TESTED (signup/login/me via CheckoutIntegrationTest; forgot/reset flow verified in E2E `forgot-password` route run) |
| Products | 2 | Implemented (active-only list/get, camelCase DTO) | TESTED (E2E `routes.spec`: store + product detail render real catalogue) |
| Cart | 4 | Implemented (GET/POST/PATCH/DELETE incl. stock guards, PATCH upsert, cart shape with lineTotalPaise/totalQuantity) | TESTED (CheckoutIntegrationTest.cartLifecycleMatchesReference) |
| Profile / addresses / credit | 10 | Implemented (default-address rules + 404s mirror `store.ts`; empty settings body accepted like TS; credit history carries both snake_case and camelCase keys — TS parity plus storefront `amountPaise` reads) | TESTED (CustomerParityIntegrationTest) |
| Returns | 5 | Implemented (window/eligibility/quantity/resolution validation, RET-YYYY-NNNN numbers, enriched list/detail+order, raw timeline, cancel + notifications) | TESTED (ReturnsIntegrationTest: lifecycle + ownership) |
| Notifications / meta | 5 | Implemented (raw rows + is_read::int, unread filter, public meta, settings-driven window) | TESTED (CustomerParityIntegrationTest) |
| Orders / checkout / tracking | 5 | Implemented (quote, checkout/replay incl. ORDER_PLACED notification, list, detail with eligibility + resolutionsByReason, tracking; detail/list carry TS legacy rupee fields `subtotal`/`unit_price`/`line_total` plus camelCase aliases; tracking is null-safe) | TESTED (CheckoutIntegrationTest: 5 tests incl. ownership, validation, idempotency-key conflicts) |
| Documents / uploads / support / feedback | 10 (inventory count; "12" was approximate) | Implemented (documents list/download, upload with mime/size/kind rules + events, tickets CRUD/messages/close, feedback create/get) | TESTED (CareIntegrationTest: 3 tests) |
| Warehouse | 18 | Implemented (me, queue, return detail, approve, receive, inspection start/complete, disposition, inventory, movements, summary, tasks, claim, shipments, analytics, audit; site-scoping; resolution via ReturnService) | TESTED (WarehouseIntegrationTest: 6 tests) |
| Admin | 54 | Implemented (reads: me/audit/summary/customers/orders/returns/warehouses/workload/inventory/movements/analytics/refunds/credit; writes: settings/reasons/credit/sites/users/catalog/support/notifications/reports) | TESTED (AdminReads: 5 tests; AdminWrites: 6 tests) |

The checklist is updated only after route-level comparison with the TypeScript
route and tests. The Java service must not replace the reference backend until
every row is implemented and verified.

## Test execution (verified 2026-09-24)

`CheckoutIntegrationTest` (5 tests), `ReturnsIntegrationTest` (2 tests),
`WarehouseIntegrationTest` (6 tests) and `CareIntegrationTest` (3 tests)
pass against real PostgreSQL 16 — 16/16 green. The return-tracking route
(GET /api/v1/tracking/:returnNumber) is implemented and tested as part of
the Returns group. Warehouse adds `V5__warehouse_columns.sql`
(pickups.received_at/expected_arrival, warehouse_tasks.sla_breached_at).
Uploads use disk storage under `returnos.upload-dir` (`UPLOAD_DIR` env,
`./uploads` default) with a 5MB per-file limit.

Admin batch 1 (verified 2026-09-24): `AdminReadsIntegrationTest` (5 tests)
and `AdminWritesIntegrationTest` (6 tests) cover all 54 admin routes
against real PostgreSQL — 27/27 green overall. Write batch audits every
mutation to `admin_audit_log`. Adds `V6__notification_templates.sql`
(TICKET_REPLIED/TICKET_CLOSED seeds, mirroring TS seedTemplates).
Testcontainers' own Docker handshake fails in this environment (testcontainers
1.21.3 pins Docker API 1.32; Docker Desktop 4.92 / Engine 29 requires
>= 1.40, and its npipe handshake also returns spurious 400s), so the test
supports both modes: Testcontainers by default, or an externally provided
PostgreSQL via `TEST_DB_URL` / `TEST_DB_USERNAME` / `TEST_DB_PASSWORD`
(the mode verified here). Reproduce with:

```
docker run -d --name returnos-test-pg -e POSTGRES_USER=test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=returnos_test -p 5433:5432 postgres:16-alpine
$env:TEST_DB_URL="jdbc:postgresql://localhost:5433/returnos_test"; $env:TEST_DB_USERNAME="test"; $env:TEST_DB_PASSWORD="test"; .\mvnw.cmd test
```

"Partial" above means exactly the behaviors asserted in
`CheckoutIntegrationTest` — no more. Ownership checks over HTTP
(GET /orders, etc.) are still unverified.

## Final verification (2026-09-25)

Full suite: **32/32 green** (`.\mvnw.cmd test` vs PostgreSQL 16:
AdminReads 5, AdminWrites 6, Care 3, CustomerParity 3, Scheduler 2,
Checkout 5, Returns 2, Warehouse 6). Fixes since 2026-09-24:

- `FulfillmentService.minutesSince`: pgjdbc returns `TIMESTAMPTZ` as
  `java.sql.Timestamp` rendered in the JVM zone; parsing it as UTC made
  every delay check negative (~-320min in IST), so the scheduler never
  advanced. Now resolves `Timestamp`/`Date`/JSR-310 values to exact
  instants; zone-less strings fall back to the system zone. Verified by
  `SchedulerIntegrationTest` (carrier leg + IN_TRANSIT stop boundary +
  RECEIVE_RETURN task creation, terminal/unknown skipping).
- Auth `forgot`: `resetToken` gated on `prod`/`production` profiles.
- `PATCH /profile/settings`: empty body accepted (200) like TS.
- `GET /credit`: history rows carry snake_case AND camelCase keys.
- `GET /orders` list + detail: TS legacy rupee fields (`subtotal`,
  `unit_price`, `line_total`) plus camelCase aliases (fixes OrderDetail
  crash found by E2E).
- `GET /orders/:id/tracking`: `Map.of` NPE on nullable carrier fixed.
- Adds `V7__demo_seed.sql`: catalogue, categories, demo accounts
  (`rudrachokshi441@gmail.com`, `maya@example.com`,
  `warehouse@returnos.test`, `admin@returnos.test` — same demo
  credentials as TS `seed.ts`), AVAILABLE buckets, seeded orders
  ORD-2026-1001..1003 + demo return RET-2026-0841, `return_counter=841`.

Frontend: `npm run test` (vitest) **28/28 pass**. Playwright vs Java
(base `frontend/playwright.config.ts`, `returnos_e2e` on port 5433):
**37/37 pass on chromium** — all 7 spec files, incl. the 4 formerly
SQLite-coupled specs (`customer-journey`, `admin-cross-system`,
`admin-responsive`, `warehouse-tasks-actions`), migrated to PostgreSQL via
`frontend/e2e/dbpg.ts` (same assertions, same intent; `SUM()` numerics
coerced). Mobile: admin-nav nav-visibility assertions fail identically vs
the old Node backend (pre-existing responsive limitation, not a backend
difference); `routes` on mobile-safari flakes on both backends (WebKit
cancels in-flight fetches on `page.goto`; the spec records the resulting
pageerrors — untouched).

E2E reset is automated: `frontend/e2e/global-setup-java.ts` wipes the E2E
schema before each run and the Playwright-managed Java backend recreates it
via Flyway on boot (deterministic V1..V7 baseline incl. demo seed). Only
ever touches the E2E database — never prod.

## Backend replacement (final)

The TypeScript/Express/SQLite backend (`backend/`) has been removed. The
only backend is Java/Spring Boot + PostgreSQL; the only database authority
is Flyway. `backend-java/tools/sqlite_to_postgres.py` is retained as a
one-off importer for existing SQLite data.
