-- Foreign currency support for BonBox
-- Run this once in Supabase SQL Editor.

alter table public.receipts
  add column if not exists original_total_amount numeric(12,2),
  add column if not exists exchange_rate numeric(12,6) not null default 1;

alter table public.receipt_items
  add column if not exists original_amount numeric(12,2),
  add column if not exists currency text not null default 'EUR',
  add column if not exists exchange_rate numeric(12,6) not null default 1;

update public.receipts
set original_total_amount = coalesce(original_total_amount, total_amount)
where original_total_amount is null;

update public.receipt_items
set original_amount = coalesce(original_amount, amount)
where original_amount is null;

create index if not exists idx_receipts_currency on public.receipts(currency);
create index if not exists idx_receipt_items_currency on public.receipt_items(currency);