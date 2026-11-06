// The round 36px control the reference design uses for every top-bar action (search, new,
// share, panel): an elevated surface with a hairline, primary-colored icon.
export const CIRCLE_BUTTON =
  "flex size-9 shrink-0 items-center justify-center rounded-full border border-hairline-weak bg-elevated text-ink transition-colors hover:bg-elevated-hover";

// CIRCLE_BUTTON as a round close control: the same disc, plus the accent focus ring.
// Its glyph is X at 18px, strokeWidth 1.75 (CIRCLE_ICON), like every other X of a header.
export const CIRCLE_CLOSE_BUTTON = `${CIRCLE_BUTTON} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60`;
export const CIRCLE_ICON = { size: 18, strokeWidth: 1.75 } as const;

// A labelled indicator on the same 36px surface (the bot page's Private / Shared):
// CIRCLE_BUTTON's height, hairline and elevated fill, widened for a label, no hover
// since it does nothing on click.
export const CIRCLE_LABEL =
  "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-hairline-weak bg-elevated px-3 text-[12px] font-medium leading-none text-ink";

// The same 36px circle for a control that sits on the sidebar rail (the
// head's search and New buttons). It paints from the rail's own tokens
// (bg-sidebar-elevated, border-sidebar-hairline-weak, sidebar ink), never the
// content frame's: on Pulsatrix Light the rail is navy while the frame is
// light, and CIRCLE_BUTTON there draws a light grey disc with a dark glyph.
// Every other skin's rail tokens equal its panel/ink, so the result is the
// same pixels as CIRCLE_BUTTON. The geometry (size-9, rounded-full, a 1px
// border) stays CIRCLE_BUTTON's so the two rows line up.
export const SIDEBAR_CIRCLE_BUTTON =
  "flex size-9 shrink-0 items-center justify-center rounded-full border border-sidebar-hairline-weak bg-sidebar-elevated text-sidebar-ink-secondary transition-colors hover:bg-sidebar-elevated-hover hover:text-sidebar-ink";
