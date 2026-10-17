-- The proof layer. What YouTube Analytics says about each of Hookline's own
-- Shorts (plays, engaged views, how long people watch, YouTube's revenue
-- estimate where the channel earns revenue), and for each YouTube channel, who
-- watches and how far it is from the Partner Program. Read once a day through
-- the channel's own access. Only the server writes it, and only its owner reads it.
-- YouTube's API rules let Hookline keep these only while it keeps reading them:
-- anything not read again for 30 days is deleted, and everything goes at once
-- with the channel or the account. The learning loop also notes when it used
-- each first day, so it learns from each one once.

create table public.video_analytics (
  video_id uuid primary key references public.videos (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- the channel it's on, whose access read it; its numbers go when the channel does
  channel_id uuid not null,
  -- YouTube's totals from the day it went up to this day, the last one YouTube had reported
  through date not null,
  views bigint not null check (views >= 0),
  engaged_views bigint not null check (engaged_views >= 0),
  avg_view_seconds real,
  -- can pass 100 when people watch a Short more than once
  avg_view_percent real,
  -- YouTube's estimate in US dollars; null where the channel earns no revenue or Hookline can't read it
  revenue numeric(12, 4),
  -- the share of its plays YouTube counted as engaged, from the first reading that covered the
  -- day it went up and the day after (Pacific) and ran no more than 6 days past the day it went
  -- up: set once, and what learning uses
  first_share real check (first_share between 0 and 1),
  -- when YouTube last gave these; deleted 30 days later unless read again
  fetched_at timestamptz not null default now(),
  foreign key (channel_id, user_id) references public.channels (id, user_id) on delete cascade
);
create index video_analytics_user on public.video_analytics (user_id);
create index video_analytics_channel on public.video_analytics (channel_id);
create index video_analytics_fetched on public.video_analytics (fetched_at);

create table public.channel_analytics (
  channel_id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- the last day YouTube had reported for the channel at its last full read
  through date,
  -- why the last try didn't read it: no permission, access lost, a limit, anything else
  problem text check (problem in ('scope', 'access', 'quota', 'error')),
  -- whether its revenue can be read, and YouTube's estimates for the 90 days up to through:
  -- all revenue, and the part from ads
  revenue_readable boolean,
  revenue_90d numeric(12, 2),
  ad_revenue_90d numeric(12, 2),
  -- YouTube's public count, rounded down as YouTube rounds it; null when hidden or unknown
  subscribers bigint,
  subscribers_hidden boolean not null default false,
  -- engaged views on Shorts over the 90 days up to through, and watch hours on long videos
  -- over 365; null where YouTube didn't split Shorts from the rest
  shorts_engaged_90d bigint,
  long_hours_365d real,
  -- YouTube's percentages of signed-in viewers 13 and over, for the 90 days up to through,
  -- as a list of { age: 'age18-24', gender: 'female', percent: 12.5 }
  audience jsonb,
  -- when it was last tried (which also stops two runs reading it at once), and last read in full
  tried_at timestamptz,
  synced_at timestamptz,
  foreign key (channel_id, user_id) references public.channels (id, user_id) on delete cascade
);
create index channel_analytics_user on public.channel_analytics (user_id);

alter table public.video_stats
  -- when the learning loop used this 24-hour reading, and whether it compared engaged views or
  -- plays (null: it only set the baseline). Readings already here, and any that code from before
  -- this writes while a deploy is under way, were learned the moment they were read, so that's
  -- the default. The new code writes nulls and learns each one itself, once.
  add column learned_at timestamptz default now(),
  add column learned_on text default 'plays' check (learned_on in ('engaged', 'plays'));
-- first days still waiting to be learned
create index video_stats_unlearned on public.video_stats (video_id) where checkpoint = '24h' and learned_at is null;

alter table public.video_analytics enable row level security;
alter table public.channel_analytics enable row level security;
-- the server's to write, even where new tables are granted to everyone by default; people read their own
revoke all on public.video_analytics, public.channel_analytics from anon, authenticated;
grant select on public.video_analytics, public.channel_analytics to authenticated;
create policy "read own video analytics" on public.video_analytics for select to authenticated
  using (user_id = (select auth.uid()));
create policy "read own channel analytics" on public.channel_analytics for select to authenticated
  using (user_id = (select auth.uid()));
select public.server_only('public.video_analytics');
select public.server_only('public.channel_analytics');

-- Disconnecting keeps the channel, but what was read with the access the
-- creator took back goes at once: every Short's numbers on it, and its own.
create function public.forget_channel_analytics() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.video_analytics where channel_id = new.id;
  delete from public.channel_analytics where channel_id = new.id;
  return null;
end;
$$;
revoke all on function public.forget_channel_analytics() from public, anon, authenticated;

create trigger forget_channel_analytics after update of status on public.channels
  for each row when (new.status = 'revoked' and old.status is distinct from 'revoked')
  execute function public.forget_channel_analytics();
