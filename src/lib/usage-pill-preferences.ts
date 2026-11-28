// Settings > Appearance > Conversation (owner 2026-11-26, M-20261126-106,
// M-20261126-108, #5406; 2026-11-27, D-20261127-001, M-20261127-037; unified
// store D-20261127-004, #5443): the usage pill in the message bar, where it
// sits, its shape per place (M-20261126-108), and the conversation's context
// indicator. Preferences of the person, kept like the other appearance
// choices (localStorage, and per person on an organization server through
// shared/user-preferences.ts), changed by a bot through the settings tool
// (shared/settings-actions.ts). Placement is a facade over sagax.uiLayout.v1;
// the other choices stay on their own keys. The defaults are an agent's
// choice: the pill shown, in the bar after the model choice, three circles in
// the message bar and the account menu, bars for the menu bar place (the
// native icon itself stays two small bars, D-20261127-014), the context
// shown. The message bar keeps `sagax.usagePillShape.v1`, so a shape already
// saved still applies there.
import { useSyncExternalStore } from "react";

import { localChoice } from "./local-choice";
import {
  getUiLayout,
  setUiLayout,
  subscribeUiLayout,
  usagePlacementFromUi,
} from "./ui-layout/preference";
import { USAGE_PLACEMENTS as UI_USAGE_PLACEMENTS, type UsagePlacement } from "./ui-layout/types";

const ON_OFF = ["on", "off"] as const;

/** "Usage in the message bar": show or hide the pill (placement is separate). */
export const usagePillInBar = localChoice<(typeof ON_OFF)[number]>("sagax.usagePillInBar.v1", ON_OFF, "on");

export const USAGE_PILL_PLACEMENTS = UI_USAGE_PLACEMENTS;
export type UsagePillPlacement = UsagePlacement;

function fitsPlacement(value: unknown): value is UsagePillPlacement {
  return typeof value === "string" && (USAGE_PILL_PLACEMENTS as readonly string[]).includes(value);
}

/** Where the pill sits when it is shown: in the bar after the model (default),
 * above the bar at the right, or under the bar at the right (D-20261127-001).
 * Facade over sagax.uiLayout.v1 composerBar.usagePlacement. */
export const usagePillPlacement = {
  key: "sagax.usagePillPlacement.v1",
  get(): UsagePillPlacement {
    return usagePlacementFromUi(getUiLayout());
  },
  set(next: UsagePillPlacement): void {
    if (!fitsPlacement(next)) return;
    const current = getUiLayout();
    if (current.zones.composerBar.usagePlacement === next) {
      // Still write so legacy mirror stays aligned after a direct localStorage poke.
    }
    setUiLayout({
      ...current,
      zones: {
        ...current.zones,
        composerBar: {
          ...current.zones.composerBar,
          usagePlacement: next,
        },
      },
    });
  },
  subscribe(listener: () => void): () => void {
    return subscribeUiLayout(listener);
  },
  use(): UsagePillPlacement {
    return useSyncExternalStore(this.subscribe, this.get, () => "inBar" as UsagePillPlacement);
  },
};

export function parseUsagePillPlacement(value: string | null | undefined): UsagePillPlacement {
  return fitsPlacement(value) ? value : "inBar";
}

export const USAGE_PILL_SHAPES = ["bars", "circles", "battery", "dots", "text"] as const;
export type UsagePillShape = (typeof USAGE_PILL_SHAPES)[number];

/** Every place that shows the usage pill (M-20261126-108). The native menu-bar
 * icon stays two small bars (D-20261127-014); its place still keeps a shape
 * choice so Appearance can name one per place. */
export const USAGE_PILL_PLACES = ["messageBar", "accountMenu", "menuBar"] as const;
export type UsagePillPlace = (typeof USAGE_PILL_PLACES)[number];

/** Shape of the pill in the message bar. Same storage key as before, so a
 * value already saved keeps its effect (M-20261126-108). */
export const usagePillShape = localChoice<UsagePillShape>("sagax.usagePillShape.v1", USAGE_PILL_SHAPES, "circles");

/** Shape of the pill in the account menu's Usage. A shape already saved under
 * the original single key is copied once so it keeps its effect. */
export const usagePillShapeAccountMenu = localChoice<UsagePillShape>(
  "sagax.usagePillShape.accountMenu.v1",
  USAGE_PILL_SHAPES,
  "circles",
);

/** Shape of the pill for the menu bar / notification area place. Default
 * bars; the native tray icon itself stays two small bars (D-20261127-014). */
export const usagePillShapeMenuBar = localChoice<UsagePillShape>(
  "sagax.usagePillShape.menuBar.v1",
  USAGE_PILL_SHAPES,
  "bars",
);

/** Once: a place with no value of its own inherits the original single shape
 * so a value already saved keeps its effect (M-20261126-108). The menu-bar
 * place keeps its own default (bars); the native icon stays two bars. */
function seedPlaceFromLegacy(choice: { key: string; set: (next: UsagePillShape) => void }): void {
  try {
    const local = globalThis.localStorage;
    if (!local || local.getItem(choice.key) !== null) return;
    const legacy = local.getItem(usagePillShape.key);
    if ((USAGE_PILL_SHAPES as readonly string[]).includes(legacy ?? "")) choice.set(legacy as UsagePillShape);
  } catch {
    // storage unavailable: the place keeps its default
  }
}
seedPlaceFromLegacy(usagePillShapeAccountMenu);

const BY_PLACE = {
  messageBar: usagePillShape,
  accountMenu: usagePillShapeAccountMenu,
  menuBar: usagePillShapeMenuBar,
} as const;

export function parseUsagePillShape(value: string | null | undefined): UsagePillShape {
  return (USAGE_PILL_SHAPES as readonly string[]).includes(value ?? "") ? (value as UsagePillShape) : "circles";
}

/** The shape choice for one place. */
export function usagePillShapeChoice(place: UsagePillPlace) {
  return BY_PLACE[place];
}

export function usagePillShapeFor(place: UsagePillPlace): UsagePillShape {
  return BY_PLACE[place].get();
}

export function setUsagePillShapeFor(place: UsagePillPlace, shape: UsagePillShape): void {
  BY_PLACE[place].set(shape);
}

/** The conversation's context indicator (the share of the model's window used). */
export const contextIndicator = localChoice<(typeof ON_OFF)[number]>("sagax.contextIndicator.v1", ON_OFF, "on");
