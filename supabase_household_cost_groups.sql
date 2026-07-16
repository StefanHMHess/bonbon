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
    ('Lebensmittel', '#059669', array['aldi','lidl','rewe','edeka','netto','supermarkt','lebensmittel','bäckerei','baeckerei']::text[], 10),
    ('Essen & Trinken', '#2DD4BF', array['restaurant','cafe','café','bar','pizza','burger','liefer','imbiss']::text[], 20),
    ('Mobilität', '#06B6D4', array['tank','shell','aral','uber','taxi','bahn','db','ticket','park']::text[], 30),
    ('Haushalt', '#CA8A04', array['dm','rossmann','haushalt','reinigung','drogerie','toilettenpapier']::text[], 40),
    ('Gesundheit', '#F43F5E', array['apotheke','arzt','medikament','medizin','praxis']::text[], 50),
    ('Freizeit', '#9F7AEA', array['kino','museum','event','sport','training','verein']::text[], 60),
    ('Geschenke', '#ff6b57', array['geschenk','gift','present']::text[], 70),
    ('Urlaub', '#18b6a3', array['urlaub','reise','hotel','flueg','flug','airbnb','vacation','travel']::text[], 80),
    ('Kleidung', '#1B4965', array['kleidung','kleidet','mode','schuhe','schuh','fashion','hm','zara','primark']::text[], 90),
    ('Lia', '#0891B2', array['lia']::text[], 100),
    ('Hunde', '#EEA12D', array['hund','hunde','dog','pet','futter','tierarzt','vet']::text[], 110),
    ('neue Kostengruppe', '#475569', array[]::text[], 120)
) as v(name, color, keywords, sort_order)
where not exists (
  select 1
  from public.household_cost_groups g
  where g.household_id = h.id and g.name = v.name
);

-- Update existing cost groups with new colors from palette
update public.household_cost_groups
set color = case name
  when 'Lebensmittel' then '#059669'
  when 'Essen & Trinken' then '#2DD4BF'
  when 'Mobilität' then '#06B6D4'
  when 'Haushalt' then '#CA8A04'
  when 'Gesundheit' then '#F43F5E'
  when 'Freizeit' then '#9F7AEA'
  when 'Geschenke' then '#ff6b57'
  when 'Urlaub' then '#18b6a3'
  when 'Kleidung' then '#1B4965'
  when 'Lia' then '#0891B2'
  when 'Hunde' then '#EEA12D'
  when 'neue Kostengruppe' then '#475569'
  else color
end
where name in ('Lebensmittel', 'Essen & Trinken', 'Mobilität', 'Haushalt', 'Gesundheit', 'Freizeit', 'Geschenke', 'Urlaub', 'Kleidung', 'Lia', 'Hunde', 'neue Kostengruppe');
