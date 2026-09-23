# ReturnOS — DESIGN.md

Source of truth for the ReturnOS visual identity (public homepage + product).
Original system: "Dock Ledger" — enterprise operations meets modern software.
Not copied from any company. No purple/blue gradients, no glassmorphism soup.

## 1. Brand personality

Precise, reliable, intelligent, operational, calm, fast, transparent, scalable,
trustworthy, modern. The site must read as: **"this system actually runs
returns operations."** No childish startup voice, no gaming effects, no fake AI
hype. Copy is specific and operational; never "revolutionizing", "leading",
"next-generation", or lorem ipsum.

## 2. Design philosophy

- **Manifest, not marketing.** Motifs come from warehouse labels, routing
  slips, inspection queues, audit trails: IDs in mono, status stamps,
  ruled ledgers, route lines.
- **One idea per section, one composition per idea.** Never seven identical
  cards. Alternate: console panel / ledger table / horizontal rail / decision
  table / metric band / flow diagram / tabbed product view.
- **Flat and bordered.** 1px `var(--line)` borders, subtle fills, one soft
  shadow reserved for the hero console and overlays. No floating-card forests.
- **Data is decoration (when honest).** Return numbers, SLAs, bins, SKUs,
  recovery values. All homepage figures are labeled demo/sample unless they
  come from a live API.

## 3. Color

Base tokens live in `frontend/src/styles/tokens.css` (single source of truth).
Homepage reuses them exactly — no parallel palette.

| Role | Token | Value | Use |
|---|---|---|---|
| Paper | `--paper` | `#f6f6f3` | Page background |
| Surface | `--surface` | `#ffffff` | Panels, consoles |
| Sunken | `--surface-sunken` | `#eceee8` | Wells, tab bars, code strips |
| Ink | `--ink` / `--ink-2` / `--ink-3` | `#16191f` / `#3d434d` / `#616a76` | Headings / body / muted |
| Line | `--line` / `--line-strong` | `#e0e3e8` / `#c6ccd4` | Borders |
| Brand | `--brand` / `--brand-strong` / `--brand-soft` | `#1d4ed8` / `#1e3a8a` / `#e5edfb` | Actions, route lines, active states |
| Ops dark | `--ops-*` (homepage scope) | `#10141b` surface, `#1a2230` raised | Warehouse console section only |
| Semantic | `--ok` / `--warn` / `--bad` / `--info` | muted greens/ambers/reds/blues | Status stamps only, always with text label |

Green is reserved for success states. Risk colors always pair with a text
label + icon, never color alone.

## 4. Typography

- UI: `Inter` (`--font-ui`). Data/IDs/numbers: `IBM Plex Mono` (`--font-data`,
  `.data` class with tabular-nums).
- Display: semibold, `letter-spacing: -0.02em`, tight leading (`--lh-tight`).
- Scale (fluid via clamp on homepage): hero `clamp(2.4rem, 5vw, 3.9rem)`;
  section `clamp(1.6rem, 2.6vw, 2.2rem)`; title `1.125rem`; body `0.95–1.02rem`;
  label `0.75rem` uppercase `0.08em`; meta `0.8125rem` mono where tabular.
- Hierarchy: kicker → H2 → lede → content. One H1 per page (hero).
  Homepage H2s are sentence-case operational statements.

## 5. Spacing / layout / grid

- 4px base (`--sp-*`). Section rhythm: `clamp(4.5rem, 8vw, 7rem)` vertical.
- Container: `1160px` max, `24px` gutters (`--sp-5`), centered.
- Grid: 12-col desktop; hero `5/7` split; capabilities alternate
  `media | text`; warehouse console full-bleed dark band with inner grid;
  analytics metric band `4-up → 2-up → 1-up`. Zero horizontal scroll at
  360px — verified.
- Dividers: 1px `var(--line)` rules between narrative sections; dark band
  uses its own hairlines (`rgba(255,255,255,.12)`).

## 6. Radius / shadow / borders

- Radius hierarchy (single source: `styles/tokens.css`): `--radius-sm: 8px`
  (chips, code tags, table flags), `--radius-md: 14px` (buttons, inputs,
  list rows, nav links), `--radius-lg: 20px` (cards, panels, ledgers),
  `--radius-xl: 28px` (hero moments: ops console, CTA band, auth card),
  `--radius-pill: 999px` (stamps, badges, tab bar, progress tracks,
  nav CTA). Circles stay 50% (dots, numbered nodes, icon menu button).
- Shadow: `--shadow-pop` for hero console + dropdowns; `--shadow-soft`
  for resting elevated surfaces (primary CTAs, auth card) and `--shadow-lift`
  on button hover. Everything else is border-defined.
- Borders: panels `1px solid var(--line)`; emphasis edge 3px top (roles) or
  left (callouts). Dashed rules separate ledger rows.
- Motion (buttons): background/border fast, lift + shadow on `--ease-spring`;
  hover `translateY(-1px)`, active press `scale(0.985)`; primary-CTA icons
  nudge `translateX(3px)` on hover. One loop allowed (current-stage pulse).
  Global `prefers-reduced-motion` kill-switch covers all of it.

## 7. Components

- **Buttons:** primary (brand fill, white text), quiet (surface, strong
  border), dark-band inverse. `12–14px` padding, semibold, radius-md.
  Hover: darken + 1px lift + soft shadow; active: gentle press. Focus: 2px brand outline + 2px offset.
- **Nav:** sticky, paper with blur fallback, hairline bottom. Desktop links +
  Track + Sign in + Get started. Mobile: hamburger → full dropdown panel,
  `aria-expanded`, Escape closes, focus returns to trigger.
- **Stamps/badges:** mono uppercase `0.72rem`, dot + label, tone border +
  soft fill (`Badge` in `components/ui.tsx` — reuse, don't reinvent).
- **Tracking ticket:** input + button; states idle / focused / loading
  (spinner + `aria-live`) / success (manifest grid) / invalid (format hint)
  / error (not found). Demo IDs listed beneath; labeled "Sample data".
- **Lifecycle rail:** horizontal 8-node rail desktop with route connector;
  vertical timeline ≤960px. Current-node pulse is the only loop.
- **Tables/ledgers:** header mono uppercase; rows with hairline separators;
  mono for IDs/SKUs/values; priority + condition as stamps.
- **Console (dark):** ops band only — near-black surface, mono timetable,
  amber/cyan accents, scan-line restraint (no heavy effects).
- **Charts:** hand-rolled SVG bars/donut from real/demo numbers (see
  `components/visuals.tsx` `Bars`/`Donut`). No chart library. Bars animate
  width on reveal; values always printed as text (no color-only encoding).
- **Tabs (showcase):** sunken tab bar, one panel at a time, `role=tablist`,
  arrow-key support, `aria-selected`/`aria-controls`.
- **Inputs:** 44px min touch target, label + hint + error (`role=alert`).

## 8. Iconography

Single system: `lucide-react`, 1.5–2.2 stroke, 15–19px in homepage context.
Technical/operational set only (package, scan, route, clipboard-check,
scale, chart, shield, plug). No emoji, no mixed libraries.

## 9. Motion

Vocabulary: fade (text), rise 10px (panels), route draw (lifecycle fill,
transform-only), count-up (metrics, `prefers-reduced-motion` → final value),
panel swap 180ms. Durations `--dur-fast: 120ms` / `--dur-med: 180ms`
(hero route up to 700ms, transform-only). One loop allowed: current-stage
pulse. `Reveal` (IntersectionObserver, one-shot, stagger ≤120ms on siblings).
Global kill-switch in `base.css` under `prefers-reduced-motion: reduce`.

## 10. Responsive

Breakpoints: `1100px` (hero stack), `960px` (rails → vertical, grids → 1-col),
`720px` (nav → hamburger, metrics 2-up), `560px` (ledger → stacked rows,
metrics 1-up, tab bar scroll). Touch targets ≥44px. Forms full-width on
mobile. No text clipping; mono IDs wrap with `overflow-wrap:anywhere`.

## 11. Accessibility

Semantic landmarks (`header/nav/main/section/footer`), logical H1→H2→H3,
skip link, visible focus, keyboard-operable tabs/menu/tracking, forms with
labels + `aria-describedby` errors, `aria-live` for tracking + counters,
alt text on imagery (CSS/SVG motifs are `aria-hidden`), contrast ≥4.5:1 for
body text (muted meta ≥4.5:1 on paper — `#616a76` on `#f6f6f3` passes),
reduced-motion respected, no ARIA where native semantics suffice.

## 12. States

Empty (ledger with action), loading (skeleton/spinner + `aria-busy`),
error (tone panel + retry), invalid-ID (format guidance, keep input value),
not-found (suggest sample IDs), demo banner ("Sample data — connect the
tracking API to go live"). Tracking component is API-ready: swap
`lookupReturn()` in `demo.ts` for a fetch call with identical return shape.

## 13. Imagery

No stock photography on v1 — story is told with live-looking product UI
(consoles, tickets, ledgers, route SVGs). If photography is added later:
warehouses, parcels, inspection benches, cargo movement; consistent cool
grade; never handshakes/meetings/smiling drivers.

## 14. Performance

Zero new runtime deps (React + react-router + lucide only). CSS modules per
section (no global bloat). Fonts via Google Fonts display=swap (Inter +
Plex Mono). Lazy-load below-fold sections? No — single homepage bundle is
small; instead: transform-only animations, IntersectionObserver reveals,
no chart lib, SVG icons, `prefers-reduced-motion` short-circuit.

## 15. Customer platform (full-stack)

The customer experience lives under `/customer` behind JWT auth and follows
the same Dock Ledger system — same tokens (`styles/tokens.css`), same stamps,
same flat bordered panels, same motion discipline. No second design language.

- **Shell:** 248px sidebar (Manage / Support / Account) + topbar + content
  column (max 1080px). Mobile: sidebar becomes an overlay drawer with scrim,
  opened by a 44px hamburger; content stacks; tables scroll inside
  `.tableWrap` so the page never scrolls horizontally at 360px.
- **Status:** one `StatusBadge` component (`components/ui.tsx`) with four
  tones (ok/warn/bad/info), always dot + text label, never color alone.
  Raw backend enums are humanized at render ("Original Method", "In Transit").
- **States:** every async view implements loading (skeleton + `role=status`),
  empty (what it means + next action), error (message + retry, `role=alert`),
  and confirmation (saved/submitted/cancelled). No dead buttons: every action
  calls a real API and reflects the result.
- **Return detail answers four questions:** what happened, what is happening
  now, what happens next, anything needed from the customer — derived from
  backend status, not hardcoded copy.
- **Backend:** Express + SQLite (`backend/`), layered routes → store →
  better-sqlite3, zod validation, JWT (`CUSTOMER` role), ownership enforced
  per-row with 404-on-foreign (no existence leaks), consistent
  `{code, message, errors?}` error shape, multer evidence uploads (JPG/PNG/
  WebP/PDF, 5 MB, ownership-checked download only — uploads are never served
  statically). `FRONTEND_DIST` enables single-origin production serving.
