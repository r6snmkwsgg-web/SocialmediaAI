-- Posting only what's true. A Short counts as posted on YouTube once
-- YouTube says it's processed and can be seen as the creator chose; a
-- link someone pastes counts once it's checked to be on their own
-- channel. Each YouTube channel says who its Shorts are for (made for
-- kids or not, asked with nothing picked) and who sees them, and every
-- one of those choices is kept. TikTok gets a copy without the free
-- plan's tag.

alter table public.channels
  -- the creator's answer to "is this channel made for kids?"; nothing posts to YouTube until there is one
  add column made_for_kids boolean,
  -- who sees new Shorts on YouTube
  add column privacy text not null default 'public' check (privacy in ('public', 'unlisted', 'private')),
  -- YouTube's own verdict on the channel, read when it's connected
  add column youtube_kids boolean;

-- A channel is an account Google or TikTok said is theirs, so only the
-- server (connecting it) adds one or changes which account it is: a
-- channel id typed in by hand would pass the "I posted it" check and the
-- test-channel gate. People answer its questions and can disconnect it.
revoke insert, update on public.channels from anon, authenticated;
grant update (made_for_kids, privacy) on public.channels to authenticated;

alter table public.videos
  -- who this Short is for, as decided when it was approved: the channel's answer or the creator's choice for it
  add column made_for_kids boolean,
  -- Hookline knows the YouTube video is on one of the creator's own channels: it uploaded it, or checked the link.
  -- Only these count in views and learning.
  add column youtube_verified boolean not null default false,
  -- what YouTube last said: its upload status (uploaded, processed, rejected, failed, deleted), who can see it,
  -- whether it's made for kids by YouTube's reckoning, and when it was asked
  add column youtube_status text,
  add column youtube_privacy text,
  add column youtube_kids boolean,
  add column youtube_checked_at timestamptz,
  -- how Hookline uploaded it: who it was for (the channel's choice then), and the time it was set
  -- to go public when it went up private until then
  add column youtube_wanted text check (youtube_wanted in ('public', 'unlisted', 'private')),
  add column youtube_publish_at timestamptz,
  -- the same video without the free plan's tag: TikTok doesn't allow app watermarks
  add column clean_path text;

-- a render that only makes the copy without the tag, for a Short made before it was needed
alter table public.render_jobs add column clean boolean not null default false;

-- Shorts uploaded before this were uploaded by Hookline, to the creator's own channel, as public;
-- those not due within 15 minutes went up private until their time
update public.videos set youtube_verified = true, youtube_wanted = 'public',
  youtube_publish_at = case when scheduled_for > uploaded_at + interval '15 minutes' then scheduled_for end
where youtube_id is not null and uploaded_at is not null;

-- every audience choice: who made it, for which channel or Short, and when
create table public.audience_log (
  id bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  channel_id uuid references public.channels (id) on delete set null,
  video_id uuid references public.videos (id) on delete set null,
  -- 'channel' when answered for a channel, 'short' when approved with a Short
  source text not null check (source in ('channel', 'short')),
  made_for_kids boolean not null,
  -- who sees new Shorts, when it was a channel's answer
  privacy text check (privacy in ('public', 'unlisted', 'private')),
  created_at timestamptz not null default now()
);
create index audience_log_user on public.audience_log (user_id, created_at desc);

alter table public.audience_log enable row level security;
-- only the server reads it, even where new tables are granted to everyone by default
revoke all on public.audience_log from anon, authenticated;
revoke all on sequence public.audience_log_id_seq from anon, authenticated;

-- Choices are written down by the database itself as they're saved, so
-- none is missed whichever way it was made. Who made it is the signed-in
-- person when there is one, and otherwise the account it belongs to.
create or replace function public.log_audience() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'channels' then
    insert into public.audience_log (user_id, channel_id, source, made_for_kids, privacy)
    values (coalesce(auth.uid(), new.user_id), new.id, 'channel', new.made_for_kids, new.privacy);
  else
    insert into public.audience_log (user_id, channel_id, video_id, source, made_for_kids)
    values (coalesce(auth.uid(), new.user_id), new.channel_id, new.id, 'short', new.made_for_kids);
  end if;
  return null;
end;
$$;
revoke all on function public.log_audience() from public, anon, authenticated;

create trigger log_channel_audience after insert or update of made_for_kids, privacy on public.channels
  for each row when (new.made_for_kids is not null) execute function public.log_audience();
create trigger log_short_audience after update of made_for_kids on public.videos
  for each row when (new.made_for_kids is not null and new.made_for_kids is distinct from old.made_for_kids)
  execute function public.log_audience();

-- What YouTube said about a video, and the copy for TikTok, are the
-- server's to record. People can still change their own Shorts' titles
-- and choices, but not claim a YouTube video is theirs without the check.
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
  end if;
  return new;
end;
$$;

create trigger guard_video_facts before insert or update on public.videos
  for each row execute function public.guard_video_facts();
