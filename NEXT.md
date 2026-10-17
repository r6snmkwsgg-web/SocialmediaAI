# Next

Everything here needs an account, a payment or someone else's approval, so it can't be done from the code. Do them in this order; each says exactly where to click. `<domain>` means the site's real address, like `hookline.app`.

## 1. Put the code on GitHub

1. github.com/new: owner `r6snmkwsgg-web`, name `hookline`, **Private**, nothing ticked (no README, .gitignore or license).
2. Push everything: from the `hookline` folder, `git remote add origin https://github.com/r6snmkwsgg-web/hookline.git`, then `git push -u origin main`.

## 2. The bridge downloads

Streamers download the bridge from a public repo's releases, so the code itself can stay private.

1. github.com/new: name `hookline-bridge`, **Public**, tick "Add a README file".
2. github.com/settings/personal-access-tokens/new: a fine-grained token. Repository access: only `hookline-bridge`. Permissions: Contents, read and write. Copy it.
3. In the `hookline` repo, Settings, Secrets and variables, Actions:
   - Secrets: `BRIDGE_RELEASE_TOKEN`, the token.
   - Variables: `BRIDGE_RELEASE_REPO`, `r6snmkwsgg-web/hookline-bridge`, and `HOOKLINE_SITE`, `https://<domain>` (the bridge only talks to this site's pages, and the build stops without it).
4. Release it: `git tag bridge-v1.1.0` then `git push origin bridge-v1.1.0`. The Actions tab shows the build (about 10 minutes); then `hookline-bridge`'s Releases page has the Windows, Mac and Linux downloads the setup page links to.
5. Later, to drop the security warnings: Windows shows "Windows protected your PC" for unsigned programs (streamers click More info, then Run anyway), and macOS makes people allow it once in System Settings, Privacy & Security. A Windows code-signing certificate and an Apple Developer account (`$99` a year, to sign and notarize) remove both; the build script then signs with them instead of its ad-hoc signature.

## 3. Supabase: accounts, database, storage

1. supabase.com, New project. Pick the region nearest most users and keep the database password.
2. Project settings, API keys: the project URL goes in `NEXT_PUBLIC_SUPABASE_URL`, the anon (or publishable) key in `NEXT_PUBLIC_SUPABASE_ANON_KEY`, the service role (or secret) key in `SUPABASE_SERVICE_ROLE_KEY`.
3. Connect (top bar), Transaction pooler: copy the connection string, with the password in it, into `DATABASE_URL`.
4. Make the tables: put that `DATABASE_URL` in `.env.local` and run `pnpm db:migrate`. Hookline doesn't use Supabase's Data API (its REST and GraphQL access to the tables), and the tables already refuse it, so you can also switch it off in Project settings, Data API.
5. Authentication, URL Configuration: Site URL `https://<domain>`. Redirect URLs: add `https://<domain>/auth/callback`.
6. Authentication, Emails, Templates: in both "Confirm signup" and "Magic Link", change the link to
   `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email`
7. Authentication, Emails, SMTP Settings: Supabase's own email only reaches the project's team, so sign-in links need a real sender. With Resend (free to start): verify `<domain>` there, make an API key, then in Supabase turn on custom SMTP with host `smtp.resend.com`, port `465`, username `resend`, the API key as the password, and a sender like `login@<domain>`.
8. Authentication, Sign In / Providers, Google: on, with the Google client from section 8 below.
9. Before launch, upgrade the project to Pro: free projects pause after a week without visitors.

## 4. Stripe: the plans

Do this in test mode first, then again in live mode with live keys.

1. Product catalog, Add product: **Hookline Pro** with a recurring price of `$19` a month, then a second price of `$190` a year. **Hookline Creator** with `$49` a month and `$490` a year. Each price's ID (`price_…`) goes in `STRIPE_PRICE_PRO_MONTH`, `STRIPE_PRICE_PRO_YEAR`, `STRIPE_PRICE_CREATOR_MONTH` and `STRIPE_PRICE_CREATOR_YEAR`.
2. Developers, API keys: the secret key goes in `STRIPE_SECRET_KEY`.
3. Developers, Webhooks, Add endpoint: `https://<domain>/api/stripe/webhook`, with the events `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated` and `customer.subscription.deleted`. Its signing secret goes in `STRIPE_WEBHOOK_SECRET`.
4. Settings, Billing, Customer portal: allow cancelling, updating payment methods and switching plans, with both products and all four prices. Save.
5. Check it: sign up on the site, Plan & billing, Pro, pay with the test card `4242 4242 4242 4242`. The plan should show Pro within a few seconds.

## 5. Claude: the titles and new material

Without Claude, quizzes and would-you-rathers come only from the built-in banks, which run out across all channels after a few dozen Shorts. Rankings and races don't need Claude but are a fixed pool shared by every channel too: about 200 rankings and 220 races in all, ever. Only battles never run out.

1. console.anthropic.com, API keys, Create key: it goes in `ANTHROPIC_API_KEY`.
2. `ANTHROPIC_MODEL` is the ID of the Claude model that writes titles, quiz questions, would-you-rathers and text stories, from Anthropic's models overview page. It must support structured outputs. If Shorts keep their plain titles, the app's and the worker's logs say why for each one (lines starting `titles:`).
3. Billing: add credit and set a monthly spend limit. Each Short's title is one small request; a quiz adds two (writing the questions, then checking them), a would-you-rather or a text story one.

## 6. Vercel: the app

Vercel's free plan is for non-commercial projects, so a paid Hookline needs Vercel Pro.

1. vercel.com/new: import `hookline`. The defaults are right for Next.js. Deploy.
2. Settings, Environment Variables: everything in `.env.example` except `HOOKLINE_DEV_LOGIN`, `CHROME_PATH` and `TEST_DATABASE_URL`. Make `TOKEN_KEY` once with `openssl rand -base64 32` and never change it, since it unlocks every saved token. `CRON_SECRET` is only needed if a scheduler runs the jobs instead of the worker; then leave Settings, Functions, Fluid compute on (the default), since the Shorts job can take up to five minutes.
3. Settings, Domains: add `<domain>` and follow the DNS steps.
4. Set `NEXT_PUBLIC_SITE_URL` to `https://<domain>` and `ADMIN_EMAILS` to your own email, then redeploy (Deployments, the latest one, Redeploy).
5. Sign in and open `https://<domain>/admin`: its Setup list ticks off each service as it's connected, and Rendering shows whether the worker is running.

## 7. The worker: rendering and posting

On Render (any host that runs Docker works the same way):

1. render.com, New, Background Worker, connect GitHub, pick `hookline`.
2. Language: Docker. Dockerfile path: `worker/Dockerfile`. An instance with at least 2 GB of memory.
3. Environment: the same variables as Vercel, `TOKEN_KEY` included.
4. Create it. The logs should say "bundling the videos…" and then "ready". Swipe right on a Short in the app; a minute or two later it shows Ready.
5. Every update that adds a migration (a new file in `supabase/migrations/`) goes out in this order, because a worker still running the old code fails against the new tables or makes Shorts the new code doesn't expect: suspend the worker (Render, the worker, Suspend), run `pnpm db:migrate` with the production `DATABASE_URL` in `.env.local`, then deploy the app and the worker together (Vercel's deploy and Render's Manual Deploy) and resume the worker.

## 8. Google: YouTube posting, views and analytics

1. console.cloud.google.com: a new project called Hookline.
2. APIs & Services, Library: enable **YouTube Data API v3** and **YouTube Analytics API**.
3. Google Auth Platform:
   - Branding: name Hookline, a support email, a 120 × 120 logo, home page `https://<domain>`, privacy policy `https://<domain>/privacy`, terms `https://<domain>/terms`, authorized domain `<domain>`.
   - Audience: External. While it's being verified, only the Google accounts added under Test users (up to 100) can connect.
   - Data Access: add `youtube.upload`, `youtube.readonly`, `yt-analytics.readonly` and `yt-analytics-monetary.readonly`.
   - Clients, Create client, Web application. Authorized redirect URIs: `https://<domain>/api/connect/youtube/callback`, `http://localhost:3000/api/connect/youtube/callback`, and Supabase's `https://<project>.supabase.co/auth/v1/callback`. The client ID and secret go in `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, and into Supabase's Google provider.
4. APIs & Services, Credentials, Create credentials, API key: restrict it to the YouTube Data API v3. It goes in `YOUTUBE_API_KEY`.
5. Google Search Console: verify `<domain>` with the same Google account.
6. Put your own channels' IDs (YouTube Studio, Settings, Channel, Advanced settings; they start with `UC`) in `YOUTUBE_TEST_CHANNELS`, comma-separated, in Vercel and the worker. Until the audit in step 8 passes, Hookline only uploads to these; everyone else posts their own Shorts and Hookline checks the links. To try Creator's channels, make a second YouTube channel (a Brand Account under your Google account works: YouTube, Settings, Add or manage your channels), connect both in Settings with Add a channel, picking the account or Brand Account that owns each when Google asks, and put both IDs in `YOUTUBE_TEST_CHANNELS`. If the second channel is on a different Google account, add that account under Google Auth Platform, Audience, Test users first. Each should get its own Shorts, look and times, and upload only to itself; pick each one in the queue, the calendar, the library and Earnings to see only its own. Then record a demo video and upload it to YouTube as unlisted: sign in with Google, connect one of those channels in Settings (show the consent screen and its scopes, then the "made for kids?" question), swipe right on a Short, the Short arriving on the channel, then Earnings and Trends.
7. Google Auth Platform, Audience, Publish app; then Verification Center, submit with the video and these reasons:
   - `youtube.upload`: posts the Shorts the creator approves, at the time shown when they approve them.
   - `youtube.readonly`: the channel's name, and its Shorts' view counts, which decide what Hookline makes next.
   - `yt-analytics.readonly`: daily views and subscribers in Earnings.
   - `yt-analytics-monetary.readonly`: YouTube's estimated revenue in Earnings, for monetized channels.
   It takes from a few days to a few weeks.
8. The YouTube audit, which needs an adult: a parent or guardian fills in and sends the "YouTube API Services Audit and Quota Extension Form" with the same video, since sending it accepts YouTube's API terms, and those need someone old enough to sign a contract. Until it passes, everything Hookline uploads stays private, so even your test channels' Shorts show as "kept private". Ask for more quota in the same form: Trends alone uses about 6,000 of the default 10,000 units a day. The project's quota page (APIs & Services, YouTube Data API v3, Quotas) shows what uploads use: read what one upload really costs there before filing (it's reported to have dropped from about 1,600 units to about 100 in December 2025), and size the request for up to 25 uploads a day for each Creator account (5 channels, 5 Shorts each). Once it passes, set `YOUTUBE_AUDITED=1` in Vercel and the worker and redeploy: Hookline then uploads for every channel. Until then the app doesn't promise Pro posts for you, but the pricing page still lists "Posts them for you at your best times" (`lib/billing/plans.ts`): decide whether to change it if you sell Pro before the audit. The same goes for Creator: until the audit, Creator customers get Shorts, looks, times and Earnings for each of their channels, but post up to 25 Shorts a day themselves.

## 9. TikTok: connecting and posting

1. developers.tiktok.com, Manage apps, Connect an app: icon, name Hookline, a category and description, terms `https://<domain>/terms`, privacy `https://<domain>/privacy`, platform Web with `https://<domain>`.
2. Add products: **Login Kit**, with the redirect URI `https://<domain>/api/connect/tiktok/callback`, and the **Content Posting API** with Direct Post turned on.
3. Scopes: `user.info.basic`, `user.info.profile`, `video.list`, `video.upload` and `video.publish`. Hookline only asks for `user.info.profile` once `TIKTOK_PROFILE=1` is set, because TikTok refuses the whole sign-in over a scope the app doesn't have. Add the scope here first (if the app was already submitted without it, add it and submit again), then set `TIKTOK_PROFILE=1`. Until then no LIVE's gift coins count in Earnings, since Hookline can't tell whose LIVE it was.
4. The client key and secret go in `TIKTOK_CLIENT_KEY` and `TIKTOK_CLIENT_SECRET`. Set `TIKTOK_DIRECT_POST=1`, and `TIKTOK_PROFILE=1` once step 3's `user.info.profile` is on the app.
5. Sandbox: add your own TikTok account as a target user, and set that account to private (TikTok, Settings and privacy, Privacy, Private account). Before TikTok's audit, direct posting only works for private accounts.
6. Record a demo: connect TikTok in Settings, swipe right on a Short and answer TikTok's questions, the post arriving on TikTok, then Earnings showing TikTok views.
7. Submit the app for review, with the video and these reasons:
   - `user.info.basic`: shows which account is connected.
   - `user.info.profile`: the account's username, to check that a LIVE the game heard is the creator's own, so its gift coins count in their Earnings.
   - `video.list`: the views of posted videos, in Earnings.
   - `video.upload`: sends a Short to the creator's TikTok drafts.
   - `video.publish`: posts a Short the creator approved, at its time, with the choices they made for it.
8. Once the app is approved, apply for the Content Posting API audit. Until it passes, posts stay private and at most 5 creators a day can post. Nothing in the app needs changing when it passes.

## 10. Check the LIVE games on a real LIVE

The bridge only listens, so anyone's LIVE works for the first check (its coins won't count in Earnings, which only counts LIVEs on your own connected TikTok).

1. Download the bridge from the release in step 2, or run `pnpm live:bridge`.
2. Find someone live right now on tiktok.com/live.
3. On `https://<domain>/live`, in the setup: Find it on this computer, pick Hookline Bridge, type their username and connect. The connection check should list their chats, likes and gifts as they happen.
4. Open the game from the setup: their gifts and likes should land in the fight.
5. The full test needs someone who can go LIVE (TikTok asks for 18+ and 1,000 followers in most places): add the game from `/app/live` as a browser source at 1080 × 1920 in TikTok LIVE Studio or OBS, go live, have friends type 1 or 2 and send a Rose, watch the vote between rounds, then end the LIVE and check `/app/live` shows that session's numbers.
6. Rivals, the same way: pick it in `/app/live` (it needs Pro), then have one friend send a Paper Crane and another a Little Crown (99 coins each). Each should land on its own side, red and blue, whatever number they typed. If TikTok names a gift differently in your country, change it under "Each side's gifts" (Creator).

## 11. Domain, email and the legal pages

1. Buy `<domain>` (in Vercel, or anywhere) and point it at Vercel.
2. Make an inbox on it, like `hello@<domain>`, and put it in `NEXT_PUBLIC_CONTACT_EMAIL`. Google and TikTok both check that it's real.
3. The privacy and terms pages are plain-language drafts. Have someone qualified read them before taking payments, including who can use Hookline (13 and over; under 18 with a parent or guardian, who owns any paid plan).

## Later

- Email for the notifications that matter most (a Short posted, a LIVE recap, an account to reconnect): needs an email service like Resend, and a setting for each person to turn them off.
- A Remotion company license once more than three people work on Hookline.
- More workers once renders queue up; each renders one Short at a time.
- TikTok has no trends API for apps like this. If it adds one, Trends can show TikTok too.
- Rivals and team names in other alphabets (Arabic, Hindi, Cyrillic and so on) are refused for now, and past English, Spanish, Portuguese and French only country names are checked, not the words for peoples, faiths or race (German "Juden", Turkish "Kürtler"). Covering them needs a decision on how: word lists per language, or a moderation service.
