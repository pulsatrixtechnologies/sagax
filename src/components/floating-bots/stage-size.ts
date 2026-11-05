// The floating mascot's stage size: shared by the view, its decor and the
// desktop window so the character's box and transparent room stay aligned.
import { mascotStage } from "./fit";

/** The owl's own box. */
export const OWL_SIZE = 120;
/** The stage around it: big enough that no spin, flip, jump or spread wing is ever cut off (fit.ts). */
export const STAGE = mascotStage(OWL_SIZE);
export const MASCOT_SIZE = { width: STAGE.width, height: STAGE.height } as const;
/** The character's own box in the stage: the balloon may come right up to it, and main keeps it on screen. */
export const OWL_BOX = { left: STAGE.left, top: STAGE.top, size: OWL_SIZE } as const;
/** The stage around the character (fit.ts). */
export const MASCOT_STAGE = STAGE;
