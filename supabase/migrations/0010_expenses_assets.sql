-- ═══════════════════════════════════════════════════════════════
-- Royze Party Needs Rental — Milestone 7
-- Expenses, payables, and equipment monitoring.
--
-- Money is stored as INTEGER CENTAVOS everywhere (never float).
-- An expense is a record of money that left the business, so it is
-- edited or corrected, never deleted.
-- ═══════════════════════════════════════════════════════════════

-- ── Who may record and categorise spending ─────────────────────
-- The Owner manages expenses outright. The Bookkeeper categorises
-- them for the BIR filing report but does not create or pay them
-- (Spec 3).
create or replace function public.can_manage_expenses()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active and role = 'owner'
  )
$$;

create or replace function public.can_categorise_expenses()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and is_active
      and role in ('owner', 'bookkeeper')
  )
$$;

-- ── Expenses and payables (Spec 4.8) ───────────────────────────
create table if not exists public.expenses (
  id                uuid primary key default gen_random_uuid(),

  expense_date      date        not null default (now() at time zone 'Asia/Manila')::date,
  -- Free text so a one-off payee needs no supplier record, with an
  -- optional link when it is somebody the business buys from often.
  payee             text        not null default '',
  supplier_id       uuid        references public.suppliers (id) on delete set null,

  -- Matched against business_settings.expense_categories, which the
  -- Owner edits — so this is text, not an enum a migration would have
  -- to chase (Spec 4.12).
  category          text        not null default '',

  amount_centavos   integer     not null check (amount_centavos > 0),
  method            public.payment_method,
  reference_number  text        not null default '',
  -- Receipt photo, in the private documents bucket.
  receipt_path      text,
  notes             text        not null default '',

  -- An unpaid expense is a payable (Spec 4.8).
  is_paid           boolean     not null default true,
  due_date          date,
  paid_on           date,

  recorded_by       uuid        references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint expenses_paid_has_date check (not is_paid or paid_on is not null),
  -- A payable nobody has dated is a payable nobody will chase.
  constraint expenses_payable_has_due_date check (is_paid or due_date is not null)
);

create index if not exists expenses_date_idx     on public.expenses (expense_date desc);
create index if not exists expenses_category_idx on public.expenses (category);
create index if not exists expenses_supplier_idx on public.expenses (supplier_id);
-- Drives the payables queue and its aging.
create index if not exists expenses_payable_idx  on public.expenses (due_date)
  where not is_paid;

drop trigger if exists expenses_touch_updated_at on public.expenses;
create trigger expenses_touch_updated_at
  before update on public.expenses
  for each row execute function public.touch_updated_at();

-- ── Equipment as an asset record (Spec 4.9) ────────────────────
-- Milestone 4 added damaged_quantity when returns started charging
-- for breakages, but left no way back: damaged stock came out of
-- availability and stayed out. These are the missing states.
alter table public.catalog_items
  add column if not exists under_repair_quantity integer not null default 0
    check (under_repair_quantity >= 0),
  add column if not exists written_off_quantity integer not null default 0
    check (written_off_quantity >= 0),
  -- Optional, for the asset register (Spec 4.9).
  add column if not exists acquisition_cost_centavos integer not null default 0
    check (acquisition_cost_centavos >= 0),
  add column if not exists acquired_on date;

-- ── Row Level Security ─────────────────────────────────────────
alter table public.expenses enable row level security;

-- The Bookkeeper reads everything financial; Booking and Delivery
-- Staff have no business seeing what the owner spends (Spec 3).
drop policy if exists expenses_select on public.expenses;
create policy expenses_select on public.expenses
  for select to authenticated
  using (public.can_categorise_expenses());

drop policy if exists expenses_insert on public.expenses;
create policy expenses_insert on public.expenses
  for insert to authenticated
  with check (public.can_manage_expenses());

-- The Bookkeeper may update, because categorising is an update. Which
-- columns they may touch is enforced in the server action, the same
-- narrowing used for Delivery Staff on bookings.
drop policy if exists expenses_update on public.expenses;
create policy expenses_update on public.expenses
  for update to authenticated
  using (public.can_categorise_expenses())
  with check (public.can_categorise_expenses());

drop policy if exists expenses_delete_owner on public.expenses;
create policy expenses_delete_owner on public.expenses
  for delete to authenticated
  using (public.is_owner());
