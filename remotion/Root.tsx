import { Composition } from "remotion";
import { BattleVideo, battleDuration, H, W, type BattleProps } from "./Battle";
import { ShortVideo, type ShortProps } from "./shorts/Short";
import { FPS } from "../lib/battle/sim";
import { frames } from "../lib/shorts/timing";

export const RemotionRoot: React.FC = () => (
  <>
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
    <Composition
      id="Short"
      component={ShortVideo}
      width={W}
      height={H}
      fps={FPS}
      durationInFrames={30 * FPS}
      defaultProps={{ spec: { format: "battle", params: { a: "fibonacci", b: "spike", seed: 1 } }, tag: true } satisfies ShortProps}
      calculateMetadata={({ props }) => ({ durationInFrames: frames(props.spec) })}
    />
  </>
);
