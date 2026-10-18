import { canPick, nicheById, OFFERED, suggestedOf, type NicheId } from "@/lib/shorts/niches";
import { Pill } from "./ui";

/**
 * What a channel is about, or for an account with no YouTube channel,
 * what its Shorts are about: one niche, picked from a list, inside a
 * Settings form. Nothing is picked for anyone. One is marked Suggested,
 * and the niches only Claude writes for can't be picked until Claude is
 * set up. A form that picks none leaves the one it has. One in the Ball
 * League says what changing does to its season first.
 */

const radio = "mt-1 h-4 w-4 shrink-0 accent-[var(--color-signal)]";

export function NichePicker({ current, claude, account = false }: {
  /** what it's about now; null while it gets a mix of everything */
  current: NicheId | null;
  /** Claude is set up on this Hookline */
  claude: boolean;
  /** the account's own Shorts, while it has no YouTube channel */
  account?: boolean;
}) {
  const suggested = suggestedOf(claude);
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-[15px] font-semibold">{account ? "What are your Shorts about?" : "What's this channel about?"}</legend>
      <p className="max-w-2xl text-[13px] leading-relaxed text-muted">
        {account ? "Pick one, and your Shorts are only about it." : "Pick one, and this channel only gets Shorts about it."} Hookline learns what works inside it. You can change it later.
      </p>
      {!current && (
        <p className="border-l-4 border-edge-strong pl-3 text-[13px] leading-relaxed">
          {account ? "Until you pick, your Shorts are a mix of everything." : "Until you pick, it gets a mix of everything."}
        </p>
      )}
      {current === "league" && (
        <p className="border-l-4 border-edge-strong pl-3 text-[13px] leading-relaxed">
          Changing stops the season that&rsquo;s on. Its results stay. Coming back starts a new season with the same eight balls.
        </p>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        {OFFERED.map((id) => {
          const n = nicheById(id)!;
          const ok = canPick(n, claude);
          return (
            <label
              key={id}
              className={`flex items-start gap-3 border-2 px-3 py-3 ${ok ? "cursor-pointer border-edge transition hover:border-edge-strong has-[:checked]:border-fg has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-signal" : "border-dashed border-edge"}`}
            >
              <input type="radio" name="niche" value={id} defaultChecked={current === id} disabled={!ok} className={radio} />
              <span className="flex min-w-0 flex-col gap-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className={`text-[14px] font-semibold ${ok ? "" : "text-muted"}`}>{n.name}</span>
                  {suggested === id && <Pill tone="signal">Suggested</Pill>}
                </span>
                <span className="text-[13px] leading-snug text-muted">{n.line}</span>
                {!ok && (
                  <span className="text-[12px] leading-snug">
                    Needs Claude set up on this Hookline.
                    {current === id && (account ? " Until it is, no new Shorts are made." : " Until it is, this channel gets no new Shorts.")}
                  </span>
                )}
                {ok && n.claude === "steady" && !claude && (
                  <span className="text-[12px] leading-snug">Without Claude set up, this runs out once Hookline&rsquo;s charts and questions are used up.</span>
                )}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
