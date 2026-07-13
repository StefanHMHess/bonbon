-- Household cost group catalog for BonBox
-- Run this once in Supabase SQL Editor.

create table if not exists public.household_cost_groups (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  color text,
  keywords text[] not null default '{}',
  sort_order int not null default 100,
  created_at timestamptz not null default now(),
  unique (household_id, name)
);

create index if not exists idx_household_cost_groups_household_sort
  on public.household_cost_groups(household_id, sort_order, name);

alter table public.household_cost_groups enable row level security;

drop policy if exists household_cost_groups_select_all on public.household_cost_groups;
drop policy if exists household_cost_groups_insert_all on public.household_cost_groups;
drop policy if exists household_cost_groups_update_all on public.household_cost_groups;
drop policy if exists household_cost_groups_delete_all on public.household_cost_groups;

create policy household_cost_groups_select_all on public.household_cost_groups
  for select using (true);

create policy household_cost_groups_insert_all on public.household_cost_groups
  for insert with check (true);

create policy household_cost_groups_update_all on public.household_cost_groups
  for update using (true) with check (true);

create policy household_cost_groups_delete_all on public.household_cost_groups
  for delete using (true);

-- Seed defaults for all households (safe on rerun).
insert into public.household_cost_groups (household_id, name, color, keywords, sort_order)
select h.id, v.name, v.color, v.keywords, v.sort_order
from public.households h
cross join (
  values
    ('Lebensmittel', '#18b6a3', array['aldi','lidl','rewe','edeka','netto','supermarkt','lebensmittel','bäckerei','baeckerei']::text[], 10),
    ('Essen & Trinken', '#0f9f8d', array['restaurant','cafe','café','bar','pizza','burger','liefer','imbiss']::text[], 20),
    ('Mobilität', '#456279', array['tank','shell','aral','uber','taxi','bahn','db','ticket','park']::text[], 30),
    ('Haushalt', '#ff6b57', array['dm','rossmann','haushalt','reinigung','drogerie','toilettenpapier']::text[], 40),
    ('Gesundheit', '#eb5a46', array['apotheke','arzt','medikament','medizin','praxis']::text[], 50),
    ('Freizeit', '#10243e', array['kino','museum','event','sport','training','verein']::text[], 60)
) as v(name, color, keywords, sort_order)
where not exists (
  select 1
  from public.household_cost_groups g
  where g.household_id = h.id and g.name = v.name
);
