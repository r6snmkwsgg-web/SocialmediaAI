/**
 * What Hookline Bridge, the game and the setup page have to agree on:
 * what a TikTok username looks like, the status the bridge reports about
 * itself, which web pages may talk to it, the switch that turns every
 * bridge off, and whether a newer bridge is out. Nothing here imports
 * anything, so the bridge can bundle it as it is.
 */

/** a TikTok username as people type it: with or without the @, any case. Null if it can't be one. */
export function cleanUser(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const u = raw.trim().replace(/^@/, "").toLowerCase();
  return /^[a-z0-9._]{2,24}$/.test(u) ? u : null;
}

export const BRIDGE_STATES = ["idle", "connecting", "live", "waiting", "error", "off"] as const;
export type BridgeState = (typeof BRIDGE_STATES)[number];

/**
 * What the bridge says about itself, as `{ event: "bridge", data }`, when
 * something connects to it and whenever it changes. `user` is the TikTok
 * LIVE it's pointed at; it's only hearing it while `state` is "live".
 * "off" means Hookline has switched every bridge off.
 */
export type BridgeStatus = { state: BridgeState; user: string | null; error: string | null; version?: string };

/** The bridge's status, from one message off its WebSocket (as text or already read). Null for anything else. */
export function bridgeStatusOf(msg: unknown): BridgeStatus | null {
  let m = msg;
  if (typeof m === "string") {
    if (!m.includes('"bridge"')) return null;
    try {
      m = JSON.parse(m);
    } catch {
      return null;
    }
  }
  if (!m || typeof m !== "object") return null;
  const { event, data } = m as { event?: unknown; data?: unknown };
  if (event !== "bridge" || !data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (!(BRIDGE_STATES as readonly unknown[]).includes(d.state)) return null;
  return {
    state: d.state as BridgeState,
    user: cleanUser(d.user),
    error: typeof d.error === "string" ? d.error.slice(0, 200) : null,
    version: typeof d.version === "string" ? d.version.slice(0, 20) : undefined,
  };
}

const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Whether a web page may talk to the bridge: Hookline's own site, and
 * pages on this computer (the bridge's own page, Hookline running on a
 * developer's machine). Any other site could otherwise disconnect a
 * streamer's game mid-LIVE or point it at someone else's LIVE. Browsers
 * always say which page a WebSocket comes from; programs that aren't
 * browsers don't, and they're already on the computer, so they're let in.
 */
export function allowedOrigin(origin: string | undefined, sites: string[]): boolean {
  if (!origin) return true;
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (LOCAL.has(u.hostname)) return true;
  return sites.some((s) => {
    try {
      return new URL(s).origin === u.origin;
    } catch {
      return false;
    }
  });
}

/**
 * Whether a request was addressed to the bridge on this computer. A page
 * on another site can make its own name point at this computer, then
 * talk to the bridge as if it were the same site; the name it asked for
 * gives it away.
 */
export function localHost(host: string | undefined, port: number): boolean {
  if (!host) return false;
  return [...LOCAL].some((h) => host === `${h}:${port}` || host === h);
}

/** The sites in a comma-separated setting, as their origins, without the ones that aren't addresses. */
export function siteList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => {
      try {
        return /^https?:$/.test(new URL(s).protocol);
      } catch {
        return false;
      }
    })
    .map((s) => new URL(s).origin);
}

/** Where a bridge asks whether it should be running, on the site it belongs to. */
export const SWITCH_PATH = "/api/live/bridge";

/** What that address answers: on or off, and what to tell the streamer. */
export type BridgeSwitch = { on: boolean; message: string | null };

/** The switch from its reply. Anything unreadable counts as on, so an outage never stops a LIVE. */
export function switchOf(body: unknown): BridgeSwitch {
  if (!body || typeof body !== "object") return { on: true, message: null };
  const b = body as { on?: unknown; message?: unknown };
  return { on: b.on !== false, message: typeof b.message === "string" ? b.message.slice(0, 200) : null };
}

/** A version's three numbers, from "1.2.3" or a release tag like "bridge-v1.2.3". Null when there aren't any. */
export function versionOf(raw: unknown): [number, number, number] | null {
  if (typeof raw !== "string") return null;
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(raw);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Whether `latest` is a newer version than `current`. False when either can't be read. */
export function newer(latest: unknown, current: unknown): boolean {
  const a = versionOf(latest), b = versionOf(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
