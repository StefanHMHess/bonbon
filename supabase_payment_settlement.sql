-- Add payment account tracking and settlement transactions for BonBon
-- Run this once in Supabase SQL Editor.

-- Add payment_account_id to receipts table
alter table public.receipts 
add column if not exists payment_account_id uuid references public.family_accounts(id) on delete set null;

-- Add receipt_time column (for AI-extracted time)
alter table public.receipts 
add column if not exists receipt_time text;

-- Create settlement_transactions table for tracking payments and reimbursements
create table if not exists public.settlement_transactions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  from_account_id uuid not null references public.family_accounts(id) on delete cascade,
  to_account_id uuid not null references public.family_accounts(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  transaction_date date not null default current_date,
  description text,
  created_at timestamptz not null default now(),
  unique (household_id, from_account_id, to_account_id, transaction_date, description)
);

create index if not exists idx_settlement_transactions_household 
  on public.settlement_transactions(household_id);
create index if not exists idx_settlement_transactions_accounts 
  on public.settlement_transactions(from_account_id, to_account_id);
create index if not exists idx_settlement_transactions_date 
  on public.settlement_transactions(transaction_date desc);

alter table public.settlement_transactions enable row level security;

drop policy if exists settlement_transactions_select_all on public.settlement_transactions;
drop policy if exists settlement_transactions_insert_all on public.settlement_transactions;
drop policy if exists settlement_transactions_update_all on public.settlement_transactions;
drop policy if exists settlement_transactions_delete_all on public.settlement_transactions;

create policy settlement_transactions_select_all on public.settlement_transactions
  for select using (true);

create policy settlement_transactions_insert_all on public.settlement_transactions
  for insert with check (true);

create policy settlement_transactions_update_all on public.settlement_transactions
  for update using (true) with check (true);

create policy settlement_transactions_delete_all on public.settlement_transactions
  for delete using (true);

-- Create view for settlement summary (who owes whom)
create or replace view public.settlement_summary as
select
  household_id,
  from_account_id,
  to_account_id,
  sum(amount) as total_amount
from public.settlement_transactions
group by household_id, from_account_id, to_account_id;
