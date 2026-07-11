-- BonBon database schema for Supabase
-- Run in SQL editor of your Supabase project.

create extension if not exists "pgcrypto";

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.receipts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid,
  merchant text,
  receipt_date date not null default current_date,
  total_amount numeric(12,2) not null default 0,
  currency text not null default 'EUR',
  image_path text,
  ai_status text not null default 'queued' check (ai_status in ('queued', 'processing', 'done', 'failed')),
  ai_raw_json jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.receipt_items (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.receipts(id) on delete cascade,
  position int,
  description text not null,
  quantity numeric(12,3) not null default 1,
  unit_price numeric(12,2),
  amount numeric(12,2) not null,
  is_gift boolean not null default false,
  category text,
  created_at timestamptz not null default now()
);

create or replace view public.household_ledger as
select
  i.id as item_id,
  r.id as receipt_id,
  r.household_id,
  r.receipt_date,
  r.merchant,
  i.description,
  i.amount,
  i.is_gift,
  case when i.is_gift then 'gift' else 'main' end as account_type
from public.receipt_items i
join public.receipts r on r.id = i.receipt_id;

create index if not exists idx_receipts_household_date on public.receipts(household_id, receipt_date desc);
create index if not exists idx_receipt_items_receipt on public.receipt_items(receipt_id);

alter table public.households enable row level security;
alter table public.receipts enable row level security;
alter table public.receipt_items enable row level security;

-- Demo policies. Adapt to your auth model before production.
drop policy if exists households_select_all on public.households;
drop policy if exists households_insert_all on public.households;
create policy households_select_all on public.households for select using (true);
create policy households_insert_all on public.households for insert with check (true);

drop policy if exists receipts_select_all on public.receipts;
drop policy if exists receipts_insert_all on public.receipts;
drop policy if exists receipts_update_all on public.receipts;
create policy receipts_select_all on public.receipts for select using (true);
create policy receipts_insert_all on public.receipts for insert with check (true);
create policy receipts_update_all on public.receipts for update using (true) with check (true);

drop policy if exists receipt_items_select_all on public.receipt_items;
drop policy if exists receipt_items_insert_all on public.receipt_items;
drop policy if exists receipt_items_update_all on public.receipt_items;
create policy receipt_items_select_all on public.receipt_items for select using (true);
create policy receipt_items_insert_all on public.receipt_items for insert with check (true);
create policy receipt_items_update_all on public.receipt_items for update using (true) with check (true);

-- Example seed row. Save the generated UUID and put it into VITE_DEFAULT_HOUSEHOLD_ID.
insert into public.households(name) values ('BonBon Haushalt') on conflict do nothing;
