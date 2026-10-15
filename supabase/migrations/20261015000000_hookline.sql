-- Hookline's database. Every table belongs to a user and row-level
-- security keeps each user to their own rows; the server's own work
-- (webhooks, crons, the render worker) runs as the table owner, which
-- RLS doesn't apply to. Secrets (OAuth tokens, Stripe keys) are stored
-- encrypted by the app, and the tables that hold them have no policies
-- at all, so no signed-in user can read them.

create extension if not exists pgcrypto;

-- ── people ──

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  name text,
  goal text check (goal in ('shorts', 'live', 'both')),
  -- for posting times and "today"; set from the browser at sign-up
  timezone text not null default 'UTC',
  onboarded_at timestamptz,
  created_at timestamptz not null default now()
);

-- a profile for everyone who signs up
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email) on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── billing ──

create table public.subscriptions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  plan text not null default 'free' check (plan in ('free', 'pro', 'creator')),
  "interval" text check ("interval" in ('month', 'year')),
  status text not null default 'none',
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  updated_at timestamptz not null default now()
);

-- every Stripe event handled, so a retried webhook does nothing twice
create table public.stripe_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);

-- ── connected accounts ──

create table public.channels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  platform text not null check (platform in ('youtube', 'tiktok')),
  external_id text not null,
  title text,
  handle text,
  avatar_url text,
  status text not null default 'connected' check (status in ('connected', 'expired', 'revoked')),
  connected_at timestamptz not null default now(),
  unique (user_id, platform, external_id)
);

create table public.channel_tokens (
  channel_id uuid primary key references public.channels (id) on delete cascade,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  scopes text
);

-- a seller's read-only Stripe key, for the money they make selling things
create table public.stripe_keys (
  user_id uuid primary key references auth.users (id) on delete cascade,
  key text not null,
  account_name text,
  connected_at timestamptz not null default now()
);

-- ── live ──

create table public.live_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- the private key in a streamer's game address: it reads their settings and saves their stats
create table public.overlay_keys (
  user_id uuid primary key references auth.users (id) on delete cascade,
  key text not null unique,
  created_at timestamptz not null default now()
);

create table public.live_sessions (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  game text not null,
  -- when a real viewer first and last did something
  started_at timestamptz not null,
  last_event_at timestamptz,
  updated_at timestamptz not null default now(),
  rounds integer not null default 0,
  coins integer not null default 0,
  peak_players integer not null default 0,
  top_gifters jsonb not null default '[]'::jsonb
);
create index live_sessions_user_started on public.live_sessions (user_id, started_at desc);

-- ── shorts ──

create table public.videos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  channel_id uuid references public.channels (id) on delete set null,
  format text not null,
  params jsonb not null,
  -- what the learning loop tracks, like 'battle:spike:sword' or 'quiz:capitals'
  key text not null,
  title text not null,
  description text not null default '',
  why jsonb not null default '[]'::jsonb,
  status text not null default 'review'
    check (status in ('review', 'rejected', 'approved', 'rendering', 'ready', 'scheduled', 'posted', 'failed')),
  -- a day's Shorts, or one made to replace a Short someone swiped away
  origin text not null default 'daily' check (origin in ('daily', 'replacement')),
  suggested_for timestamptz,
  scheduled_for timestamptz,
  file_path text,
  youtube_id text,
  tiktok_publish_id text,
  -- the creator's own choices for TikTok (who can see it, comments, Duet,
  -- Stitch, brand disclosure), made each time, as TikTok requires; when
  -- it goes there, and why it didn't if TikTok turned it down
  tiktok_post jsonb,
  tiktok_at timestamptz,
  tiktok_error text,
  error text,
  -- set while something is uploading it, so two posters never post it twice
  posting_at timestamptz,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  posted_at timestamptz
);
create index videos_user_status on public.videos (user_id, status, created_at desc);
create index videos_user_created on public.videos (user_id, created_at desc);

create table public.render_jobs (
  id bigserial primary key,
  video_id uuid not null references public.videos (id) on delete cascade,
  priority integer not null default 0,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  attempts integer not null default 0,
  progress real not null default 0,
  locked_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index render_jobs_queue on public.render_jobs (status, priority desc, created_at);
-- one job at a time per video
create unique index render_jobs_live on public.render_jobs (video_id) where status in ('queued', 'running');

create table public.video_stats (
  video_id uuid not null references public.videos (id) on delete cascade,
  checkpoint text not null check (checkpoint in ('1h', '24h', '72h')),
  views bigint not null,
  likes bigint,
  comments bigint,
  fetched_at timestamptz not null default now(),
  primary key (video_id, checkpoint)
);

-- what the learning loop has learned: how each format and key does on this account
create table public.weights (
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('format', 'key')),
  name text not null,
  score real not null default 1,
  samples integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, kind, name)
);

-- ── trends (shared by everyone) ──

create table public.trend_videos (
  platform text not null default 'youtube',
  external_id text not null,
  niche text not null,
  title text not null,
  channel_title text,
  url text not null,
  thumbnail text,
  published_at timestamptz not null,
  views bigint not null,
  views_per_hour real not null,
  format text not null,
  fetched_at timestamptz not null default now(),
  primary key (platform, external_id)
);
create index trend_videos_niche on public.trend_videos (niche, views_per_hour desc);

create table public.niches (
  user_id uuid not null references auth.users (id) on delete cascade,
  niche text not null,
  primary key (user_id, niche)
);

-- ── earnings ──

create table public.metrics (
  user_id uuid not null references auth.users (id) on delete cascade,
  source text not null,
  metric text not null,
  day date not null,
  value numeric not null,
  primary key (user_id, source, metric, day)
);

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source text not null,
  metric text not null,
  target numeric not null check (target > 0),
  period text not null check (period in ('month', 'all')),
  label text not null,
  created_at timestamptz not null default now()
);

-- ── who can see what ──

do $$
declare t text;
begin
  foreach t in array array['profiles', 'subscriptions', 'stripe_events', 'channels', 'channel_tokens', 'stripe_keys',
    'live_settings', 'overlay_keys', 'live_sessions', 'videos', 'render_jobs', 'video_stats', 'weights',
    'trend_videos', 'niches', 'metrics', 'goals']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

create policy "own profile" on public.profiles for all to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- billing is written by the Stripe webhook only; people can read their own
create policy "read own subscription" on public.subscriptions for select to authenticated
  using (user_id = (select auth.uid()));

create policy "own channels" on public.channels for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own live settings" on public.live_settings for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own overlay key" on public.overlay_keys for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own live sessions" on public.live_sessions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own videos" on public.videos for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own weights" on public.weights for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own niches" on public.niches for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own metrics" on public.metrics for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own goals" on public.goals for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- render progress and video stats, for videos people own
create policy "own render jobs" on public.render_jobs for select to authenticated
  using (exists (select 1 from public.videos v where v.id = video_id and v.user_id = (select auth.uid())));
create policy "own video stats" on public.video_stats for select to authenticated
  using (exists (select 1 from public.videos v where v.id = video_id and v.user_id = (select auth.uid())));

-- trends are the same for everyone signed in
create policy "trends for everyone" on public.trend_videos for select to authenticated using (true);

-- channel_tokens, stripe_keys and stripe_events have no policies: nobody signed in can read them
