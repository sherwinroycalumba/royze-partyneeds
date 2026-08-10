-- ═══════════════════════════════════════════════════════════════
-- Royze Party Needs Rental — Milestone 5
-- Rental agreements, payments, and the verification workflow that
-- together close the 50%-confirmation gate on a booking.
--
-- Money is stored as INTEGER CENTAVOS everywhere (never float).
-- Payments are never deleted — a recorded payment is part of the
-- money trail whether or not it turns out to be real; a mistaken one
-- is rejected with a reason and stays on the record.
-- ═══════════════════════════════════════════════════════════════

-- ── Rental agreements (Spec 4.5) ───────────────────────────────
do $$ begin
  create type public.agreement_status as enum (
    'generated',
    'sent',
    'signed'
  );
exception when duplicate_object then null;
end $$;

create table if not exists public.rental_agreements (
  id                  uuid primary key default gen_random_uuid(),
  agreement_number    text        not null unique,
  -- One live agreement per booking. Re-generating replaces it, which
  -- is why this is unique rather than a history table.
  booking_id          uuid        not null unique references public.bookings (id) on delete cascade,

  status              public.agreement_status not null default 'generated',

  -- The clauses are SNAPSHOTTED at generation time. The owner may
  -- edit the template in Settings whenever they like, but a document
  -- someone has signed must never silently change wording (Spec 4.5).
  clauses             jsonb       not null default '[]'::jsonb,

  -- Snapshotted for the same reason: the agreement states the figures
  -- the client actually agreed to.
  total_centavos      integer     not null default 0 check (total_centavos >= 0),
  downpayment_centavos integer    not null default 0 check (downpayment_centavos >= 0),

  sent_at             timestamptz,
  signed_at           timestamptz,
  -- Photo or scan of the signed copy, in the private documents bucket.
  signed_copy_path    text,
  signed_by_name      text        not null default '',

  generated_by        uuid        references public.profiles (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- "Signed" is what gates Confirmed, so it must carry a timestamp.
  constraint rental_agreements_signed_has_timestamp check (
    status <> 'signed' or signed_at is not null
  )
);

create index if not exists rental_agreements_booking_idx on public.rental_agreements (booking_id);
create index if not exists rental_agreements_status_idx  on public.rental_agreements (status);

drop trigger if exists rental_agreements_touch_updated_at on public.rental_agreements;
create trigger rental_agreements_touch_updated_at
  before update on public.rental_agreements
  for each row execute function public.touch_updated_at();

-- ── Payments (Spec 4.7) ────────────────────────────────────────
do $$ begin
  create type public.payment_method as enum (
    'cash',
    'gcash',
    'maya',
    'bank_transfer'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.payment_status as enum (
    'pending',
    'verified',
    'rejected'
  );
exception when duplicate_object then null;
end $$;

create table if not exists public.payments (
  id                  uuid primary key default gen_random_uuid(),
  -- Orders arrive in Milestone 6 and will hang off the same table.
  booking_id          uuid        references public.bookings (id) on delete restrict,

  paid_on             date        not null default (now() at time zone 'Asia/Manila')::date,
  amount_centavos     integer     not null check (amount_centavos > 0),
  method              public.payment_method not null,
  reference_number    text        not null default '',
  -- Screenshot of the GCash/Maya/bank confirmation, private bucket.
  screenshot_path     text,
  notes               text        not null default '',

  -- Cash handed over the counter is verified the moment it is
  -- recorded; everything else waits for the Owner to check the
  -- account, which is what the business already does (Spec 4.7).
  status              public.payment_status not null default 'pending',
  verified_by         uuid        references public.profiles (id) on delete set null,
  verified_at         timestamptz,
  rejected_reason     text        not null default '',

  recorded_by         uuid        references public.profiles (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- A payment has to be against something.
  constraint payments_has_a_subject check (booking_id is not null),
  constraint payments_verified_has_timestamp check (
    status <> 'verified' or verified_at is not null
  ),
  constraint payments_rejected_has_reason check (
    status <> 'rejected' or length(btrim(rejected_reason)) > 0
  )
);

create index if not exists payments_booking_idx on public.payments (booking_id);
create index if not exists payments_status_idx  on public.payments (status);
create index if not exists payments_paid_on_idx on public.payments (paid_on desc);
-- Drives the Owner's "Pending Verification" queue.
create index if not exists payments_pending_idx on public.payments (created_at)
  where status = 'pending';

drop trigger if exists payments_touch_updated_at on public.payments;
create trigger payments_touch_updated_at
  before update on public.payments
  for each row execute function public.touch_updated_at();

-- ── The 50% gate, in the database ──────────────────────────────
-- Only VERIFIED payments count toward confirming a booking (Spec 4.7).
-- The app computes this too; having it here means a report or a
-- future trigger cannot accidentally use a different definition.
create or replace function public.verified_paid_centavos(p_booking uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(amount_centavos), 0)::integer
  from public.payments
  where booking_id = p_booking
    and status = 'verified'
$$;

revoke all on function public.verified_paid_centavos(uuid) from public;
grant execute on function public.verified_paid_centavos(uuid) to authenticated;

-- ── Keeping bookings.agreement_signed honest ───────────────────
-- The booking carries the flag the Confirmed gate reads. Rather than
-- trusting every call site to remember, the agreement's own status is
-- the single writer.
create or replace function public.sync_booking_agreement_signed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.bookings
  set agreement_signed = (new.status = 'signed'),
      agreement_signed_at = case when new.status = 'signed' then new.signed_at end
  where id = new.booking_id;

  return new;
end;
$$;

drop trigger if exists rental_agreements_sync_booking on public.rental_agreements;
create trigger rental_agreements_sync_booking
  after insert or update of status on public.rental_agreements
  for each row execute function public.sync_booking_agreement_signed();

-- A deleted agreement leaves the booking unsigned, or the gate would
-- stay open on the strength of a document that no longer exists.
create or replace function public.clear_booking_agreement_signed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.bookings
  set agreement_signed = false,
      agreement_signed_at = null
  where id = old.booking_id;

  return old;
end;
$$;

drop trigger if exists rental_agreements_clear_booking on public.rental_agreements;
create trigger rental_agreements_clear_booking
  after delete on public.rental_agreements
  for each row execute function public.clear_booking_agreement_signed();

-- ── Row Level Security ─────────────────────────────────────────
alter table public.rental_agreements enable row level security;
alter table public.payments          enable row level security;

-- Agreements: everyone signed in may read one (Delivery Staff carry a
-- copy to the event); Owner and Booking Staff write them.
drop policy if exists rental_agreements_select on public.rental_agreements;
create policy rental_agreements_select on public.rental_agreements
  for select to authenticated
  using (public.is_active_user());

drop policy if exists rental_agreements_insert on public.rental_agreements;
create policy rental_agreements_insert on public.rental_agreements
  for insert to authenticated
  with check (public.can_manage_bookings());

drop policy if exists rental_agreements_update on public.rental_agreements;
create policy rental_agreements_update on public.rental_agreements
  for update to authenticated
  using (public.can_manage_bookings())
  with check (public.can_manage_bookings());

drop policy if exists rental_agreements_delete on public.rental_agreements;
create policy rental_agreements_delete on public.rental_agreements
  for delete to authenticated
  using (public.is_owner());

-- Payments: the Bookkeeper reads them all, Booking Staff record them,
-- and only the Owner may change one once it exists — which is what
-- makes "only the Owner verifies" true at the database level and not
-- merely in the UI (Spec 4.7).
drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments
  for select to authenticated
  using (public.can_view_quotations());

drop policy if exists payments_insert on public.payments;
create policy payments_insert on public.payments
  for insert to authenticated
  with check (public.can_manage_bookings());

drop policy if exists payments_update_owner on public.payments;
create policy payments_update_owner on public.payments
  for update to authenticated
  using (public.is_owner())
  with check (public.is_owner());

drop policy if exists payments_delete_owner on public.payments;
create policy payments_delete_owner on public.payments
  for delete to authenticated
  using (public.is_owner());
