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
6. `0006_bookings.sql` — bookings, their line items and package
   component rows, the `reserved_quantities` availability aggregate,
   and `catalog_items.damaged_quantity`
7. `0007_agreements_payments.sql` — rental agreements, payments and
   their verification workflow, the `verified_paid_centavos` function,
   and the trigger that keeps `bookings.agreement_signed` honest
8. `0008_cash_payment_note.sql` — makes the CASH line on documents
   owner-editable
9. `0009_orders.sql` — quick-sale orders, and `payments.order_id` so a
   payment can hang off an order as well as a booking
10. `0010_expenses_assets.sql` — expenses and payables, plus the
    under-repair / written-off counts and acquisition details that
    turn the rental catalog into an asset register

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
| `npm run seed` | Seed owner, catalog, and — with `SEED_DEMO_USERS=true` — demo staff and a week of operations |
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
    bookings/      list, builder, detail, the delivery-staff return sheet,
                   the agreement card, and the payments card;
                   [id]/agreement returns the signed-document PDF
    calendar/      month, week, and day views of the whole team's work
    payments/      the ledger and the owner's verification queue
    orders/        the quick-sale screen, the sales list, and receipts
    expenses/      spending, categories, and the payables queue
    assets/        the equipment register and overdue returns
    reports/       the eight reports; export/ returns CSV or PDF
    audit/         the append-only trail, filtered by area and date
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
  documents/
    totals.ts      line, delivery, discount, and downpayment maths shared
                   by every priced document (pure, tested)
  quotations/
    status.ts      lifecycle, derived expiry, transitions (pure, tested)
    numbering.ts   QT-YYYY-#### shape and safe PDF filenames (pure, tested)
    validation.ts  what makes a quotation savable (pure, tested)
    actions.ts     server actions ONLY
  agreements/
    status.ts      Generated → Sent → Signed (pure, tested)
    actions.ts     server actions ONLY
  assets/
    status.ts      the owned/damaged/repair/written-off counts, the
                   availability breakdown, overdue returns (pure, tested)
    actions.ts     server actions ONLY
  reports/
    types.ts       one shape for every report, so CSV and PDF each
                   need a single renderer
    revenue.ts     cash-basis recognition and exact centavo splitting
                   (pure, tested)
    aging.ts       receivables buckets (pure, tested)
    csv.ts         CSV serialising, escaping, formula guard (pure, tested)
    build.ts       the eight report queries, server-only
  expenses/
    payables.ts    payable aging and category totals (pure, tested)
    validation.ts  what makes an expense savable (pure, tested)
    actions.ts     server actions ONLY
  orders/
    totals.ts      counter arithmetic — no fee, no downpayment (pure, tested)
    stock.ts       sale and void stock movements, low stock (pure, tested)
    status.ts      completed / voided (pure, tested)
    actions.ts     server actions ONLY
  payments/
    methods.ts     methods, the cash-auto-verifies rule, validation (pure, tested)
    totals.ts      verified vs pending money (pure, tested)
    actions.ts     server actions ONLY
  bookings/
    status.ts      the nine statuses and the Confirmed gate (pure, tested)
    availability.ts  stock maths and the overbooking verdict (pure, tested)
    windows.ts     the date range stock is held for (pure, tested)
    returns.ts     damage charges and inventory effects (pure, tested)
    calendar.ts    month/week/day grid maths (pure, tested)
    validation.ts  what makes a booking savable (pure, tested)
    stock.ts       the one database half of availability, server-only
    actions.ts     server actions ONLY
  pdf/
    theme.ts       A4 page styles, brand palette, bundled font
    document.tsx   header, item table, totals, payment channels, footer
    quotation.tsx  the quotation document itself
    agreement.tsx  the rental agreement, with replacement values
    report.tsx     one landscape renderer for all eight reports
    fonts/         Inter (SIL OFL 1.1) — see the note below
  settings/
    payment-accounts.ts  account rules and document ordering (pure, tested)
    actions.ts     server actions ONLY
  suppliers/actions.ts   server actions ONLY
  nav.ts           grouped sidebar model + role filtering (pure, tested)
  supabase/
    server.ts      cookie-bound client, runs as the user (RLS applies)
    client.ts      browser client
    admin.ts       service-role client, bypasses RLS — owner ops only
  forms.ts         FormData readers shared by every server action
  money.ts         integer-centavo arithmetic
  date.ts          Asia/Manila formatting
  audit.ts         append-only audit trail (writes)
  audit-log.ts     reading it: domains, notable actions (pure, tested)
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

**Availability is answered by the database, judged in TypeScript.** The
overlap aggregate (`reserved_quantities`) runs in Postgres, because summing
every competing booking in the app would mean pulling them all across the
wire. Everything that decides whether the answer is a *problem* —
owned − damaged − reserved, per item, totalled across a cart —
is pure and tested in `lib/bookings/availability.ts`. A backdrop package
contributes its rental components individually, which is what stops two
backdrop bookings on one day from quietly sharing a single arch. Going past
the stock on hand is blocked for everyone and overridable only by the Owner,
with a reason, which is logged.

**A booking's window is the whole job, not the event day.** Stock is held
from the earliest of setup and delivery through the latest of teardown and
pickup, and every instant is folded to a *Manila* day first: a 9pm delivery
on the 28th is the 29th in UTC, and a chair that left the yard on the 28th
must not read as free that day. `datetime-local` inputs are read as Manila
wall-clock time for the same reason — otherwise the phone's own timezone
would silently decide what "2:00 PM" meant.

**The Confirmed gate.** A booking cannot be confirmed until the rental
agreement is signed *and* verified payments cover the downpayment. Both
blockers are reported at once, so staff chasing a customer know they want a
signature *and* the deposit rather than discovering the second requirement
after satisfying the first. The Owner may override with a logged reason.

**Verified money and claimed money are never added together.** Cash is
verified the moment it is recorded — the person recording it is holding it.
GCash, Maya, and bank transfers are *claims* that money moved, and only the
Owner can confirm one against the account. Until they do, the amount counts
toward nothing: not the gate, not the balance, not revenue. This is enforced
three deep — `initialStatus` decides it, `summarisePayments` keeps the two
apart, and the database grants an UPDATE policy on `payments` to the Owner
alone, so "only the Owner verifies" is true even against a hand-written API
call. A rejected payment keeps its reason and stays on the money trail rather
than vanishing.

**`bookings.agreement_signed` has exactly one writer.** The flag the gate
reads is maintained by a trigger on `rental_agreements`, not by any call
site, so the booking and its agreement cannot disagree about whether
something has been signed. Deleting an agreement clears the flag, or the gate
would stay open on the strength of a document that no longer exists.

**A signed document never changes.** The agreement snapshots its clauses and
its figures at generation time. The owner can rewrite the template in
Settings whenever they like; a document someone has put their name to keeps
the wording they agreed to. Re-generating is refused once signed — that would
discard evidence.

**Package components are stored, not just summarised.** A backdrop package
becomes a priced parent line plus one ₱0 component row per part. The
components are what the availability engine reserves and what consumables
come out of; the customer-facing documents print only the parent. Components
are rebuilt from the saved package on every write, so they always match the
definition the catalog vouches for.

**Returns raise charges.** Delivery Staff record each line as fine, damaged,
or lost. Anything damaged or lost raises a charge at the catalog's
replacement value — the figure the agreement says the customer agreed to —
and re-recording a return replaces that charge rather than stacking a second
one. Damaged stock stays owned but stops being available; lost stock reduces
what the business owns. Marking damaged items repaired or written off is
Milestone 7.

**A quick sale is one screen and one submission.** Spec 4.6 sets the bar at
"under ~30 seconds so quick sales actually get recorded" — the problem being
solved is unrecorded sales, not imperfect ones. So the sale, its stock
movement, and its payment are a single form: tap an item, tap a payment
method, done. The customer defaults to Walk-in, the date to today, the price
to the catalog's, and quantity is a stepper rather than a keyboard.

**Selling more than the shelf says is recorded, not refused.** If the count
says eight and someone sells ten, the goods have physically left the shop.
Refusing that would recreate the exact problem the screen exists to fix, so
the sale saves, stock floors at zero, and the discrepancy is surfaced to
staff and written to the audit trail so somebody can recount. Orders are
never deleted either: voiding puts the stock back, strikes the payment with
a reason, and leaves the mistake on the record.

**Order arithmetic is deliberately its own function.** `orderTotals` is not
`documentTotals` with zeroes passed in — a counter sale has no delivery fee
and no downpayment, and faking them would leave two shapes of "total" that
look interchangeable and are not.

**Damaged stock now has a way back.** Milestone 4 took broken items out of
availability on return and left them there — the register was a one-way door.
The Owner can now move stock between damaged, away for repair, and back in
service, or write it off. Writing off shrinks the fleet as well as the broken
pile, exactly as an item lost on return does, so `quantity_owned` always means
"what the business actually has". Available is *derived* — owned less damaged,
under repair, reserved, and out on rental — so putting something back in
service is simply taking it out of the broken pile.

**A payable with no due date is refused.** An unpaid expense that nobody
dated is a bill nobody will chase, so the validation insists on one. Paid and
unpaid expenses keep the other's date column blank rather than carrying a
stale value into the payables queue. Aging buckets match the receivables
report in Spec 4.11, so both halves of the money picture read the same way.

**Uncategorised spending is visible, not silent.** An expense with no category
gets its own bucket in the totals and a count on the page, because finding
those is precisely the Bookkeeper's job before a BIR filing. Categorising is
its own server action, separate from editing, so the Bookkeeper can reach the
category and nothing else — the app-level half of an RLS policy that can only
say "may update", not "may update this column".

**A report is data, not markup.** Eight reports times two export formats is
sixteen things to keep in step, so a report is described as sections of
columns and rows and there is exactly one CSV serialiser and one PDF
renderer. A ninth report is a query in `lib/reports/build.ts`, not another
pair of exporters.

**Revenue is split without losing centavos.** Cash-basis means revenue is
recognised when a payment is verified — but a payment arrives as one number
against a basket of rentals, sale items, a package, a delivery fee, and
possibly a damage charge, and the P&L wants those apart. Each verified
payment is allocated across the document's revenue mix by largest-remainder,
so the parts sum to *exactly* the cash received. A half-paid booking
recognises half of each source: the customer did not pay "for the chairs
first". Overpayment is a credit, not income.

**The CSV is written for a spreadsheet, not for a screen.** Money goes out as
`1234.56`, because Excel cannot sum a peso sign and thousands separators turn
a number into text. Any value that starts `=`, `+`, `-`, or `@` is prefixed
with an apostrophe: a payee named `=cmd|…` is a real attack on whoever opens
the file, and one character prevents it.

**The audit trail is readable, not just written.** Every write has appended an
entry since Milestone 1, but a few thousand rows of `booking.update` answer
nothing. `/audit` groups entries by area and can narrow to the ones that move
money, override a rule, or remove something — overrides, voids, rejections,
cancellations, write-offs, stock adjustments, password resets. Those are not
"suspicious": every one is a legitimate action. They are simply what an owner
scans for when reconciling a month or wondering why a number changed. The
table has no UPDATE or DELETE policy, so nothing there can be altered —
including by the owner.

**Payment accounts.** The business can hold any number of GCash, Maya, and
bank accounts. Only the ones marked active print on quotations and rental
agreements, so a closed account stays on file for reference without ever
being quoted. `activeAccounts` / `accountsByChannel` in
`lib/settings/payment-accounts.ts` are what documents must render through.

**The sidebar is grouped, and the groups are honest.** Thirteen
destinations in a flat list is unreadable on a phone, so everything except
Dashboard and Settings sits in a collapsible group — Sales & Bookings,
Catalog & Assets, Contacts, Finance. `visibleNav` filters links by permission
and drops any group left with nothing in it, so Delivery Staff see exactly
Dashboard, Bookings, and Calendar rather than headings that expand into
nothing. The group holding the current page opens on arrival whatever was
remembered; every other group's state is remembered per user in
`localStorage`, read through `useSyncExternalStore` so the server render and
the first client render agree.

A consequence worth knowing: Delivery Staff no longer hold `catalog.view`.
Booking lines carry their own snapshotted descriptions, so a driver never
needs the price list — and a nav that hid a page they could still open by
typing the URL would be lying.

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
database and storage are already hosted by Supabase.

### 1. Create the production Supabase project

A separate project from the one you develop against — the seed creates real
accounts and the app writes real money records.

### 2. Apply the migrations, in order

Paste `supabase/migrations/0001` … `0010` into the SQL Editor one at a time,
or `npx supabase db push` if you have the CLI linked. They are ordered and
idempotent, and no migration references anything a later one creates, so a
clean run in numeric order is all that is needed.

**Check each one reported success before moving on.** The SQL Editor runs a
script as a single transaction: one failing statement rolls the whole file
back, leaving no trace that it was attempted. If the app later complains that
a table is missing "in the schema cache", an earlier migration silently rolled
back.

### 3. Deploy the app

1. Push the repo to GitHub and import it into Vercel.
2. Add `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and
   `SUPABASE_SERVICE_ROLE_KEY` as environment variables. Mark the service-role
   key as a **server-side** variable — it bypasses RLS.

A VPS works equally well: `npm run build && npm start` behind a reverse proxy.

### 4. Seed the owner

```bash
npm run seed
```

against the production environment, **without** `SEED_DEMO_USERS` — you do not
want demo staff accounts or fake bookings in the real system.

### 5. First-run checklist

In this order, because each step depends on the one before:

1. Sign in as the owner and change the temporary password.
2. **Settings → Business Profile** — address, contact numbers, TIN, logo.
   These print on every quotation and agreement.
3. **Settings → Payment Channels** — your GCash, Maya, and bank accounts, and
   the cash instructions. A document generated before this prints with no way
   for the customer to pay you.
4. **Settings → Delivery Fees** — the free-delivery area name and any
   suggested fees.
5. **Price Catalog** — adjust the seeded prices, which are starting points,
   and set `quantity_owned` for each rental item. The availability engine is
   only as honest as that number.
6. **Settings → Users** — create the real staff accounts.
7. Make one quotation, download the PDF, and check it shows your details and
   your payment channels. That single document exercises the branding, the
   numbering, the fonts, and the payment settings in one go.

**Never commit `.env.local`.** It is already gitignored.

### Backups

Supabase takes daily backups on paid plans. On the free tier, the money
records — `bookings`, `payments`, `orders`, `expenses` — are the ones worth
exporting periodically; the reports screen exports each as CSV.

---

## Build progress

Built in the milestone order from `Spec.md` §7.

- [x] **1 — Scaffold, auth, roles, settings, user management**
- [x] **2 — Price catalog, customers, suppliers**
- [x] **3 — Quotations + PDF engine**
- [x] **4 — Bookings, availability engine, statuses, calendar**
- [x] **5 — Rental agreements, payments, verification, 50% confirmation rule**
- [x] **6 — Quick-sale orders + inventory decrement**
- [x] **7 — Expenses, payables, asset monitoring**
- [x] **8 — Dashboard + reports + CSV/PDF export**
- [x] **9 — Seed data, audit polish, deployment guide**

### Acceptance criteria (Spec §8)

Every criterion is implemented. The right-hand column is honest about what
has been **exercised against a real database** versus what is covered by
tests and a build only — the difference matters, because most of the bugs
found during this build were only visible when the app met real data.

| Criterion | Where | Verified live |
|---|---|---|
| Owner creates staff accounts; role restrictions enforced | Settings → Users, `lib/auth/dal.ts` | yes |
| Quotation on a phone, A4 PDF in under 2 minutes | `/quotations/new`, `[id]/pdf` | yes — `QT-2026-0001` |
| Quotation converts to a booking in one click; appears on the calendar | Convert button, `/calendar` | yes — `BK-2026-0001` |
| Confirmed needs a signed agreement **and** verified payments ≥ 50%, owner override logged | `lib/bookings/status.ts` | not yet |
| Owner sees pending payments and verifies in one tap | Dashboard queue, `/payments` | not yet |
| Double-booking past owned quantities warns | `lib/bookings/availability.ts` | not yet |
| Backdrop package reserves components, decrements consumables, shows as a calendar setup | `expandPackages`, `/calendar` | not yet |
| Delivery staff update status on a phone; damage auto-charges replacement value | `/bookings/[id]`, `lib/bookings/returns.ts` | not yet |
| Quick sale under 30 seconds, stock decreases | `/orders/new` | not yet |
| Free-delivery toggle zeroes the fee and prints "FREE Delivery & Pickup" | `deliveryFeeCharged`, both PDFs | partly — renders correctly in preview |
| P&L, daily sales, receivables aging, payables for any range, CSV and PDF | `/reports` | not yet |
| All money reconciles: total = verified payments + balance due | `summarisePayments`, tested | tested, not live |

The unverified rows are not known to be broken — they are covered by 398
tests and a clean production build. They are simply the paths nobody has
walked with real records yet, and this table is the shortest route to
walking them.

### Accounting basis (for the bookkeeper)

Reports use **cash-basis** accounting for the MVP: revenue is recognized when
a payment is **verified**, not when a booking is created or completed. Pending
(unverified) payments never count toward revenue or the 50% confirmation gate.
