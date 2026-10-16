-- LIVE proof: whose LIVE a session's gift coins came from. The game can be
-- pointed at anyone's LIVE, so a session only counts as the streamer's
-- when every LIVE it heard is a TikTok account they connected, with the
-- username TikTok itself gave us. Sessions are written by the server only
-- (the game's key-checked route), and people can read their own. Also:
-- the answers to "can you earn gifts on a TikTok LIVE?".

-- the username each connected TikTok account has, from TikTok's own
-- profile (user.info.profile) when it was connected; the server's to write
create table public.tiktok_usernames (
  channel_id uuid primary key references public.channels (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  username text not null check (username ~ '^[a-z0-9._]{2,24}$'),
  verified_at timestamptz not null default now()
);
create index tiktok_usernames_user on public.tiktok_usernames (user_id);

alter table public.live_sessions
  -- the TikTok LIVEs the game heard real viewers on, as its source named them
  add column heard text[] not null default '{}',
  -- some of it came from a source that didn't say whose LIVE it was
  -- (TikFinity); once true it stays true, and the session can't count
  add column heard_unknown boolean not null default false,
  -- every LIVE it heard is one of the account's own TikTok accounts
  add column verified boolean not null default false,
  add constraint live_sessions_unknown_not_verified check (not (heard_unknown and verified));

-- "can you earn gifts on a TikTok LIVE?": { adult, canGoLive, computer }, or null until asked
alter table public.profiles add column live_check jsonb;

-- whether a session that heard these LIVEs is the account's own
create function public.own_lives(uid uuid, heard text[]) returns boolean
language sql stable set search_path = public as $$
  select cardinality(heard) > 0
    and heard <@ coalesce((select array_agg(username) from public.tiktok_usernames where user_id = uid), '{}')
$$;
revoke execute on function public.own_lives(uuid, text[]) from public, anon, authenticated;

alter table public.tiktok_usernames enable row level security;
-- server-written, even where new tables are granted to everyone by default; people read their own
revoke all on public.tiktok_usernames from anon, authenticated;
grant select on public.tiktok_usernames to authenticated;
create policy "read own tiktok usernames" on public.tiktok_usernames for select to authenticated
  using (user_id = (select auth.uid()));

-- sessions were anyone's own to write through Supabase's API, so anyone could
-- give themselves coins; now only the server writes them
drop policy "own live sessions" on public.live_sessions;
revoke insert, update, delete on public.live_sessions from anon, authenticated;
create policy "read own live sessions" on public.live_sessions for select to authenticated
  using (user_id = (select auth.uid()));
