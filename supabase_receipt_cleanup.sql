-- Receipt cleanup helpers for BonBox
-- Run this once in Supabase SQL Editor.

drop policy if exists receipts_delete_all on public.receipts;
create policy receipts_delete_all on public.receipts
  for delete using (true);

drop policy if exists receipt_items_delete_all on public.receipt_items;
create policy receipt_items_delete_all on public.receipt_items
  for delete using (true);

create or replace function public.clear_receipt_items(p_receipt_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.receipt_items
  where receipt_id = p_receipt_id;

  update public.receipts
  set total_amount = 0
  where id = p_receipt_id;

  return true;
end;
$$;

grant execute on function public.clear_receipt_items(uuid) to anon, authenticated;

create or replace function public.delete_receipt_cascade(p_receipt_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  delete from public.receipts
  where id = p_receipt_id;

  get diagnostics deleted_count = row_count;
  return deleted_count > 0;
end;
$$;

grant execute on function public.delete_receipt_cascade(uuid) to anon, authenticated;