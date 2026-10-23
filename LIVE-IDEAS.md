# TikTok LIVE coach — idea notes (2026-10-23)

Not started. A standalone product for TikTok LIVE creators, spun out of
Hookline's LIVE code (engine, games, bridge app, clipper). Hookline stays the
"Shorts on autopilot" product; this one is only about going LIVE and growing
from it.

## The pitch

"Whatever you stream, it shows you what's working and coaches you to grow."

For every kind of streamer: gaming, just chatting, music, selling, IRL. The
gift-controlled ball games are one optional extra, not the centre: plenty of
streamers would rather stream a video game.

Launch video idea: "This is how I got 42,000 followers live streaming on
TikTok." Only works if it's true and the product is what did it; otherwise
change the angle.

## Features

Matt's ideas:

1. **Auto clips from every stream.** After a LIVE, find the best moments and
   hand back vertical clips with captions, title and hashtags, ready to post.
   - Getting the video: the desktop bridge picks up the OBS / LIVE Studio
     recording when the stream ends (PC); phone streamers upload their LIVE
     replay.
   - Finding moments: the stream's event timeline (gift, comment, follow and
     viewer spikes) + loud/hype audio + an AI pass over the transcript.
   - Reuse Hookline's clipper and Remotion rendering.
2. **Teach them to stream, plus an AI coach that tracks how they do.**
   - Step-by-step course from zero to first LIVE.
   - During the stream: an on-screen coach window ("viewers dropping, ask a
     question", "say hi to the 5 new people", "10 minutes without a follow
     ask").
   - After: a report card — when people stayed, followed and gifted, and
     what to change next time.
3. **TikFinity connection.** Work alongside it, not against it. Check what
   TikFinity can send to other apps; if nothing, our bridge reads the same
   events.
4. **Setup help.** Guided checklist for PC, console and phone: LIVE Studio,
   OBS, capture cards, audio, and a "test my setup" button.

More ideas:

- **Pre-LIVE kit:** teaser post text, best time to go live, a reminder.
- **Thank-you list** after each stream: top gifters and new followers to
  shout out next time.
- **Earnings tracker:** diamonds → dollars per stream, streaks and goals.
- **LIVE eligibility path:** TikTok needs 1,000 followers and 18+ to go
  live; guide people under 1,000 there (a big audience the stats tools skip).
- **Battle (LIVE Match) stats:** win rate, best times, what each earned.
- **Benchmarks:** "streams like yours average X viewers", from our own users'
  anonymised data.
- **Gamers:** which games are hot or under-served on TikTok LIVE right now;
  on-screen gift/follow alerts while they play.
- **Audience games mode:** the Hookline battles for chatting streams or slow
  moments.

## Build order (when it starts)

1. Bridge + post-stream report card (data from day one)
2. Auto clips (the result people pay for and post about)
3. Setup guide + course
4. Live coach + TikFinity connection
5. Trends and benchmarks, once there are enough users

## Cautions

- TikTok has no official API for LIVE data; tools like this (and Hookline's
  bridge) use unofficial connections that TikTok could break. Use only data
  from users' own streams, with their permission. Don't scrape other people's
  LIVEs.
- Focus: this would be product #4. Building it on Hookline's LIVE code keeps
  it cheap.

## What already exists (researched 2026-10-23)

- LIVE stats trackers, numbers but no coaching: TikTokStats, TikMonitor,
  TingTalks, EchoTik, TikTok's own LIVE Center.
- Trend tools for videos/hashtags/sounds, not LIVE: Pentos, Exolyt.
- Teaching: only courses and communities, mostly TikTok Shop live selling —
  e.g. Girl Go Live Academy (Skool, $99/mo), a $150 Stan course, a $35
  Gumroad workbook. No app found that teaches going LIVE and coaches you
  while you do.
