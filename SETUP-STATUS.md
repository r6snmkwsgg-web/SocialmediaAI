# Setup status

Where the YouTube Shorts launch stands. NEXT.md has the full steps; this is the checklist. Values never go in this file, only names.

Scope: YouTube Shorts only. Skipped for now: the bridge (NEXT.md 2), TikTok (9), LIVE tests (10) and YouTube Live (11).

Until the domain exists, every address below uses `https://socialmedia-ai-rosy.vercel.app`.

## 1. GitHub

- [ ] `r6snmkwsgg-web/SocialmediaAI` private (was public, 0 stars, forks or watchers). This session's GitHub proxy refuses settings changes, so you do it: Settings, General, Danger Zone, Change visibility, Make private.

CLIs installed in this container: vercel 65.2.0, supabase 2.122.0, stripe 1.55.1, render 2.31.0 (gcloud and gh were already there).

## 2. What's already connected

- [ ] Vercel CLI logged in (two device links expired unused; reply "ready" for a fresh one)
- [ ] Vercel CLI linked to project `socialmedia-ai`
- [ ] Env var names listed and compared with `.env.example`

## 3. Name and domain

- [x] Names checked against `.com` RDAP (free ones listed in chat)
- [ ] Name picked
- [ ] Domain bought (by you)
- [ ] Domain added in Vercel, DNS pointed
- [ ] `NEXT_PUBLIC_SITE_URL` switched to the domain, and every vercel.app address below swapped for it

## 4. Supabase (NEXT.md 3)

- [ ] Project created
- [ ] `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` (transaction pooler) saved
- [ ] `pnpm db:migrate` run
- [ ] Data API switched off
- [ ] Auth Site URL and redirect URL
- [ ] "Confirm signup" and "Magic Link" templates
- [ ] Custom SMTP (needs the domain and Resend)
- [ ] Google provider (needs the OAuth client from step 8)
- [ ] Pro plan before launch (paid, your call)

## 5. Stripe, test mode (NEXT.md 4)

- [ ] Hookline Pro: $19/month, $190/year
- [ ] Hookline Creator: $49/month, $490/year
- [ ] Webhook endpoint with the four events
- [ ] Customer portal
- [ ] `STRIPE_SECRET_KEY` (you paste it into Vercel), `STRIPE_WEBHOOK_SECRET`, four `STRIPE_PRICE_*`
- [ ] Test checkout with 4242 4242 4242 4242
- [ ] Live mode, later

## 6. Vercel env vars (NEXT.md 6)

- [ ] `TOKEN_KEY` generated
- [ ] `NEXT_PUBLIC_SITE_URL`, `ADMIN_EMAILS`, `NEXT_PUBLIC_CONTACT_EMAIL`
- [ ] Supabase, Stripe and Google vars
- [ ] `ANTHROPIC_MODEL`
- [ ] `ANTHROPIC_API_KEY` (you enter it)
- [ ] Redeploy (only when you say "deploy")

## 7. Worker on Render (NEXT.md 7)

- [x] `render.yaml` added (worker, Docker, 1c-2g, Virginia, manual deploys, settings from env group `hookline-worker`)
- [ ] `render.yaml` validated with `render blueprints validate` (needs the Render login)
- [ ] Env group `hookline-worker` made through Render's API, values straight from `.env.local`
- [ ] Worker created on Render (paid instance, your call)
- [ ] Worker env vars set
- [ ] Logs say "ready"

## 8. Google (NEXT.md 8)

- [ ] Cloud project created (owned by your parent)
- [ ] YouTube Data API v3 and YouTube Analytics API enabled
- [ ] `YOUTUBE_API_KEY` made, restricted to the YouTube Data API v3
- [ ] Branding (you, in the console)
- [ ] Audience: External, test users
- [ ] Data Access: the four scopes
- [ ] OAuth client: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and into Supabase
- [ ] Search Console verification (needs the domain)
- [ ] `YOUTUBE_TEST_CHANNELS`
- [ ] Demo video recorded
- [ ] Verification submitted
- [ ] Audit form sent (your parent)

## 9. DRAFTS.md

- [ ] Demo video shot list
- [ ] Google verification answers
- [ ] YouTube audit form answers
