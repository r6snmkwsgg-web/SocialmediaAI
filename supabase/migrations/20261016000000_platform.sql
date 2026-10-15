-- The platform around the sections: notifications when something real
-- happens to someone's Shorts, LIVEs, accounts or plan; the render
-- worker checking in, so the app can say when rendering has stopped; and
-- the moments in a Short's life that its page shows.

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- what happened, for its icon
  kind text not null check (kind in ('posted', 'failed', 'ready', 'results', 'live', 'plan', 'account')),
  title text not null,
  body text,
  href text,
  -- the same event never notifies twice
  key text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (user_id, key)
);
create index notifications_user_created on public.notifications (user_id, created_at desc);

-- each worker process, checking in while it runs; only the server reads it
create table public.workers (
  id text primary key,
  started_at timestamptz not null default now(),
  seen_at timestamptz not null default now(),
  -- the Short it's rendering right now, if any
  rendering uuid
);

alter table public.videos
  -- when it went up to YouTube, and when it went to TikTok
  add column uploaded_at timestamptz,
  add column tiktok_posted_at timestamptz;

alter table public.notifications enable row level security;
alter table public.workers enable row level security;

grant select, update on public.notifications to authenticated;
-- the workers table is the server's alone, even where new tables are granted to everyone by default
revoke all on public.workers from anon, authenticated;

-- people read their own, and mark them read; only the server writes them
create policy "own notifications" on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy "mark own notifications read" on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
