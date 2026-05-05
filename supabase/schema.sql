create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'user',
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "select_own_profile" on public.profiles;
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

drop policy if exists "select_own_allow" on public.allowed_emails;
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

-- Cache por usuário (metadados e snapshots da UI)
create table if not exists public.user_cache (
  user_id uuid not null references auth.users (id) on delete cascade,
  cache_key text not null,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, cache_key)
);

alter table public.user_cache enable row level security;

drop policy if exists "select_own_cache" on public.user_cache;
create policy "select_own_cache"
on public.user_cache
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "upsert_own_cache" on public.user_cache;
create policy "upsert_own_cache"
on public.user_cache
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "update_own_cache" on public.user_cache;
create policy "update_own_cache"
on public.user_cache
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "delete_own_cache" on public.user_cache;
create policy "delete_own_cache"
on public.user_cache
for delete
to authenticated
using (user_id = auth.uid());

-- Bucket para posters/backdrops cacheados
insert into storage.buckets (id, name, public)
values ('posters', 'posters', true)
on conflict (id) do nothing;

drop policy if exists "public_read_posters" on storage.objects;
create policy "public_read_posters"
on storage.objects
for select
to public
using (bucket_id = 'posters');

drop policy if exists "auth_upload_posters" on storage.objects;
create policy "auth_upload_posters"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'posters');

drop policy if exists "auth_update_posters" on storage.objects;
create policy "auth_update_posters"
on storage.objects
for update
to authenticated
using (bucket_id = 'posters')
with check (bucket_id = 'posters');

drop policy if exists "auth_delete_posters" on storage.objects;
create policy "auth_delete_posters"
on storage.objects
for delete
to authenticated
using (bucket_id = 'posters');
