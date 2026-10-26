// The bot panel's grouped card (Details > Routines and Details > Coding,
// JC 2026-10-19: "le même encadré"): one rounded card on the raised
// surface with a fine border, its rows split by hairlines. One place for
// the classes, so the two sections never drift apart.
export const GROUPED_CARD = "flex flex-col overflow-hidden rounded-xl border border-hairline-weak bg-card";

/** A row of a grouped card (its own content lays itself out inside). */
export const GROUPED_ROW = "border-b border-hairline-weak px-3 py-2.5 last:border-b-0";
