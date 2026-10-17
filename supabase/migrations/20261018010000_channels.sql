-- A Short for each channel. Every YouTube channel an account connects gets
-- its own daily Shorts (as many as the plan allows each one), in its own
-- look, at its own best times, learning from its own views, with its own
-- figures in Earnings. A Short is made for one channel and only goes to
-- that one. An account with no channel works as before (its Shorts are for
-- no channel), and its first channel takes over the ones not on YouTube yet.
-- Disconnecting keeps a channel and its Shorts, and lets go of its keys and
-- the figures read with them, so connecting it again carries on where it stopped.

-- channels
alter table public.channels
  -- first connected, or connected again after being disconnected: a plan with room for fewer gives it to the oldest
  add column added_at timestamptz,
  -- the creator's choice: whether it gets new Shorts. A channel's own Shorts settings live here, beside its made-for-kids answer
  add column shorts_on boolean not null default true,
  -- so a Short (and what's learned and read for a channel) can name its channel and its owner together
  add constraint channels_id_user unique (id, user_id);
-- in the order posting went by, so the channel an account's Shorts went to stays first: its connected channels as
-- they were connected, then any that had stopped letting Hookline in. Each keeps its time, or goes just after the one
-- before it when that's later, to the millisecond, as the app reads it, so the app and the database always agree
update public.channels c set added_at = o.added_at
from (
  select id, max(at - n * interval '1 millisecond') over (partition by user_id, platform order by n) + n * interval '1 millisecond' as added_at
  from (
    select id, user_id, platform, date_trunc('milliseconds', connected_at) as at,
      row_number() over (partition by user_id, platform order by (status = 'connected') desc, connected_at, id) as n
    from public.channels
  ) r
) o
where o.id = c.id;
alter table public.channels alter column added_at set default date_trunc('milliseconds', now()), alter column added_at set not null;

-- 'revoked' is now a channel the creator disconnected in Hookline; 'expired' one Google or TikTok stopped letting
-- Hookline into. Only the server connects or disconnects one; people answer its questions and say whether it gets Shorts.
revoke delete on public.channels from anon, authenticated;
grant update (shorts_on) on public.channels to authenticated;

-- videos: a Short is for one of its owner's own channels, whoever writes it
update public.videos v set channel_id = null
where v.channel_id is not null and not exists (select 1 from public.channels c where c.id = v.channel_id and c.user_id = v.user_id);
alter table public.videos drop constraint videos_channel_id_fkey;
alter table public.videos add constraint videos_channel_owner foreign key (channel_id, user_id)
  references public.channels (id, user_id) on delete set null (channel_id);
create index videos_channel_created on public.videos (channel_id, created_at desc) where channel_id is not null;

-- What YouTube said about a video, and the copy for TikTok, are the
-- server's to record. People can still change their own Shorts' titles
-- and choices, but not claim a YouTube video is theirs without the check.
-- Once it's made, only the server moves it to another channel, so an
-- approved Short keeps the look and answers it was made with.
create or replace function public.guard_video_facts() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.youtube_id is not null or new.youtube_verified or new.youtube_status is not null or new.youtube_privacy is not null
      or new.youtube_kids is not null or new.youtube_checked_at is not null or new.youtube_wanted is not null
      or new.youtube_publish_at is not null or new.clean_path is not null then
      raise exception 'only the server records what YouTube said' using errcode = '42501';
    end if;
  elsif new.youtube_id is distinct from old.youtube_id or new.youtube_verified is distinct from old.youtube_verified
    or new.youtube_status is distinct from old.youtube_status or new.youtube_privacy is distinct from old.youtube_privacy
    or new.youtube_kids is distinct from old.youtube_kids or new.youtube_checked_at is distinct from old.youtube_checked_at
    or new.youtube_wanted is distinct from old.youtube_wanted or new.youtube_publish_at is distinct from old.youtube_publish_at
    or new.clean_path is distinct from old.clean_path then
    raise exception 'only the server records what YouTube said' using errcode = '42501';
  elsif new.channel_id is distinct from old.channel_id then
    raise exception 'only the server moves a Short to another channel' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- each channel's look, claimed in the content ledger like everything else (other items are everyone's once claimed)
alter table public.content_ledger add column channel_id uuid references public.channels (id) on delete set null;
create index content_ledger_channel_look on public.content_ledger (channel_id) where kind = 'look';

-- the morning run: one try for each channel that gets Shorts, or for the account while it has no channel
alter table public.shorts_runs drop constraint shorts_runs_pkey;
alter table public.shorts_runs alter column user_id set not null;
alter table public.shorts_runs add column channel_id uuid;
alter table public.shorts_runs add constraint shorts_runs_channel foreign key (channel_id, user_id)
  references public.channels (id, user_id) on delete cascade;
alter table public.shorts_runs add constraint shorts_runs_unit unique nulls not distinct (user_id, channel_id);

-- learning, per channel: the same measure as weights, for one channel. weights stays the account's
-- (every channel's results), for an account with no channel, Trends, Home and the library's view across channels
create table public.channel_weights (
  channel_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('format', 'key')),
  name text not null,
  score real not null default 1,
  samples integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (channel_id, kind, name),
  foreign key (channel_id, user_id) references public.channels (id, user_id) on delete cascade
);
create index channel_weights_user on public.channel_weights (user_id);
alter table public.channel_weights enable row level security;
-- people read their own; only the server writes them, even where new tables are granted to everyone by default
revoke all on public.channel_weights from anon, authenticated;
grant select on public.channel_weights to authenticated;
create policy "read own channel weights" on public.channel_weights for select to authenticated
  using (user_id = (select auth.uid()));
select public.server_only('public.channel_weights');

-- Earnings: YouTube's and TikTok's figures are each channel's own; Stripe's are the account's (no channel)
alter table public.metrics add column channel_id uuid;
alter table public.metrics add constraint metrics_channel foreign key (channel_id, user_id)
  references public.channels (id, user_id) on delete cascade;
alter table public.metrics drop constraint metrics_pkey;
alter table public.metrics add constraint metrics_day unique nulls not distinct (user_id, source, metric, channel_id, day);

-- what was there before goes to each account's first channel.
-- Last, and safe to run again, so a test can run it over rows it made.
drop table if exists pg_temp.first_youtube;
-- first in the order new Shorts go by, as the app reads it
create temporary table first_youtube as
  select distinct on (user_id) user_id, id as channel_id from public.channels
  where platform = 'youtube' and status <> 'revoked'
  order by user_id, added_at, id;
-- not yet on YouTube: where posting would have sent them
update public.videos v set channel_id = f.channel_id from first_youtube f
where v.user_id = f.user_id and v.channel_id is null and v.youtube_id is null;
-- already on YouTube: only what Hookline uploaded since the account's one channel was last connected, and only
-- where no channel that said who it's for (as each one Hookline uploaded to had) is gone. Disconnecting used to
-- delete a channel and leave its Shorts with none, so the rest may be on one that's gone: they stay unknown, and
-- are checked as before
update public.videos v set channel_id = c.id from public.channels c
where c.user_id = v.user_id and c.platform = 'youtube' and v.channel_id is null and v.youtube_id is not null
  and v.uploaded_at >= c.connected_at
  and (select count(*) from public.channels x where x.user_id = v.user_id and x.platform = 'youtube') = 1
  and not exists (select 1 from public.audience_log a where a.user_id = v.user_id and a.source = 'channel' and a.channel_id is null);
-- the account's look is its first channel's
update public.content_ledger l set channel_id = f.channel_id from first_youtube f
where l.kind = 'look' and l.user_id = f.user_id and l.channel_id is null
  and not exists (select 1 from public.content_ledger x where x.kind = 'look' and x.channel_id = f.channel_id);
-- what it learned came mostly from that channel's Shorts (uploads went to it)
insert into public.channel_weights (channel_id, user_id, kind, name, score, samples, updated_at)
select f.channel_id, w.user_id, w.kind, w.name, w.score, w.samples, w.updated_at
from public.weights w join first_youtube f on f.user_id = w.user_id
on conflict do nothing;
update public.shorts_runs r set channel_id = f.channel_id from first_youtube f
where r.user_id = f.user_id and r.channel_id is null
  and not exists (select 1 from public.shorts_runs x where x.user_id = r.user_id and x.channel_id = f.channel_id);
-- figures: kept where the account had one channel of the kind, for the days it has read itself since it was last
-- connected (YouTube's last 35 days at each sync, TikTok's total on each day after it). A channel disconnected
-- before left its figures behind, and with more than one they overwrote each other, so the rest go and the
-- next sync reads 35 days back
update public.metrics m set channel_id = c.id
from public.channels c left join public.profiles p on p.id = c.user_id
left join pg_catalog.pg_timezone_names z on z.name = p.timezone
where m.source in ('youtube', 'tiktok') and m.channel_id is null and c.user_id = m.user_id and c.platform = m.source
  and (select count(*) from public.channels x where x.user_id = m.user_id and x.platform = m.source) = 1
  and m.day > case when m.source = 'youtube' then ((c.connected_at - interval '35 days') at time zone 'UTC')::date
    else (c.connected_at at time zone coalesce(z.name, 'UTC'))::date end
  and not exists (select 1 from public.metrics y where y.user_id = m.user_id and y.source = m.source
    and y.metric = m.metric and y.day = m.day and y.channel_id = c.id);
delete from public.metrics where source in ('youtube', 'tiktok') and channel_id is null;
drop table pg_temp.first_youtube;
