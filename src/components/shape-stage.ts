// The stage a shape mascot stands on (#5384): where the app draws a bot's
// mascot large (the bot page's hero, the bot panel's avatar), the person
// turns it by hand, as on the open-bot-avatar site's stage. The stage
// (floating-bots/use-mascot-turn.tsx) provides this; a shape drawn inside it
// (ShapeMascot.tsx) reads it. Off a stage a mascot is drawn as it always was.
import { createContext } from "react";
import type { AvatarState } from "open-bot-avatar";

export interface ShapeStage {
  /** The extra turn of the body, radians (the engine's `view`). */
  view: { yaw: number; pitch: number };
  /** The look stays as it is while the person drags the body (the engine's `holdGaze`). */
  holdGaze: boolean;
  /** A state shown for a moment in place of the bot's own (keys 1 to 6); never stored. */
  previewState: AvatarState | null;
  /**
   * The stage of a mascot drawn under the live size (the bot panel's avatar,
   * 64 px filled to its box): at rest it stays the still image it was, and it
   * is the moving drawing only while it is turned, dragged or previews a state.
   */
  small?: boolean;
}

export const ShapeStageContext = createContext<ShapeStage | null>(null);
