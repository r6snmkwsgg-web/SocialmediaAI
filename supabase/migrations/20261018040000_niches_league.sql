-- One niche per channel, and Ball League seasons. The creator picks what
-- each YouTube channel is about, and that channel only gets Shorts about
-- it; an account's own Shorts have one too, while it has no channel. Each
-- channel keeps its own note on why its last Shorts couldn't all be made,
-- since one niche can run dry while another never does. Only the server
-- writes the league, and a league Short is the match it was made from.
-- The seed of a match nobody has played yet stays with the server, so no
-- one can know a result before it's played.

-- what each channel is about: an id from lib/shorts/niches.ts. Null, or one the code doesn't know, reads as not
-- picked: a mix of everything. Only its length is checked, so the list can change without a migration
alter table public.channels
  add column niche text check (char_length(niche) <= 24),
  -- why the channel's last Shorts couldn't all be made, in plain words, and since when; only the server writes these
  add column shorts_note text,
  add column shorts_note_at timestamptz;
grant update (niche) on public.channels to authenticated;
-- the same, for an account's own Shorts while it has no YouTube channel (profiles already has its note)
alter table public.profiles add column niche text check (char_length(niche) <= 24);

-- a channel's Ball League: its eight named balls, the same every season
create table public.leagues (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- null: an account's own Shorts, before any YouTube channel is connected
  channel_id uuid,
  -- the eight balls, [{ slot, name, color, power }], one of each power
  balls jsonb not null,
  created_at timestamptz not null default now(),
  foreign key (channel_id, user_id) references public.channels (id, user_id) on delete cascade,
  unique nulls not distinct (user_id, channel_id),
  unique (id, user_id)
);

create table public.league_seasons (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  number integer not null check (number >= 1),
  status text not null default 'running' check (status in ('running', 'done', 'stopped')),
  -- each power's starting health, as the league's table stood when the season began
  health jsonb not null,
  -- how ties are broken: the cast's slots in an order drawn when the season began
  lots integer[] not null,
  -- the tune every match of the season plays
  tune text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  -- why it stopped before its final: the channel changed what it's about
  stopped_reason text check (stopped_reason in ('niche')),
  -- the slot that won its final
  champion integer check (champion between 0 and 7),
  foreign key (league_id, user_id) references public.leagues (id, user_id) on delete cascade,
  unique (league_id, number),
  unique (id, user_id),
  check (champion is null or status = 'done'),
  check (stopped_reason is null or status = 'stopped')
);
-- one season at a time
create unique index league_seasons_running on public.league_seasons (league_id) where status = 'running';
-- so deleting an account finds its seasons without reading everyone's
create index league_seasons_user on public.league_seasons (user_id);

create table public.league_matches (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- 1 to 28 the round robin, 29 and 30 the semi-finals, 31 the final, played in this order
  number integer not null check (number between 1 and 31),
  stage text not null check (stage in ('round', 'semi', 'final')),
  round integer check (round between 1 and 7),
  -- cast slots, a on the left; a knockout's are set when it's played
  a integer check (a between 0 and 7),
  b integer check (b between 0 and 7),
  -- drawn at random when the season began, before any fight was run, and used in order. Only the server
  -- reads them: a played match's seeds are in games
  seeds integer[] not null check (cardinality(seeds) between 1 and 24),
  -- each game as it was run: [{ seed, winner (slot or null), frame, byTimeout, hp: [a, b] }]
  games jsonb,
  -- null for a drawn round robin match
  winner integer check (winner between 0 and 7),
  -- when it was run: it counts from then, posted or not
  played_at timestamptz,
  video_id uuid references public.videos (id) on delete set null,
  foreign key (season_id, user_id) references public.league_seasons (id, user_id) on delete cascade,
  unique (season_id, number),
  check (stage = case when number <= 28 then 'round' when number <= 30 then 'semi' else 'final' end),
  check (a is null or a is distinct from b),
  check ((games is null) = (played_at is null)),
  check (winner is null or played_at is not null)
);
create index league_matches_video on public.league_matches (video_id) where video_id is not null;
-- and its matches, which add up season after season
create index league_matches_user on public.league_matches (user_id);

alter table public.leagues enable row level security;
alter table public.league_seasons enable row level security;
alter table public.league_matches enable row level security;
-- people read their own league; only the server writes it, even where new tables are granted to everyone by default
revoke all on public.leagues, public.league_seasons, public.league_matches from anon, authenticated;
grant select on public.leagues, public.league_seasons to authenticated;
-- every column but seeds, so nobody can work out a match before it's played
grant select (id, season_id, user_id, number, stage, round, a, b, games, winner, played_at, video_id) on public.league_matches to authenticated;
create policy "read own leagues" on public.leagues for select to authenticated using (user_id = (select auth.uid()));
create policy "read own seasons" on public.league_seasons for select to authenticated using (user_id = (select auth.uid()));
create policy "read own matches" on public.league_matches for select to authenticated using (user_id = (select auth.uid()));
select public.server_only('public.leagues');
select public.server_only('public.league_seasons');
select public.server_only('public.league_matches');

-- ball names are claimed like everything else, while there are new ones to draw
alter table public.content_ledger drop constraint content_ledger_kind_check;
alter table public.content_ledger add constraint content_ledger_kind_check
  check (kind in ('battle', 'quiz', 'wyr', 'texts', 'ranking', 'race', 'look', 'cast'));

-- the morning run can find a league channel with a day's matches still waiting for a swipe
alter table public.shorts_runs drop constraint shorts_runs_outcome_check;
alter table public.shorts_runs add constraint shorts_runs_outcome_check
  check (outcome in ('made', 'allowance', 'nothing_new', 'failed', 'waiting'));

-- A Ball League Short is the match it was made from: only the server
-- makes one, and the creator can only change whether it asks for
-- comments, besides its title and choices like any Short's. What YouTube
-- said stays with guard_video_facts; this holds only the league's rule.
create function public.guard_league_video() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.params ? 'league' then
      raise exception 'only the server makes Ball League Shorts' using errcode = '42501';
    end if;
  elsif (old.params ? 'league' or new.params ? 'league') and (new.format is distinct from old.format
    or (new.params - 'allowComments') is distinct from (old.params - 'allowComments')) then
    raise exception 'a Ball League Short is the match it was made from' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger guard_league_video before insert or update on public.videos
  for each row execute function public.guard_league_video();
