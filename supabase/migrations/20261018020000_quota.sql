-- YouTube's quota, counted by Hookline (lib/shorts/quota.ts has the shares).
-- It belongs to Hookline's one Google Cloud project and every account
-- shares it: since June 2026, 100 uploads, 100 searches and 10,000 units a
-- day for every other call, reset at midnight Pacific time, with YouTube
-- Analytics counted on its own. Each call is counted here before it's
-- made, by its quota day (from 00:05 Pacific, when Hookline treats the
-- quota as reset), the allowance it comes out of and what it was for, so
-- Trends, views, link checks and YouTube Live can't use what posting
-- needs, and a call with no room left waits for the reset instead of
-- failing at Google. Each account's uploads and link checks are counted
-- here too, by the server alone. Trends checks each niche once a day,
-- keeps YouTube's made-for-kids verdict on each rising Short, and
-- remembers when each niche was last checked.

create table public.youtube_quota (
  -- the quota day it counts against: the Pacific date whose 00:05 it started at
  day date not null,
  bucket text not null constraint youtube_quota_bucket_check check (bucket in ('units', 'uploads', 'searches', 'analytics')),
  kind text not null constraint youtube_quota_kind_check
    check (kind in ('trends', 'uploads', 'checks', 'stats', 'other', 'live', 'analytics')),
  units integer not null default 0 check (units >= 0),
  calls integer not null default 0 check (calls >= 0),
  -- the first time this kind found no room left that day
  ran_out_at timestamptz,
  -- YouTube itself said this allowance was used up that day, whatever the count here says
  full_at timestamptz,
  -- the first call counted in this row, so /admin can say when counting began
  created_at timestamptz not null default now(),
  primary key (day, bucket, kind)
);

-- each account's part of the day: Shorts Hookline uploaded for it (its plan's
-- uploads a day) and pasted links checked with YouTube (so one account can't
-- use everyone's checks). Only the server counts these: people can edit and
-- delete their own videos rows, so a limit can't be counted from those.
create table public.youtube_account_days (
  day date not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  uploads integer not null default 0 check (uploads >= 0),
  link_checks integer not null default 0 check (link_checks >= 0),
  primary key (day, user_id)
);

-- when each Trends niche was last checked, how the last try went, and when it's checked next
create table public.trend_checks (
  niche text primary key,
  -- the last check that worked; null until one has
  checked_at timestamptz,
  tried_at timestamptz not null,
  -- found rising Shorts, found none, waited for the quota, or YouTube didn't answer; null while the first is under way
  outcome text check (outcome in ('found', 'none', 'quota', 'failed')),
  next_at timestamptz not null
);

alter table public.trend_videos
  -- YouTube's own verdict on whether it's made for kids; null when YouTube didn't say
  add column made_for_kids boolean;

-- what a ready Short waits for: YouTube's uploads for Hookline today, or its plan's uploads today
alter table public.videos drop constraint videos_waiting_on_check;
alter table public.videos add constraint videos_waiting_on_check
  check (waiting_on in ('youtube_quota', 'plan_cap'));

alter table public.youtube_quota enable row level security;
alter table public.youtube_account_days enable row level security;
alter table public.trend_checks enable row level security;

-- the server's alone, even where new tables are granted to everyone by default
revoke all on public.youtube_quota from anon, authenticated;
revoke all on public.youtube_account_days from anon, authenticated;

-- how fresh Trends is, for everyone signed in; only the server writes it
revoke all on public.trend_checks from anon, authenticated;
grant select on public.trend_checks to authenticated;
create policy "trend checks for everyone" on public.trend_checks for select to authenticated using (true);

select public.server_only('public.youtube_quota');
select public.server_only('public.youtube_account_days');
select public.server_only('public.trend_checks');
