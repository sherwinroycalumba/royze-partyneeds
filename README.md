# Royze Party Needs Rental — Management System

Internal rental, supplies, and backdrop-package management for **Royze Party
Needs Rental** (Meycauayan, Bulacan). Replaces the Messenger + Google Sheets
workflow with one shared source of truth for bookings, inventory, payments,
and reports.

Built mobile-first: staff run bookings and deliveries from their phones, the
owner uses a desktop for reports.

- **Currency:** Philippine Peso (₱), stored as integer centavos — never floats.
- **Timezone:** Asia/Manila. Dates display as `Aug 09, 2026`.
- **Scope:** internal only. No client-facing portal in the MVP.

---

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router) + React 19 + TypeScript |
| Styling | Tailwind CSS v4, orange brand tokens in `app/globals.css` |
| Database | Supabase Postgres, with Row Level Security |
| Auth | Supabase Auth (email + password), owner-provisioned accounts |
| File storage | Supabase Storage (`branding` public, `documents` private) |
| PDFs | `@react-pdf/renderer`, A4, with a bundled font |
| Tests | Vitest |

> **Note on Next.js 16:** Middleware is now **Proxy** (`proxy.ts`, exporting
> `proxy`), and `cookies()`, `headers()`, `params`, and `searchParams` are
> async-only. Keep this in mind when adding routes.

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env.local
```

Fill in from **Supabase Dashboard → Project Settings → API**:

| Variable | Where to find it | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL | Safe in the browser |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable / anon key | Safe in the browser |
| `SUPABASE_SERVICE_ROLE_KEY` | `service_role` secret | **Server only.** Bypasses RLS |
| `SEED_OWNER_EMAIL` / `SEED_OWNER_PASSWORD` | You choose | Used once by the seed script |

The service-role key is required for owner-driven user management (creating
staff accounts, resetting passwords) because those use the Supabase Auth admin
API. It is imported only from `lib/supabase/admin.ts`, which is marked
`server-only` so it can never be bundled into client code.

### 3. Apply database migrations

The SQL in `supabase/migrations/` is ordered and idempotent — safe to re-run.

**Option A — Supabase dashboard (no extra tooling):**
Open **SQL Editor**, paste the contents of each file in order, and run:

1. `0001_auth_and_settings.sql` — roles, profiles, business settings, audit log, RLS
2. `0002_storage.sql` — storage buckets and their access policies
3. `0003_catalog_customers_suppliers.sql` — price catalog, backdrop
   packages, price history, customers, suppliers, catalog photo bucket
4. `0004_payment_accounts.sql` — repeatable payment accounts. **Copies the
   old single GCash/Maya/bank fields into the new table, then drops those
   columns from `business_settings`.** Run it once; it is guarded so a
   re-run is a no-op.
5. `0005_quotations.sql` — quotations, their line items, and the shared
   `PREFIX-YYYY-####` document counter that bookings, agreements, and
   orders will draw on too

**Option B — Supabase CLI:**

```bash
npm install -D supabase
npx supabase link --project-ref <your-project-ref>   # asks for the DB password
npx supabase db push
```

### 4. Seed the owner account

```bash
npm run seed
```

Creates the Owner from `SEED_OWNER_EMAIL` / `SEED_OWNER_PASSWORD`, and — when
`SEED_DEMO_USERS=true` — one demo account per role:

| Email | Role |
|---|---|
| `booking@royzepartyneeds.com` | Booking Staff (catalog manager) |
| `delivery@royzepartyneeds.com` | Delivery Staff |
| `books@royzepartyneeds.com` | Bookkeeper |

It also loads the known catalog — tents, tables, chairs, covers, karaoke,
backdrop frames, draping, lights, and about fifteen sale items — plus four
backdrop packages (Birthday Arch, Wedding Backdrop, Christening, Gender
Reveal) with their bills of components. `SEED_DEMO_USERS=true` additionally
adds sample customers and suppliers.

**Seeded prices are starting points.** Adjust them under *Price Catalog*;
every change is recorded in the price history.

Every seeded account is forced to set its own password at first sign-in.
Re-running the script skips anything that already exists, so it never
overwrites a price the owner has since edited.

### 5. Run it

```bash
npm run dev      # http://localhost:3000
```

---

## Commands

| Command | Does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm test` | Run the test suite |
| `npm run test:watch` | Tests in watch mode |
| `npm run typecheck` | TypeScript, no emit |
| `npm run lint` | ESLint |
| `npm run seed` | Seed owner, demo users, and settings |
| `npm run preview:pdf` | Render a sample quotation PDF to `.preview/` |

---

## Roles

Enforced in **three** places: the database (RLS policies), the server (the
data access layer in `lib/auth/dal.ts`), and the UI (nav and buttons are
hidden when the permission is absent).

| Role | Can |
|---|---|
| **Owner** | Everything. The only role that can verify payments, manage users and settings, view financial reports, manage expenses, and delete records. |
| **Booking Staff** | Customers, bookings, quotations, orders, agreements. Records payments as *pending verification*. Manages the catalog only if granted the `catalog_manager` flag. |
| **Delivery Staff** | Read-only calendar and booking details. Updates delivery/return status and records item condition on return. |
| **Bookkeeper** | Read-only financial data, including cost prices, quotations, and the customer and supplier directories. Categorizes expenses, exports reports for BIR filing. |

Accounts are **deactivated, never deleted**, so audit history always resolves
to a real person. The system refuses to deactivate or demote the last active
owner, and you cannot deactivate your own account.

The permission matrix lives in `lib/auth/permissions.ts` and is covered by
tests — change it there and both the guards and the nav follow.

---

## Architecture notes

```
app/
  (auth)/          login, forced password change      — signed-out shell
  (app)/           dashboard, catalog, packages,      — authenticated shell
                   customers, suppliers
    quotations/    list, builder, detail; [id]/pdf is a route handler
                   that returns the PDF file itself
    settings/      business, payments, delivery, defaults,
                   agreement, expenses, users — one route each
lib/
  auth/
    dal.ts         requireUser / requireOwner / requirePermission
    permissions.ts role → permission matrix (pure, tested)
    actions.ts     server actions ONLY
    password.ts    password policy (pure)
    admin-password.ts  privileged helper, server-only
  catalog/
    items.ts       item rules and stock status (pure, tested)
    packages.ts    package/component rules and bundle maths (pure, tested)
    price-history.ts  which money fields the price log watches (pure)
    actions.ts     server actions ONLY
  customers/
    matching.ts    phone normalisation and duplicate detection (pure, tested)
    actions.ts     server actions ONLY
  quotations/
    totals.ts      line, delivery, discount, and downpayment maths (pure, tested)
    status.ts      lifecycle, derived expiry, transitions (pure, tested)
    numbering.ts   QT-YYYY-#### shape and safe PDF filenames (pure, tested)
    actions.ts     server actions ONLY
  pdf/
    theme.ts       A4 page styles, brand palette, bundled font
    document.tsx   header, item table, totals, payment channels, footer
    quotation.tsx  the quotation document itself
    fonts/         Inter (SIL OFL 1.1) — see the note below
  settings/
    payment-accounts.ts  account rules and document ordering (pure, tested)
    actions.ts     server actions ONLY
  suppliers/actions.ts   server actions ONLY
  nav.ts           sidebar model, incl. the Settings sub-sections
  supabase/
    server.ts      cookie-bound client, runs as the user (RLS applies)
    client.ts      browser client
    admin.ts       service-role client, bypasses RLS — owner ops only
  forms.ts         FormData readers shared by every server action
  money.ts         integer-centavo arithmetic
  date.ts          Asia/Manila formatting
  audit.ts         append-only audit trail
  storage.ts       file upload abstraction (swap for S3 later)
proxy.ts           session refresh + optimistic redirect (was middleware)
supabase/migrations/  ordered, idempotent SQL
```

**Business rules live in pure modules.** Anything a test should be able to
reach — item validation, stock thresholds, bundle maths, phone matching —
sits outside the `"use server"` files, which handle only authorization,
persistence, and logging.

**Nothing is deleted.** Catalog items, packages, customers, and suppliers
are archived (`is_active = false`) so past bookings and quotations keep
resolving to the record they were written against. Archiving a catalog item
that an active package still lists is refused, and names the packages.

**Authorization boundary.** `proxy.ts` only refreshes sessions and does an
optimistic redirect — it is *not* the security boundary. Every page and
server action calls into `lib/auth/dal.ts`, which verifies the user against
the Auth server with `getUser()` (never the attacker-modifiable session
cookie) and then checks the role.

**A `"use server"` file may export only async functions, and every export
becomes a client-callable endpoint.** Constants, pure helpers, and privileged
functions that don't authorize themselves must live outside those modules —
see `lib/auth/password.ts` and `lib/auth/admin-password.ts`.

**Money.** Every amount is an integer number of centavos. `lib/money.ts` is
the only place arithmetic happens; percentages round half-up to the nearest
centavo, matching what staff compute by hand.

**Catalog shape.** One table backs both rental and sale items, because an
item can be both — a table cover is rented with a booking and also sold over
the counter. `is_rental` and `is_sale` decide which price set applies; cost
price is only ever sent to the Owner and Bookkeeper, and an edit by a
catalog manager who cannot see it leaves it untouched.

**Backdrop packages** are priced as a bundle, independently of the parts.
Their bill of components still drives behaviour: components flagged *used up*
come out of sale stock when the booking is confirmed, and everything else is
reserved against inventory for the event dates.

**Documents are real PDF files.** `/quotations/[id]/pdf` is a route handler
that returns `application/pdf`, not a print-styled page, because staff send
quotations to customers as an attachment on Messenger. The renderer is
`@react-pdf/renderer`; `lib/pdf/` splits into a shared theme and shell and a
per-document layout, so the rental agreement in Milestone 5 reuses the header,
item table, and signature blocks. The route re-checks the session itself —
`proxy.ts` is not a security boundary and no page guard has run.

**The bundled font is not decoration.** The PDF standard fonts cannot render
`₱`: Helvetica silently substitutes `±` and Times swallows the digit after it,
so every amount on a quotation would be wrong in a way nobody notices until a
customer argues about it. `lib/pdf/fonts/` therefore carries Inter (SIL OFL
1.1), read from disk at request time — which is why `next.config.ts` traces
those files into the deployment. Two related traps, both fixed and commented in
`lib/pdf/theme.ts`: a `lineHeight` on the `Page` style silently drops the
running footer off the page, and a heading without its own leading overlaps the
line beneath it.

**Quotation numbers are reserved in the database.** `next_document_number`
takes a row lock on a per-year counter, so two staff saving at the same moment
cannot both be handed `QT-2026-0007`. The same function issues `BK-`, `RA-`,
and `OR-` numbers in later milestones.

**Expiry is computed, never written.** A quotation past its validity date reads
as Expired the next time anyone looks at it, rather than waiting for a
scheduled job — so the list, the detail page, and the PDF can never disagree
about whether an offer still stands. Only a *sent* quotation expires: a draft
was never promised to anyone, and an accepted or declined one has already been
answered. Re-sending an expired quotation gives it a fresh validity window.

**Quotation lines are snapshots.** Each line stores the description and price
as they were when it was written, and keeps the catalog reference only so
reports can group by item. Editing a price in the catalog must never restate a
quotation the customer is already holding. For the same reason an accepted
quotation is frozen — it is the record of what was agreed.

**Payment accounts.** The business can hold any number of GCash, Maya, and
bank accounts. Only the ones marked active print on quotations and rental
agreements, so a closed account stays on file for reference without ever
being quoted. `activeAccounts` / `accountsByChannel` in
`lib/settings/payment-accounts.ts` are what documents must render through.

**Settings is seven routes, not one page.** `SETTINGS_SECTIONS` in
`lib/nav.ts` is the single source for the sidebar sub-links, each page's
heading and subtitle, and where a bare `/settings` redirects. Every section
still calls `requireOwner` server-side — the sub-links are a convenience,
not the boundary.

**List search is inline.** `components/ui/list-search.tsx` filters the rows
already on the page as you type, matching across every field a row exposes
and folding punctuation so `0917-123 4567` answers to `09171234567`. Filters
that change *which* rows are loaded (active vs archived, rental vs sale)
stay server-side GET forms so the URL remains shareable.

**Branding.** The orange palette is defined once as Tailwind v4 `@theme`
tokens in `app/globals.css`. Only `brand-600`/`brand-700` carry text (lighter
oranges fail WCAG AA on white). Semantic colors stay conventional: green =
verified, red = overdue, amber = pending.

---

## Deployment

Deploys as a standard Next.js app. Vercel is the simplest target since the
database and storage are already hosted by Supabase:

1. Push the repo to GitHub and import it into Vercel.
2. Add `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and
   `SUPABASE_SERVICE_ROLE_KEY` as environment variables. Mark the service-role
   key as a **server-side** variable.
3. Apply the migrations against the production project (step 3 above).
4. Run the seed once against production with the production `.env`.

A VPS works equally well: `npm run build && npm start` behind a reverse proxy.

**Never commit `.env.local`.** It is already gitignored.

---

## Build progress

Built in the milestone order from `Spec.md` §7.

- [x] **1 — Scaffold, auth, roles, settings, user management**
- [x] **2 — Price catalog, customers, suppliers**
- [x] **3 — Quotations + PDF engine**
- [ ] 4 — Bookings, availability engine, statuses, calendar
- [ ] 5 — Rental agreements, payments, verification, 50% confirmation rule
- [ ] 6 — Quick-sale orders + inventory decrement
- [ ] 7 — Expenses, payables, asset monitoring
- [ ] 8 — Dashboard + reports + CSV/PDF export
- [ ] 9 — Seed data, audit polish, deployment guide

### Accounting basis (for the bookkeeper)

Reports use **cash-basis** accounting for the MVP: revenue is recognized when
a payment is **verified**, not when a booking is created or completed. Pending
(unverified) payments never count toward revenue or the 50% confirmation gate.
