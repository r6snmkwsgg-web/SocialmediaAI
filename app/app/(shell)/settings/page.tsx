import type { Metadata } from "next";
import { ConnectList } from "@/components/app/connect";
import { SettingsTabs } from "@/components/app/settings-tabs";
import { button, Card, CardHead, PageHead } from "@/components/app/ui";
import { account } from "@/lib/server/account";
import { channelsOf } from "@/lib/server/channels";
import { configured } from "@/lib/server/env";
import { deleteAccount, disconnect, saveProfile } from "./actions";

export const metadata: Metadata = { title: "Settings" };

const NOTES: Record<string, { text: string; bad?: boolean }> = {
  saved: { text: "Saved." },
  disconnected: { text: "Disconnected. Hookline can't post there or read it any more." },
  profile: { text: "That didn't save. Check the name is under 40 characters.", bad: true },
  confirm: { text: "Type DELETE to confirm, then press the button again.", bad: true },
  cancel: { text: "Your subscription couldn't be cancelled, so nothing was deleted. Try again, or cancel it in Plan & billing first.", bad: true },
  delete: { text: "The account couldn't be deleted. Try again in a minute.", bad: true },
};

const field = "w-full border-2 border-edge-strong bg-surface px-3.5 py-2.5 text-base text-fg focus:border-fg focus:outline-none";

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function Settings({ searchParams }: { searchParams: Search }) {
  const me = await account();
  const q = await searchParams;
  const channels = await channelsOf(me.id);
  const c = configured();
  const key = ["saved", "disconnected"].find((k) => q[k] === "1") ?? (typeof q.error === "string" ? q.error : undefined);
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
            <div className="sm:col-span-2">
              <button type="submit" className={button.primary}>Save</button>
            </div>
          </form>
        </Card>

        <Card>
          <CardHead title="Connected accounts" />
          <div className="px-5 py-5">
            <ConnectList platforms={["youtube", "tiktok"]} channels={channels} ready={{ youtube: c.youtube, tiktok: c.tiktok }} next="/app/settings" disconnect={disconnect} />
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
