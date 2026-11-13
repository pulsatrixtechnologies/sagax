// The round 36px control the reference design uses for every top-bar action (search, new,
// "...", gear, close, panel), measured in the owner's configuration (#4163): the
// reference's elevated fill (`circle`), a 1px ring of the ink at 6% dark or 8% light
// (`circle-ring`), the glyph in the ink at 90% dark or 92% light (`circle-glyph`,
// CIRCLE_ICON), and on hover a 6% wash of the ink over the fill. No pressed state of
// its own, as the reference.
export const CIRCLE_BUTTON =
  "flex size-9 shrink-0 items-center justify-center rounded-full border border-circle-ring bg-circle text-circle-glyph transition-colors duration-[120ms] ease-out hover:bg-circle-hover";

// CIRCLE_BUTTON as a round close control: the same disc, plus the accent focus ring.
// Its glyph is X at 18px, strokeWidth 1.75 (CIRCLE_ICON), like every other X of a header:
// lucide's 24-unit glyphs drawn at 18px span the 13 to 14px the reference's 16px glyphs
// fill, with a stroke of about 1.3px, so every round control's glyph uses CIRCLE_ICON.
export const CIRCLE_CLOSE_BUTTON = `${CIRCLE_BUTTON} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60`;
export const CIRCLE_ICON = { size: 18, strokeWidth: 1.75 } as const;

// A labelled indicator on the same 36px surface (the bot page's Private / Shared):
// CIRCLE_BUTTON's height, ring and fill, widened for a label, no hover
// since it does nothing on click.
export const CIRCLE_LABEL =
  "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-circle-ring bg-circle px-3 text-[12px] font-medium leading-none text-ink";

// CIRCLE_LABEL as a button of a top bar (the bot page's Share, and the link
// back of its sub-pages, #4078): the same pill, with a hover and the accent
// focus ring.
export const CIRCLE_LABEL_BUTTON = `${CIRCLE_LABEL} transition-colors hover:bg-circle-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 motion-reduce:transition-none`;

// The same 36px circle for a control that sits on the sidebar rail (the
// head's search and New buttons). It paints from the rail's own tokens
// (sidebar-circle, its ring and glyph, from the rail's ink), never the
// content frame's: on Pulsatrix Light the rail is navy while the frame is
// light, and CIRCLE_BUTTON there draws a light disc with a dark glyph.
// On every other skin the rail's ink is the frame's, so the result is the
// same pixels as CIRCLE_BUTTON (#4163: the reference draws them alike, the
// glyph in the primary ink, no dimmer grey). The geometry (size-9,
// rounded-full, a 1px border) stays CIRCLE_BUTTON's so the two rows line up.
export const SIDEBAR_CIRCLE_BUTTON =
  "flex size-9 shrink-0 items-center justify-center rounded-full border border-sidebar-circle-ring bg-sidebar-circle text-sidebar-circle-glyph transition-colors duration-[120ms] ease-out hover:bg-sidebar-circle-hover";
