-- ═══════════════════════════════════════════════════════════════
-- Royze Party Needs Rental — Milestone 4
-- Bookings, their line items, the availability engine, and the
-- return/damage workflow.
--
-- Money is stored as INTEGER CENTAVOS everywhere (never float).
-- Bookings are cancelled, never deleted: the calendar, the audit
-- trail, and the customer's history all have to keep resolving.
-- ═══════════════════════════════════════════════════════════════

-- ── Who may do what with a booking ─────────────────────────────
-- Owner and Booking Staff author them. Delivery Staff may update a
-- booking too, but only its delivery status and the condition of
-- returned items — that narrowing is enforced in the server actions,
-- because every app user shares one database role and column-level
-- grants cannot tell them apart (same reasoning as cost_price in
-- 0003).
create or replace function public.can_manage_bookings()
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

create or replace function public.can_touch_bookings()
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
      and role in ('owner', 'booking_staff', 'delivery_staff')
  )
$$;

-- ── Damaged stock (Spec 4.4 / 4.9) ─────────────────────────────
-- An item that comes back damaged is out of service until the Owner
-- repairs or writes it off, so it must stop counting as available.
-- The repair/write-off screen itself is Milestone 7.
alter table public.catalog_items
  add column if not exists damaged_quantity integer not null default 0
    check (damaged_quantity >= 0);

-- ── Booking lifecycle (Spec 4.4) ───────────────────────────────
do $$ begin
  create type public.booking_status as enum (
    'inquiry',
    'quoted',
    'reserved',
    'confirmed',
    'out_for_delivery',
    'delivered',
    'picked_up',
    'completed',
    'cancelled'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.booking_line_type as enum (
    'rental',
    'sale',
    'package',
    'custom',
    -- Raised automatically when an item comes back damaged or lost,
    -- charged at the catalog replacement value (Spec 4.4).
    'damage_charge'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.return_condition as enum (
    'pending',
    'ok',
    'damaged',
    'lost'
  );
exception when duplicate_object then null;
end $$;

-- ── Bookings ───────────────────────────────────────────────────
create table if not exists public.bookings (
  id                        uuid primary key default gen_random_uuid(),
  booking_number            text        not null unique,
  customer_id               uuid        not null references public.customers (id) on delete restrict,
  status                    public.booking_status not null default 'inquiry',
  -- Set when this was converted from a quotation (Spec 4.3).
  source_quotation_id       uuid        references public.quotations (id) on delete set null,

  -- Event and logistics (Spec 4.4)
  event_date                date        not null,
  event_start_time          time,
  event_end_time            time,
  delivery_at               timestamptz,
  pickup_at                 timestamptz,
  -- Backdrop jobs need a styling crew on site, not just a drop-off.
  setup_at                  timestamptz,
  teardown_at               timestamptz,

  -- The window stock is held for: the earliest of delivery/setup
  -- through the latest of pickup/teardown, falling back to the event
  -- date. Written by the app from a single pure function, and indexed
  -- so the availability check is one range scan rather than a
  -- per-row date calculation.
  reserved_from             date        not null,
  reserved_to               date        not null,

  event_address             text        not null default '',
  landmark                  text        not null default '',
  contact_person_name       text        not null default '',
  contact_person_phone      text        not null default '',

  -- Backdrop bookings capture these as well (Spec 4.4).
  occasion                  text        not null default '',
  theme_motif               text        not null default '',
  celebrant_name            text        not null default '',
  reference_photo_urls      text[]      not null default '{}',

  -- Money, the same shape as a quotation (Spec 4.4).
  within_free_delivery_area boolean     not null default false,
  delivery_fee_centavos     integer     not null default 0 check (delivery_fee_centavos >= 0),
  delivery_fee_override_reason text     not null default '',
  discount_centavos         integer     not null default 0 check (discount_centavos >= 0),
  downpayment_percent       numeric(5,2) not null default 50
    check (downpayment_percent >= 0 and downpayment_percent <= 100),

  -- The Confirmed gate (Spec 4.4). `agreement_signed` is written by
  -- the rental-agreement workflow in Milestone 5; until then it stays
  -- false and only an Owner override can get past the gate.
  agreement_signed          boolean     not null default false,
  agreement_signed_at       timestamptz,
  confirmation_override_reason text     not null default '',
  -- Recorded when an Owner books past a shortage (Spec 4.4).
  availability_override_reason text     not null default '',

  assigned_delivery_staff   uuid        references public.profiles (id) on delete set null,

  notes                     text        not null default '',
  internal_notes            text        not null default '',

  reserved_at               timestamptz,
  confirmed_at              timestamptz,
  delivered_at              timestamptz,
  returned_at               timestamptz,
  completed_at              timestamptz,
  cancelled_at              timestamptz,
  cancellation_reason       text        not null default '',

  created_by                uuid        references public.profiles (id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  constraint bookings_window_ordered check (reserved_to >= reserved_from),
  constraint bookings_pickup_after_delivery check (
    delivery_at is null or pickup_at is null or pickup_at >= delivery_at
  ),
  constraint bookings_teardown_after_setup check (
    setup_at is null or teardown_at is null or teardown_at >= setup_at
  ),
  -- Inside the free-delivery area the fee is ₱0, always (Spec 4.4).
  constraint bookings_free_area_is_free check (
    not within_free_delivery_area or delivery_fee_centavos = 0
  )
);

create index if not exists bookings_customer_idx on public.bookings (customer_id);
create index if not exists bookings_status_idx   on public.bookings (status);
create index if not exists bookings_event_idx    on public.bookings (event_date);
create index if not exists bookings_number_idx   on public.bookings (lower(booking_number));
-- The availability check asks "which bookings overlap this window?".
create index if not exists bookings_window_idx   on public.bookings (reserved_from, reserved_to);
create index if not exists bookings_delivery_idx on public.bookings (delivery_at);
create index if not exists bookings_setup_idx    on public.bookings (setup_at);

-- ── Booking line items ─────────────────────────────────────────
-- Names and prices are snapshotted, exactly as on a quotation.
--
-- A backdrop package is stored as a priced parent line plus one
-- zero-priced component row per part (Spec 4.4): the components are
-- what the availability engine reserves and what consumables come out
-- of, while the customer-facing documents print only the parent.
create table if not exists public.booking_items (
  id                      uuid primary key default gen_random_uuid(),
  booking_id              uuid        not null references public.bookings (id) on delete cascade,

  line_type               public.booking_line_type not null default 'rental',
  catalog_item_id         uuid        references public.catalog_items (id) on delete set null,
  package_id              uuid        references public.backdrop_packages (id) on delete set null,
  -- Set on the component rows that expand under a package line.
  parent_item_id          uuid        references public.booking_items (id) on delete cascade,
  is_component            boolean     not null default false,

  description             text        not null,
  component_summary       text        not null default '',

  quantity                integer     not null default 1 check (quantity > 0),
  unit_price_centavos     integer     not null default 0 check (unit_price_centavos >= 0),
  line_discount_centavos  integer     not null default 0 check (line_discount_centavos >= 0),

  -- Rental stock held for the booking's window.
  reserves_stock          boolean     not null default false,
  -- Consumables come out of sale stock when the booking is confirmed.
  consumes_stock          boolean     not null default false,
  stock_consumed          boolean     not null default false,

  -- Condition on return (Spec 4.4), recorded by Delivery Staff.
  return_condition        public.return_condition not null default 'pending',
  return_notes            text        not null default '',
  damaged_quantity        integer     not null default 0 check (damaged_quantity >= 0),
  lost_quantity           integer     not null default 0 check (lost_quantity >= 0),
  -- A damage_charge line points back at the line that caused it.
  source_item_id          uuid        references public.booking_items (id) on delete cascade,

  sort_order              integer     not null default 0,

  constraint booking_items_description_not_blank check (length(btrim(description)) > 0),
  constraint booking_items_discount_within_line check (
    line_discount_centavos <= unit_price_centavos * quantity
  ),
  constraint booking_items_damage_within_quantity check (
    damaged_quantity + lost_quantity <= quantity
  ),
  -- A component belongs to a parent line; a parent never does.
  constraint booking_items_component_has_parent check (
    (is_component and parent_item_id is not null)
    or (not is_component and parent_item_id is null)
  )
);

create index if not exists booking_items_booking_idx on public.booking_items (booking_id, sort_order);
create index if not exists booking_items_catalog_idx on public.booking_items (catalog_item_id);
create index if not exists booking_items_parent_idx  on public.booking_items (parent_item_id);
-- Drives the availability aggregate below.
create index if not exists booking_items_reserves_idx
  on public.booking_items (catalog_item_id) where reserves_stock;

-- ── updated_at trigger ─────────────────────────────────────────
drop trigger if exists bookings_touch_updated_at on public.bookings;
create trigger bookings_touch_updated_at
  before update on public.bookings
  for each row execute function public.touch_updated_at();

-- ── Availability engine (Spec 4.4) ─────────────────────────────
-- Which booking statuses actually hold stock. Inquiry and Quoted are
-- not commitments; once the items have been picked back up, or the
-- booking is cancelled, the stock is free again.
create or replace function public.booking_holds_stock(p_status public.booking_status)
returns boolean
language sql
immutable
as $$
  select p_status in ('reserved', 'confirmed', 'out_for_delivery', 'delivered')
$$;

-- How much of each rental item is already spoken for across a window.
-- Returns one row per item that is held at all, so the caller can ask
-- about a whole cart in a single round trip.
--
-- `p_exclude` leaves a booking out of its own check — otherwise
-- editing a booking would find itself competing for its own stock.
create or replace function public.reserved_quantities(
  p_from    date,
  p_to      date,
  p_exclude uuid default null
)
returns table (catalog_item_id uuid, reserved_quantity integer)
language sql
stable
security definer
set search_path = public
as $$
  select
    items.catalog_item_id,
    sum(items.quantity)::integer as reserved_quantity
  from public.booking_items items
  join public.bookings bookings on bookings.id = items.booking_id
  where items.reserves_stock
    and items.catalog_item_id is not null
    and public.booking_holds_stock(bookings.status)
    and (p_exclude is null or bookings.id <> p_exclude)
    -- Two closed ranges overlap unless one ends before the other starts.
    and bookings.reserved_from <= p_to
    and bookings.reserved_to   >= p_from
  group by items.catalog_item_id
$$;

revoke all on function public.reserved_quantities(date, date, uuid) from public;
grant execute on function public.reserved_quantities(date, date, uuid) to authenticated;

-- ── Row Level Security ─────────────────────────────────────────
alter table public.bookings      enable row level security;
alter table public.booking_items enable row level security;

-- Everyone signed in reads bookings: Delivery Staff need the calendar
-- and the address, and the Bookkeeper needs the receivables picture
-- (Spec 3).
drop policy if exists bookings_select on public.bookings;
create policy bookings_select on public.bookings
  for select to authenticated
  using (public.is_active_user());

drop policy if exists bookings_insert on public.bookings;
create policy bookings_insert on public.bookings
  for insert to authenticated
  with check (public.can_manage_bookings());

-- Delivery Staff are included here so they can move a booking through
-- delivery and record returns; which columns they may touch is
-- enforced by the server actions.
drop policy if exists bookings_update on public.bookings;
create policy bookings_update on public.bookings
  for update to authenticated
  using (public.can_touch_bookings())
  with check (public.can_touch_bookings());

drop policy if exists bookings_delete on public.bookings;
create policy bookings_delete on public.bookings
  for delete to authenticated
  using (public.is_owner());

drop policy if exists booking_items_select on public.booking_items;
create policy booking_items_select on public.booking_items
  for select to authenticated
  using (public.is_active_user());

drop policy if exists booking_items_insert on public.booking_items;
create policy booking_items_insert on public.booking_items
  for insert to authenticated
  with check (public.can_manage_bookings());

-- Delivery Staff write the return condition onto the line itself.
drop policy if exists booking_items_update on public.booking_items;
create policy booking_items_update on public.booking_items
  for update to authenticated
  using (public.can_touch_bookings())
  with check (public.can_touch_bookings());

drop policy if exists booking_items_delete on public.booking_items;
create policy booking_items_delete on public.booking_items
  for delete to authenticated
  using (public.can_manage_bookings());
