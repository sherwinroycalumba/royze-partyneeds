# Spec.md — Party Needs Rental & Supplies Management System (MVP)

## 1. Project Overview

Build a **responsive web application** (usable on both mobile phones and desktop browsers) for **Royze Party Needs Rental**, a small Philippine party-needs business that:

1. **Rents out** party equipment — tents (2x2m, 3x3m, 3x6m), karaoke machines, tables, chairs, table covers, chair covers, backdrop items.
2. **Sells** party supplies — balloons, party poppers, gender reveal smoke/poppers, paper cups, paper plates, toys, foil balloons, party hats, banners, and similar items.
3. **Offers backdrop packages** — styled backdrop setup services for birthdays, weddings, anniversaries, christenings, and other occasions. Each package combines a backdrop structure (arch type, rectangular, metal bars, etc.), balloons, cloth/draping, and lights (fairy lights, butterfly lights, etc.), including on-site setup and teardown.

The business currently runs on Facebook Messenger + manual Google Sheets. This MVP replaces the internal record-keeping and coordination workflow. It is **internal-only** (owner + staff). A client-facing portal is explicitly **out of scope** for the MVP (but design the data model so it can be added later).

**Currency:** Philippine Peso (₱ / PHP) everywhere. **Timezone:** Asia/Manila. **Date format:** display as `MMM DD, YYYY` (e.g., Aug 09, 2026).

---

## 2. Tech Stack (recommended — you may adjust with justification)

- **Frontend:** Next.js (App Router) + TypeScript + Tailwind CSS. Mobile-first responsive layout (staff will mostly use phones; owner will use desktop for reports).
- **Backend:** Next.js API routes / server actions.
- **Database:** SQLite via Prisma ORM for the MVP (simple to deploy, easy to migrate to Postgres later). Use decimal-safe handling for money (store amounts as integers in centavos OR use Prisma Decimal — never floats).
- **Auth:** Email/username + password with session cookies (e.g., Lucia, Auth.js credentials, or a simple bcrypt + iron-session implementation). No third-party OAuth needed for MVP.
- **PDF generation:** Server-side PDF output for Quotations and Rental Agreements (e.g., `@react-pdf/renderer`, `pdf-lib`, or Puppeteer/Playwright print-to-PDF of a print-styled HTML page). PDFs must be downloadable and printable, A4 size.
- **Calendar UI:** A month/week calendar view (e.g., FullCalendar or a custom Tailwind calendar). Must work on mobile.

Keep the app deployable on a single low-cost host (e.g., a VPS, Railway, or Vercel + hosted DB). Include a `README.md` with setup, seed, and deployment instructions.

---

## 2.1 Branding & Design

- **Brand:** Royze Party Needs Rental. The app name, login screen, sidebar/header, and all PDF documents (quotations, rental agreements, reports) carry the business name and logo.
- **Theme: orange color palette.** Use orange as the primary brand color across the UI — a warm, festive feel that matches a party business without sacrificing readability:
  - **Primary:** orange-600 `#EA580C` (buttons, active nav, links, key accents)
  - **Primary hover/dark:** orange-700 `#C2410C`
  - **Light tints:** orange-50 `#FFF7ED` / orange-100 `#FFEDD5` (page section backgrounds, highlighted rows, selected calendar days)
  - **Accent:** amber-500 `#F59E0B` (secondary highlights, badges)
  - **Neutrals:** warm grays (stone/zinc scale) for text and surfaces; near-white background
  - Define these as design tokens (Tailwind theme extension / CSS variables) so the palette is changeable in one place.
- **Semantic colors stay conventional** for clarity: green = success/verified/confirmed, red = danger/overdue/cancelled, yellow/amber = pending/warning. Booking-status colors on the calendar should remain distinguishable from each other and from the orange brand color.
- **Accessibility:** maintain WCAG AA contrast — use orange-600/700 (not lighter oranges) for text on white and for text-bearing buttons; never place white text on light orange tints.
- **PDF documents** use the orange brand color for the header band, business name, table header row, and total row, with black body text for clean printing (must remain readable when printed in grayscale).
- Login screen and dashboard may include a subtle festive touch (e.g., light confetti/balloon motif in orange tones) — tasteful, not noisy; this is a business tool first.

---

## 3. Users & Roles (RBAC)

Seed an initial **Owner** account (credentials in `.env.example`; force password change on first login).

| Role | Permissions |
|---|---|
| **Owner (Admin)** | Everything. Only role that can: create/deactivate user accounts, confirm/verify payments received (GCash/Maya/bank transfer), view financial reports (P&L, receivables, payables), manage expenses, delete records. |
| **Booking Staff** | Create/edit customers, bookings, orders, quotations, rental agreements; record payments as "pending verification"; view calendar; manage price catalog **if granted** the `catalog_manager` flag. |
| **Delivery Staff** | Read-only view of calendar and booking details (items, address, contact, schedule); can update delivery status (Out for Delivery → Delivered → Picked Up/Returned) and record item condition on return. |
| **Bookkeeper** | Read-only access to all financial data + ability to export reports (CSV + PDF) for BIR tax filing. Can categorize expenses. |

Implement role checks on both UI and API level. Users can be deactivated but never hard-deleted (preserve audit history). Record `created_by` / `updated_at` on all key records.

---

## 4. Core Modules

### 4.1 Customers
- Fields: name, phone number(s), Facebook name/profile link, address (free text + optional landmark notes), email (optional), notes.
- Detect possible duplicates by phone number on create.
- Customer profile page shows full history: bookings, orders, quotations, payments, outstanding balances, and any damage/loss incidents.

### 4.2 Price Catalog (Rentals + Sale Items)
- Three item types: **Rental Item**, **Sale Item**, and **Backdrop Package** (some items may be both rental and sale — allow an item to have a rental price and a sale price).
- Rental item fields: name, category, description, photo (optional), rental price per event/day, replacement value (used in agreements for damaged/lost items), quantity owned, quantity available (computed).
- Sale item fields: name, category, unit price, cost price (optional, owner/bookkeeper visible only), stock quantity, low-stock threshold.
- **Backdrop package fields:** package name (e.g., "Birthday Arch Package"), occasion tags (birthday, wedding, anniversary, christening, gender reveal, other), package price, description, photo(s), and a **bill of components** — a list of catalog items with quantities that make up the package: backdrop structure (arch / rectangular / metal bars — these are rental/asset items), cloth & draping (rental items), lights (fairy lights, butterfly lights — rental items), and balloons/consumables (sale items, consumed per setup). Also: estimated setup time and teardown notes for scheduling.
- Packages are priced as a bundle (package price may differ from the sum of components). Consumable components (balloons, tape, etc.) decrement sale-item stock when the booking is confirmed; rental components are reserved against inventory for the event date range like any other rental item.
- Allow **custom/one-off packages** on a booking: start from a saved package, then add/remove components and adjust the price for the specific client (common for themed requests).
- Only Owner and staff with `catalog_manager` flag can edit; everyone can view.
- Price history log (who changed what price, when).

### 4.3 Quotations
- Build a quotation by selecting catalog items (rental and/or sale), quantities, and optional per-line discounts; add delivery fee line and general discount. The **delivery & pickup fee follows the same policy as bookings** (see 4.4): free within Deca Homes Meycauayan (shown as "FREE Delivery & Pickup" on the PDF), fee applies outside.
- Auto-numbered: `QT-YYYY-####`.
- Statuses: Draft → Sent → Accepted → Expired / Declined. Validity period (default 7 days, editable).
- One-click **"Convert to Booking"** (carries over customer, items, prices).
- **PDF output (A4, printable/downloadable)** with business name, logo placeholder, address, contact info, quotation number, date, validity, itemized table, subtotal, discount, delivery fee, total, required 50% downpayment amount, payment channels (Cash / GCash / Maya / Bank Transfer with account details configurable in Settings), and terms.

### 4.4 Bookings (Rentals) — the heart of the system
- Fields: customer, event date + time, delivery date/time, pickup/return date/time, delivery address, contact person on site, rental items + quantities + prices, delivery fee, discount, notes, assigned delivery staff.
- **Delivery & pickup fee policy:** delivery and pickup are **free within Deca Homes Meycauayan**; locations outside it are charged a delivery/pickup fee. On the booking/quotation form, include a "Within Deca Homes Meycauayan?" toggle (or a service-area dropdown): when checked, the delivery fee is locked to ₱0 and the documents show "FREE Delivery & Pickup (within Deca Homes Meycauayan)"; when unchecked, staff enters the fee manually (with an optional per-area suggested-fee table maintained in Settings). Staff can always override with a reason; overrides are logged.
- Auto-numbered: `BK-YYYY-####`.
- Bookings can include rental items, backdrop packages, and sale items in any combination. When a backdrop package is added, its components expand under the package line (editable for custom packages) while the client-facing documents (quotation, agreement, PDFs) show the package as a single priced line with a short component summary.
- Backdrop bookings additionally capture: occasion, theme/color motif, celebrant name (e.g., for birthday/christening banners), **setup date/time** and teardown time, and reference photos (upload or link) of the desired peg/design.
- **Availability check:** when adding rental items — or backdrop packages, whose rental components are checked individually — warn (blocking warning with override allowed by Owner only) if the requested quantity exceeds available stock for the overlapping date range (delivery/setup date → return/teardown date). Two backdrop bookings on the same date must not double-allocate the same arch or light set.
- **Booking statuses:** Inquiry → Quoted → Reserved (agreement generated) → Confirmed (≥50% downpayment verified) → Out for Delivery → Delivered/Ongoing → Picked Up → Completed → Cancelled.
- **Business rule:** a booking cannot move to **Confirmed** until (a) a rental agreement has been generated and marked signed, and (b) verified payments cover at least 50% of the total. The Owner may override with a logged reason.
- Balance tracking: total, downpayment required (50%, editable %), amount paid (verified), balance due.
- On return: Delivery Staff records item condition per line (OK / Damaged / Lost + notes). Damaged/lost items auto-create a **charge line** at replacement value, added to the booking balance, and log the incident on the customer profile. Damaged items reduce available inventory until Owner marks them repaired or written off.

### 4.5 Rental Agreement
- Generated from a booking. Auto-numbered: `RA-YYYY-####`.
- **PDF (A4)** containing: parties (business + customer details), event/delivery/return dates and address, itemized list with quantities and replacement values, total fees, 50% downpayment requirement and payment terms, cancellation policy, responsibility for damage/loss (charged at replacement value), care of equipment clause, signature blocks for client and business representative, date signed.
- All clause texts must be editable in a **Settings → Agreement Template** page (plain text/rich text blocks), so the owner can adjust wording without code changes.
- Workflow: Generated → Printed/Sent → Signed (staff checks a box and can upload a photo of the signed copy). "Signed" gates the Confirmed status (see 4.4).

### 4.6 Orders (Quick Sales of Supplies)
- Fast POS-style screen for walk-in/Messenger sales: search item → add qty → payment method → done. Must take under ~30 seconds so quick sales actually get recorded (this fixes the current problem of unrecorded quick sales).
- Auto-numbered: `OR-YYYY-####`. Customer optional (default "Walk-in").
- Decrements sale-item stock. Low-stock alerts on dashboard.

### 4.7 Payments
- Attach payments to a booking or order. Fields: date, amount, method (Cash / GCash / Maya / Bank Transfer), reference number, screenshot upload (optional), recorded by.
- **Verification workflow:** Cash payments are auto-verified when recorded. GCash/Maya/bank-transfer payments start as **Pending Verification**; only the **Owner** can mark them Verified (matching current practice where the owner checks the account). Unverified payments do not count toward the 50% confirmation rule.
- Payments list with filters (date range, method, status) and a "Pending Verification" queue on the Owner dashboard.

### 4.8 Expenses & Payables
- Expense entry: date, payee/supplier, category (configurable list: purchases/restock, fuel & delivery, repairs, salaries, rent, utilities, permits/taxes, misc.), amount, method, receipt photo upload (optional), notes.
- Payables: expenses can be marked Unpaid (creating a payable with due date) or Paid.
- Suppliers module: name, contact, what they supply, notes; link expenses/restocks to suppliers; supplier profile shows purchase history.

### 4.9 Assets / Equipment Monitoring
- Every rental catalog item doubles as an asset record: quantity owned, acquisition cost & date (optional), current status breakdown (Available / Reserved / Out on Rental / Damaged / Under Repair / Written Off).
- Equipment status dashboard: what's out, with which booking, due back when; overdue returns flagged.

### 4.10 Calendar (whole-team view)
- Month and week views showing bookings color-coded by status; each entry shows customer name, event type/items summary, and delivery window.
- Day view lists: deliveries scheduled, backdrop setups scheduled (with setup time and estimated duration), pickups/teardowns scheduled, events ongoing. Backdrop setups are visually distinct (icon/color) since they need a styling crew on site, not just a drop-off.
- Clicking an entry opens booking details. This replaces the Messenger announcements as the delivery staff's source of truth.

### 4.11 Dashboard & Reports
**Owner dashboard:** today's & this week's bookings, deliveries and pickups due, pending payment verifications, receivables total, low-stock alerts, overdue returns, month-to-date sales vs expenses.

**Reports (all filterable by date range; all exportable to CSV and PDF):**
1. **Profit & Loss** — Revenue (rental income, sales income, **backdrop package income**, damage/loss charges) minus Expenses by category = Net Income. Cash-basis for MVP (recognize revenue on verified payment; note this assumption in the README for the bookkeeper).
2. **Daily Sales Report** — all verified payments received per day, by method.
3. **Receivables (Aging)** — bookings/orders with unpaid balances, aged 0–7 / 8–30 / 31+ days.
4. **Payables** — unpaid expenses by supplier and due date.
5. **Booking Summary** — bookings per period by status; cancellation count.
6. **Inventory & Stock Report** — sale item stock levels; rental utilization (times rented per item); backdrop package popularity (bookings per package and per occasion type).
7. **Customer Report** — top customers by revenue; customers with damage incidents.
8. **Expense Report** — by category and supplier (formatted for handover to the bookkeeper for BIR filing).

### 4.12 Settings (Owner only)
- Business profile: name (seeded as "Royze Party Needs Rental"), address, contact numbers, logo upload, TIN (shown on quotations/agreements).
- Payment channel details (GCash number/name, Maya, bank accounts) shown on PDFs.
- Downpayment percentage default (50%).
- **Delivery & pickup fee settings:** free-delivery area name (default: "Deca Homes Meycauayan", editable in case coverage changes) and an optional suggested-fee table per area/barangay/distance bracket used to pre-fill fees for locations outside the free zone.
- Quotation validity default, agreement clause templates, expense categories, user management (create account, assign role, `catalog_manager` flag, reset password, deactivate).

---

## 5. Cross-Cutting Requirements

- **Audit trail:** log create/update/status-change/override events with user + timestamp on bookings, payments, catalog prices, and agreements.
- **Search:** global search by customer name, phone, booking/quotation/order number.
- **Validation:** prevent negative stock, negative payments, overlapping double-allocation of rental inventory (beyond owned quantity) without owner override.
- **Money handling:** exact decimal arithmetic; display as `₱1,234.56`.
- **Mobile-first UI:** all staff flows (booking creation, quick sale, delivery status updates, calendar) must be fully usable on a phone. Reports may be desktop-optimized.
- **Empty states & seed data:** include a seed script with the known catalog (2x2m/3x3m/3x6m tents, karaoke, tables, chairs, covers, backdrop structures — arch, rectangular, metal bars — cloth sets, fairy lights, butterfly lights, and ~15 sample sale items) plus 3–4 sample backdrop packages (e.g., Birthday Arch Package, Wedding Backdrop Package, Christening Package, Gender Reveal Package) and sample users for each role, so the app is demo-ready immediately.
- **File uploads** (payment screenshots, signed agreements, receipts, logo): store locally in `/uploads` with a clean abstraction so it can later move to S3-compatible storage.

---

## 6. Out of Scope (MVP)

- Client-facing booking portal or online payments (Phase 2 — keep the data model ready).
- Facebook Messenger integration/automation.
- Accrual accounting, VAT computation, or direct BIR e-filing (bookkeeper handles filing from exported reports).
- SMS/email notifications (Phase 2).
- Multi-branch support.

---

## 7. Suggested Build Order

1. Project scaffold, auth, roles, settings, user management.
2. Price catalog + customers + suppliers.
3. Quotations + PDF engine (get PDF working early; the agreement reuses it).
4. Bookings + availability engine + statuses + calendar.
5. Rental agreements + signed-gating + payment module + verification workflow + 50% confirmation rule.
6. Quick-sale orders + inventory decrement.
7. Expenses, payables, assets monitoring.
8. Dashboard + reports + CSV/PDF exports.
9. Seed data, audit trail polish, README, deployment guide.

At each stage, write at least basic tests for the money math, availability checks, and the 50%-confirmation gating rule.

---

## 8. Acceptance Criteria (MVP is done when…)

- [ ] Owner can create staff accounts with roles; role restrictions are enforced.
- [ ] Staff can create a quotation on a phone and download a professional A4 PDF in under 2 minutes.
- [ ] A quotation converts to a booking in one click; the booking appears on the shared calendar.
- [ ] Booking cannot be Confirmed without a signed agreement AND verified payments ≥ 50% (owner override logged).
- [ ] Owner sees pending GCash/Maya/bank payments and verifies them in one tap.
- [ ] Double-booking beyond owned tent/table/chair quantities triggers a warning.
- [ ] A backdrop package can be added to a booking, customized per client (components + price), reserves its rental components, decrements consumables, and appears on the calendar as a setup with its scheduled time.
- [ ] Delivery staff can open the calendar on a phone, see the address and items, and update delivery/return status; damaged item on return auto-charges replacement value.
- [ ] A quick sale can be recorded in under 30 seconds and stock decreases.
- [ ] Marking a booking/quotation as within Deca Homes Meycauayan zeroes the delivery fee and prints "FREE Delivery & Pickup" on the PDF; outside locations require a fee entry.
- [ ] Owner can view P&L, daily sales, receivables aging, and payables for any date range and export each as CSV and PDF.
- [ ] All money figures reconcile: total = payments verified + balance due on every booking/order.
