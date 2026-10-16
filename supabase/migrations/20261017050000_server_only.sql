-- Hookline's tables are for Hookline's own server. Supabase's REST and
-- GraphQL APIs take the same sign-in as the app and run as the same role,
-- so without this anyone signed in could read and change their own rows
-- directly, past every check the app makes: a Short's file and status, a
-- LIVE game's rivalries, a channel's settings. The app marks its own
-- transactions (asUser in lib/server/db.ts); anything else signed in
-- gets nothing.

create or replace function public.via_hookline() returns boolean
language sql stable set search_path = public as $$
  select coalesce(current_setting('hookline.via', true), '') = 'server'
$$;

-- Puts the rule on one table. Every new table in public gets it in the
-- migration that makes it; a test fails on any table without it.
create or replace function public.server_only(t regclass) returns void
language plpgsql set search_path = public as $$
begin
  execute format('alter table %s enable row level security', t);
  execute format('drop policy if exists "only through hookline" on %s', t);
  execute format(
    'create policy "only through hookline" on %s as restrictive for all to authenticated using (public.via_hookline()) with check (public.via_hookline())',
    t
  );
end;
$$;
revoke all on function public.server_only(regclass) from public;

do $$
declare t record;
begin
  for t in
    select c.oid::regclass as reg
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
  loop
    perform public.server_only(t.reg);
  end loop;
end $$;
