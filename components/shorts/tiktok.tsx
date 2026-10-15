"use client";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState, useTransition } from "react";
import { toast } from "@/components/app/toast";
import { button } from "@/components/app/ui";
import { Phone } from "@/components/phone";
import { labelOf, POLICIES, PRIVACY_LABEL, problemWith, type Creator, type Privacy, type TikTokChoices } from "@/lib/shorts/tiktok";
import type { Spec } from "@/lib/shorts/types";
import { ShortPlayer } from "./player";

export type CreatorResult = { ok: true; creator: Creator } | { ok: false; message: string };

type FormProps = {
  /** the Short's length: TikTok limits it per account */
  seconds: number;
  /** asks TikTok about the account, each time the form opens */
  load: () => Promise<CreatorResult>;
  onPost: (choices: TikTokChoices) => void;
  onSkip?: () => void;
  onBack?: () => void;
  postLabel: string;
  skipLabel?: string;
  busy?: boolean;
};

const field = "w-full border-2 border-edge-strong bg-surface px-3 py-2 text-[15px] text-fg focus:border-fg focus:outline-none";
const box = "h-5 w-5 shrink-0 accent-[var(--color-signal)]";
const small = "font-mono text-[11px] uppercase tracking-[0.16em] text-muted";

/**
 * TikTok's questions before a Short goes to someone's TikTok, asked the
 * way TikTok requires: which account it's going to, who can see it with
 * nothing picked for them, comments, Duet and Stitch off until they're
 * switched on, whether it promotes a brand, and TikTok's terms for
 * posting. Asked for every Short.
 */
export function TikTokChoicesForm({ seconds, load, onPost, onSkip, onBack, postLabel, skipLabel = "Not on TikTok", busy = false }: FormProps) {
  const [result, setResult] = useState<CreatorResult | null>(null);
  const [privacy, setPrivacy] = useState<Privacy | "">("");
  const [comment, setComment] = useState(false);
  const [duet, setDuet] = useState(false);
  const [stitch, setStitch] = useState(false);
  const [disclose, setDisclose] = useState(false);
  const [yourBrand, setYourBrand] = useState(false);
  const [branded, setBranded] = useState(false);
  const id = useId();

  useEffect(() => {
    let live = true;
    load()
      .then((r) => live && setResult(r))
      .catch(() => live && setResult({ ok: false, message: "TikTok didn't answer. Try again in a moment." }));
    return () => {
      live = false;
    };
  }, [load]);

  const back = onBack && (
    <button type="button" onClick={onBack} className={button.quiet}>
      Back
    </button>
  );
  const skip = onSkip && (
    <button type="button" onClick={onSkip} disabled={busy} className={button.secondary}>
      {skipLabel}
    </button>
  );

  if (!result) {
    return (
      <div aria-busy="true" aria-label="Asking TikTok about your account" className="flex flex-col gap-3">
        <div className="h-5 w-2/3 bg-card-2 motion-safe:animate-pulse" />
        <div className="h-11 bg-card-2 motion-safe:animate-pulse" />
        <div className="h-5 w-1/2 bg-card-2 motion-safe:animate-pulse" />
      </div>
    );
  }
  if (!result.ok) {
    return (
      <div className="flex flex-col gap-4">
        <p role="alert" className="text-[14px] text-signal">{result.message}</p>
        <div className="flex flex-wrap items-center gap-3">
          {skip}
          {back}
        </div>
      </div>
    );
  }

  const creator = result.creator;
  const picked = { comment: comment && !creator.commentOff, duet: duet && !creator.duetOff, stitch: stitch && !creator.stitchOff, disclose, yourBrand: disclose && yourBrand, branded: disclose && branded };
  const problem = problemWith({ ...picked, privacy: privacy || null }, creator, seconds);
  const choices: TikTokChoices | null = privacy && !problem ? { ...picked, privacy } : null;
  const label = labelOf({ disclose, yourBrand, branded });
  const toggles = [
    { key: "comment", name: "Comment", on: comment, set: setComment, off: creator.commentOff },
    { key: "duet", name: "Duet", on: duet, set: setDuet, off: creator.duetOff },
    { key: "stitch", name: "Stitch", on: stitch, set: setStitch, off: creator.stitchOff },
  ];

  return (
    <div className="flex flex-col gap-5">
      <p className="text-[15px]">
        Posting to TikTok as <b className="font-semibold">{creator.nickname}</b>
      </p>

      <label className="flex flex-col gap-1.5">
        <span className={small}>Who can see it</span>
        <select value={privacy} onChange={(e) => setPrivacy(e.target.value as Privacy)} className={field} required autoFocus>
          <option value="" disabled>
            Choose
          </option>
          {creator.privacy.map((p) => (
            <option key={p} value={p} disabled={p === "SELF_ONLY" && disclose && branded}>
              {PRIVACY_LABEL[p]}
              {p === "SELF_ONLY" && disclose && branded ? " (not for branded content)" : ""}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className={`${small} mb-1.5`}>Let viewers</legend>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {toggles.map((t) => (
            <label key={t.key} className={`flex items-center gap-2 text-[15px] ${t.off ? "text-muted" : ""}`}>
              <input type="checkbox" checked={t.on && !t.off} disabled={t.off} onChange={(e) => t.set(e.target.checked)} className={box} aria-describedby={t.off ? `${id}-off` : undefined} />
              {t.name}
            </label>
          ))}
        </div>
        {toggles.some((t) => t.off) && (
          <p id={`${id}-off`} className="text-[13px] text-muted">
            Greyed out: switched off in your TikTok settings.
          </p>
        )}
      </fieldset>

      <div className="flex flex-col gap-3">
        <label className="flex items-start gap-2.5 text-[15px]">
          <input type="checkbox" checked={disclose} onChange={(e) => setDisclose(e.target.checked)} className={`${box} mt-0.5`} />
          <span>This promotes a brand, product or service</span>
        </label>
        {disclose && (
          <div className="flex flex-col gap-2.5 border-l-4 border-edge pl-4">
            <label className="flex items-start gap-2.5 text-[15px]">
              <input type="checkbox" checked={yourBrand} onChange={(e) => setYourBrand(e.target.checked)} className={`${box} mt-0.5`} />
              <span>
                Your brand
                <span className="block text-[13px] text-muted">You, or your own business</span>
              </span>
            </label>
            <label className="flex items-start gap-2.5 text-[15px]">
              <input type="checkbox" checked={branded} onChange={(e) => setBranded(e.target.checked)} className={`${box} mt-0.5`} />
              <span>
                Branded content
                <span className="block text-[13px] text-muted">Another brand, in return for something</span>
              </span>
            </label>
            {label && <p className="text-[13px] text-muted">TikTok will label it &ldquo;{label}&rdquo;.</p>}
          </div>
        )}
      </div>

      {problem && (
        <p role="alert" className="text-[13px] text-signal">
          {problem}
        </p>
      )}

      <p className="text-[13px] leading-relaxed text-muted">
        By posting, you agree to TikTok&rsquo;s{" "}
        {disclose && branded && (
          <>
            <a href={POLICIES.branded} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-fg">
              Branded Content Policy
            </a>{" "}
            and{" "}
          </>
        )}
        <a href={POLICIES.music} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-fg">
          Music Usage Confirmation
        </a>
        .
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => choices && onPost(choices)} disabled={!choices || busy} className={button.primary}>
          {busy ? "Saving…" : postLabel}
        </button>
        {skip}
        {back}
      </div>
    </div>
  );
}

/**
 * TikTok for a Short that's already on its way: approved before TikTok
 * was connected, or turned down by TikTok and chosen again.
 */
export function TikTokLater({ id, spec, seconds, tag, label, load, choose }: {
  id: string;
  spec: Spec;
  seconds: number;
  tag: boolean;
  label: string;
  load: FormProps["load"];
  choose: (id: string, choices: TikTokChoices) => Promise<{ ok: boolean }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={`${button.quiet} self-start`}>
        {label}
      </button>
    );
  }
  return (
    <div className="grid gap-5 border-2 border-edge p-4 sm:grid-cols-[150px_minmax(0,1fr)]">
      <Phone className="mx-auto w-[150px] self-start">
        <ShortPlayer spec={spec} tag={tag} />
      </Phone>
      <div className="flex min-w-0 flex-col gap-3">
        <TikTokChoicesForm
          seconds={seconds}
          load={load}
          postLabel="Post to TikTok"
          busy={pending}
          onBack={() => setOpen(false)}
          onPost={(c) =>
            start(async () => {
              const r = await choose(id, c);
              if (!r.ok) return setFailed(true);
              toast("Going to TikTok too", "good");
              setOpen(false);
              router.refresh();
            })
          }
        />
        {failed && (
          <p role="alert" className="text-[13px] text-signal">
            That didn&rsquo;t save. Try again.
          </p>
        )}
      </div>
    </div>
  );
}
