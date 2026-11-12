// The bot panel's grouped card (Details > Routines and Details > Coding,
// 2026-10-19: "le même encadré"): one rounded card on the raised
// surface with a fine border, its rows split by hairlines. One place for
// the classes, so the two sections never drift apart.
export const GROUPED_CARD = "flex flex-col overflow-hidden rounded-xl border border-hairline-weak bg-card";

/** A row of a grouped card (its own content lays itself out inside). */
export const GROUPED_ROW = "border-b border-hairline-weak px-3 py-2.5 last:border-b-0";

/** The bot panel's cards (reference design, #2125): one flat card on the
 * panel, no border, no line between the rows. */
export const PANEL_CARD = "flex flex-col overflow-hidden rounded-xl bg-[var(--bot-panel-card)]";

/** A row of a PANEL_CARD. */
export const PANEL_ROW = "px-3 py-2";

/** A section label above a PANEL_CARD: Upcoming, Suggested, Computer, Voice chat. */
export const PANEL_LABEL = "px-0.5 text-[13px] font-normal leading-[18px] text-ink-tertiary";

/** The reference's "Show more" line at the end of a long list in a card
 * (Grok Bot, #2174): the card's full width, centered, small grey words,
 * darker on hover. One place for its look: Routines, Coding and a bot
 * profile's Access card (#4075). */
export const SHOW_MORE_ROW = "w-full py-2 text-center text-[13px] leading-[18px] text-ink-secondary hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60";
