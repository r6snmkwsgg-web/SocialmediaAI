-- Which terms each account agreed to, and when. Asked right after signing
-- up, with the first question in the app; when the terms change, the app
-- asks again (lib/legal.ts holds the version it wants). The LIVE games'
-- age question is gone: the terms say they're for 18 and over, so the old
-- answers' "adult" no longer counts and is dropped from them.

alter table public.profiles
  add column terms_version text check (char_length(terms_version) <= 20),
  add column terms_accepted_at timestamptz;

update public.profiles set live_check = live_check - 'adult' where live_check ? 'adult';
update public.profiles set yt_live_check = yt_live_check - 'adult' where yt_live_check ? 'adult';
