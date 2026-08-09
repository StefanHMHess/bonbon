-- Allow receipt item allocations to target cost centers directly.
-- Run this once in Supabase SQL Editor for existing BonBox databases.

alter table if exists public.receipt_item_allocations
  add column if not exists cost_center_id uuid references public.cost_centers(id) on delete cascade;

alter table if exists public.receipt_item_allocations
  alter column account_id drop not null;

update public.receipt_item_allocations ria
set cost_center_id = fa.cost_center_id
from public.family_accounts fa
where ria.account_id = fa.id
  and ria.cost_center_id is null
  and fa.cost_center_id is not null;

create index if not exists idx_receipt_item_allocations_cost_center
  on public.receipt_item_allocations(cost_center_id);

create unique index if not exists idx_receipt_item_allocations_item_cost_center
  on public.receipt_item_allocations(receipt_item_id, cost_center_id)
  where cost_center_id is not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'receipt_item_allocations_account_or_cost_center_check'
  ) then
    alter table public.receipt_item_allocations
      add constraint receipt_item_allocations_account_or_cost_center_check
      check (account_id is not null or cost_center_id is not null);
  end if;
end
$$;