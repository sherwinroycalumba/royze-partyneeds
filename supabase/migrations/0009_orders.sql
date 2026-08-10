-- ═══════════════════════════════════════════════════════════════
-- Royze Party Needs Rental — Milestone 6
-- Quick-sale orders: the walk-in and Messenger sales that were going
-- unrecorded because writing them down was slower than making them.
--
-- Money is stored as INTEGER CENTAVOS everywhere (never float).
-- An order is never deleted — it is voided, which puts the stock back
-- and leaves the mistake on the record.
-- ═══════════════════════════════════════════════════════════════

-- ── Who may sell ───────────────────────────────────────────────
-- The same people who take bookings (Spec 3). Kept as its own
-- function so the two can diverge later without a migration hunting
-- down every policy.
create or replace function public.can_manage_orders()
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
      and role in ('owner', 'booking_staff')
  )
$$;

-- ── Orders ─────────────────────────────────────────────────────
do $$ begin
  create type public.order_status as enum ('completed', 'voided');
exception when duplicate_object then null;
end $$;

create table if not exists public.orders (
  id                uuid primary key default gen_random_uuid(),
  order_number      text        not null unique,

  -- Optional: a walk-in has no record in the customer directory, and
  -- forcing one would defeat the point of a 30-second sale (Spec 4.6).
  customer_id       uuid        references public.customers (id) on delete set null,
  -- What prints on the receipt when there is no linked customer.
  customer_label    text        not null default 'Walk-in',

  status            public.order_status not null default 'completed',
  sold_on           date        not null default (now() at time zone 'Asia/Manila')::date,

  discount_centavos integer     not null default 0 check (discount_centavos >= 0),
  notes             text        not null default '',

  voided_at         timestamptz,
  voided_reason     text        not null default '',

  sold_by           uuid        references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint orders_voided_has_reason check (
    status <> 'voided' or length(btrim(voided_reason)) > 0
  )
);

create index if not exists orders_sold_on_idx  on public.orders (sold_on desc);
create index if not exists orders_customer_idx on public.orders (customer_id);
create index if not exists orders_status_idx   on public.orders (status);
create index if not exists orders_number_idx   on public.orders (lower(order_number));

-- ── Order lines ────────────────────────────────────────────────
-- Prices are snapshotted, exactly as on a quotation or booking: a
-- receipt has to keep saying what the customer actually paid.
create table if not exists public.order_items (
  id                      uuid primary key default gen_random_uuid(),
  order_id                uuid        not null references public.orders (id) on delete cascade,
  catalog_item_id         uuid        references public.catalog_items (id) on delete set null,

  description             text        not null,
  quantity                integer     not null default 1 check (quantity > 0),
  unit_price_centavos     integer     not null default 0 check (unit_price_centavos >= 0),
  line_discount_centavos  integer     not null default 0 check (line_discount_centavos >= 0),
  sort_order              integer     not null default 0,

  constraint order_items_description_not_blank check (length(btrim(description)) > 0),
  constraint order_items_discount_within_line check (
    line_discount_centavos <= unit_price_centavos * quantity
  )
);

create index if not exists order_items_order_idx   on public.order_items (order_id, sort_order);
create index if not exists order_items_catalog_idx on public.order_items (catalog_item_id);

drop trigger if exists orders_touch_updated_at on public.orders;
create trigger orders_touch_updated_at
  before update on public.orders
  for each row execute function public.touch_updated_at();

-- ── Payments can now hang off an order (Spec 4.7) ──────────────
alter table public.payments
  add column if not exists order_id uuid references public.orders (id) on delete restrict;

create index if not exists payments_order_idx on public.payments (order_id);

-- A payment belongs to exactly one thing. The Milestone 5 version of
-- this constraint only knew about bookings.
alter table public.payments
  drop constraint if exists payments_has_a_subject;

alter table public.payments
  add constraint payments_has_a_subject check (
    (booking_id is not null and order_id is null)
    or (booking_id is null and order_id is not null)
  );

-- The order equivalent of `verified_paid_centavos`, so a receipt and a
-- report cannot disagree about what has actually been paid.
create or replace function public.order_verified_paid_centavos(p_order uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(amount_centavos), 0)::integer
  from public.payments
  where order_id = p_order
    and status = 'verified'
$$;

revoke all on function public.order_verified_paid_centavos(uuid) from public;
grant execute on function public.order_verified_paid_centavos(uuid) to authenticated;

-- ── Row Level Security ─────────────────────────────────────────
alter table public.orders      enable row level security;
alter table public.order_items enable row level security;

-- The Bookkeeper reads them for daily sales; Delivery Staff have no
-- reason to see counter takings (Spec 3).
drop policy if exists orders_select on public.orders;
create policy orders_select on public.orders
  for select to authenticated
  using (public.can_view_quotations());

drop policy if exists orders_insert on public.orders;
create policy orders_insert on public.orders
  for insert to authenticated
  with check (public.can_manage_orders());

-- Voiding is the only update, and it puts stock back, so it is the
-- Owner's call alone.
drop policy if exists orders_update_owner on public.orders;
create policy orders_update_owner on public.orders
  for update to authenticated
  using (public.is_owner())
  with check (public.is_owner());

drop policy if exists orders_delete_owner on public.orders;
create policy orders_delete_owner on public.orders
  for delete to authenticated
  using (public.is_owner());

drop policy if exists order_items_select on public.order_items;
create policy order_items_select on public.order_items
  for select to authenticated
  using (public.can_view_quotations());

drop policy if exists order_items_insert on public.order_items;
create policy order_items_insert on public.order_items
  for insert to authenticated
  with check (public.can_manage_orders());

drop policy if exists order_items_update_owner on public.order_items;
create policy order_items_update_owner on public.order_items
  for update to authenticated
  using (public.is_owner())
  with check (public.is_owner());

drop policy if exists order_items_delete_owner on public.order_items;
create policy order_items_delete_owner on public.order_items
  for delete to authenticated
  using (public.is_owner());
