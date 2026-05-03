create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'user',
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "select_own_profile"
on public.profiles
for select
to authenticated
using (user_id = auth.uid());

create table if not exists public.allowed_emails (
  email text primary key,
  created_at timestamptz not null default now()
);

alter table public.allowed_emails enable row level security;

create policy "select_own_allow"
on public.allowed_emails
for select
to authenticated
using (email = (auth.jwt() ->> 'email'));

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id)
  values (new.id)
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

