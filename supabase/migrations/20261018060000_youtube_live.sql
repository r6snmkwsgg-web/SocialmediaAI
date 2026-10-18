-- YouTube Live: the LIVE games on the streamer's own YouTube stream,
-- through YouTube's API. While a game is open, the server reads the live
-- chat of the account's own stream with its connected channel and hands
-- the game what happened. One reader per account, written only by the
-- server. Chat is kept a few minutes for open games to pick up. Each
-- stream the reader heard is kept with what it heard (counts, never
-- money), which is how a YouTube session is known to be theirs. Each
-- account's LIVE units are counted by the server, by quota day.

create table public.yt_live_readers (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- the channel the streamer picked to go live on; null means the first YouTube channel connected
  channel_id uuid,
  state text not null default 'idle'
    check (state in ('idle', 'not_live', 'live', 'chat_off', 'ended', 'paused', 'reconnect', 'error')),
  -- why, in plain words, for the LIVE page and beside the game
  detail text,
  -- the stream it found, and its chat once it has one
  broadcast_id text,
  chat_id text,
  -- where reading carries on from; anything published 30 seconds or more before seen_until is old news
  page_token text,
  seen_until timestamptz,
  -- when the chat was last read, and how long YouTube asked to be left before the next read
  read_at timestamptz,
  poll_ms integer,
  -- when a game or the setup page last asked, and a game itself, since when it has looked for a stream, and the last look-now
  asked_at timestamptz,
  game_at timestamptz,
  looking_since timestamptz,
  nudged_at timestamptz,
  -- a game is counting down or voting until then, so a quiet chat isn't read any less often
  hurry_until timestamptz,
  -- when YouTube is next asked, and until when whoever is asking it right now holds the turn
  next_at timestamptz not null default now(),
  busy_until timestamptz,
  -- reads in a row that found nothing new
  quiet integer not null default 0,
  -- the day's YouTube LIVE time ran out: until when, and whose (this account's, or everyone's)
  paused_until timestamptz,
  paused_for text check (paused_for in ('account', 'everyone')),
  -- Jewels gift combos on this stream, by viewer and gift: how many have been handed out, and when
  streaks jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  -- only ever one of the account's own channels
  foreign key (channel_id, user_id) references public.channels (id, user_id) on delete set null (channel_id)
);

create table public.yt_broadcasts (
  user_id uuid not null references auth.users (id) on delete cascade,
  broadcast_id text not null check (broadcast_id ~ '^[A-Za-z0-9_-]{11}$'),
  -- the channel it was found on, which is the account's own
  channel_id uuid not null,
  title text,
  started_at timestamptz,
  ended_at timestamptz,
  -- what the reader heard on it while a game was open: how many, never what anyone paid
  super_chats integer not null default 0,
  super_stickers integer not null default 0,
  jewels bigint not null default 0,
  new_members integer not null default 0,
  gifted_members integer not null default 0,
  heard_at timestamptz not null default now(),
  primary key (user_id, broadcast_id),
  foreign key (channel_id, user_id) references public.channels (id, user_id) on delete cascade
);
create index yt_broadcasts_channel on public.yt_broadcasts (channel_id);

create table public.yt_chat_events (
  seq bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  broadcast_id text not null,
  message_id text not null,
  -- a Jewels gift's combo count as YouTube gave it; 0 for everything else, so a message sent again is handed out once
  combo integer not null default 0,
  -- what the game should do with it, as LiveEvents in order
  events jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, message_id, combo)
);
create index yt_chat_events_user_seq on public.yt_chat_events (user_id, seq);
create index yt_chat_events_created on public.yt_chat_events (created_at);

alter table public.live_sessions
  add column platform text not null default 'tiktok' check (platform in ('tiktok', 'youtube')),
  -- the YouTube streams it heard, by video id
  add column broadcasts text[] not null default '{}',
  -- YouTube has no gift coins: what viewers paid is in Earnings, from YouTube itself
  add constraint live_sessions_youtube_no_coins check (platform = 'tiktok' or coins = 0);
-- YouTube sessions still holding viewers' names, for the tidy that lets them go after 30 days
create index live_sessions_youtube_names on public.live_sessions (started_at) where platform = 'youtube' and top_gifters <> '[]'::jsonb;

-- 'can you play on YouTube Live?': { adult, canGoLive, computer, superChat }, or null until asked
alter table public.profiles add column yt_live_check jsonb;

-- the days of each channel's Super Chats Hookline has read: from the first whole day (YouTube shares 30 days back) to the
-- day of the last read. Outside them a day is unknown, never none
alter table public.channels add column superchats_from date, add column superchats_through date;

-- YouTube Live's units this account used on a quota day, counted by the server alone
alter table public.youtube_account_days add column live_units integer not null default 0 check (live_units >= 0);

-- whether a session that heard these YouTube streams is the account's own: its reader heard each one
create function public.own_broadcasts(uid uuid, heard text[]) returns boolean
language sql stable set search_path = public as $$
  select cardinality(heard) > 0
    and heard <@ coalesce((select array_agg(broadcast_id) from public.yt_broadcasts where user_id = uid), '{}')
$$;
revoke execute on function public.own_broadcasts(uuid, text[]) from public, anon, authenticated;

-- Disconnecting a channel takes back the access its streams were read
-- with: their chat and what the reader heard on them go, and so do the
-- names of the top supporters of any LIVE that heard one of them, and a
-- reader on one of them starts over. Sessions keep their numbers. Its
-- Super Chat figures go with its other figures (disconnectChannel), so the
-- days they covered go too: connected again, it's read afresh.
create function public.forget_youtube_lives() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.status = 'revoked' and old.status is distinct from 'revoked' then
    update public.live_sessions s set top_gifters = '[]'::jsonb
    where s.user_id = new.user_id and s.platform = 'youtube' and s.top_gifters <> '[]'::jsonb
      and s.broadcasts && array(select b.broadcast_id from public.yt_broadcasts b where b.channel_id = new.id);
    update public.yt_live_readers r set state = 'idle', detail = null, broadcast_id = null, chat_id = null, page_token = null,
      seen_until = null, quiet = 0, streaks = '{}'::jsonb, next_at = now(), updated_at = now()
    from public.yt_broadcasts b
    where b.channel_id = new.id and b.user_id = r.user_id and b.broadcast_id = r.broadcast_id;
    delete from public.yt_chat_events e using public.yt_broadcasts b
    where b.channel_id = new.id and e.user_id = b.user_id and e.broadcast_id = b.broadcast_id;
    delete from public.yt_broadcasts where channel_id = new.id;
    update public.channels set superchats_from = null, superchats_through = null where id = new.id and superchats_from is not null;
  end if;
  return new;
end;
$$;

create trigger forget_youtube_lives after update of status on public.channels
  for each row execute function public.forget_youtube_lives();

alter table public.yt_live_readers enable row level security;
alter table public.yt_broadcasts enable row level security;
alter table public.yt_chat_events enable row level security;

-- server-written, even where new tables are granted to everyone by default; people read their own reader and streams
revoke all on public.yt_live_readers, public.yt_broadcasts, public.yt_chat_events from anon, authenticated;
revoke all on sequence public.yt_chat_events_seq_seq from anon, authenticated;
grant select on public.yt_live_readers, public.yt_broadcasts to authenticated;
create policy "read own youtube reader" on public.yt_live_readers for select to authenticated
  using (user_id = (select auth.uid()));
create policy "read own youtube lives" on public.yt_broadcasts for select to authenticated
  using (user_id = (select auth.uid()));
-- yt_chat_events has no policies: only the server reads it, for the game holding the key

select public.server_only('public.yt_live_readers');
select public.server_only('public.yt_broadcasts');
select public.server_only('public.yt_chat_events');
