-- ═══════════════════════════════════════════════════════════════
-- Royze Party Needs Rental — Milestone 1
-- Roles & profiles, business settings, audit trail.
--
-- Money is stored as INTEGER CENTAVOS everywhere (never float).
-- Timestamps are timestamptz; the app renders them in Asia/Manila.
-- ═══════════════════════════════════════════════════════════════

-- ── Roles ──────────────────────────────────────────────────────
do $$ begin
  create type public.user_role as enum (
    'owner',
    'booking_staff',
    'delivery_staff',
    'bookkeeper'
  );
exception when duplicate_object then null;
end $$;

-- ── Profiles ───────────────────────────────────────────────────
-- One row per auth.users row. Users are deactivated, never deleted,
-- so audit history always resolves to a real person (Spec 3).
create table if not exists public.profiles (
  id                    uuid primary key references auth.users (id) on delete cascade,
  email                 text        not null,
  full_name             text        not null default '',
  phone                 text,
  role                  public.user_role not null default 'booking_staff',
  -- Grants Booking Staff the right to edit the price catalog (Spec 3).
  catalog_manager       boolean     not null default false,
  is_active             boolean     not null default true,
  -- Forces the password-change screen on first login (Spec 3).
  must_change_password  boolean     not null default true,
  created_by            uuid        references public.profiles (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists profiles_role_idx on public.profiles (role);
create index if not exists profiles_active_idx on public.profiles (is_active);

-- ── Business settings (singleton) ──────────────────────────────
-- The `id` column is pinned to true so only one row can ever exist.
create table if not exists public.business_settings (
  id                      boolean     primary key default true check (id),

  -- Business profile — appears on every PDF (Spec 4.12)
  business_name           text        not null default 'Royze Party Needs Rental',
  address                 text        not null default '',
  contact_numbers         text[]      not null default '{}',
  email                   text,
  facebook_page           text,
  tin                     text,
  logo_url                text,

  -- Payment channels shown on quotations and agreements
  gcash_name              text,
  gcash_number            text,
  maya_name               text,
  maya_number             text,
  bank_name               text,
  bank_account_name       text,
  bank_account_number     text,

  -- Defaults
  downpayment_percent     numeric(5,2) not null default 50
                            check (downpayment_percent >= 0 and downpayment_percent <= 100),
  quotation_validity_days integer     not null default 7
                            check (quotation_validity_days > 0),

  -- Delivery & pickup fee policy (Spec 4.4 / 4.12).
  -- Inside the free area, delivery and pickup are free.
  free_delivery_area      text        not null default 'Deca Homes Meycauayan',
  -- [{ "area": "Meycauayan Proper", "fee_centavos": 30000 }, ...]
  delivery_fee_table      jsonb       not null default '[]'::jsonb,

  -- Editable clause blocks for the rental agreement (Spec 4.5).
  -- [{ "heading": "Cancellation Policy", "body": "..." }, ...]
  agreement_clauses       jsonb       not null default '[]'::jsonb,

  -- Configurable expense categories (Spec 4.8)
  expense_categories      text[]      not null default array[
                            'Purchases / Restock',
                            'Fuel & Delivery',
                            'Repairs',
                            'Salaries',
                            'Rent',
                            'Utilities',
                            'Permits & Taxes',
                            'Miscellaneous'
                          ],

  updated_by              uuid        references public.profiles (id) on delete set null,
  updated_at              timestamptz not null default now()
);

-- ── Audit trail (Spec 5) ───────────────────────────────────────
-- actor_name is denormalized on purpose: the log must stay readable
-- even if the profile is later renamed or deactivated.
create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  actor_id    uuid        references public.profiles (id) on delete set null,
  actor_name  text        not null default 'system',
  action      text        not null,          -- e.g. 'user.create', 'settings.update'
  entity_type text        not null,          -- e.g. 'profile', 'business_settings'
  entity_id   text,
  summary     text        not null default '',
  details     jsonb       not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists audit_log_created_at_idx on public.audit_log (created_at desc);
create index if not exists audit_log_entity_idx on public.audit_log (entity_type, entity_id);
create index if not exists audit_log_actor_idx on public.audit_log (actor_id);

-- ── updated_at triggers ────────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists business_settings_touch_updated_at on public.business_settings;
create trigger business_settings_touch_updated_at
  before update on public.business_settings
  for each row execute function public.touch_updated_at();

-- ── Auth helpers ───────────────────────────────────────────────
-- SECURITY DEFINER so these can be called from inside profiles'
-- own RLS policies without recursing back through those policies.
create or replace function public.auth_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and is_active
$$;

create or replace function public.is_owner()
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

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and is_active
  )
$$;

-- Lets a user clear their own must_change_password flag after they
-- have actually changed it, without granting write access to role,
-- is_active, or any other privileged column.
create or replace function public.complete_password_change()
returns void
language sql
volatile
security definer
set search_path = public
as $$
  update public.profiles
     set must_change_password = false
   where id = auth.uid()
$$;

-- ── Profile auto-creation ──────────────────────────────────────
-- Every auth.users row gets a profile, so a user can never exist
-- without a role. Role/name arrive via admin createUser metadata.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta_role text := new.raw_user_meta_data ->> 'role';
  resolved_role public.user_role;
begin
  begin
    resolved_role := meta_role::public.user_role;
  exception when others then
    resolved_role := 'booking_staff';
  end;

  insert into public.profiles (id, email, full_name, role, catalog_manager, must_change_password)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(resolved_role, 'booking_staff'),
    coalesce((new.raw_user_meta_data ->> 'catalog_manager')::boolean, false),
    coalesce((new.raw_user_meta_data ->> 'must_change_password')::boolean, true)
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Row Level Security ─────────────────────────────────────────
-- Defense in depth. The app also enforces RBAC server-side in the
-- data access layer; the service-role client bypasses RLS for the
-- owner-only admin operations (creating staff, resetting passwords).
alter table public.profiles          enable row level security;
alter table public.business_settings enable row level security;
alter table public.audit_log         enable row level security;

-- profiles: any active user may read the roster (needed to assign
-- delivery staff to bookings); only the owner may write.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (public.is_active_user());

drop policy if exists profiles_insert_owner on public.profiles;
create policy profiles_insert_owner on public.profiles
  for insert to authenticated
  with check (public.is_owner());

drop policy if exists profiles_update_owner on public.profiles;
create policy profiles_update_owner on public.profiles
  for update to authenticated
  using (public.is_owner())
  with check (public.is_owner());

-- Deliberately no DELETE policy: profiles are deactivated, never
-- removed, so audit history keeps resolving (Spec 3).

-- business_settings: everyone reads (PDF headers, delivery policy,
-- downpayment %); only the owner writes.
drop policy if exists business_settings_select on public.business_settings;
create policy business_settings_select on public.business_settings
  for select to authenticated
  using (public.is_active_user());

drop policy if exists business_settings_update_owner on public.business_settings;
create policy business_settings_update_owner on public.business_settings
  for update to authenticated
  using (public.is_owner())
  with check (public.is_owner());

drop policy if exists business_settings_insert_owner on public.business_settings;
create policy business_settings_insert_owner on public.business_settings
  for insert to authenticated
  with check (public.is_owner());

-- audit_log: owner and bookkeeper read it; any active user appends
-- to it; nobody updates or deletes it.
drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log
  for select to authenticated
  using (public.auth_role() in ('owner', 'bookkeeper'));

drop policy if exists audit_log_insert on public.audit_log;
create policy audit_log_insert on public.audit_log
  for insert to authenticated
  with check (public.is_active_user() and actor_id = auth.uid());

-- ── Seed the settings singleton ────────────────────────────────
insert into public.business_settings (id, agreement_clauses)
values (
  true,
  '[
    {"heading":"Rental Period","body":"Equipment is rented for the period stated above. Late returns are charged an additional day''s rental per item unless otherwise agreed in writing."},
    {"heading":"Downpayment & Payment Terms","body":"A downpayment of at least 50% of the total amount is required to confirm this booking. The remaining balance is due on or before the delivery/setup date."},
    {"heading":"Cancellation Policy","body":"Cancellations made at least 7 days before the event date are refunded in full less a processing fee. Cancellations within 3 days of the event forfeit the downpayment."},
    {"heading":"Care of Equipment","body":"The Client shall keep all rented equipment clean, dry, and protected from weather damage, and shall not modify, paint, or sublease any item."},
    {"heading":"Damage & Loss","body":"The Client is responsible for any item damaged, lost, or not returned, and shall be charged the replacement value stated in the itemized list above."},
    {"heading":"Delivery & Pickup","body":"Delivery and pickup are FREE within Deca Homes Meycauayan. Locations outside this area are charged a delivery and pickup fee as quoted."},
    {"heading":"Liability","body":"The Business is not liable for injury, loss, or damage arising from the Client''s use of the rented equipment after delivery and acceptance."}
  ]'::jsonb
)
on conflict (id) do nothing;
