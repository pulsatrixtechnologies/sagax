// Whole-app UI customize layout (D-20261127-004, M-20261127-056, #5443).
// A component moves and hides inside its zone only; never changes zone.

export const UI_LAYOUT_KEY = "sagax.uiLayout.v1";

export const ZONE_IDS = ["composerBar", "sidebar", "conversationHeader", "botPage"] as const;
export type ZoneId = (typeof ZONE_IDS)[number];

/** Movable composer bar items (text field and Send stay fixed outside). */
export const COMPOSER_BAR_COMPONENT_IDS = ["plus", "model", "usage", "voice"] as const;
export type ComposerBarComponentId = (typeof COMPOSER_BAR_COMPONENT_IDS)[number];

export const USAGE_PLACEMENTS = ["inBar", "above", "below"] as const;
export type UsagePlacement = (typeof USAGE_PLACEMENTS)[number];

/** Fixed sidebar chrome that never hides (account menu trigger + Customize entry). */
export const SIDEBAR_FIXED_IDS = ["accountMenu", "customizeEntry"] as const;

/** Known movable/hideable sidebar components (sections use their existing ids). */
export const SIDEBAR_KNOWN_COMPONENT_IDS = [
  "collapse",
  "search",
  "new",
  "pinnedTiles",
  "accountUsage",
] as const;
export type SidebarKnownComponentId = (typeof SIDEBAR_KNOWN_COMPONENT_IDS)[number];

/** Conversation header: centre title/pill and right-side controls. */
export const CONVERSATION_HEADER_COMPONENT_IDS = [
  "title",
  "botPanel",
  "exportMenu",
  "liveCall",
  "tasks",
] as const;
export type ConversationHeaderComponentId = (typeof CONVERSATION_HEADER_COMPONENT_IDS)[number];

/** Bot page (profile tabs + General cards) and bot panel tab pills. */
export const BOT_PAGE_COMPONENT_IDS = [
  "tab:general",
  "tab:outcomes",
  "tab:knowledge",
  "tab:stats",
  "card:settings",
  "card:notifications",
  "card:channels",
  "card:accounts",
  "card:more",
  "panel:activity",
  "panel:library",
  "panel:coding",
] as const;
export type BotPageComponentId = (typeof BOT_PAGE_COMPONENT_IDS)[number];

/** Fixed bot-page chrome: close (and panel gear/close) stay reachable. */
export const BOT_PAGE_FIXED_IDS = ["close", "panelGear", "panelClose"] as const;

export type ZoneLayout = {
  /** Visible components in left-to-right / top-to-bottom order. */
  order: string[];
  /** Hidden component ids for this zone. */
  hidden: string[];
  /** composerBar: how many of the first order items sit left of the text field. */
  left?: number;
  /** composerBar: where the usage pill sits when shown. */
  usagePlacement?: UsagePlacement;
};

export type UiLayoutV1 = {
  version: 1;
  zones: Record<ZoneId, ZoneLayout>;
};

export type ComponentSpec = {
  id: string;
  /** Can the person hide it in customize mode. */
  hideable: boolean;
  /** Never movable and never hideable (documented fixed chrome). */
  fixed: boolean;
  /** Locale key for the component label. */
  labelKey: string;
};

export type ZoneSpec = {
  id: ZoneId;
  labelKey: string;
  components: readonly ComponentSpec[];
};
