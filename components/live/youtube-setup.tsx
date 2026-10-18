"use client";
import { useEffect, useRef, useState } from "react";
import { youtubeSetupLine, type SetupLine } from "@/lib/live/connection";
import { GAMES } from "@/lib/live/games";
import type { GameId } from "@/lib/live/settings";
import type { YouTubeState, YouTubeStatus } from "@/lib/live/youtube";
import { AddressBox, HearingLog, saveLog, type Heard } from "./setup-parts";
import type { SourceState } from "./source";
import { YouTubeSource } from "./youtube-source";

/** how long the page listens after Check now: long enough to try the game on a stream, not so long it reads chat all day */
const LISTEN_MS = 10 * 60_000;

/** What the LIVE page knows about YouTube Live as it loads. */
export type YouTubeSetupProps = {
  /** their YouTube channels that aren't disconnected, first connected first, and the one the game reads */
  channels: { id: string; name: string }[];
  picked: string | null;
  /** the reader as it was: what a game would hear, whether one asked in the last 90 seconds, and today's share of their YouTube LIVE time */
  summary: {
    state: YouTubeState | "idle"; detail: string | null; kids: boolean; channel: string | null; title: string | null; until: string | null; who: "account" | "everyone" | null; open: boolean; used: number;
  };
  /** saves the channel they go live on */
  pick: (form: FormData) => Promise<void>;
  /** connecting YouTube, and connecting the channel the game reads again, back to this page */
  connect: string;
  reconnect: string | null;
  /** they've saved their own TikTok gift menu, which is for TikTok only */
  ownMenu: boolean;
};

const dot: Record<SetupLine["tone"], string> = { good: "bg-[#34C759]", wait: "bg-[#FFD60A]", bad: "bg-signal", none: "bg-muted" };

const step = "flex flex-col gap-5 bg-surface p-6 sm:p-7";
const num = "outline-num font-display [--stroke:var(--fg)] text-6xl leading-none";
const title = "font-display text-3xl uppercase tracking-wide";
const action = "press w-fit bg-signal px-4 py-2 font-display text-lg uppercase tracking-wider text-ink [--press:var(--fg)]";

/**
 * Setting up the game on a YouTube Live: Hookline hears the stream itself,
 * through the streamer's own channel, so there's nothing to install. The
 * page says what Hookline last knew about the stream, and Check now asks
 * Hookline to look straight away, then lists what it hears for 10
 * minutes. Hookline only reads the chat while something asks, so the page
 * stops asking after that.
 */
export function YouTubeSetup({ overlayKey, game, channels, picked, summary, pick, connect, reconnect, ownMenu }: YouTubeSetupProps & { overlayKey: string; game: GameId }) {
  const [status, setStatus] = useState<YouTubeStatus | null>(null);
  // whether Hookline answers while Check now listens
  const [hookline, setHookline] = useState<SourceState>("connecting");
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState<Heard[]>([]);
  const all = useRef<Heard[]>([]);
  const [clean, setClean] = useState(true);
  const [origin, setOrigin] = useState("");
  const source = useRef<YouTubeSource | null>(null);
  const stopAt = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
    return () => {
      source.current?.stop();
      if (stopAt.current) clearTimeout(stopAt.current);
    };
  }, []);

  const check = () => {
    if (source.current) source.current.check();
    else {
      // its first ask looks for the stream straight away
      const s = new YouTubeSource(overlayKey, {
        onEvent: (e) => {
          const h = { at: Date.now(), e };
          all.current.push(h);
          if (all.current.length > 500) all.current.shift();
          setHeard((x) => [h, ...x].slice(0, 12));
        },
        onState: setHookline,
        onStatus: setStatus,
      }, { setup: true });
      source.current = s;
      s.start();
    }
    setListening(true);
    if (stopAt.current) clearTimeout(stopAt.current);
    stopAt.current = setTimeout(() => {
      source.current?.stop();
      source.current = null;
      setListening(false);
    }, LISTEN_MS);
  };

  // the address is filled in once the page runs on the device, and so is a pause's end, in the device's own time
  const line = youtubeSetupLine(status ?? summary, { local: origin !== "", reached: !(listening && hookline === "closed") });
  const state = status?.state ?? summary.state;
  const used = Math.round(summary.used * 100);
  const q = new URLSearchParams({ src: "youtube", key: overlayKey });
  if (clean) q.set("clean", "1");
  const url = origin ? `${origin}/live/play?${q}` : "";

  return (
    <div className="grid gap-px bg-edge lg:grid-cols-3">
      {/* 1: hear the live */}
      <div className={step}>
        <span className={num}>01</span>
        <h3 className={title}>Hear your LIVE</h3>
        <p className="text-[15px] leading-relaxed text-fg/70">Hookline reads your stream&rsquo;s live chat through your YouTube channel while the game is open. Nothing to install.</p>
        {channels.length === 0 ? (
          <a href={connect} className={action}>Connect YouTube</a>
        ) : (
          <>
            {channels.length > 1 && (
              <form action={pick} className="flex flex-col gap-2">
                <label htmlFor="live-channel" className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">The channel you go live on</label>
                <div className="flex gap-2">
                  <select id="live-channel" name="channel" defaultValue={picked ?? channels[0].id} className="min-w-0 flex-1 border-2 border-edge bg-card px-3 py-2 text-[14px] text-fg focus:border-fg focus:outline-none">
                    {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <button type="submit" className="border-2 border-fg px-3 py-2 font-display text-base uppercase tracking-wider transition hover:bg-fg hover:text-surface">Save</button>
                </div>
              </form>
            )}
            <div className="flex flex-col gap-1.5 border-2 border-edge px-4 py-3">
              <p role="status" className="flex items-center gap-2.5 text-[14px] leading-snug">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot[line.tone]}`} />
                {line.text}
              </p>
              {summary.open && <p className="text-[13px] text-muted">The game is open and listening.</p>}
              {state === "reconnect" && reconnect && (
                <a href={reconnect} className="w-fit text-[13px] underline decoration-signal decoration-2 underline-offset-4">Connect it again</a>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <button type="button" onClick={check} className={action}>Check now</button>
              {listening && <p className="text-[12px] leading-relaxed text-muted">Listening for 10 minutes. What it hears shows in step 03.</p>}
            </div>
            <ul className="flex flex-col gap-1.5 text-[12px] leading-relaxed text-muted">
              <li>Bigger Super Chats do more: each colour is a step up. It&rsquo;s only for the game, and the stream never shows money.</li>
              <li>In YouTube Studio, set Stream latency to Ultra low, so chat sees the game about when you do.</li>
              <li>Super Chats and gifts only come on public streams that aren&rsquo;t made for kids. A stream made for kids has chat off, so the game can&rsquo;t hear anyone.</li>
              <li>Today you&rsquo;ve used {used}% of your daily YouTube LIVE time.</li>
            </ul>
          </>
        )}
      </div>

      {/* 2: put it on the stream */}
      <div className={step}>
        <span className={num}>02</span>
        <h3 className={title}>Put it on your LIVE</h3>
        <p className="border-2 border-edge px-3 py-2.5 text-[14px] leading-snug">
          <span className="block font-display text-lg uppercase tracking-wide">{GAMES.find((g) => g.id === game)?.name}</span>
          <span className="text-fg/60">The game and everything else come from your settings, so you set this up once.</span>
        </p>
        <p className="text-[14px] leading-relaxed text-fg/70">
          In OBS, add a Browser source with this address, 1080 wide and 1920 tall. For a vertical stream, set OBS&rsquo;s canvas to 1080 × 1920 too. Then go live on YouTube from OBS.
        </p>
        {ownMenu && <p className="border-l-2 border-signal pl-2 text-[12px] leading-relaxed text-fg/80">Your own gift menu is for TikTok. On YouTube the menu goes by Super Chat colours.</p>}
        <AddressBox url={url} clean={clean} onClean={setClean} keyed />
      </div>

      {/* 3: try it */}
      <div className={step}>
        <span className={num}>03</span>
        <h3 className={title}>Try it first</h3>
        <p className="text-[15px] leading-relaxed text-fg/70">
          On the game, press <kbd className="border border-edge px-1.5 font-mono text-[12px]">T</kbd> for the test panel: every Super Chat colour and gift, without anyone paying. <kbd className="border border-edge px-1.5 font-mono text-[12px]">D</kbd> fills it with pretend viewers, labeled DEMO.
        </p>
        <HearingLog
          heard={heard}
          unit="power"
          empty={listening ? "Nothing yet. Once you're live and people chat, it shows up here." : "Press Check now in step 01 while you're live, and chat and Super Chats show up here."}
          onSave={() => saveLog(all.current)}
        />
        <p className="text-[12px] leading-relaxed text-muted">If a Super Chat or a gift doesn&rsquo;t do what it should, Save log and send us the file.</p>
      </div>
    </div>
  );
}
