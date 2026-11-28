// Zone registry for customize mode (D-20261127-004, #5443).
// PR1 wires composerBar + sidebar; conversationHeader and botPage are stubs.

import {
  BOT_CHATS_SECTION_ID,
  BOTS_SECTION_ID,
  BUILT_IN_SECTION_ID,
  CHANNELS_SECTION_ID,
  PEOPLE_SECTION_ID,
} from "../sidebar-layout";
import type { ComponentSpec, ZoneId, ZoneSpec } from "./types";
import { COMPOSER_BAR_COMPONENT_IDS, SIDEBAR_KNOWN_COMPONENT_IDS } from "./types";

/** Matches Sidebar.tsx-parts/helpers GENERAL_SECTION_ID (kept here to avoid lib→components). */
const GENERAL_SECTION_ID = "builtin:general";

const composerComponents: ComponentSpec[] = COMPOSER_BAR_COMPONENT_IDS.map((id) => ({
  id,
  hideable: true,
  fixed: false,
  labelKey: `composer.customize.item.${id}`,
}));

const sidebarKnown: ComponentSpec[] = SIDEBAR_KNOWN_COMPONENT_IDS.map((id) => ({
  id,
  hideable: true,
  fixed: false,
  labelKey: `ui.customize.item.${id}`,
}));

/** Built-in section ids that may appear as sidebar zone components. */
export const SIDEBAR_BUILTIN_SECTION_IDS = [
  GENERAL_SECTION_ID,
  BUILT_IN_SECTION_ID,
  BOTS_SECTION_ID,
  CHANNELS_SECTION_ID,
  BOT_CHATS_SECTION_ID,
  PEOPLE_SECTION_ID,
] as const;

const sidebarBuiltinSections: ComponentSpec[] = SIDEBAR_BUILTIN_SECTION_IDS.map((id) => ({
  id,
  hideable: true,
  fixed: false,
  labelKey: `ui.customize.item.section`,
}));

export const ZONE_REGISTRY: Record<ZoneId, ZoneSpec> = {
  composerBar: {
    id: "composerBar",
    labelKey: "ui.customize.zone.composerBar",
    components: Object.freeze(composerComponents),
  },
  sidebar: {
    id: "sidebar",
    labelKey: "ui.customize.zone.sidebar",
    components: Object.freeze([...sidebarKnown, ...sidebarBuiltinSections]),
  },
  // PR2 stubs: preference shape ready, UI not wired.
  conversationHeader: {
    id: "conversationHeader",
    labelKey: "ui.customize.zone.conversationHeader",
    components: Object.freeze([] as ComponentSpec[]),
  },
  botPage: {
    id: "botPage",
    labelKey: "ui.customize.zone.botPage",
    components: Object.freeze([] as ComponentSpec[]),
  },
};

export function zoneComponent(zoneId: ZoneId, componentId: string): ComponentSpec | undefined {
  return ZONE_REGISTRY[zoneId].components.find((entry) => entry.id === componentId);
}

export function isHideable(zoneId: ZoneId, componentId: string): boolean {
  const spec = zoneComponent(zoneId, componentId);
  if (spec) return spec.hideable && !spec.fixed;
  // Dynamic personal sections (section:Name) are hideable in the sidebar zone.
  if (zoneId === "sidebar" && componentId.startsWith("section:")) return true;
  return false;
}

export function isFixedComponent(zoneId: ZoneId, componentId: string): boolean {
  const spec = zoneComponent(zoneId, componentId);
  return Boolean(spec?.fixed);
}

/** Default visible order for a zone (known components; sections filled at migrate/runtime). */
export function defaultZoneOrder(zoneId: ZoneId): string[] {
  if (zoneId === "composerBar") return [...COMPOSER_BAR_COMPONENT_IDS];
  if (zoneId === "sidebar") {
    return [
      "collapse",
      "search",
      "new",
      "pinnedTiles",
      GENERAL_SECTION_ID,
      BUILT_IN_SECTION_ID,
      "accountUsage",
    ];
  }
  return [];
}
