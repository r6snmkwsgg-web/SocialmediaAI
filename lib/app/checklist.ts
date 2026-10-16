/**
 * Home's setup list: the steps from a new account to one that's earning,
 * in the order that suits what they came for. Each step is done or not
 * from real data, never ticked by hand.
 */

export type Goal = "shorts" | "live" | "both";

export type Facts = { youtube: boolean; swiped: boolean; posted: boolean; liveSetUp: boolean; wentLive: boolean; goal: boolean };

export type Step = { id: keyof Facts; title: string; body: string; href: string; cta: string; done: boolean };

const STEPS: Record<keyof Facts, Omit<Step, "done" | "id">> = {
  youtube: { title: "Connect YouTube", body: "So the Shorts you approve can post themselves.", href: "/app/settings", cta: "Connect" },
  swiped: { title: "Swipe your first Shorts", body: "Right to post it, left for a different one.", href: "/app/shorts", cta: "Open the queue" },
  posted: { title: "Post your first Short", body: "It goes out at the time your audience is around.", href: "/app/shorts", cta: "See the queue" },
  liveSetUp: { title: "Set up your LIVE game", body: "Pick a game and your gift prices, then add it to TikTok LIVE Studio.", href: "/app/live", cta: "Set it up" },
  wentLive: { title: "Play it on a LIVE", body: "Your first rounds, coins and top gifters show up here after.", href: "/app/live", cta: "How to go live" },
  goal: { title: "Set a goal", body: "A number to aim for, tracked from your real earnings.", href: "/app/earnings", cta: "Set one" },
};

const ORDER: Record<Goal, (keyof Facts)[]> = {
  shorts: ["youtube", "swiped", "posted", "goal", "liveSetUp", "wentLive"],
  live: ["liveSetUp", "wentLive", "goal", "youtube", "swiped", "posted"],
  both: ["youtube", "liveSetUp", "swiped", "wentLive", "posted", "goal"],
};

/** Where Hookline doesn't post for them (Free, or before YouTube's audit), they post their own Shorts. */
const SELF: Partial<Record<keyof Facts, Pick<Step, "body">>> = {
  youtube: { body: "So Hookline can check the Shorts you post and read their views." },
  posted: { body: "Post one on YouTube yourself, then tap I posted it." },
};

export function checklist(goal: Goal | null, facts: Facts, posts = false): Step[] {
  return ORDER[goal ?? "both"].map((id) => ({ id, ...STEPS[id], ...(posts ? {} : SELF[id]), done: facts[id] }));
}

/** The first step not done yet: Home's one big button. */
export function nextStep(steps: Step[]): Step | null {
  return steps.find((s) => !s.done) ?? null;
}
