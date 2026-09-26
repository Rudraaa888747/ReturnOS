# ReturnOS

A returns-management platform built as three connected products on one backend:
a **customer storefront**, a **warehouse floor tool**, and an **admin console**.

A customer buys something and asks to send it back. An operator receives the
parcel, inspects it and decides what physically happens to the goods. The
backend turns that into money — a refund, store credit, or a replacement order —
and the customer watches it happen. Admin sees all of it.

The point of the project is that those three views never disagree, because
there is exactly one source of truth underneath them.

---

## Contents

- [What it does](#what-it-does)
- [Architecture](#architecture)
- [Quick start](#quick-start)
- [Demo accounts](#demo-accounts)
- [Deployment](#deployment)
- [The lifecycle](#the-lifecycle)
- [Design decisions worth knowing](#design-decisions-worth-knowing)
- [Data model](#data-model)
- [API surface](#api-surface)
- [Testing](#testing)
- [Project layout](#project-layout)
- [Known limitations](#known-limitations)

---

## What it does

### Customer
Browse a catalogue, add to cart, check out, track an order to delivery, then
raise a return against a delivered item. Pick a resolution — refund,
replacement, exchange or store credit — upload evidence, and follow the return
on a timeline. Store credit lands in a ledger and can be spent on the next
order.

### Warehouse
A queue of returns with derived priority and SLA. Receive a parcel (recording
its condition and any discrepancy), inspect it line by line, then choose a
disposition: restock, resell, repair, return to vendor, recycle or dispose.
Inventory moves between operational states, tasks are created by the work
itself, and everything is audited.

### Admin
Read-across visibility of every customer, order, return, warehouse and
inventory movement. Manage the catalogue, adjust store credit with a mandatory
reason, tune settings, handle support tickets, and export CSV reports. Admin
sees everything and writes almost nothing — deliberately.

---

## Architecture

```
          ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
          │   Customer   │  │  Warehouse   │  │    Admin     │
          │  storefront  │  │    floor     │  │   console    │
          └──────┬───────┘  └──────┬───────┘  └──────┬───────┘
                 │                 │                 │
                 └────────── React 19 / Vite ─────────┘
                                   │
                    Java 21 + Spring Boot (/api/v1)
                                   │
                  ┌────────────────┴──────────────────┐
                  │  controllers · services · scheduler │
                  │  ← all business logic lives here  │
                  └────────────────┬──────────────────┘
                                   │
                        PostgreSQL (Flyway V1..V8)
```

| | |
|---|---|
| **Backend** | Java 21, Spring Boot, Spring Security, JDBC, PostgreSQL, Flyway, JWT + BCrypt |
| **Frontend** | React 19, Vite 8, react-router 7, CSS Modules + design tokens, lucide-react |
| **Tests** | JUnit + Spring Boot + PostgreSQL (backend), vitest + Testing Library (frontend), Playwright (e2e) |
| **Schema** | Flyway migrations `backend-java/src/main/resources/db/migration/V1..V8` |
| **Money** | Integer paise everywhere (`*_paise` columns). Never floats |

The frontend performs **no business logic and no financial writes**. Every
price, total, eligibility decision and status transition comes from the server.

---

## Quick start

Requires Java 21, Maven 3.9+ (wrapper included), PostgreSQL 16+, Node 20+.

```bash
# 1. Database
createdb returnos

# 2. Backend — http://localhost:8080 (Flyway migrates V1..V8 automatically,
#    incl. the demo catalogue, users and orders)
cd backend-java
export DATABASE_URL=jdbc:postgresql://localhost:5432/returnos
export DATABASE_USERNAME=returnos DATABASE_PASSWORD=returnos
export JWT_SECRET=<at-least-32-characters> PORT=8080
./mvnw.cmd spring-boot:run        # Windows
./mvnw spring-boot:run            # Linux/macOS
```

```bash
# 3. Frontend — http://localhost:5173 (proxies /api to :8080)
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173> and sign in with one of the accounts below. The
app routes you to the right module based on your role.

To import an existing SQLite database after Flyway has run, set
`SQLITE_PATH` and `DATABASE_URL`, then run
`python backend-java/tools/sqlite_to_postgres.py`. The importer preserves text
IDs and copies common columns in SQLite dependency order; make a database
backup first and import into a clean target.

### Useful scripts

| Command | Where | What it does |
|---|---|---|
| `./mvnw.cmd spring-boot:run` | backend-java | Dev server with reload |
| `./mvnw.cmd test` | backend-java | Integration tests (needs PostgreSQL, see below) |
| `./mvnw.cmd package -DskipTests` | backend-java | Production jar (`target/returnos-backend-1.0.0.jar`) |
| `npm run dev` | frontend | Vite dev server |
| `npm test` | frontend | Unit tests |
| `npm run test:e2e` | frontend | Playwright suite (starts Java + Vite itself) |
| `npm run build` | frontend | Production build |
| `npm run lint` | frontend | oxlint |

Backend tests need PostgreSQL: either Testcontainers (default) or an
externally provided database via `TEST_DB_URL` / `TEST_DB_USERNAME` /
`TEST_DB_PASSWORD`:

```bash
docker run -d --name returnos-test-pg -e POSTGRES_USER=test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=returnos_test -p 5433:5432 postgres:16-alpine
$env:TEST_DB_URL="jdbc:postgresql://localhost:5433/returnos_test"; $env:TEST_DB_USERNAME="test"; $env:TEST_DB_PASSWORD="test"; .\mvnw.cmd test
```

The Playwright suite resets its own database (`returnos_e2e` on port 5433
by default, see `frontend/e2e/global-setup-java.ts`) before every run, so
**running e2e tests will reset the E2E data** — never point it at prod.

---

## Demo accounts

Seeded by Flyway migration `V7__demo_seed.sql` on every fresh database.

| Role | Email | Password |
|---|---|---|
| Customer | `customer@returnos.test` | `Customer123` |
| Warehouse | `warehouse@returnos.test` | `Warehouse123` |
| Admin | `admin@returnos.test` | `Admin123` |

Warehouse and admin accounts are **seeded, never self-registered** — public
signup always creates a `CUSTOMER`, so there is no privilege-escalation path.

### Public demo mode

Set `DEMO_MODE=true` on a public deployment to make the three demo accounts
read-only: login and all reads keep working, but any authenticated mutation
(cart, checkout, returns, warehouse actions, admin writes, signup) is
rejected by the backend with `403 DEMO_MODE`, and the frontend shows a
"Demo mode" notice instead of running the action. Leave it `false` (default)
for development, tests, and private deployments.

---

## Deployment

Frontend → Vercel, backend + PostgreSQL → Railway.

**Frontend (Vercel):** build `npm run build`, output `dist/`. Same-origin
works out of the box; for split hosting set `VITE_API_URL` to the backend
origin (e.g. `https://returnos-api.up.railway.app`). A `vercel.json` SPA
fallback is included.

**Backend (Railway):** deploy `backend-java/` with `./mvnw package` /
`java -jar target/*.jar`. Required variables:

| Variable | Notes |
|---|---|
| `DATABASE_URL` | JDBC URL, e.g. `jdbc:postgresql://host:5432/returnos` (Railway's auto `DATABASE_URL` lacks the `jdbc:` prefix — use a JDBC-style value) |
| `DATABASE_USERNAME` / `DATABASE_PASSWORD` | PostgreSQL credentials |
| `JWT_SECRET` | ≥ 32 random characters, never committed |
| `CORS_ORIGINS` | Production frontend origin(s), comma-separated |
| `DEMO_MODE` | `true` for the public demo, `false` otherwise |
| `STORAGE_PROVIDER` | `local` (default) or `s3` for document storage |
| `AWS_REGION` / `AWS_S3_BUCKET` | S3 region (default `ap-south-1`) and private bucket (default `returnos`) |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | **Environment only, never committed.** Read by the AWS SDK default chain |

Document uploads (`POST /api/v1/uploads/return/:id`) store only the S3
object key (`returns/{returnId}/photos/{generated}`) in PostgreSQL.
Downloads are ownership-checked, then served from the private bucket —
streamed through the backend for local storage, or via short-lived (5 min)
pre-signed URLs for S3. The bucket stays private; credentials never reach
the frontend.
| `PORT` | Provided by Railway automatically |

Flyway migrates on boot (deterministic V1..V8, incl. demo seed). Health:
`GET /api/health`. No scheduler or worker processes are required.

---

## The lifecycle

This is the path the whole system is built around.

```
CUSTOMER          places order ──▶ ORDER
                                    │  scheduler simulates the carrier
                                    ▼
                                 DELIVERED
                                    │
CUSTOMER          raises return ──▶ RETURN (REQUESTED)
                                    │
WAREHOUSE         approve ─────────▶ approved_at stamped
                  receive ─────────▶ RECEIVED    ──▶ customer sees "Return received"
                  inspect ─────────▶ INSPECTION  ──▶ customer sees "Inspection"
                  disposition ─────▶ goods moved to their new inventory state
                                    │
BACKEND           resolveReturnAtResolved()
                                    │
                    ┌───────────────┼───────────────┬──────────────┐
                    ▼               ▼               ▼              ▼
                 REFUND       STORE CREDIT     REPLACEMENT     EXCHANGE
                              (ledger entry)   (new order linked to the return)
                                    │
CUSTOMER          spends the credit on a new order ──▶ back to the top
```

Customer and warehouse do not push updates to each other. They both read the
same `return_events` timeline, so the customer's status *is* the warehouse's
status.

---

## Design decisions worth knowing

These are the parts that are easy to get wrong, and the reasoning behind how
they work.

### One resolution engine
`ReturnService` (`backend-java/.../returns/ReturnService.java`) is the
**only** code that issues store credit, completes a refund, or creates a
replacement/exchange order. The warehouse and admin modules call it; neither
reimplements it. A second implementation would be a second source of
financial truth.

### Approval is independent of status
`returns.approved_at` is a separate stamp, not a status value. Receiving a
parcel proves it arrived, **not** that the claim was accepted. If goods are
received without approval, the physical work continues (they have to go
somewhere) but the payout is **held**, an audit warning is raised, and it
appears on the dashboard as `pendingApproval`. Approving later releases the
held resolution.

### Duplicate work is blocked by the database
Not by application checks alone:

```sql
receiving_records   UNIQUE (return_id)
inspections         UNIQUE (return_id)
dispositions        UNIQUE (return_item_id)
store_credit_ledger UNIQUE (reference_type, reference_id)
inventory_movements UNIQUE (reference_type, reference_id, reason, product_id)
```

A retried request conflicts instead of double-applying.

### Two stock numbers that cannot drift
`products.stock` is what the storefront sells from. `inventory_buckets` with
`state = 'AVAILABLE'` is what the warehouse counts as sellable. They must always
agree, so **both are written in a single transaction** by the movement engine
in `WarehouseService`, and checkout routes its decrement through the same
engine. If the bucket ever comes up short it is clamped — and the clamp is
recorded as `WARNING_INVENTORY_CLAMPED`, because a silent clamp hides real
drift.

### Roles are read from the database, never from the token
The JWT carries a role claim, but every request re-reads the role and the
`active` flag from the database. Disabling or demoting an account takes effect
on the **next request**, not at token expiry. A token claiming `role: ADMIN` for
a customer's account is worthless.

### Warehouse operators are scoped to their site
Every operational table carries `warehouse_id`, and queries filter on the
operator's own site. Another site's task returns the same 404 as a task that
does not exist, so queues cannot be probed by id. Admin sees all sites by
design — but an admin token still gets 403 on `/warehouse/*` and on the
customer API. Breadth of visibility is not a universal key.

### The scheduler stops at IN_TRANSIT
`FulfillmentService` simulates the carrier leg only. Everything from `RECEIVED`
onward is driven by real operator actions. Without that boundary the timer
would receive and resolve returns before anyone touched them.

### Settings are tunable parameters only
Return window, SLA hours and shipping thresholds live in a database-backed
settings table. The **resolution matrix stays in code** — which dispositions an
inspection result permits, the paise arithmetic, and the approval gate are not
editable from the UI. This is a deliberate boundary, not an oversight.

---

## Data model

Core entities (customer side):

```
users ── orders ── order_items ── returns ── return_items
   │        │                        │
   ├── addresses                     ├── return_events   (the shared timeline)
   ├── cart_items                    ├── pickups         (inbound shipment)
   └── store_credit_ledger           └── refunds
```

Warehouse operations build on top rather than duplicating:

```
warehouses ── warehouse_locations
     │
     ├── receiving_records   (one per return)
     ├── inspections ── inspection_items
     ├── dispositions        (one per returned line)
     ├── inventory_buckets   (quantity per product per state)
     ├── inventory_movements (append-only stock ledger)
     ├── warehouse_tasks     (created by the work itself)
     └── audit_log           (append-only)
```

Admin adds `categories`, `settings`, `notification_templates` and its own
`admin_audit_log` — kept separate from the warehouse trail.

**Inventory states:** `AVAILABLE`, `RETURNED`, `INSPECTION`, `DAMAGED`,
`REPAIR`, `RESALE`, `VENDOR_RETURN`, `RECYCLE`, `DISPOSAL`, `RESERVED`.

---

## API surface

All routes are under `/api/v1`. 121 endpoints:

| Group | Count | Auth |
|---|---|---|
| `/auth` | 5 | public |
| Customer storefront (`/products`, `/cart`, `/checkout`, `/orders`, `/returns`, `/credit`, `/addresses`, `/profile`, `/support`, …) | ~43 | `CUSTOMER` |
| `/warehouse/*` | 18 | `WAREHOUSE` + site scope |
| `/admin/*` | 54 | `ADMIN` |
| Health (`/api/health`) | 1 | public |

Errors are always `{ code, message, errors? }` — machine-readable codes like
`ALREADY_RECEIVED`, `DISPOSITION_NOT_ALLOWED`, `INSUFFICIENT_INVENTORY`,
`ADMIN_SELF_LOCKOUT`. Stack traces are never returned.

---

## Testing

```bash
cd backend-java && .\mvnw.cmd test   # 34 tests, 9 classes (needs PostgreSQL, see above)
cd frontend && npm test               # 28 tests, 5 files
cd frontend && npm run test:e2e       # 37 Playwright tests vs Java + PostgreSQL
```

The suites are built around the failure modes that actually matter:

- **Authorization matrix** — every admin endpoint against every role (admin,
  warehouse, customer, anonymous, forged token), with instant revocation: a
  live session with a still-valid token loses access on the very next request
  after the account is disabled (roles are re-read from the database, never
  trusted from the token).
- **Money invariants** — store credit issued exactly once; a refund resolution
  issues no credit; interleaved restock-and-sale cannot make the two stock
  numbers drift; a failed movement rolls back both writes.
- **Workflow ordering** — cannot inspect before receiving, cannot dispose
  before inspecting, cannot do either twice.
- **Cross-system e2e** — a customer order and return, processed on the
  warehouse floor, verified as visible in Admin, in three separate browser
  contexts.

Playwright wipes and reseeds its own PostgreSQL database before each run
(`e2e/global-setup-java.ts` + Flyway), so tests read a known baseline
instead of whatever the previous run left behind.

---

## Project layout

```
backend-java/
  src/main/java/com/returnos/
    auth/            JWT, security filter, login/signup/reset
    commerce/        products, cart
    orders/          quote, checkout, order detail, tracking
    customer/        profile, addresses, credit, notifications
    returns/         returns, timelines, cancel, public tracking
    fulfillment/     carrier-leg scheduler (stops at IN_TRANSIT)
    warehouse/       queue, receive, inspection, disposition, inventory, tasks
    admin/           reads, writes, catalog, finance, sites, reports
    care/            documents, uploads, support tickets, feedback
    common/          health, meta, error contract
  src/main/resources/db/migration/
    V1..V8           Flyway schema + operational/demo seed
  src/test/          8 integration test classes (PostgreSQL-backed)
  tools/
    sqlite_to_postgres.py   One-off SQLite → PostgreSQL importer

frontend/
  src/
    pages/customer/  Storefront, cart, checkout, orders, returns
    pages/warehouse/ Queue, receiving, inspection, disposition, inventory, tasks
    pages/admin/     26 pages across the admin console
    lib/             API clients, session, cart provider
  e2e/               Playwright specs (+ dbpg.ts PostgreSQL helper)
```

The warehouse and admin consoles share one visual language
(`ops.module.css`) — both are operational tools. The customer storefront has
its own, consumer-facing aesthetic.

---

## Known limitations

Honest list of what is not done or deliberately constrained.

- **Payment is a test flow.** Orders are marked `PAID` with method `TEST`. No
  real payment provider is integrated; the architecture keeps that replaceable.
- **Refunds are read-only from Admin, by design.** Refund transitions belong to
  the resolution engine. Admin can see a refund but cannot push it forward.
- **Carrier tracking is not live.** Tracking numbers and carriers are recorded,
  but nothing contacts a carrier API. Shipment status is this system's own view.
- **Single warehouse operationally.** The schema carries `warehouse_id`
  everywhere and a second site has been exercised in tests, so going
  multi-site is a data and authorization change rather than a rewrite.
- **Granular RBAC is scaffolded, not active.** 21 permission strings are
  registered and every route already passes one, but `hasPermission()` checks
  role today. Per-permission grants slot in without touching call sites.
- **Support tickets have no category field.** No real data ever existed behind
  it, so it was left out rather than invented.
- **Browser coverage.** The e2e suite runs on Chromium. Mobile viewports are
  covered for the customer storefront but not for the admin console.

---

## License

No license file is included. All rights reserved by the repository owner
unless stated otherwise.
