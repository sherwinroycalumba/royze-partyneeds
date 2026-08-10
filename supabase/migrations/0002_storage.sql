-- ═══════════════════════════════════════════════════════════════
-- File storage (Spec 5)
--
-- Two buckets, split by who may read them:
--   branding  — public. The logo is embedded in quotation and
--               agreement PDFs, which are sent to customers.
--   documents — private. Payment screenshots, signed agreements,
--               and expense receipts. Served via signed URLs only.
-- ═══════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'branding',
  'branding',
  true,
  2097152, -- 2 MB
  array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents',
  'documents',
  false,
  10485760, -- 10 MB
  array['image/png', 'image/jpeg', 'image/webp', 'application/pdf']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ── branding: world-readable, owner-writable ───────────────────
drop policy if exists branding_public_read on storage.objects;
create policy branding_public_read on storage.objects
  for select
  using (bucket_id = 'branding');

drop policy if exists branding_owner_write on storage.objects;
create policy branding_owner_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'branding' and public.is_owner());

drop policy if exists branding_owner_update on storage.objects;
create policy branding_owner_update on storage.objects
  for update to authenticated
  using (bucket_id = 'branding' and public.is_owner())
  with check (bucket_id = 'branding' and public.is_owner());

drop policy if exists branding_owner_delete on storage.objects;
create policy branding_owner_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'branding' and public.is_owner());

-- ── documents: any active staff reads and uploads ──────────────
-- Delivery staff photograph signed agreements and returned items;
-- booking staff attach payment screenshots. Only the owner deletes.
drop policy if exists documents_staff_read on storage.objects;
create policy documents_staff_read on storage.objects
  for select to authenticated
  using (bucket_id = 'documents' and public.is_active_user());

drop policy if exists documents_staff_write on storage.objects;
create policy documents_staff_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'documents' and public.is_active_user());

drop policy if exists documents_owner_delete on storage.objects;
create policy documents_owner_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'documents' and public.is_owner());
