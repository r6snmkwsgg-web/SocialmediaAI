# Decisions

Defaults picked while building, so nobody has to guess why something is the way it is. Change any of them; each says where it lives.

## Order of work

- The account system (Phase 2) was built before streamer settings and session stats (Phase 1, items 3 and 4), because saving settings "per account" needs accounts. Everything else in Phase 1 came first.

## Live

- **The vote** (`lib/live/show.ts`): it runs on the win screen, which is 10 seconds long when voting is on and 7 when it's off. One vote per viewer, and typing again changes it. A gift during the vote adds 1 vote per coin, capped at 50 per gift; those votes stay with the gifter and count once they type A, B or C. Ties are broken at random. When nobody votes, the next round is picked at random and nothing is announced.
- **Abilities in the battle** come from a pool of five (spike, sword, grow, speed, heal). A streamer can switch any off but must keep two.
- **Ball Race** (`lib/live/games/race.ts`): typing "go" enters free with weight 1. After the gate opens, free entries wait for the next race. Gifters always get in, even when it's full (24 racers); a CPU makes room first, then the newest free entry. Three CPU racers fill an empty board. A race ends when the first ball finishes and the podium fills (3 finishers, or 2.5 seconds), or at 75 seconds.
- **Last One Standing** (`lib/live/games/royale.ts`): free entry for the first 15 seconds of a round, after that viewers wait for the next one. Gifters always get in and a CPU makes way. Four CPUs at 5 HP fill an empty arena; 24 fighters at most.
- **The default gift menu** is Rose (1 coin), Finger Heart (5), Perfume (20), Hand Hearts (100), Corgi (299) and Galaxy (1,000), shown at those prices. Each item starts a coin under for the big ones (99 and 999), so other gifts at those common prices count too.
- **Custom gift menus** (Creator) are a gift name and its price for each of the six items, not just prices, so the menu on screen always names a gift that really costs that much. The first gift must cost 1 coin and each one after more than the last; otherwise the defaults stand.
- **Settings and the game address**: the game reads a streamer's settings through a private key in its address (32 random characters). A new key can be made at any time; the old address then shows a bar asking for the new one and plays the free game. Changes reach a game that's already open when it's reloaded.
- **Without a key** (someone trying it from the website) the game is the free one: the battle, with the tag. Demo mode (`?demo=1`) can show any game, since it's only pretend viewers.
- **Session numbers count real viewers only.** Demo and test-panel viewers play like anyone but never count, and rounds count from the first thing a real viewer does, so testing before going live doesn't add up. The game sends the whole session so far every 30 seconds and as it closes; numbers only ever go up, and a session dated in the future or more than a week back is turned away.

## Accounts and billing

- **Signing in** is Supabase Auth: an email link or Google, no passwords. On a developer's own machine (`HOOKLINE_DEV_LOGIN=1` and not a production build) there's also a sign-in without email, so the app can be worked on offline. It can't be switched on in a deploy.
- **The database is reached directly** with postgres.js, not through Supabase's REST API. Each request runs in a transaction that takes on Supabase's `authenticated` role with the user's id, so row-level security applies exactly as it would through Supabase. Webhooks, crons and the render worker run as the table owner.
- **Secrets at rest** (OAuth tokens, a seller's Stripe key) are encrypted by the app with AES-256-GCM using `TOKEN_KEY`, and the tables holding them have no RLS policies, so nothing signed in can read them even by mistake.
- **Plans** (`lib/billing/plans.ts`): Pro makes 3 Shorts a day and Creator 5 a day per channel (the brief said "daily"). Yearly is 10 times monthly: two months free. A failed card (`past_due`) keeps the plan while Stripe retries; cancelled, unpaid or unfinished subscriptions drop to Free. A price that isn't one of ours never grants a plan.
- **Changing plans** goes through Stripe's billing portal once someone is paying, so nobody ends up with two subscriptions. Checkout is only for going from Free to paid.
- **Deleting an account** cancels the subscription at once (no refund for the rest of the period), then deletes the account and everything that cascades from it. Videos already posted stay on YouTube and TikTok.
- **Onboarding** is two taps: what you want (Shorts, LIVE games, or both), then connecting accounts, which can be skipped. "Shorts" lands on the Shorts queue, "LIVE" on the Live page, "both" on Home.
- **Times** in the app show in the viewer's own timezone, filled in on their device.

## Shorts

- **Six formats, all drawn by code**: ball battles, quizzes, would you rather, text stories, rankings and bar-chart races (`lib/shorts/formats/`). A Short is stored as its format and parameters, so the video someone approves is exactly the one that's rendered and posted.
- **Run many, keep the best**: a battle is the most dramatic of 240 simulated fights (six fresh matchups, 40 runs each); a quiz or a would-you-rather the best of 160 sets of questions; a ranking the closest-fought of every figure and region not yet used; a race the stretch of years with the most overtakes out of about 250 tried.
- **Nothing made up in the videos.** Would-you-rathers show no poll results; the comments are the answer. Text stories carry a STORY label on screen and in their facts for the title writer. Quiz facts are ones that don't change, every capital is checked against the country-codes data in the tests, and sums are worked out by the code.
- **Real data for charts**: World Bank population (1960 on) and GDP in current US dollars (1960 on), through the Frictionless Data mirrors on GitHub, because the World Bank's own API wasn't reachable when this was built. The source is on screen. Rankings use the latest year at least 90% of countries have a figure for. GDP races start in 1990 or later, since too many countries have no earlier figures. Country names are the short ones people use (USA, UK, DR Congo, Ivory Coast).
- **Titles** are written by Claude from a list of facts about the video, with rules against invented numbers and claims, spoilers, and presenting stories as real. The model is set with `ANTHROPIC_MODEL`. When Claude isn't set up or a call fails, the format's own plain title is used, and the description is a plain line plus hashtags.
- **How many**: Free makes 3 Shorts in any 7 days; Pro 3 a day; Creator 5 a day for each connected YouTube channel (up to 5). A Short swiped away is replaced straight away and the replacement doesn't count, up to 10 replacements a day. Nothing a channel has had, posted or swiped away, comes round again.
- **When to post**: a new channel starts at noon, 4pm and 7pm in its own timezone (set from the browser at sign-up, changeable in Settings). Once at least three hours of the day have two or more results each, the channel's three best hours are used instead. Posts are at least an hour out and two hours apart.
- **Free doesn't post for you**: an approved Short is rendered for download with its caption to copy. "I posted it" (with the YouTube link, optionally) marks it posted, and with the link its views are tracked too.
- **YouTube**: Shorts upload as private with a publish time, and YouTube makes them public then, so posting doesn't depend on Hookline being up at that moment. One due within 15 minutes goes up public. Quizzes, rankings and races use the Education category; the rest Entertainment.
- **TikTok** has no way to schedule. Once TikTok approves the app for direct posting (`TIKTOK_POSTING_APPROVED=1`), Shorts post at their time. Until then a ready Short can be sent to the creator's TikTok drafts to finish in the app.
- **The learning loop**: views are read at 1 hour, 24 hours and 3 days (up to two days late if the worker was down). At 24 hours a Short is compared with the channel's typical Short, the median of its last 30 at 24 hours, once there are at least 3: (views + 10) / (typical + 10). That moves a weight for its format and its kind (a battle's two powers, a quiz's subject, a story's tone, a chart's figure), averaged in log space over the last 20 results. Formats are drawn by these weights, trusted fully only after 5 results, never below a fifth of the best, and no more than two of one format a day. Within a format, the best kind of three runs is kept.
- **The worker** (`pnpm worker`) does everything long or periodic: rendering, each channel's morning Shorts (from 6am local), posting every minute and views every 15 minutes. The same jobs can be run from a scheduler through `/api/cron/post`, `/api/cron/stats` and `/api/cron/shorts`; each video is locked while it's being posted, so both at once is safe.
- **Rendered files** go in a private Supabase Storage bucket called `videos` (made automatically the first time) and are handed out as 10-minute signed links. Without Supabase they're kept in `.data/videos` and served by the app to their owner.

## Trends

- **YouTube only**, through the official Data API. TikTok doesn't offer trending data to apps like this (its Research API is for academic researchers), so there's no TikTok trends.
- **Ten niches** (`lib/trends/niches.ts`), six of them one per Shorts format so "make one like this" can make one; the other four (satisfying, facts, gaming, football) are there to watch. People pick which to see; none picked means all.
- **Rising means growing fast**: views per hour since upload. Each niche is searched every four hours for Shorts (three minutes or less) uploaded in the last two days, and the 25 growing fastest are kept for a week; Rising now shows the last three days. A search costs 100 of the 10,000 daily quota units, so ten niches every four hours uses about 6,000.
- **Best times** come from the channel's own Shorts: each one's views at 24 hours against the channel's usual, by day of the week and three-hour block in its own timezone. YouTube doesn't share when a channel's viewers are online through its API.
- **Formats right now** is the middle growth rate of the rising Shorts in each format over three days, next to how that format does on the channel.
- **"Make one like this"** makes a Short of the same format straight into the queue, and counts toward the plan's Shorts.

## Earnings

- **Real figures only, from where they are**: YouTube Analytics (daily views, new subscribers and, for channels that can read it, YouTube's estimated revenue, refreshed for the last 35 days every 6 hours); TikTok's view counts (it only gives each video's total, so a day's views are the rise since the last reading, and a day without a reading shows as unknown, not zero); the LIVE game's gift coins, labelled as coins and as the game's own count, never as money; and Stripe sales for people who sell something.
- **Stripe** needs a restricted key (`rk_live_…`) that can read balance transactions; a secret key is refused. It's stored encrypted. Sales are charges and payments less refunds, before Stripe's fees, kept per currency.
- **Charts**: one measure per chart, side by side rather than two on one axis, as daily bars from zero, with each day's exact figure on hover and in a table for screen readers.
- **Goals** are set on any of those measures, for this month (in the account's timezone) or all time.
