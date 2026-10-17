-- LIVE clips: a Ball Battle or Rivals round worth watching again, as the
-- game played it on a streamer's LIVE, waiting to become one of a morning's
-- Shorts. Only the server writes them (the game's key-checked route), and
-- people can read their own. Each waits three days at most. A Short made
-- from one carries the round in its parameters, and nobody signed in can
-- make one or change the round it shows: they only choose whether gifters'
-- names show.

create table public.live_clips (
  user_id uuid not null references auth.users (id) on delete cascade,
  -- the LIVE session it's from (live_sessions.id); its first save can come after the round does, so a morning checks it
  session_id uuid not null,
  -- the session's own count of rounds real viewers played, so "Round 14 of your LIVE" is true
  round integer not null check (round between 1 and 100000),
  game text not null check (game in ('battle', 'rivals')),
  -- waiting to become a Short, or turned away
  state text not null check (state in ('ready', 'refused')),
  -- why: it didn't play back exactly, broke a rule, wasn't worth a Short, or three better rounds from the same LIVE were kept
  reason text check (reason in ('replay', 'rules', 'dull', 'dropped')),
  -- how good it is to watch, to keep each LIVE's best; a dull or dropped round keeps it too, to tune the bar by
  score real,
  -- the round as the game recorded it, gifters' display names and all, kept only while it's waiting
  log jsonb,
  played_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (user_id, session_id, round),
  check ((state = 'ready') = (log is not null and score is not null and reason is null)),
  check ((state = 'refused') = (reason is not null and log is null))
);
-- each account's waiting rounds, best first, for a morning's Shorts
create index live_clips_ready on public.live_clips (user_id, score desc) where state = 'ready';
-- how many rounds a game has sent in the last hour
create index live_clips_user_created on public.live_clips (user_id, created_at desc);

alter table public.live_clips enable row level security;
-- the server's to write, even where new tables are granted to everyone by default; people read their own
revoke all on public.live_clips from anon, authenticated;
grant select on public.live_clips to authenticated;
create policy "read own clips" on public.live_clips for select to authenticated
  using (user_id = (select auth.uid()));
select public.server_only('public.live_clips');

-- A clip Short shows a round as it happened on a LIVE, so that it's a clip,
-- the round it shows and where its video starts are the server's to record.
-- People can still change its title and choices like any Short's, and on a
-- clip whether gifters' names show and whether it asks for comments. What
-- YouTube said stays with guard_video_facts; this holds only the clip rules.
create function public.guard_clip_video() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.format = 'clip' then
      raise exception 'only the server records what happened on a LIVE' using errcode = '42501';
    end if;
  elsif (old.format = 'clip' or new.format = 'clip') and (new.format is distinct from old.format
    or (new.params - 'names' - 'allowComments') is distinct from (old.params - 'names' - 'allowComments')) then
    raise exception 'only the server records what happened on a LIVE' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger guard_clip_video before insert or update on public.videos
  for each row execute function public.guard_clip_video();

-- clip Shorts, at most one a day for each account: the LIVE page finds each LIVE's, and the hourly tidy empties names
create index videos_clips on public.videos (user_id, created_at desc) where format = 'clip';
