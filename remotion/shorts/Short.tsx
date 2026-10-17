import { useMemo } from "react";
import { AbsoluteFill, Audio, staticFile } from "remotion";
import { frames } from "../../lib/shorts/timing";
import type { Spec } from "../../lib/shorts/types";
import { BattleVideo } from "../Battle";
import { ClipVideo } from "./Clip";
import { QuizVideo } from "./Quiz";
import { RaceVideo } from "./Race";
import { RankingVideo } from "./Ranking";
import { TextsVideo } from "./Texts";
import { WyrVideo } from "./Wyr";

export type ShortProps = {
  spec: Spec;
  /** the free plan's "made with Hookline" line */
  tag: boolean;
  /** the soundtrack: a URL the browser made, or a file next to a server render */
  soundUrl?: string | null;
  soundFile?: string | null;
};

/** Any Short, whatever its format: the one composition the app previews and the worker renders. A battle and a round from a LIVE carry their own sound. */
export function ShortVideo({ spec, tag, soundUrl, soundFile }: ShortProps) {
  // how long it runs, for an ending that runs back into the start
  const total = useMemo(() => (spec.format === "battle" || spec.format === "clip" ? 0 : frames(spec)), [spec]);
  if (spec.format === "battle") return <BattleVideo {...spec.params} tag={tag} soundUrl={soundUrl} soundFile={soundFile} />;
  if (spec.format === "clip") return <ClipVideo params={spec.params} tag={tag} soundUrl={soundUrl} soundFile={soundFile} />;
  const sound = soundUrl ?? (soundFile ? staticFile(soundFile) : null);
  return (
    <AbsoluteFill>
      {sound && <Audio src={sound} />}
      {spec.format === "quiz" && <QuizVideo params={spec.params} tag={tag} total={total} />}
      {spec.format === "wyr" && <WyrVideo params={spec.params} tag={tag} total={total} />}
      {spec.format === "texts" && <TextsVideo params={spec.params} tag={tag} total={total} />}
      {spec.format === "ranking" && <RankingVideo params={spec.params} tag={tag} total={total} />}
      {spec.format === "race" && <RaceVideo params={spec.params} tag={tag} total={total} />}
    </AbsoluteFill>
  );
}
