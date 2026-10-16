# Hookline

Content that makes itself. Lives that pay.

Hookline is one place to make money from short video and TikTok LIVE, in four sections:

- **Shorts**: every morning, a few faceless Shorts drawn by code (ball battles, quizzes, would you rather, text stories, rankings, bar-chart races). Swipe right to keep one, left to bin it. Kept ones are rendered, titled by Claude and posted to YouTube and TikTok at the channel's best times, and whatever does well gets made more.
- **Live**: games for a TikTok LIVE that viewers play with chat and gifts (a ball battle, Rivals, Ball Race, Last One Standing), with a vote for the next round, settings per account and each session's real numbers. In Rivals the sides are a new rivalry every round, like Messi vs Ronaldo, and each side has its own gifts.
- **Trends**: the Shorts growing fastest right now in the niches you follow, from YouTube's official API, the hours your own Shorts do best, and which formats are working.
- **Earnings**: real figures from YouTube, TikTok, the LIVE games and Stripe, one chart per measure, with goals.

Why things are the way they are is in [DECISIONS.md](DECISIONS.md). What's waiting on someone else (app reviews, accounts to create) is in [NEXT.md](NEXT.md). Screenshots of every screen are in [docs/screens](docs/screens).

## Run it on your computer

You need Node 22, pnpm 10, Postgres 16 and, for rendering videos, Chrome.

```bash
pnpm install
cp .env.example .env.local
```

In `.env.local`, set at least:

```bash
DATABASE_URL=postgres://postgres:<password>@127.0.0.1:5432/hookline
TOKEN_KEY=<the output of: openssl rand -base64 32>
HOOKLINE_DEV_LOGIN=1
```

Then make the database and start everything:

```bash
createdb hookline
pnpm db:migrate --local       # the few bits of Supabase the tables need, then the tables
pnpm dev                      # http://localhost:3000
pnpm worker                   # in a second terminal: rendering, posting and the other background jobs
```

`HOOKLINE_DEV_LOGIN=1` puts a "sign in without email" button on `/login`, so the whole app works offline without Supabase. It only works in development; a production build ignores it.

Everything else is optional. A service that isn't set up says so where it's needed, and the rest of the app works. Put your own email in `ADMIN_EMAILS` and `/admin` shows what's set up and what isn't.

Inside the app, Ctrl K (⌘K on a Mac) jumps anywhere.

## Settings

Every setting is in [.env.example](.env.example), with what it's for. Locally they go in `.env.local`. In a deploy they go in the host's environment: Vercel for the app, and the same values wherever the worker runs. Never commit real values.

| What | Settings | What it switches on |
| --- | --- | --- |
| Database | `DATABASE_URL` | Required. In a deploy, Supabase's "Transaction pooler" connection string. |
| Encryption | `TOKEN_KEY` | Required to connect accounts: OAuth tokens and Stripe keys are encrypted with it. |
| Site address | `NEXT_PUBLIC_SITE_URL` | Sign-in links, OAuth redirects, the sitemap and share images. |
| Supabase | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Sign-in by email link and Google, video storage, deleting accounts. |
| Stripe | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, the four `STRIPE_PRICE_*` | The Pro and Creator plans. |
| Claude | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Titles and descriptions, and new quiz questions, would-you-rathers and text stories for each channel. Without them, each format writes its own plain title and uses its built-in questions and choices, which run out. |
| Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Connecting YouTube channels: posting, views and analytics. |
| YouTube data | `YOUTUBE_API_KEY` | Trends, and checking the links people paste. |
| YouTube audit | `YOUTUBE_TEST_CHANNELS`, `YOUTUBE_AUDITED` | Which channels Hookline uploads to: only the test channels until YouTube's API audit passes, then all of them. |
| TikTok | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_DIRECT_POST`, `TIKTOK_PROFILE` | Connecting TikTok: Shorts to the creator's drafts, or posted straight to their TikTok; with `TIKTOK_PROFILE=1`, the username that makes a LIVE count as theirs. |
| Scheduler | `CRON_SECRET` | The `/api/cron/*` routes, for a scheduler running the background jobs. |
| Bridge | `NEXT_PUBLIC_BRIDGE_REPO`, `EULER_API_KEY`, `BRIDGE_OFF` | Where the bridge downloads come from, a signing key if TikTok starts refusing it, and `BRIDGE_OFF=1` to switch every bridge off (games move to TikFinity). |
| Rendering | `CHROME_PATH` | The Chrome the worker renders with, if not Remotion's own. |
| Contact | `NEXT_PUBLIC_CONTACT_EMAIL` | Shown on the privacy and terms pages. |
| Admin | `ADMIN_EMAILS` | Who can open `/admin`: sign-ups, plans, revenue, the render queue and problems. |

## Setting up the services

Wherever this says `https://<site>`, use the site's real address, and `http://localhost:3000` as well while developing.

### Supabase

1. Make a project. From its settings, the URL and anon key go in `NEXT_PUBLIC_SUPABASE_*`, the service role key in `SUPABASE_SERVICE_ROLE_KEY`, and the "Transaction pooler" connection string (Connect, at the top) in `DATABASE_URL`.
2. Run the migrations on it: `pnpm db:migrate` with that `DATABASE_URL` in `.env.local`, or `supabase db push` with Supabase's CLI.
3. Authentication, URL Configuration: the Site URL is `https://<site>`, and `https://<site>/auth/callback` goes in Redirect URLs.
4. Authentication, Emails: in both the "Confirm signup" and "Magic Link" templates, make the link
   `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email`
   so a link still signs in when it's opened on a different device from the one that asked for it.
5. Authentication, Providers: Email on, and Google on with a Google OAuth client whose redirect URI is the one Supabase shows (`https://<project>.supabase.co/auth/v1/callback`).
6. Videos are kept in a private storage bucket called `videos`, made automatically the first time one is saved.

### Stripe

1. Two products: **Pro** with a monthly price of `$19` and a yearly one of `$190`, and **Creator** with `$49` a month and `$490` a year. Each price's ID goes in its `STRIPE_PRICE_*` setting.
2. Developers, Webhooks: an endpoint at `https://<site>/api/stripe/webhook` with the events `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated` and `customer.subscription.deleted`. Its signing secret goes in `STRIPE_WEBHOOK_SECRET`.
3. Settings, Billing, Customer portal: allow updating cards, cancelling, and switching between the four prices. Anyone already paying changes plan there.
4. Locally, `stripe listen --forward-to localhost:3000/api/stripe/webhook` prints a webhook secret to use.

### Google and YouTube

1. A Google Cloud project with the **YouTube Data API v3** and the **YouTube Analytics API** turned on.
2. An OAuth consent screen with the scopes `youtube.upload`, `youtube.readonly`, `yt-analytics.readonly` and `yt-analytics-monetary.readonly`.
3. An OAuth client (Web application) with the redirect URI `https://<site>/api/connect/youtube/callback`; its ID and secret go in `GOOGLE_*`. The same client can be the one Supabase uses for Google sign-in, with Supabase's redirect URI added to it.
4. An API key restricted to the YouTube Data API, in `YOUTUBE_API_KEY`.

Until Google verifies the app and YouTube audits it, only test users can connect and uploads stay private, so Hookline only uploads to the channels in `YOUTUBE_TEST_CHANNELS` and everyone else posts their own. NEXT.md has the steps.

### TikTok

1. At developers.tiktok.com, an app with **Login Kit** and the **Content Posting API**, and the redirect URI `https://<site>/api/connect/tiktok/callback`.
2. The scopes `user.info.basic`, `video.list` and `video.upload`, plus `video.publish` once direct posting is approved, and `user.info.profile` (the username, which is how a LIVE is checked as the creator's own) once `TIKTOK_PROFILE=1`. Add a scope to the app before switching it on: TikTok refuses the sign-in over one the app doesn't have.
3. The client key and secret go in `TIKTOK_CLIENT_*`. Without `TIKTOK_DIRECT_POST`, Shorts go to the creator's TikTok drafts. With `TIKTOK_DIRECT_POST=1` they post straight to TikTok, after the creator answers TikTok's questions for each one; until TikTok's Direct Post audit passes, that only works for private accounts and the posts stay private.

### Claude

An API key from the Anthropic Console in `ANTHROPIC_API_KEY`, and the ID of the model that writes the titles and the new quiz questions, would-you-rathers and stories in `ANTHROPIC_MODEL`. Both are needed; with either missing, Shorts keep their plain titles and only use the built-in banks.

## Deploying

- **The app** goes on Vercel as a normal Next.js project, with the settings above in its environment.
- **The worker** runs anywhere that keeps a process going and can run Chrome: a small server, Fly.io, Railway or Render. `worker/Dockerfile` builds it from the repo's root:

  ```bash
  docker build -f worker/Dockerfile -t hookline-worker .
  docker run --env-file .env.worker hookline-worker
  ```

  It takes the same settings as the app. Give it about 2 GB of memory.

## The render worker

`pnpm worker` (`worker/main.ts`) is the long-running part that Vercel can't host. It bundles the videos once, then:

- renders approved Shorts with Remotion, one at a time, paid plans first, and saves them to storage
- posts whatever is due, every minute
- makes each channel's Shorts for the day, from 6am in its timezone
- reads views 1 hour, 1 day and 3 days after posting, for the learning loop
- refreshes Trends (each niche every 4 hours) and syncs Earnings every 6 hours
- sends each LIVE's recap once it's been quiet for 20 minutes
- checks in every 30 seconds, so the app can say when rendering has stopped and `/admin` can show the workers

Run more workers for more renders at once; each one claims its own job. A failed render is tried 3 times. The worker finds Chrome by itself, or uses `CHROME_PATH` (Chrome or Chrome Headless Shell).

A scheduler can run the periodic jobs instead: `GET /api/cron/post`, `/api/cron/stats`, `/api/cron/shorts`, `/api/cron/trends`, `/api/cron/earnings` and `/api/cron/live`, with `Authorization: Bearer <CRON_SECRET>`. Rendering always needs the worker. Running both is safe, since each job locks what it works on.

## The LIVE bridge

The LIVE games hear a stream through something on the streamer's computer: **TikFinity** (`ws://localhost:21213`) or **Hookline Bridge** (`ws://localhost:21214`), a small program that connects to the TikTok LIVE with `tiktok-live-connector`.

- From source: `pnpm live:bridge [username] [--port 21214] [--key <Euler Stream key>]`.
- For streamers it's one program to download and double-click. The setup on `/live` and `/app/live` finds it, tells it which account to connect to and checks the connection. It remembers the account in `~/.hookline-bridge.json`.
- `pnpm bridge:build` builds it into `dist-bridge/` for the computer it runs on, as a Node single executable. `HOOKLINE_SITE=https://<site>` bakes in the site: only its pages and pages on the streamer's own computer can use the bridge, and the bridge asks the site's `/api/live/bridge` every 10 minutes whether it's been switched off (`--site` overrides it when run from source).
- To release it, push a tag like `bridge-v1.0.0`: `.github/workflows/bridge.yml` builds it for Windows, macOS (Apple silicon and Intel) and Linux and attaches them to a GitHub release. The setup page links to the latest release in `NEXT_PUBLIC_BRIDGE_REPO`.
- TikTok makes outside apps sign their connection. The connector does that through Euler Stream, which works without a key at low volume; if it starts refusing, get a free key at eulerstream.com and pass it with `--key` or `EULER_API_KEY`.

The game itself is `/live/play`, an OBS browser source at 1080 × 1920. Its address carries the streamer's private key from `/app/live`, so it plays with their settings. `?demo=1` adds pretend viewers and `?clean=1` hides the hints. On the game, T opens a test panel, D switches the demo, M mutes and F goes full screen.

## Scripts

```bash
pnpm dev                      # the app, for development (build and start for production)
pnpm check                    # types, lint, tests and a production build
pnpm worker                   # the render worker
pnpm db:migrate               # the migrations (--local for a plain Postgres, --local --reset to start over)
pnpm live:bridge              # the LIVE bridge from source
pnpm bridge:build             # the bridge as one program
pnpm render fibonacci spike   # one battle Short as an MP4 in out/, the best of 60 runs
pnpm stills                   # every Short format at five moments, as pictures in out/stills
pnpm og                       # the share images in public/og
pnpm icons                    # the home-screen icons, from app/icon.svg
pnpm data                     # fetches the World Bank figures in data/ again
pnpm screens [url]            # screenshots of every page into docs/screens (the app running with HOOKLINE_DEV_LOGIN=1)
```

## Tests

`pnpm test` runs everything in `tests/`. The database tests also run when `TEST_DATABASE_URL` points at a local database whose name ends in `_test`. They wipe it and build it again each time:

```bash
createdb hookline_test
TEST_DATABASE_URL=postgres://postgres:<password>@127.0.0.1:5432/hookline_test pnpm test
```

**Battles must stay frame-for-frame identical**, because the videos people approve and the live preview depend on it. `tests/battle.test.ts` hashes `simulate()` across every matchup with seeds 1, 2, 3, 4, 32, 66 and 98 and checks it's still `7033c6cb4fcab19a6aad1d96b36f1869ec009c4c8867b5ef53667d5072e34fe1`, so `pnpm test` fails if a change in `lib/battle/` changes any fight.

## Where things are

- `app/` the pages and routes: the website at the top, the signed-in app under `app/app/`, the operator's view under `app/admin/`, and webhooks, OAuth and the cron jobs under `app/api/`
- `components/` the website (`site/`), the app (`app/`), the LIVE games (`live/`) and the Shorts player and queue (`shorts/`)
- `lib/battle/` the ball battle: the simulation (`sim.ts`) and its own trig (`trig.ts`), picking the best run, the timeline and the soundtrack
- `lib/live/` the LIVE games: TikTok's events, the rules, the show round after round, the vote, settings and session numbers
- `lib/shorts/` the Shorts formats (`formats/`), real data, timing, sound, the learning loop and posting times
- `lib/trends/` and `lib/earnings/` the logic behind those sections
- `lib/server/` everything that touches the database or another service, on the server only
- `remotion/` the videos, used by both the browser player and the renderer
- `worker/` the render worker, and `bridge/` the LIVE bridge
- `supabase/migrations/` the database, and `supabase/local.sql` the bits of Supabase that a plain Postgres needs
- `data/` World Bank population and GDP, and the list of countries

## Licenses

- Remotion is free for individuals and companies of up to three people. A bigger company needs a Remotion company license.
- Anton, Bricolage Grotesque and Martian Mono are under the SIL Open Font License.
- Population and GDP are from the World Bank under CC BY 4.0, credited on screen.
- The battle soundtracks are generated in code from public-domain tunes.
