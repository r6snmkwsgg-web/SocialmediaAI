import { Composition } from "remotion";
import { BattleVideo, battleDuration, H, W, type BattleProps } from "./Battle";
import { ShortVideo, type ShortProps } from "./shorts/Short";
import { OgCard, type OgProps } from "./Og";
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
    <Composition
      id="Og"
      component={OgCard}
      width={1200}
      height={630}
      fps={FPS}
      // long enough that the frozen frame inside isn't clipped to the card's own length
      durationInFrames={60 * FPS}
      defaultProps={{ kicker: "Hookline", lines: ["Your channel", "runs itself."], spec: { format: "battle", params: { a: "fibonacci", b: "spike", seed: 1 } }, frame: 300 } satisfies OgProps}
    />
  </>
);
