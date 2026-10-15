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

## Where things are

- `lib/battle/` the simulation (`sim.ts`), abilities, picking the best run (`drama.ts`), the video timeline and the soundtrack
- `remotion/` the video itself, used both by the browser player and the renderer
- `app/`, `components/` the website
- `scripts/balance.ts` every matchup run many times, to check no ability is unbeatable

Remotion is free for individuals and companies of up to three people; check its license before the team grows.
