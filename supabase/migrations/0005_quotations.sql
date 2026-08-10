-- ═══════════════════════════════════════════════════════════════
-- Royze Party Needs Rental — Milestone 3
-- Quotations, their line items, and the shared document numbering
-- counter that bookings, agreements, and orders will also draw on.
--
-- Money is stored as INTEGER CENTAVOS everywhere (never float).
-- Quotations are never hard-deleted: a sent quotation is a promise
-- the customer may still be holding, so it is declined or expired
-- rather than removed.
-- ═══════════════════════════════════════════════════════════════

-- ── Who may write quotations ───────────────────────────────────
-- Owner and Booking Staff (Spec 3). The Bookkeeper reads them for
-- the receivables picture; Delivery Staff have no reason to see a
-- price list, so they are left out of the select policy entirely.
create or replace function public.can_manage_quotations()
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

create or replace function public.can_view_quotations()
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
      and role in ('owner', 'booking_staff', 'bookkeeper')
  )
$$;

-- ── Document numbering ─────────────────────────────────────────
-- Spec 4.3/4.4/4.5/4.6 all number documents PREFIX-YYYY-####, with
-- the sequence restarting each calendar year. One counter row per
-- (prefix, year); `next_document_number` takes a row lock so two
-- staff saving at the same moment cannot be handed QT-2026-0007
-- twice.
create table if not exists public.document_counters (
  prefix      text        not null,
  year        integer     not null,
  last_number integer     not null default 0 check (last_number >= 0),
  primary key (prefix, year)
);

alter table public.document_counters enable row level security;
-- No policies: only the SECURITY DEFINER function below touches it,
-- so no client can reserve or rewind a number directly.

create or replace function public.next_document_number(
  p_prefix text,
  p_year   integer default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year   integer;
  v_number integer;
begin
  -- The business year is the Manila one — a quotation written at
  -- 7am on January 1st in Manila is still 3pm December 31st in UTC.
  v_year := coalesce(
    p_year,
    extract(year from (now() at time zone 'Asia/Manila'))::integer
  );

  insert into public.document_counters as counters (prefix, year, last_number)
  values (p_prefix, v_year, 1)
  on conflict (prefix, year)
    do update set last_number = counters.last_number + 1
  returning counters.last_number into v_number;

  return p_prefix || '-' || v_year::text || '-' || lpad(v_number::text, 4, '0');
end;
$$;

-- Callable by signed-in staff; the RLS on the documents themselves
-- is what decides whether the number can actually be used.
revoke all on function public.next_document_number(text, integer) from public;
grant execute on function public.next_document_number(text, integer) to authenticated;

-- ── Quotation status (Spec 4.3) ────────────────────────────────
-- Draft → Sent → Accepted, or Declined / Expired. Expiry is derived
-- from valid_until on read rather than written by a cron job, so a
-- quotation is never briefly wrong just because nothing has run.
do $$ begin
  create type public.quotation_status as enum (
    'draft',
    'sent',
    'accepted',
    'declined',
    'expired'
  );
exception when duplicate_object then null;
end $$;

-- ── Quotations ─────────────────────────────────────────────────
create table if not exists public.quotations (
  id                        uuid primary key default gen_random_uuid(),
  quotation_number          text        not null unique,
  customer_id               uuid        not null references public.customers (id) on delete restrict,

  status                    public.quotation_status not null default 'draft',
  -- Dates, not timestamps: a quotation is valid for a calendar day
  -- in Manila, not until an hour of it.
  issue_date                date        not null default (now() at time zone 'Asia/Manila')::date,
  valid_until               date        not null,

  -- Event context, carried over when this converts to a booking.
  event_date                date,
  event_address             text        not null default '',
  occasion                  text        not null default '',

  -- Delivery & pickup fee policy (Spec 4.4). Free inside the area
  -- named in business_settings.free_delivery_area; the fee is forced
  -- to zero there so the toggle and the money can never disagree.
  within_free_delivery_area boolean     not null default false,
  delivery_fee_centavos     integer     not null default 0 check (delivery_fee_centavos >= 0),
  -- Set when staff quote something other than the suggested fee.
  delivery_fee_override_reason text     not null default '',

  -- Whole-quotation discount, on top of any per-line discounts.
  discount_centavos         integer     not null default 0 check (discount_centavos >= 0),

  -- Snapshotted from business_settings when the quotation is made:
  -- changing the default later must not restate a sent document.
  downpayment_percent       numeric(5,2) not null default 50 check (downpayment_percent >= 0 and downpayment_percent <= 100),

  notes                     text        not null default '',
  -- Internal-only; never printed on the customer's copy.
  internal_notes            text        not null default '',

  sent_at                   timestamptz,
  decided_at                timestamptz,
  -- Set in Milestone 4 when "Convert to Booking" runs (Spec 4.3).
  converted_booking_id      uuid,

  created_by                uuid        references public.profiles (id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  constraint quotations_validity_after_issue check (valid_until >= issue_date),
  -- Inside the free-delivery area the fee is ₱0, always (Spec 4.4).
  constraint quotations_free_area_is_free check (
    not within_free_delivery_area or delivery_fee_centavos = 0
  )
);

create index if not exists quotations_customer_idx on public.quotations (customer_id);
create index if not exists quotations_status_idx   on public.quotations (status);
create index if not exists quotations_issued_idx   on public.quotations (issue_date desc);
create index if not exists quotations_number_idx   on public.quotations (lower(quotation_number));

-- ── Quotation line items ───────────────────────────────────────
-- Names and prices are SNAPSHOTTED onto the line. The catalog item
-- is still referenced so reports can group by it, but a later price
-- edit must never silently restate a quotation the customer holds.
do $$ begin
  create type public.quotation_line_type as enum ('rental', 'sale', 'package', 'custom');
exception when duplicate_object then null;
end $$;

create table if not exists public.quotation_items (
  id                      uuid primary key default gen_random_uuid(),
  quotation_id            uuid        not null references public.quotations (id) on delete cascade,

  line_type               public.quotation_line_type not null default 'rental',
  -- Exactly one of these is set for catalogued lines; a 'custom'
  -- line (a one-off request typed by staff) has neither.
  catalog_item_id         uuid        references public.catalog_items (id) on delete set null,
  package_id              uuid        references public.backdrop_packages (id) on delete set null,

  -- What prints on the PDF, frozen at the moment of quoting.
  description             text        not null,
  -- "2 × Arch frame, 6 × Cloth drape" under a package line (Spec 4.4).
  component_summary       text        not null default '',

  quantity                integer     not null default 1 check (quantity > 0),
  unit_price_centavos     integer     not null default 0 check (unit_price_centavos >= 0),
  line_discount_centavos  integer     not null default 0 check (line_discount_centavos >= 0),

  sort_order              integer     not null default 0,

  constraint quotation_items_description_not_blank check (length(btrim(description)) > 0),
  -- A discount cannot exceed what the line is worth.
  constraint quotation_items_discount_within_line check (
    line_discount_centavos <= unit_price_centavos * quantity
  )
);

create index if not exists quotation_items_quotation_idx on public.quotation_items (quotation_id, sort_order);
create index if not exists quotation_items_catalog_idx   on public.quotation_items (catalog_item_id);
create index if not exists quotation_items_package_idx   on public.quotation_items (package_id);

-- ── updated_at trigger ─────────────────────────────────────────
drop trigger if exists quotations_touch_updated_at on public.quotations;
create trigger quotations_touch_updated_at
  before update on public.quotations
  for each row execute function public.touch_updated_at();

-- ── Row Level Security ─────────────────────────────────────────
alter table public.quotations      enable row level security;
alter table public.quotation_items enable row level security;

-- Owner, Booking Staff, and the Bookkeeper read; Delivery Staff do
-- not (they see booking logistics, not prices — Spec 3).
drop policy if exists quotations_select on public.quotations;
create policy quotations_select on public.quotations
  for select to authenticated
  using (public.can_view_quotations());

drop policy if exists quotations_insert on public.quotations;
create policy quotations_insert on public.quotations
  for insert to authenticated
  with check (public.can_manage_quotations());

drop policy if exists quotations_update on public.quotations;
create policy quotations_update on public.quotations
  for update to authenticated
  using (public.can_manage_quotations())
  with check (public.can_manage_quotations());

-- Only the Owner may delete, and the app never does (Spec 3).
drop policy if exists quotations_delete on public.quotations;
create policy quotations_delete on public.quotations
  for delete to authenticated
  using (public.is_owner());

-- Lines follow their quotation.
drop policy if exists quotation_items_select on public.quotation_items;
create policy quotation_items_select on public.quotation_items
  for select to authenticated
  using (public.can_view_quotations());

drop policy if exists quotation_items_insert on public.quotation_items;
create policy quotation_items_insert on public.quotation_items
  for insert to authenticated
  with check (public.can_manage_quotations());

drop policy if exists quotation_items_update on public.quotation_items;
create policy quotation_items_update on public.quotation_items
  for update to authenticated
  using (public.can_manage_quotations())
  with check (public.can_manage_quotations());

drop policy if exists quotation_items_delete on public.quotation_items;
create policy quotation_items_delete on public.quotation_items
  for delete to authenticated
  using (public.can_manage_quotations());
