// A custom colour, duo-tone or mood (M-20261119-073, JC: « custom color
// picker for Colour, Duo-tone, Mood »): the person's own colours beside the
// fixed swatches of each row. The choice is a tint like the swatches' and is
// kept where they are (`omb-skin-tint`, synced with the person's
// preferences, and the Perspicax account's `tint`), written as its kind and
// its colours, the same in Sagax and in the Perspicax console:
//
//   custom:#rrggbb                       one colour
//   custom-duo:#rrggbb,#rrggbb,<0-359>   two colours and the gradient's angle
//   custom-mood:#rrggbb,#rrggbb,#rrggbb  the ground, then the two accents
//
// An app that does not know it reads an unknown tint and wears the family's
// own look. This module only reads that form; src/lib/custom-colours.ts
// writes it and derives what it wears, fetched with the picker or with a
// custom tint worn.

export const CUSTOM_KINDS = ["custom", "custom-duo", "custom-mood"] as const;
export type CustomKind = (typeof CUSTOM_KINDS)[number];

export interface CustomColour {
  kind: "custom";
  color: string;
}
export interface CustomDuo {
  kind: "custom-duo";
  from: string;
  to: string;
  angle: number;
}
export interface CustomMood {
  kind: "custom-mood";
  ground: string;
  from: string;
  to: string;
}
export type CustomTint = CustomColour | CustomDuo | CustomMood;

/** The three forms in one: the kind, then one, two or three colours, a
 *  duo-tone's angle last. */
const FORM = /^(custom|custom-duo|custom-mood):(#[0-9a-f]{6})(?:,(#[0-9a-f]{6}),(#[0-9a-f]{6}|[0-9]{1,3}))?$/;

/** A stored custom tint, or null for anything else (a swatch's id included). */
export function parseCustomTint(value: unknown): CustomTint | null {
  const m = typeof value === "string" ? FORM.exec(value) : null;
  if (!m) return null;
  const [, kind, a, b, c] = m;
  if (kind === "custom") return b ? null : { kind: "custom", color: a };
  if (!b) return null;
  if (kind === "custom-duo") return c[0] !== "#" && Number(c) < 360 ? { kind: "custom-duo", from: a, to: b, angle: Number(c) } : null;
  return c[0] === "#" ? { kind: "custom-mood", ground: a, from: b, to: c } : null;
}

/** The kind of a stored custom tint, else null. */
export const customKindOf = (tint: unknown): CustomKind | null => parseCustomTint(tint)?.kind ?? null;

/** What a custom swatch opens on the first time. */
export const CUSTOM_DEFAULTS: Record<CustomKind, string> = {
  custom: "custom:#7c5cff",
  "custom-duo": "custom-duo:#f472b6,#22d3ee,135",
  "custom-mood": "custom-mood:#101827,#38bdf8,#a78bfa",
};
