-- BonBox storage bucket and RLS policies for receipt uploads.
-- Run this once in the Supabase SQL editor for existing projects.

insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do update
set public = excluded.public;

drop policy if exists receipts_objects_select_authenticated on storage.objects;
drop policy if exists receipts_objects_insert_authenticated on storage.objects;
drop policy if exists receipts_objects_update_authenticated on storage.objects;
drop policy if exists receipts_objects_delete_authenticated on storage.objects;

create policy receipts_objects_select_authenticated on storage.objects
  for select
  to authenticated
  using (bucket_id = 'receipts');

create policy receipts_objects_insert_authenticated on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'receipts');

create policy receipts_objects_update_authenticated on storage.objects
  for update
  to authenticated
  using (bucket_id = 'receipts')
  with check (bucket_id = 'receipts');

create policy receipts_objects_delete_authenticated on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'receipts');