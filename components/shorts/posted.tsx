"use client";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "@/components/app/toast";
import { button } from "@/components/app/ui";

/** `moved` names the channel the Short went to, when its link was on another of theirs than the one it was made for. */
type Result = { ok: true; checked: boolean; moved?: string } | { ok: false; message: string };

/**
 * "I posted it", for a Short someone posts themselves. The YouTube link is
 * optional; with one, Hookline checks the video is on their own channel
 * before it counts, and says plainly when it isn't. On another of their
 * channels, the Short moves there, and the toast says so.
 */
export function PostedForm({ id, posted, size = "small" }: { id: string; posted: (id: string, link: string) => Promise<Result>; size?: "small" | "big" }) {
  const router = useRouter();
  const field = useId();
  const [link, setLink] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        setProblem(null);
        start(async () => {
          const r = await posted(id, link);
          if (!r.ok) {
            setProblem(r.message);
            return;
          }
          toast(
            r.moved
              ? `Marked as posted. It's on ${r.moved}, so its views count there.`
              : link.trim() && !r.checked
                ? "Marked as posted. The link couldn't be checked, so its views won't count."
                : "Marked as posted.",
            "good",
          );
          router.refresh();
        });
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={field}>YouTube link, if you posted it there</label>
        <input
          id={field}
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="YouTube link, to track its views (optional)"
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? `${field}-problem` : undefined}
          className={`min-w-0 flex-1 border-2 border-edge-strong bg-surface px-3 focus:border-fg focus:outline-none ${size === "big" ? "py-2 text-[14px]" : "py-1.5 text-[13px]"}`}
        />
        <button type="submit" disabled={pending} className={button.secondary}>
          {pending ? "Checking…" : "I posted it"}
        </button>
      </div>
      {problem && (
        <p id={`${field}-problem`} role="alert" className="text-[13px] text-signal">
          {problem}
        </p>
      )}
    </form>
  );
}
