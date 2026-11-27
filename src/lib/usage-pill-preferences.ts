// Settings > Appearance > Conversation (owner 2026-11-26, M-20261126-106,
// M-20261126-108, #5406; 2026-11-27, D-20261127-001, M-20261127-037): the
// usage pill in the message bar, where it sits, its shape, and the
// conversation's context indicator. Preferences of the person, kept like the
// other appearance choices (localStorage, and per person on an organization
// server through shared/user-preferences.ts), changed by a bot through the
// settings tool (shared/settings-actions.ts). The defaults are an agent's
// choice: the pill shown, in the bar after the model choice, three circles,
// the context shown.
import { localChoice } from "./local-choice";

const ON_OFF = ["on", "off"] as const;

/** "Usage in the message bar": show or hide the pill (placement is separate). */
export const usagePillInBar = localChoice<(typeof ON_OFF)[number]>("sagax.usagePillInBar.v1", ON_OFF, "on");

export const USAGE_PILL_PLACEMENTS = ["inBar", "above", "below"] as const;
export type UsagePillPlacement = (typeof USAGE_PILL_PLACEMENTS)[number];

/** Where the pill sits when it is shown: in the bar after the model (default),
 * above the bar at the right, or under the bar at the right (D-20261127-001). */
export const usagePillPlacement = localChoice<UsagePillPlacement>(
  "sagax.usagePillPlacement.v1",
  USAGE_PILL_PLACEMENTS,
  "inBar",
);

export function parseUsagePillPlacement(value: string | null | undefined): UsagePillPlacement {
  return (USAGE_PILL_PLACEMENTS as readonly string[]).includes(value ?? "")
    ? (value as UsagePillPlacement)
    : "inBar";
}

export const USAGE_PILL_SHAPES = ["bars", "circles", "battery", "dots", "text"] as const;
export type UsagePillShape = (typeof USAGE_PILL_SHAPES)[number];

/** The pill's shape: three bars, three circles, a battery, three dots, text only. */
export const usagePillShape = localChoice<UsagePillShape>("sagax.usagePillShape.v1", USAGE_PILL_SHAPES, "circles");

export function parseUsagePillShape(value: string | null | undefined): UsagePillShape {
  return (USAGE_PILL_SHAPES as readonly string[]).includes(value ?? "") ? (value as UsagePillShape) : "circles";
}

/** The conversation's context indicator (the share of the model's window used). */
export const contextIndicator = localChoice<(typeof ON_OFF)[number]>("sagax.contextIndicator.v1", ON_OFF, "on");
