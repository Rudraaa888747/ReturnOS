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
                          Express 4 + TypeScript
                                   │
                 ┌─────────────────┴─────────────────┐
                 │   store.ts · warehouse/ · admin/  │
                 │   ← all business logic lives here │
                 └─────────────────┬─────────────────┘
                                   │
                          SQLite (better-sqlite3)
```

| | |
|---|---|
| **Backend** | Express 4, TypeScript (ESM), better-sqlite3 (synchronous), Zod, JWT + bcrypt |
| **Frontend** | React 19, Vite 8, react-router 7, CSS Modules + design tokens, lucide-react |
| **Tests** | vitest + supertest (backend), vitest + Testing Library (frontend), Playwright (e2e) |
| **Schema** | No migration files. `initSchema()` runs idempotent `CREATE TABLE IF NOT EXISTS` plus guarded `ALTER TABLE` checks |
| **Money** | Integer paise everywhere (`*_paise` columns). Never floats |

The frontend performs **no business logic and no financial writes**. Every
price, total, eligibility decision and status transition comes from the server.

---

## Quick start

Requires Node 20+.

```bash
# 1. Backend — http://localhost:8080
cd backend
npm install
cp .env.example .env     # then set JWT_SECRET to anything for local dev
npm run seed             # creates the demo catalogue, users and orders
npm run dev
```

```bash
# 2. Frontend — http://localhost:5173 (proxies /api to :8080)
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173> and sign in with one of the accounts below. The
app routes you to the right module based on your role.

### Useful scripts

| Command | Where | What it does |
|---|---|---|
| `npm run dev` | both | Dev server with reload |
| `npm test` | both | Unit/integration tests |
| `npm run test:e2e` | frontend | Playwright suite |
| `npm run build` | both | Production build |
| `npm run seed` | backend | Seed catalogue, users, demo orders |
| `npm run trim:orders` | backend | **Reset the demo database to its seeded baseline** |
| `npm run lint` | frontend | oxlint |

`trim:orders` is the reset button. It removes development orders, restores
catalogue stock, and puts the seeded demo return back under inspection. The
Playwright suite runs it automatically before every run, so **running e2e tests
will reset your demo data**.

---

## Demo accounts

Created by `npm run seed`.

| Role | Email | Password |
|---|---|---|
| Customer | see `backend/src/seed.ts` | `123456` |
| Warehouse | `warehouse@returnos.test` | `Warehouse123` |
| Admin | `admin@returnos.test` | `Admin123` |

Warehouse and admin accounts are **seeded, never self-registered** — public
signup always creates a `CUSTOMER`, so there is no privilege-escalation path.

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
`resolveReturnAtResolved()` in `store.ts` is the **only** code that issues store
credit, completes a refund, or creates a replacement/exchange order. The
warehouse and admin modules call it; neither reimplements it. A second
implementation would be a second source of financial truth.

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
agree, so **both are written in a single transaction** by `applyMovement()`, and
checkout routes its decrement through the same engine. If the bucket ever comes
up short it is clamped — and the clamp is recorded as
`WARNING_INVENTORY_CLAMPED`, because a silent clamp hides real drift.

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
`fulfillment.ts` simulates the carrier leg only. Everything from `RECEIVED`
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

All routes are under `/api/v1`. Roughly 120 endpoints:

| Group | Count | Auth |
|---|---|---|
| `/auth` | 5 | public |
| Customer (`/products`, `/cart`, `/checkout`, `/orders`, `/returns`, `/credit`, `/addresses`, `/profile`, `/support`, …) | ~47 | `CUSTOMER` |
| `/warehouse/*` | 18 | `WAREHOUSE` + site scope |
| `/admin/*` | 56 | `ADMIN` |

Errors are always `{ code, message, errors? }` — machine-readable codes like
`ALREADY_RECEIVED`, `DISPOSITION_NOT_ALLOWED`, `INSUFFICIENT_INVENTORY`,
`ADMIN_SELF_LOCKOUT`. Stack traces are never returned.

---

## Testing

```bash
cd backend  && npm test      # 521 tests, 25 files
cd frontend && npm test      #  28 tests,  5 files
cd frontend && npm run test:e2e   # 37 Playwright tests
```

The suites are built around the failure modes that actually matter:

- **Authorization matrix** — every admin endpoint against every role (admin,
  warehouse, customer, anonymous, forged token), with the route table asserted
  against the live Express router, so a new endpoint that nobody covers fails
  the suite.
- **Instant revocation** — a live session with a still-valid token loses access
  on the very next request after the account is disabled.
- **Money invariants** — store credit issued exactly once; a refund resolution
  issues no credit; interleaved restock-and-sale cannot make the two stock
  numbers drift; a failed movement rolls back both writes.
- **Workflow ordering** — cannot inspect before receiving, cannot dispose
  before inspecting, cannot do either twice.
- **Cross-system e2e** — a customer order and return, processed on the
  warehouse floor, verified as visible in Admin, in three separate browser
  contexts.

Playwright resets the demo database before each run, so tests read a known
baseline instead of whatever the previous run left behind.

---

## Project layout

```
backend/
  src/
    routes/          HTTP layer — validation, status codes, no business rules
    store.ts         Customer domain + the resolution engine
    warehouse/       schema, inventory, operations, tasks, analytics, audit
    admin/           permissions, readers, catalog, finance, sites, users, reports
    db.ts            Schema creation and migrations
    fulfillment.ts   Carrier-leg simulation (stops at IN_TRANSIT)
    seed.ts          Demo catalogue, users, orders
  scripts/
    trim-demo-orders.ts   Reset to the seeded baseline

frontend/
  src/
    pages/customer/  Storefront, cart, checkout, orders, returns
    pages/warehouse/ Queue, receiving, inspection, disposition, inventory, tasks
    pages/admin/     26 pages across the admin console
    lib/             API clients, session, cart provider
  e2e/               Playwright specs
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
