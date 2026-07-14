-- Family/person accounts and item allocation mapping for BonBox
-- Run this once in Supabase SQL Editor.

create table if not exists public.family_accounts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  color text,
  account_type text not null default 'person' check (account_type in ('person', 'family')),
  sort_order int not null default 100,
  created_at timestamptz not null default now(),
  unique (household_id, name)
);

create table if not exists public.receipt_item_allocations (
  id uuid primary key default gen_random_uuid(),
  receipt_item_id uuid not null references public.receipt_items(id) on delete cascade,
  account_id uuid not null references public.family_accounts(id) on delete cascade,
  amount numeric(12,2) not null check (amount >= 0),
  created_at timestamptz not null default now(),
  unique (receipt_item_id, account_id)
);

create index if not exists idx_family_accounts_household_sort
  on public.family_accounts(household_id, account_type, sort_order, name);

create index if not exists idx_receipt_item_allocations_item
  on public.receipt_item_allocations(receipt_item_id);

create index if not exists idx_receipt_item_allocations_account
  on public.receipt_item_allocations(account_id);

alter table public.family_accounts enable row level security;
alter table public.receipt_item_allocations enable row level security;

drop policy if exists family_accounts_select_all on public.family_accounts;
drop policy if exists family_accounts_insert_all on public.family_accounts;
drop policy if exists family_accounts_update_all on public.family_accounts;
drop policy if exists family_accounts_delete_all on public.family_accounts;

create policy family_accounts_select_all on public.family_accounts
  for select using (true);

create policy family_accounts_insert_all on public.family_accounts
  for insert with check (true);

create policy family_accounts_update_all on public.family_accounts
  for update using (true) with check (true);

create policy family_accounts_delete_all on public.family_accounts
  for delete using (true);

drop policy if exists receipt_item_allocations_select_all on public.receipt_item_allocations;
drop policy if exists receipt_item_allocations_insert_all on public.receipt_item_allocations;
drop policy if exists receipt_item_allocations_update_all on public.receipt_item_allocations;
drop policy if exists receipt_item_allocations_delete_all on public.receipt_item_allocations;

create policy receipt_item_allocations_select_all on public.receipt_item_allocations
  for select using (true);

create policy receipt_item_allocations_insert_all on public.receipt_item_allocations
  for insert with check (true);

create policy receipt_item_allocations_update_all on public.receipt_item_allocations
  for update using (true) with check (true);

create policy receipt_item_allocations_delete_all on public.receipt_item_allocations
  for delete using (true);

-- Seed a default family account for every household (safe on rerun).
insert into public.family_accounts (household_id, name, color, account_type, sort_order)
select h.id, 'Familienkonto', '#10243e', 'family', 0
from public.households h
where not exists (
  select 1
  from public.family_accounts fa
  where fa.household_id = h.id and fa.account_type = 'family'
);