-- Add is_ignored column to receipt_items for marking items to be excluded from cost summaries
alter table public.receipt_items 
add column if not exists is_ignored boolean not null default false;
