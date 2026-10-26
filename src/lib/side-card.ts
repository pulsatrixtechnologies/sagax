// The floating cards on the chat's right edge share one look and one column:
// the dev context pods at the top (Environment, Context, Connectors) and the
// "This run" checklist above the composer. Both draw with these classes and
// sit in the column `railGeometry` computes (src/components/dev-pods), so
// they line up on the same right edge at the same width.

/** The card: radius, hairline, background and shadow. */
export const SIDE_CARD =
  "pointer-events-auto rounded-2xl border-[0.5px] border-border bg-elevated text-ink shadow-sm";

/** A small icon button in a card's header (collapse, menu, close). */
export const SIDE_CARD_ICON_BUTTON =
  "flex size-6 shrink-0 items-center justify-center rounded-md text-ink-secondary outline-none transition-colors hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-focus";

/** The card's header row: same height and padding in every side card. */
export const SIDE_CARD_HEADER = "flex min-h-[40px] items-center gap-1.5 py-1.5 pl-3 pr-1.5";
