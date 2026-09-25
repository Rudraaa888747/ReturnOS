# Migration map

The TypeScript backend remains the behavioural reference until parity is verified.
The Java package boundaries mirror it: `auth` maps `routes/auth.ts` and
`middleware/auth.ts`; `commerce` maps `products`, `cart`, `checkout` and
`orders`; the remaining planned modules map one-to-one to `returns`,
`warehouse`, and `admin` route modules. `V1__initial_schema.sql` maps every
SQLite table from `db.ts`, `warehouse/schema.ts`, and `admin/schema.ts` to
PostgreSQL while retaining text identifiers and integer paise money fields.

`tools/route_inventory.ps1` generates the complete TypeScript route inventory
from the route modules for API-parity review; no existing route is removed
from the TypeScript app.
The two critical unique guards are preserved in PostgreSQL: ledger references
and inventory movement references, alongside one receiving record, inspection,
and disposition per return/item.
