-- The content ledger: every question, choice, story, chart and fight a
-- Short is made from, and who has it, so nothing ever goes to two
-- channels. YouTube won't pay a channel that posts what other channels
-- post, so no two Hookline channels ever get the same thing. Each
-- channel's look is claimed here too, so no two look the same. Only the
-- server reads or writes it.

create table public.content_ledger (
  -- what was used: a question or choice id, a countdown's countries in order ('ranking:gdp:Asia:CHN,JPN,IND'),
  -- a race's top countries at the start and the finish ('race:population:Asia:CHN,IND>IND,CHN'), a fight ('battle:spike:sword:4817'), 'look:12'
  item text primary key,
  kind text not null check (kind in ('battle', 'quiz', 'wyr', 'texts', 'ranking', 'race', 'look')),
  -- who has it; kept when they delete their account, since their videos stay up
  user_id uuid references auth.users (id) on delete set null,
  claimed_at timestamptz not null default now(),
  -- for a question, choice or story: the words that carry its meaning, so the same thing in other words is caught too
  words text[]
);
create index content_ledger_kind_user on public.content_ledger (kind, user_id);
create index content_ledger_words on public.content_ledger using gin (words) where words is not null;

alter table public.content_ledger enable row level security;
-- the server's alone, even where new tables are granted to everyone by default
revoke all on public.content_ledger from anon, authenticated;

alter table public.profiles
  -- text stories are off until the creator turns them on: YouTube is least keen to pay for scrolling text
  add column text_stories boolean not null default false,
  -- why the last Shorts couldn't all be made, in plain words, and since when; cleared once they can
  add column shorts_note text,
  add column shorts_note_at timestamptz;

-- everything already made, oldest first, so what's already on a channel never goes to another
insert into public.content_ledger (item, kind, user_id, claimed_at)
select item, kind, user_id, created_at from (
  select q->>'id' as item, 'quiz' as kind, v.user_id, v.created_at
  from public.videos v
  cross join lateral jsonb_array_elements(case when jsonb_typeof(v.params->'questions') = 'array' then v.params->'questions' else '[]'::jsonb end) q
  where v.format = 'quiz'
  union all
  select p->>'id', 'wyr', v.user_id, v.created_at
  from public.videos v
  cross join lateral jsonb_array_elements(case when jsonb_typeof(v.params->'pairs') = 'array' then v.params->'pairs' else '[]'::jsonb end) p
  where v.format = 'wyr'
  union all
  select v.params->'story'->>'id', 'texts', v.user_id, v.created_at from public.videos v where v.format = 'texts'
  union all
  -- a countdown: its countries in the order shown
  select 'ranking:' || (v.params->>'metric') || ':' || (v.params->>'region') || ':' ||
    (select string_agg(i->>'iso', ',' order by n) from jsonb_array_elements(v.params->'items') with ordinality as x (i, n)), 'ranking', v.user_id, v.created_at
  from public.videos v where v.format = 'ranking' and jsonb_typeof(v.params->'items') = 'array'
  union all
  -- a race: its top countries, biggest first, in its first year and its last
  select 'race:' || (v.params->>'metric') || ':' || (v.params->>'region') || ':' ||
    (select string_agg(iso, ',' order by value desc, iso) from (
      select s->>'iso' as iso, (s->'values'->>0)::float8 as value from jsonb_array_elements(v.params->'series') s
      where s->'values'->>0 is not null order by value desc, iso limit (v.params->>'top')::int) first_year) || '>' ||
    (select string_agg(iso, ',' order by value desc, iso) from (
      select s->>'iso' as iso, (s->'values'->>-1)::float8 as value from jsonb_array_elements(v.params->'series') s
      where s->'values'->>-1 is not null order by value desc, iso limit (v.params->>'top')::int) last_year), 'race', v.user_id, v.created_at
  from public.videos v where v.format = 'race' and jsonb_typeof(v.params->'series') = 'array'
  union all
  select 'battle:' || (v.params->>'a') || ':' || (v.params->>'b') || ':' || (v.params->>'seed'), 'battle', v.user_id, v.created_at
  from public.videos v where v.format = 'battle'
) used
where item is not null
order by created_at
on conflict (item) do nothing;
