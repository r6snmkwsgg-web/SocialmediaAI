import type { Metadata } from "next";
import { ConnectList } from "@/components/app/connect";
import { SettingsTabs } from "@/components/app/settings-tabs";
import { button, Card, CardHead, PageHead } from "@/components/app/ui";
import { account } from "@/lib/server/account";
import { channelsOf } from "@/lib/server/channels";
import { asUser } from "@/lib/server/db";
import { configured } from "@/lib/server/env";
import { deleteAccount, disconnect, saveAudience, saveProfile, saveShorts } from "./actions";

export const metadata: Metadata = { title: "Settings" };

const NOTES: Record<string, { text: string; bad?: boolean }> = {
  saved: { text: "Saved." },
  youtube: { text: "YouTube is connected. Say who the channel is for below, and Shorts you approve can post themselves." },
  youtubeSelf: { text: "YouTube is connected. Say who the channel is for below. Until YouTube finishes reviewing Hookline, you post Shorts yourself and Hookline checks them." },
  youtubeFree: { text: "YouTube is connected. Say who the channel is for below. Hookline checks the Shorts you post there and reads their views." },
  audience: { text: "Saved." },
  audienceError: { text: "Pick whether the channel is made for kids, then save.", bad: true },
  tiktok: { text: "TikTok is connected." },
  channels: { text: "Your plan has room for one channel on each platform. Creator has room for five.", bad: true },
  connect: { text: "That didn't connect. Try again, and allow everything Hookline asks for.", bad: true },
  denied: { text: "Nothing was connected: the permission was turned down.", bad: true },
  nochannel: { text: "That Google account has no YouTube channel yet. Make one on YouTube, then connect again.", bad: true },
  setup: { text: "Connecting accounts isn't set up on this Hookline yet.", bad: true },
  disconnected: { text: "Disconnected. Hookline can't post there or read it any more." },
  profile: { text: "That didn't save. Check the name is under 40 characters.", bad: true },
  confirm: { text: "Type DELETE to confirm, then press the button again.", bad: true },
  cancel: { text: "Your subscription couldn't be cancelled, so nothing was deleted. Try again, or cancel it in Plan & billing first.", bad: true },
  delete: { text: "The account couldn't be deleted. Try again in a minute.", bad: true },
};

const ZONES = ["UTC", ...Intl.supportedValuesOf("timeZone").filter((z) => z !== "UTC")];

const field = "w-full border-2 border-edge-strong bg-surface px-3.5 py-2.5 text-base text-fg focus:border-fg focus:outline-none";

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function Settings({ searchParams }: { searchParams: Search }) {
  const me = await account();
  const q = await searchParams;
  const channels = await channelsOf(me.id);
  const [{ text_stories: stories }] = await asUser(me.id, (tx) => tx<{ text_stories: boolean }[]>`select text_stories from public.profiles where id = ${me.id}`);
  const c = configured();
  const posting = channels.find((x) => x.platform === "youtube" && x.status === "connected");
  const key =
    ["saved", "disconnected"].find((k) => q[k] === "1") ??
    (q.saved === "audience" ? "audience" : undefined) ??
    (q.error === "audience" ? "audienceError" : undefined) ??
    // Free posts its own Shorts; paid plans do too until YouTube's review passes, except on test channels
    (q.connected === "youtube" && !me.plan.scheduling ? "youtubeFree" : undefined) ??
    (q.connected === "youtube" && posting && !posting.api ? "youtubeSelf" : undefined) ??
    (typeof q.connected === "string" ? q.connected : undefined) ??
    (typeof q.error === "string" ? q.error : undefined);
  const note = key ? NOTES[key] : undefined;

  return (
    <>
      <PageHead eyebrow="Settings" title="Account" />
      <SettingsTabs />
      {note && (
        <p role={note.bad ? "alert" : "status"} className={`mb-6 border-2 px-4 py-3 text-[15px] ${note.bad ? "border-signal" : "border-fg bg-card"}`}>
          {note.text}
        </p>
      )}

      <div className="flex flex-col gap-6">
        <Card>
          <CardHead title="You" />
          <form action={saveProfile} className="grid gap-5 px-5 py-5 sm:grid-cols-2">
            <div className="flex flex-col gap-2 sm:col-span-2">
              <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">Email</span>
              <span className="text-base">{me.email}</span>
            </div>
            <label className="flex flex-col gap-2">
              <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">Name</span>
              <input name="name" defaultValue={me.profile.name ?? ""} maxLength={40} autoComplete="nickname" className={field} placeholder="What to call you" />
            </label>
            <label className="flex flex-col gap-2">
              <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">What you use Hookline for</span>
              <select name="goal" defaultValue={me.profile.goal ?? "both"} className={field}>
                <option value="shorts">Shorts</option>
                <option value="live">LIVE games</option>
                <option value="both">Both</option>
              </select>
            </label>
            <label className="flex flex-col gap-2 sm:col-span-2">
              <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">Time zone: when your Shorts post, and what &ldquo;today&rdquo; means</span>
              <select name="timezone" defaultValue={me.profile.timezone} className={`${field} sm:max-w-md`}>
                {ZONES.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
              </select>
            </label>
            <div className="sm:col-span-2">
              <button type="submit" className={button.primary}>Save</button>
            </div>
          </form>
        </Card>

        <Card>
          <CardHead title="Shorts" />
          <form action={saveShorts} className="flex flex-col gap-4 px-5 py-5">
            <label className="flex items-start gap-3">
              <input type="checkbox" name="textStories" defaultChecked={stories} className="mt-1 h-5 w-5 accent-[var(--color-signal)]" />
              <span className="flex flex-col gap-1">
                <span className="text-[15px] font-semibold">Make text stories too</span>
                <span className="max-w-2xl text-[13px] leading-relaxed text-muted">
                  Made-up text conversations, labelled as stories. They&rsquo;re off unless you turn them on, because YouTube is the least keen to pay for videos of scrolling text.
                </span>
              </span>
            </label>
            <div>
              <button type="submit" className={button.secondary}>Save</button>
            </div>
          </form>
        </Card>

        <Card>
          <CardHead title="Connected accounts" />
          <div className="px-5 py-5">
            <ConnectList
              platforms={["youtube", "tiktok"]}
              channels={channels}
              ready={{ youtube: c.youtube, tiktok: c.tiktok }}
              next="/app/settings"
              disconnect={disconnect}
              audience={saveAudience}
              youtubeApi={c.youtubeAudited}
              tiktokProfile={c.tiktokProfile}
              posts={me.plan.scheduling}
            />
            <p className="mt-4 text-[13px] leading-relaxed text-muted">
              Hookline only posts videos you approved. Disconnecting stops posting and reading at once; you can also remove access from your Google or TikTok account settings.
            </p>
          </div>
        </Card>

        <Card className="border-dashed">
          <div id="delete" className="flex flex-col gap-4 px-5 py-5">
            <h2 className="font-display text-xl uppercase tracking-wide">Delete account</h2>
            <p className="max-w-2xl text-[14px] leading-relaxed text-muted">
              Cancels your plan, disconnects your accounts and deletes your videos, settings and stats. Videos already posted stay on YouTube and TikTok. This can&rsquo;t be undone.
            </p>
            <form action={deleteAccount} className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-2">
                <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">Type DELETE</span>
                <input name="confirm" autoComplete="off" className={`${field} w-48`} aria-describedby="delete" />
              </label>
              <button type="submit" className="border-2 border-signal px-4 py-2.5 font-display text-base uppercase tracking-wider text-signal transition hover:bg-signal hover:text-ink">
                Delete my account
              </button>
            </form>
          </div>
        </Card>
      </div>
    </>
  );
}
