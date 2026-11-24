// Settings > Appearance > Conversation > "Space under the composer": how
// much room the composer keeps between the field and the bottom edge of the
// window. "standard" (48px, the default) is the fixed margin of #5158, which
// keeps a click in the field clear of an auto-hidden Dock or taskbar;
// "small" (16px) gives the transcript the room back, "large" (80px) lifts the
// field higher. A preference of the person, for every conversation: kept
// like the other appearance choices (localStorage, and per person on an
// organization server through shared/user-preferences.ts), changed by a bot
// through the settings tool (shared/settings-actions.ts,
// appearance.composerBottomSpace), applied live through the CSS variable
// `--composer-bottom-space` the composer's dock reads (#5238).
import type { CSSProperties } from "react";
import { localChoice } from "./local-choice";

export const COMPOSER_BOTTOM_SPACE_KEY = "sagax.composerBottomSpace.v1";
export const COMPOSER_BOTTOM_SPACES = ["small", "standard", "large"] as const;
export type ComposerBottomSpace = (typeof COMPOSER_BOTTOM_SPACES)[number];

/** The CSS variable the composer's dock pads its bottom with. */
export const COMPOSER_BOTTOM_SPACE_VAR = "--composer-bottom-space";
/** The margin of #5158, and what the dock keeps when the variable is unset. */
export const COMPOSER_BOTTOM_SPACE_DEFAULT_PX = 48;

export const composerBottomSpaceChoice = localChoice<ComposerBottomSpace>(COMPOSER_BOTTOM_SPACE_KEY, COMPOSER_BOTTOM_SPACES, "standard");

export function parseComposerBottomSpace(value: string | null | undefined): ComposerBottomSpace {
  if (value === "small" || value === "standard" || value === "large") return value;
  return "standard";
}

export function composerBottomSpacePx(space: ComposerBottomSpace): number {
  switch (space) {
    case "small":
      return 16;
    case "large":
      return 80;
    default:
      return COMPOSER_BOTTOM_SPACE_DEFAULT_PX;
  }
}

/** The inline style that hands the choice to the dock's class. */
export function composerBottomSpaceStyle(space: ComposerBottomSpace): CSSProperties {
  return { [COMPOSER_BOTTOM_SPACE_VAR]: `${composerBottomSpacePx(space)}px` } as CSSProperties;
}

export function setComposerBottomSpace(next: ComposerBottomSpace): void {
  composerBottomSpaceChoice.set(next);
}

/** The choice, followed live (this window, another window, a bot, another device). */
export function useComposerBottomSpace(): ComposerBottomSpace {
  return composerBottomSpaceChoice.use();
}

export function useComposerBottomSpaceStyle(): CSSProperties {
  return composerBottomSpaceStyle(useComposerBottomSpace());
}
