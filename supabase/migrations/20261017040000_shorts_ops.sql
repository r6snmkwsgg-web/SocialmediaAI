-- Running the Shorts day to day: the morning job remembers when it last
-- tried each account, what happened and when to try again, so an account
-- that can't get Shorts today (Free's week used up, nothing new left to
-- make) waits for then instead of coming first every five minutes, ahead
-- of everyone else; and a Short held back by YouTube's daily upload quota
-- says so, and waits for the quota to come back instead of trying every
-- minute.

create table public.shorts_runs (
  user_id uuid primary key references auth.users (id) on delete cascade,
  tried_at timestamptz not null,
  -- made some, the plan's allowance was used up, nothing new was left, or it went wrong
  outcome text not null check (outcome in ('made', 'allowance', 'nothing_new', 'failed')),
  made integer not null default 0,
  -- tomorrow, when Free's week frees up, or in an hour after an error
  next_try_at timestamptz not null
);

alter table public.videos
  -- what a ready Short is waiting for before it can go up, and when it's tried again
  add column waiting_on text check (waiting_on in ('youtube_quota')),
  add column waiting_until timestamptz;

alter table public.shorts_runs enable row level security;

-- people can read their own; only the server writes them, even where new tables are granted to everyone by default
revoke all on public.shorts_runs from anon, authenticated;
grant select on public.shorts_runs to authenticated;

create policy "own shorts runs" on public.shorts_runs for select to authenticated
  using (user_id = (select auth.uid()));
