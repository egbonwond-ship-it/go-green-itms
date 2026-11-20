-- Run once in Supabase: Project → SQL Editor → New query → paste → Run.
create table if not exists public.records (
  id         text primary key,
  kind       text not null,
  doc        jsonb not null,
  updated_at timestamptz not null default now()
);
create index if not exists records_kind_idx on public.records (kind);

-- Lock the table down: only the server-side secret key (used by the API) can read or write.
alter table public.records enable row level security;
revoke all on public.records from anon, authenticated;

-- Atomic ticket numbers: INC0001001, REQ0001001, ...
create table if not exists public.counters (
  prefix text primary key,
  value  bigint not null
);
alter table public.counters enable row level security;
revoke all on public.counters from anon, authenticated;

create or replace function public.next_number(p_prefix text)
returns bigint
language sql
security definer
set search_path = public
as $$
  insert into public.counters (prefix, value) values (p_prefix, 1001)
  on conflict (prefix) do update set value = public.counters.value + 1
  returning value;
$$;
revoke execute on function public.next_number(text) from public, anon, authenticated;
grant execute on function public.next_number(text) to service_role;
