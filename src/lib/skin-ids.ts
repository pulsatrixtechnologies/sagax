export const SKIN_IDS = [
  "pulsatrix",
  "pulsatrix-light",
  "midnight",
  "atelier",
  "foundry",
  "lagoon",
  "graphite",
  "linen",
  "dusk",
  "daylight",
  "retro98",
  "meadow",
] as const;
export type SkinId = (typeof SKIN_IDS)[number];
