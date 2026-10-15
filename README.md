# Hookline

You swipe, it posts. Hookline makes Shorts that need no face, no voice and no AI video: every frame is drawn by code.

The first format is **ball battles**: two balls with different abilities fight in an arena with real physics. Each matchup is run many times and the most dramatic run is kept (lead changes, a close finish, a comeback), then rendered with slow motion on the deciding hit and a soundtrack generated in code from public-domain tunes.

## Run it

```bash
pnpm install
pnpm dev                      # the site, with live battles in the browser
pnpm test                     # the simulation, drama picking, timeline and sound
pnpm render fibonacci spike   # an MP4 in out/, best of 60 runs
```

Rendering needs Chrome. Set `CHROME_PATH` if Remotion can't find one.

## Live battles, for TikTok LIVE

The same fight, run in real time on a streamer's LIVE. Viewers type 1 or 2 to pick a side; likes, shares, follows and gifts land in the fight (heals, balls with the gifter's face, rage, shields, meteors). Rounds repeat with a new matchup and a running series score.

- `/live` the page for streamers: what gifts do, and the setup with a connection check
- `/live/play` the game itself, for an OBS browser source at 1080 × 1920. `?src=tikfinity` or `?src=bridge` to listen to a LIVE, `?demo=1` for pretend viewers, `?clean=1` to hide the hints. On the game: T test panel, D demo, M mute, F full screen.

It hears the LIVE through something on the streamer's computer:

- **TikFinity** (the desktop app), on its local event connection, `ws://localhost:21213`
- **Hookline's bridge**: `pnpm live:bridge <tiktok username>` connects with `tiktok-live-connector` and serves `ws://localhost:21214`. Signing goes through Euler Stream; pass `--key` or set `EULER_API_KEY` if it starts refusing.

## Where things are

- `lib/battle/` the simulation (`sim.ts`), abilities, picking the best run (`drama.ts`), the video timeline and the soundtrack
- `remotion/` the video itself, used both by the browser player and the renderer
- `lib/live/` live battles: reading TikTok events (`events.ts`), what each thing is worth (`rules.ts`), and the show itself, round after round (`round.ts`)
- `components/live/` the live game's canvas, sound and connection
- `app/`, `components/` the website
- `scripts/balance.ts` every matchup run many times, to check no ability is unbeatable

Remotion is free for individuals and companies of up to three people; check its license before the team grows.
