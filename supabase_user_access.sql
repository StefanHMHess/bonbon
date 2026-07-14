-- User approval workflow for BonBox
-- Run this once in Supabase SQL Editor.

create table if not exists public.user_access (
  user_id uuid primary key,
  email text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'blocked')),
  is_admin boolean not null default false,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_user_access_status_created
  on public.user_access(status, created_at);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_user_access_set_updated_at on public.user_access;
create trigger trg_user_access_set_updated_at
before update on public.user_access
for each row execute function public.set_updated_at();

alter table public.user_access enable row level security;

create or replace function public.is_current_user_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_access ua
    where ua.user_id = auth.uid()
      and ua.is_admin = true
      and ua.status = 'approved'
  );
$$;

grant execute on function public.is_current_user_admin() to authenticated;

drop policy if exists user_access_select_own on public.user_access;
create policy user_access_select_own on public.user_access
for select
using (auth.uid() = user_id or public.is_current_user_admin());

drop policy if exists user_access_insert_own on public.user_access;
create policy user_access_insert_own on public.user_access
for insert
with check (auth.uid() = user_id);

drop policy if exists user_access_bootstrap_first_admin on public.user_access;
drop policy if exists user_access_bootstrap_first_admin on public.user_access;

drop policy if exists user_access_admin_read_all on public.user_access;
create policy user_access_admin_read_all on public.user_access
for select
using (public.is_current_user_admin());

drop policy if exists user_access_admin_update_all on public.user_access;
create policy user_access_admin_update_all on public.user_access
for update
using (public.is_current_user_admin())
with check (public.is_current_user_admin());

create or replace function public.bootstrap_first_admin()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  has_admin boolean;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select exists (
    select 1
    from public.user_access
    where is_admin = true and status = 'approved'
  )
  into has_admin;

  if has_admin then
    return false;
  end if;

  update public.user_access
  set
    is_admin = true,
    status = 'approved',
    approved_at = now()
  where user_id = auth.uid();

  return true;
end;
$$;

grant execute on function public.bootstrap_first_admin() to authenticated;

create or replace function public.check_email_approved(p_email text)
returns table(approved boolean, is_admin boolean)
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1
      from public.user_access ua
      where lower(ua.email) = lower(p_email)
        and ua.status = 'approved'
    ) as approved,
    coalesce((
      select ua.is_admin
      from public.user_access ua
      where lower(ua.email) = lower(p_email)
        and ua.status = 'approved'
      order by ua.approved_at desc nulls last, ua.created_at desc
      limit 1
    ), false) as is_admin;
$$;

grant execute on function public.check_email_approved(text) to anon, authenticated;

-- Optional: mark one known account as first admin (edit e-mail before running).
-- update public.user_access
-- set is_admin = true, status = 'approved', approved_at = now()
-- where lower(email) = 'dein-admin@beispiel.de';
