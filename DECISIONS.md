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
