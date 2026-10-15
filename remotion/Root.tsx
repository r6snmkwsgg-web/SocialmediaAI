import { Composition } from "remotion";
import { BattleVideo, battleDuration, H, W, type BattleProps } from "./Battle";
import { FPS } from "../lib/battle/sim";

export const RemotionRoot: React.FC = () => (
  <Composition
    id="Battle"
    component={BattleVideo}
    width={W}
    height={H}
    fps={FPS}
    durationInFrames={30 * FPS}
    defaultProps={{ a: "fibonacci", b: "spike", seed: 1, tag: true } satisfies BattleProps}
    calculateMetadata={({ props }) => ({ durationInFrames: battleDuration(props) })}
  />
);
