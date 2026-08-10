-- ═══════════════════════════════════════════════════════════════
-- Royze Party Needs Rental — Milestone 2
-- Price catalog (rental + sale items), backdrop packages,
-- price history, customers, suppliers.
--
-- Money is stored as INTEGER CENTAVOS everywhere (never float).
-- Records are archived (is_active = false), never hard-deleted, so
-- historical bookings keep resolving to the item they were sold at.
-- ═══════════════════════════════════════════════════════════════

-- ── Catalog authoring rights ───────────────────────────────────
-- Owner always; Booking Staff only with the catalog_manager flag
-- (Spec 3). SECURITY DEFINER so RLS policies can call it freely.
create or replace function public.can_manage_catalog()
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
      and (role = 'owner' or (role = 'booking_staff' and catalog_manager))
  )
$$;

-- ── Catalog items ──────────────────────────────────────────────
-- One table for both rental and sale items: Spec 4.2 allows an item
-- to be both (a table cover can be rented out and also sold), so the
-- two price sets live side by side behind is_rental / is_sale flags.
create table if not exists public.catalog_items (
  id                          uuid primary key default gen_random_uuid(),
  name                        text        not null,
  category                    text        not null default '',
  description                 text        not null default '',
  photo_url                   text,

  is_rental                   boolean     not null default false,
  is_sale                     boolean     not null default false,

  -- Rental side (Spec 4.2). Price is per event/day.
  rental_price_centavos       integer     not null default 0 check (rental_price_centavos >= 0),
  -- Charged to the customer when an item comes back damaged or lost.
  replacement_value_centavos  integer     not null default 0 check (replacement_value_centavos >= 0),
  quantity_owned              integer     not null default 0 check (quantity_owned >= 0),

  -- Sale side (Spec 4.2). cost_price is owner/bookkeeper-visible only,
  -- enforced in the app's select list, not by RLS (column-level RLS
  -- would need a separate view; the DAL is the boundary here).
  sale_price_centavos         integer     not null default 0 check (sale_price_centavos >= 0),
  cost_price_centavos         integer     not null default 0 check (cost_price_centavos >= 0),
  stock_quantity              integer     not null default 0 check (stock_quantity >= 0),
  low_stock_threshold         integer     not null default 0 check (low_stock_threshold >= 0),

  is_active                   boolean     not null default true,
  created_by                  uuid        references public.profiles (id) on delete set null,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),

  -- An item that is neither rented nor sold cannot be quoted.
  constraint catalog_items_has_a_type check (is_rental or is_sale),
  constraint catalog_items_name_not_blank check (length(btrim(name)) > 0)
);

create index if not exists catalog_items_active_idx   on public.catalog_items (is_active);
create index if not exists catalog_items_category_idx on public.catalog_items (category);
create index if not exists catalog_items_rental_idx   on public.catalog_items (is_rental) where is_rental;
create index if not exists catalog_items_sale_idx     on public.catalog_items (is_sale) where is_sale;
-- Case-insensitive name lookups for the catalog search box.
create index if not exists catalog_items_name_idx     on public.catalog_items (lower(name));

-- ── Backdrop packages (Spec 4.2) ───────────────────────────────
-- Priced as a bundle; the package price may differ from the sum of
-- its components, which is exactly why the bundle price is stored.
create table if not exists public.backdrop_packages (
  id                      uuid primary key default gen_random_uuid(),
  name                    text        not null,
  description             text        not null default '',
  photo_url               text,
  -- birthday / wedding / anniversary / christening / gender_reveal / other
  occasion_tags           text[]      not null default '{}',
  package_price_centavos  integer     not null default 0 check (package_price_centavos >= 0),
  -- Feeds the calendar: a setup needs a styling crew on site, not a
  -- drop-off, so scheduling needs its duration (Spec 4.10).
  setup_minutes           integer     not null default 60 check (setup_minutes >= 0),
  teardown_notes          text        not null default '',
  is_active               boolean     not null default true,
  created_by              uuid        references public.profiles (id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint backdrop_packages_name_not_blank check (length(btrim(name)) > 0)
);

create index if not exists backdrop_packages_active_idx   on public.backdrop_packages (is_active);
create index if not exists backdrop_packages_occasion_idx on public.backdrop_packages using gin (occasion_tags);

-- ── Bill of components (Spec 4.2) ──────────────────────────────
-- What physically makes up a package. `consumes_stock` decides the
-- behaviour at booking time: consumables decrement sale stock, the
-- rest are reserved against inventory for the event date range.
do $$ begin
  create type public.component_kind as enum (
    'structure',   -- arch, rectangular frame, metal bars
    'cloth',       -- cloth and draping
    'lights',      -- fairy lights, butterfly lights
    'consumable',  -- balloons, tape, and other used-up supplies
    'other'
  );
exception when duplicate_object then null;
end $$;

create table if not exists public.backdrop_package_components (
  id               uuid primary key default gen_random_uuid(),
  package_id       uuid not null references public.backdrop_packages (id) on delete cascade,
  -- restrict: an item that is part of a package cannot be deleted out
  -- from under it. Items are archived instead.
  catalog_item_id  uuid not null references public.catalog_items (id) on delete restrict,
  quantity         integer not null default 1 check (quantity > 0),
  kind             public.component_kind not null default 'other',
  consumes_stock   boolean not null default false,
  sort_order       integer not null default 0,

  unique (package_id, catalog_item_id)
);

create index if not exists package_components_package_idx on public.backdrop_package_components (package_id);
create index if not exists package_components_item_idx    on public.backdrop_package_components (catalog_item_id);

-- ── Price history (Spec 4.2) ───────────────────────────────────
-- "Who changed what price, when." Separate from audit_log because it
-- is read per item on the item page, and it is the one log a
-- bookkeeper may need without seeing the whole audit trail.
create table if not exists public.price_history (
  id                  bigint generated always as identity primary key,
  entity_type         text        not null check (entity_type in ('catalog_item', 'backdrop_package')),
  entity_id           uuid        not null,
  -- Denormalized so the log stays readable if the item is renamed.
  entity_name         text        not null default '',
  field               text        not null,   -- e.g. 'rental_price_centavos'
  old_value_centavos  integer     not null,
  new_value_centavos  integer     not null,
  changed_by          uuid        references public.profiles (id) on delete set null,
  changed_by_name     text        not null default 'system',
  changed_at          timestamptz not null default now()
);

create index if not exists price_history_entity_idx on public.price_history (entity_type, entity_id, changed_at desc);

-- ── Customers (Spec 4.1) ───────────────────────────────────────
create table if not exists public.customers (
  id             uuid primary key default gen_random_uuid(),
  name           text        not null,
  phone          text        not null default '',
  alt_phone      text,
  facebook_name  text,
  facebook_url   text,
  address        text        not null default '',
  landmark       text,
  email          text,
  notes          text        not null default '',
  is_active      boolean     not null default true,
  created_by     uuid        references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint customers_name_not_blank check (length(btrim(name)) > 0)
);

-- Digits-only form of the phone, so "0917 123 4567", "0917-123-4567",
-- and "+63 917 123 4567" all collide during duplicate detection.
-- Deliberately NOT unique: Spec 4.1 asks for a warning, not a block
-- (families genuinely share one number).
alter table public.customers
  add column if not exists phone_digits text
  generated always as (regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')) stored;

create index if not exists customers_phone_digits_idx on public.customers (phone_digits);
create index if not exists customers_name_idx         on public.customers (lower(name));
create index if not exists customers_active_idx       on public.customers (is_active);

-- ── Suppliers (Spec 4.8) ───────────────────────────────────────
create table if not exists public.suppliers (
  id              uuid primary key default gen_random_uuid(),
  name            text        not null,
  contact_person  text,
  phone           text        not null default '',
  email           text,
  address         text        not null default '',
  -- Free text: "balloons, foil balloons, party poppers"
  supplies        text        not null default '',
  notes           text        not null default '',
  is_active       boolean     not null default true,
  created_by      uuid        references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint suppliers_name_not_blank check (length(btrim(name)) > 0)
);

create index if not exists suppliers_name_idx   on public.suppliers (lower(name));
create index if not exists suppliers_active_idx on public.suppliers (is_active);

-- ── updated_at triggers ────────────────────────────────────────
drop trigger if exists catalog_items_touch_updated_at on public.catalog_items;
create trigger catalog_items_touch_updated_at
  before update on public.catalog_items
  for each row execute function public.touch_updated_at();

drop trigger if exists backdrop_packages_touch_updated_at on public.backdrop_packages;
create trigger backdrop_packages_touch_updated_at
  before update on public.backdrop_packages
  for each row execute function public.touch_updated_at();

drop trigger if exists customers_touch_updated_at on public.customers;
create trigger customers_touch_updated_at
  before update on public.customers
  for each row execute function public.touch_updated_at();

drop trigger if exists suppliers_touch_updated_at on public.suppliers;
create trigger suppliers_touch_updated_at
  before update on public.suppliers
  for each row execute function public.touch_updated_at();

-- ── Row Level Security ─────────────────────────────────────────
alter table public.catalog_items                enable row level security;
alter table public.backdrop_packages            enable row level security;
alter table public.backdrop_package_components  enable row level security;
alter table public.price_history                enable row level security;
alter table public.customers                    enable row level security;
alter table public.suppliers                    enable row level security;

-- catalog: everyone views, catalog managers write, owner deletes
-- (Spec 4.2: "Only Owner and staff with catalog_manager flag can
-- edit; everyone can view").
drop policy if exists catalog_items_select on public.catalog_items;
create policy catalog_items_select on public.catalog_items
  for select to authenticated
  using (public.is_active_user());

drop policy if exists catalog_items_insert on public.catalog_items;
create policy catalog_items_insert on public.catalog_items
  for insert to authenticated
  with check (public.can_manage_catalog());

drop policy if exists catalog_items_update on public.catalog_items;
create policy catalog_items_update on public.catalog_items
  for update to authenticated
  using (public.can_manage_catalog())
  with check (public.can_manage_catalog());

drop policy if exists catalog_items_delete on public.catalog_items;
create policy catalog_items_delete on public.catalog_items
  for delete to authenticated
  using (public.is_owner());

drop policy if exists backdrop_packages_select on public.backdrop_packages;
create policy backdrop_packages_select on public.backdrop_packages
  for select to authenticated
  using (public.is_active_user());

drop policy if exists backdrop_packages_insert on public.backdrop_packages;
create policy backdrop_packages_insert on public.backdrop_packages
  for insert to authenticated
  with check (public.can_manage_catalog());

drop policy if exists backdrop_packages_update on public.backdrop_packages;
create policy backdrop_packages_update on public.backdrop_packages
  for update to authenticated
  using (public.can_manage_catalog())
  with check (public.can_manage_catalog());

drop policy if exists backdrop_packages_delete on public.backdrop_packages;
create policy backdrop_packages_delete on public.backdrop_packages
  for delete to authenticated
  using (public.is_owner());

-- Components follow their package: viewable by all, writable by
-- catalog managers (the editor replaces the whole component set).
drop policy if exists package_components_select on public.backdrop_package_components;
create policy package_components_select on public.backdrop_package_components
  for select to authenticated
  using (public.is_active_user());

drop policy if exists package_components_insert on public.backdrop_package_components;
create policy package_components_insert on public.backdrop_package_components
  for insert to authenticated
  with check (public.can_manage_catalog());

drop policy if exists package_components_update on public.backdrop_package_components;
create policy package_components_update on public.backdrop_package_components
  for update to authenticated
  using (public.can_manage_catalog())
  with check (public.can_manage_catalog());

drop policy if exists package_components_delete on public.backdrop_package_components;
create policy package_components_delete on public.backdrop_package_components
  for delete to authenticated
  using (public.can_manage_catalog());

-- price_history: append-only, like audit_log. Anyone who can see the
-- catalog can see how its prices moved.
drop policy if exists price_history_select on public.price_history;
create policy price_history_select on public.price_history
  for select to authenticated
  using (public.is_active_user());

drop policy if exists price_history_insert on public.price_history;
create policy price_history_insert on public.price_history
  for insert to authenticated
  with check (public.can_manage_catalog() and changed_by = auth.uid());

-- customers: owner and booking staff manage them; delivery staff read
-- customer details through the booking, not the directory.
drop policy if exists customers_select on public.customers;
create policy customers_select on public.customers
  for select to authenticated
  using (public.auth_role() in ('owner', 'booking_staff', 'bookkeeper'));

drop policy if exists customers_insert on public.customers;
create policy customers_insert on public.customers
  for insert to authenticated
  with check (public.auth_role() in ('owner', 'booking_staff'));

drop policy if exists customers_update on public.customers;
create policy customers_update on public.customers
  for update to authenticated
  using (public.auth_role() in ('owner', 'booking_staff'))
  with check (public.auth_role() in ('owner', 'booking_staff'));

drop policy if exists customers_delete on public.customers;
create policy customers_delete on public.customers
  for delete to authenticated
  using (public.is_owner());

-- suppliers: part of the expense/payables side, so the owner writes
-- and the bookkeeper reads. Booking staff see them when recording a
-- restock's source.
drop policy if exists suppliers_select on public.suppliers;
create policy suppliers_select on public.suppliers
  for select to authenticated
  using (public.auth_role() in ('owner', 'booking_staff', 'bookkeeper'));

drop policy if exists suppliers_insert on public.suppliers;
create policy suppliers_insert on public.suppliers
  for insert to authenticated
  with check (public.is_owner());

drop policy if exists suppliers_update on public.suppliers;
create policy suppliers_update on public.suppliers
  for update to authenticated
  using (public.is_owner())
  with check (public.is_owner());

drop policy if exists suppliers_delete on public.suppliers;
create policy suppliers_delete on public.suppliers
  for delete to authenticated
  using (public.is_owner());

-- ── Catalog photo storage ──────────────────────────────────────
-- Public read: item and package photos are embedded in quotation
-- PDFs sent to customers. Writable by catalog managers, unlike the
-- owner-only `branding` bucket.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'catalog',
  'catalog',
  true,
  5242880, -- 5 MB
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists catalog_public_read on storage.objects;
create policy catalog_public_read on storage.objects
  for select
  using (bucket_id = 'catalog');

drop policy if exists catalog_manager_write on storage.objects;
create policy catalog_manager_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'catalog' and public.can_manage_catalog());

drop policy if exists catalog_manager_update on storage.objects;
create policy catalog_manager_update on storage.objects
  for update to authenticated
  using (bucket_id = 'catalog' and public.can_manage_catalog())
  with check (bucket_id = 'catalog' and public.can_manage_catalog());

drop policy if exists catalog_owner_delete on storage.objects;
create policy catalog_owner_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'catalog' and public.is_owner());
