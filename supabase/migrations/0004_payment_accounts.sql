-- ═══════════════════════════════════════════════════════════════
-- Royze Party Needs Rental — payment accounts
--
-- Replaces the single GCash / Maya / bank triplet on business_settings
-- with a repeatable list, so the business can hold any number of
-- accounts per channel (Spec 4.12).
--
-- The existing values are copied into the new table BEFORE the old
-- columns are dropped, so nothing is lost. Safe to re-run: the copy is
-- guarded on the old columns still existing.
-- ═══════════════════════════════════════════════════════════════

do $$ begin
  create type public.payment_channel as enum (
    'gcash',
    'maya',
    'bank_transfer'
  );
exception when duplicate_object then null;
end $$;

create table if not exists public.payment_accounts (
  id              uuid primary key default gen_random_uuid(),
  channel         public.payment_channel not null,
  -- Only meaningful for bank transfers; blank for e-wallets.
  bank_name       text        not null default '',
  account_name    text        not null default '',
  account_number  text        not null default '',
  -- Inactive accounts stay on file but are left off customer-facing
  -- documents, so a closed account can never be quoted by mistake.
  is_active       boolean     not null default true,
  sort_order      integer     not null default 0,
  created_by      uuid        references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint payment_accounts_number_not_blank
    check (length(btrim(account_number)) > 0),
  -- A bank transfer without a bank name is unusable on a document.
  constraint payment_accounts_bank_needs_name
    check (channel <> 'bank_transfer' or length(btrim(bank_name)) > 0)
);

create index if not exists payment_accounts_active_idx
  on public.payment_accounts (is_active, sort_order);

drop trigger if exists payment_accounts_touch_updated_at on public.payment_accounts;
create trigger payment_accounts_touch_updated_at
  before update on public.payment_accounts
  for each row execute function public.touch_updated_at();

-- ── Carry the existing details across ──────────────────────────
-- Runs only while the old columns are still present, so a re-run after
-- the drop below is a no-op rather than an error.
do $$
declare
  has_old_columns boolean;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'business_settings'
      and column_name  = 'gcash_number'
  ) into has_old_columns;

  if not has_old_columns then
    return;
  end if;

  -- Guarded on an empty table so a re-run cannot duplicate the rows.
  if exists (select 1 from public.payment_accounts) then
    return;
  end if;

  insert into public.payment_accounts
    (channel, bank_name, account_name, account_number, sort_order)
  select 'gcash', '',
         coalesce(gcash_name, ''), gcash_number, 0
    from public.business_settings
   where id and coalesce(btrim(gcash_number), '') <> '';

  insert into public.payment_accounts
    (channel, bank_name, account_name, account_number, sort_order)
  select 'maya', '',
         coalesce(maya_name, ''), maya_number, 1
    from public.business_settings
   where id and coalesce(btrim(maya_number), '') <> '';

  insert into public.payment_accounts
    (channel, bank_name, account_name, account_number, sort_order)
  select 'bank_transfer',
         -- The check constraint needs a bank name; fall back rather
         -- than drop a real account on the floor.
         coalesce(nullif(btrim(bank_name), ''), 'Bank'),
         coalesce(bank_account_name, ''), bank_account_number, 2
    from public.business_settings
   where id and coalesce(btrim(bank_account_number), '') <> '';
end $$;

-- ── Retire the old columns ─────────────────────────────────────
-- Their data now lives in payment_accounts; leaving them in place
-- would let the two drift apart.
alter table public.business_settings
  drop column if exists gcash_name,
  drop column if exists gcash_number,
  drop column if exists maya_name,
  drop column if exists maya_number,
  drop column if exists bank_name,
  drop column if exists bank_account_name,
  drop column if exists bank_account_number;

-- ── Row Level Security ─────────────────────────────────────────
alter table public.payment_accounts enable row level security;

-- Every active user reads them: quotation and agreement PDFs print the
-- active accounts, and booking staff generate those documents.
drop policy if exists payment_accounts_select on public.payment_accounts;
create policy payment_accounts_select on public.payment_accounts
  for select to authenticated
  using (public.is_active_user());

drop policy if exists payment_accounts_insert_owner on public.payment_accounts;
create policy payment_accounts_insert_owner on public.payment_accounts
  for insert to authenticated
  with check (public.is_owner());

drop policy if exists payment_accounts_update_owner on public.payment_accounts;
create policy payment_accounts_update_owner on public.payment_accounts
  for update to authenticated
  using (public.is_owner())
  with check (public.is_owner());

drop policy if exists payment_accounts_delete_owner on public.payment_accounts;
create policy payment_accounts_delete_owner on public.payment_accounts
  for delete to authenticated
  using (public.is_owner());
