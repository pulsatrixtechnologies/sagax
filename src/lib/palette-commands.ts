// The ⌘K palette's rows, grouped the way Cursor's command palette and Grok
// Bot's quick search are: a heading per group, recently used first, the
// keyboard shortcut at the right edge, and a fuzzy search that keeps the
// groups. Pure (no React, no store), so the grouping and the search are
// tested without a renderer; CommandPalette.tsx renders and runs them.
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { rankFuzzy } from "@/lib/palette-rank";
import type { SearchHit } from "@/lib/search-hit";
import type { AppSettingsSection, Bot, Group, Message } from "@/state/store";
import type { GroupGoalRunStatus } from "../../shared/group-goal-run";

export type PaletteGroupId =
  | "recent"
  | "conversations"
  | "bots"
  | "artifacts"
  | "messages"
  | "navigation"
  | "settings"
  | "goal"
  | "help";

/** Fixed order of the headings; a search keeps it (Cursor does too). */
export const PALETTE_GROUP_ORDER: readonly PaletteGroupId[] = [
  "recent",
  "conversations",
  "bots",
  "artifacts",
  "messages",
  "navigation",
  "settings",
  "goal",
  "help",
];

const GROUP_LABEL: Record<PaletteGroupId, LocaleKey> = {
  recent: "palette.group.recent",
  conversations: "palette.group.conversations",
  bots: "palette.group.bots",
  artifacts: "palette.group.artifacts",
  messages: "palette.group.messages",
  navigation: "palette.group.navigation",
  settings: "palette.group.settings",
  goal: "palette.group.goal",
  help: "palette.group.help",
};

export function paletteGroupLabel(group: PaletteGroupId): string {
  return t(GROUP_LABEL[group]);
}

/** What a row does when picked; CommandPalette.tsx carries it out. */
export type PaletteAction =
  | { kind: "bot"; bot: Bot }
  | { kind: "room"; group: Group }
  | { kind: "message"; hit: SearchHit }
  | { kind: "artifact"; botId: string; artifactId: string; title: string }
  | { kind: "newConversation" }
  | { kind: "newBot" }
  | { kind: "routines" }
  | { kind: "teamMap" }
  | { kind: "connectApps" }
  | { kind: "settings"; section?: AppSettingsSection }
  | { kind: "botSettings"; botId: string }
  | { kind: "botHistory"; botId: string }
  | { kind: "goalStart"; groupId: string; threadId: string }
  | { kind: "goalStatus"; threadId: string; messageId: string }
  | { kind: "goalStop"; groupId: string; threadId: string }
  | { kind: "shortcuts" }
  | { kind: "releaseNotes" }
  | { kind: "tour" };

export interface PaletteItem {
  /** Stable across opens: the recent list remembers it. */
  id: string;
  group: Exclude<PaletteGroupId, "recent">;
  label: string;
  /** Second line or right-hand note (a bot's title, a goal's words). */
  detail?: string;
  /** Extra search words: the group name, synonyms in both languages. */
  words: string[];
  /** Keys shown at the right edge, e.g. ["⌘", "N"]. */
  shortcut?: string[];
  action: PaletteAction;
}

export interface PaletteSection {
  group: PaletteGroupId;
  label: string;
  items: PaletteItem[];
}

/** The goal of the room being looked at, from its newest goal card. */
export interface PaletteGoal {
  groupId: string;
  threadId: string;
  /** Newest goal card in the open thread, when there is one. */
  latest?: { messageId: string; status: GroupGoalRunStatus; goal: string };
}

export interface PaletteContext {
  /** Visible bots in roster order: the first nine get ⌘1 to ⌘9 (App.tsx). */
  bots: readonly Bot[];
  groups: readonly Group[];
  /** Favorite artifacts of every bot this viewer sees (GET /api/artifacts). */
  artifacts?: readonly PaletteArtifact[];
  query: string;
  messageHits: readonly SearchHit[];
  /** Item ids, most recent first (loadPaletteRecents). */
  recents: readonly string[];
  isMac: boolean;
  /** The desktop shell answers ⌘, and shows Updates. */
  desktop: boolean;
  canCreateBots: boolean;
  /** Simple mode does not offer Connect apps (App.tsx closes it). */
  advanced: boolean;
  /** The bot whose chat is open, for "Bot settings". */
  currentBotId?: string;
  /** Set only when a channel (not a direct conversation) is open. */
  goal?: PaletteGoal;
}

/** A favorite artifact as the palette lists it. */
export interface PaletteArtifact {
  id: string;
  botId: string;
  title: string;
  favorite: boolean;
}

export const PALETTE_RECENT_LIMIT = 5;

function keys(isMac: boolean, ...rest: string[]): string[] {
  return [isMac ? "⌘" : "Ctrl", ...rest];
}

/** The newest goal card of a channel's open thread. */
export function latestGoalRun(group: Group): PaletteGoal["latest"] {
  for (let i = group.messages.length - 1; i >= 0; i -= 1) {
    const message: Message = group.messages[i]!;
    if (message.kind === "goal.run" && message.goalRun) {
      return { messageId: message.id, status: message.goalRun.status, goal: message.goalRun.goal };
    }
  }
  return undefined;
}

/** Every command row, before search and grouping. */
export function paletteCommands(context: PaletteContext): PaletteItem[] {
  const { isMac } = context;
  const items: PaletteItem[] = [];
  const nav = t("palette.group.navigation");
  const settings = t("palette.group.settings");
  const goal = t("palette.group.goal");
  const help = t("palette.group.help");

  items.push({
    id: "cmd:newConversation",
    group: "navigation",
    label: t("palette.cmd.newConversation"),
    words: [nav, "new", "chat", "nouveau", "message", "compose"],
    shortcut: keys(isMac, "N"),
    action: { kind: "newConversation" },
  });
  if (context.canCreateBots) {
    items.push({
      id: "cmd:newBot",
      group: "navigation",
      label: t("palette.cmd.newBot"),
      words: [nav, "create", "créer", "add", "ajouter"],
      action: { kind: "newBot" },
    });
  }
  items.push(
    {
      id: "cmd:routines",
      group: "navigation",
      label: t("palette.cmd.routines"),
      words: [nav, "routines", "schedule", "calendar", "calendrier", "horaire"],
      action: { kind: "routines" },
    },
    {
      id: "cmd:teamMap",
      group: "navigation",
      label: t("palette.cmd.teamMap"),
      words: [nav, "team", "map", "équipe", "carte", "canvas"],
      action: { kind: "teamMap" },
    },
  );
  if (context.advanced) {
    items.push({
      id: "cmd:connectApps",
      group: "navigation",
      label: t("palette.cmd.connectApps"),
      words: [nav, "plugins", "apps", "mcp", "applications", "connect"],
      action: { kind: "connectApps" },
    });
  }

  items.push({
    id: "cmd:settings",
    group: "settings",
    label: t("palette.cmd.openSettings"),
    words: [settings, "settings", "preferences", "préférences", "réglages"],
    ...(context.desktop ? { shortcut: keys(isMac, ",") } : {}),
    action: { kind: "settings" },
  });
  const sections: Array<[AppSettingsSection, LocaleKey, string[]]> = [
    ["general", "settings.section.general", ["profile", "profil", "account", "compte", "language", "langue"]],
    ["appearance", "settings.section.appearance", ["theme", "thème", "dark", "sombre", "mode"]],
    ["notifications", "settings.section.notifications", ["sound", "son", "badge", "alert", "alerte"]],
    ["engines", "settings.section.modelsVoice", ["models", "modèles", "voice", "voix", "claude", "codex", "grok", "keys", "clés"]],
  ];
  if (context.desktop) sections.push(["updates", "settings.updates.title", ["update", "version", "mise à jour", "beta"]]);
  for (const [section, labelKey, words] of sections) {
    items.push({
      id: `settings:${section}`,
      group: "settings",
      label: t(labelKey),
      words: [settings, ...words],
      action: { kind: "settings", section },
    });
  }
  const currentBot = context.currentBotId ? context.bots.find((bot) => bot.id === context.currentBotId) : undefined;
  if (currentBot) {
    items.push({
      id: "cmd:botSettings",
      group: "settings",
      label: t("palette.cmd.botSettings", { name: currentBot.name }),
      words: [settings, "bot", "persona", "instructions"],
      action: { kind: "botSettings", botId: currentBot.id },
    });
    items.push({
      id: "cmd:botHistory",
      group: "navigation",
      label: t("palette.cmd.botHistory", { name: currentBot.name }),
      words: [nav, "history", "historique", "activity", "activité", "coding", "runs"],
      action: { kind: "botHistory", botId: currentBot.id },
    });
  }

  // Goal (/goal in a channel's composer). Start, status and stop are wired
  // to what exists: goal mode in the composer, the goal card, the room's
  // Stop. Pause and resume have no route on the server yet, so they are
  // not offered rather than offered and refused.
  if (context.goal) {
    const { groupId, threadId, latest } = context.goal;
    items.push({
      id: "goal:start",
      group: "goal",
      label: t("palette.cmd.goalStart"),
      words: [goal, "/goal", "goal", "objectif", "start", "démarrer", "team", "équipe"],
      action: { kind: "goalStart", groupId, threadId },
    });
    if (latest) {
      items.push({
        id: "goal:status",
        group: "goal",
        label: t("palette.cmd.goalStatus"),
        detail: latest.goal,
        words: [goal, "/goal", "status", "état", "progress", "progrès"],
        action: { kind: "goalStatus", threadId, messageId: latest.messageId },
      });
      if (latest.status === "working") {
        items.push({
          id: "goal:stop",
          group: "goal",
          label: t("palette.cmd.goalStop"),
          words: [goal, "/goal", "stop", "arrêter", "cancel", "annuler"],
          action: { kind: "goalStop", groupId, threadId },
        });
      }
    }
  }

  items.push(
    {
      id: "help:shortcuts",
      group: "help",
      label: t("palette.cmd.shortcuts"),
      words: [help, "keyboard", "clavier", "keys", "touches", "shortcuts", "raccourcis"],
      shortcut: keys(isMac, "/"),
      action: { kind: "shortcuts" },
    },
    {
      id: "help:releaseNotes",
      group: "help",
      label: t("palette.cmd.releaseNotes"),
      words: [help, "release notes", "notes de version", "what's new", "nouveautés", "changelog"],
      action: { kind: "releaseNotes" },
    },
    {
      id: "help:tour",
      group: "help",
      label: t("palette.cmd.tour"),
      words: [help, "tour", "visite", "guide", "onboarding"],
      action: { kind: "tour" },
    },
  );
  return items;
}

function conversationItems(context: PaletteContext): PaletteItem[] {
  const conversations = t("palette.group.conversations");
  return context.groups.map((group) => ({
    id: `room:${group.id}`,
    group: "conversations",
    label: group.name,
    words: [conversations],
    action: { kind: "room", group },
  }));
}

function botItems(context: PaletteContext): PaletteItem[] {
  const bots = t("palette.group.bots");
  return context.bots.map((bot, index) => ({
    id: `bot:${bot.id}`,
    group: "bots",
    label: bot.name,
    ...(bot.title ? { detail: bot.title } : {}),
    words: [bots, ...(bot.title ? [bot.title] : [])],
    ...(index < 9 ? { shortcut: keys(context.isMac, String(index + 1)) } : {}),
    action: { kind: "bot", bot },
  }));
}

/** Favorite artifacts of every bot, the bot's name beside each. */
function artifactItems(context: PaletteContext): PaletteItem[] {
  const heading = t("palette.group.artifacts");
  const names = new Map(context.bots.map((bot) => [bot.id, bot.name]));
  return (context.artifacts ?? []).filter((artifact) => artifact.favorite && names.has(artifact.botId)).map((artifact) => {
    const botName = names.get(artifact.botId)!;
    return {
      id: `artifact:${artifact.id}`,
      group: "artifacts",
      label: artifact.title,
      detail: botName,
      words: [heading, botName],
      action: { kind: "artifact", botId: artifact.botId, artifactId: artifact.id, title: artifact.title },
    };
  });
}

function messageItems(context: PaletteContext): PaletteItem[] {
  return context.messageHits.map((hit) => ({
    id: `msg:${hit.threadId}:${hit.messageId}`,
    group: "messages",
    label: hit.name,
    ...(hit.task ? { detail: hit.task } : {}),
    words: [],
    action: { kind: "message", hit },
  }));
}

/** The palette's sections, in PALETTE_GROUP_ORDER, empty ones left out.
 * No query: Recent first (what was picked last, at most five), then each
 * group with what Recent already shows taken out. A query: every group
 * filtered and ranked on its own (prefix, word start, substring, search
 * words, then letters in order), headings kept; transcript hits (already
 * matched by the server) under Messages. */
export function buildPaletteSections(context: PaletteContext): PaletteSection[] {
  const query = context.query.trim();
  const all = [...conversationItems(context), ...botItems(context), ...artifactItems(context), ...paletteCommands(context)];
  const byGroup = new Map<PaletteGroupId, PaletteItem[]>();
  if (!query) {
    const byId = new Map(all.map((item) => [item.id, item]));
    const recent = context.recents
      .map((id) => byId.get(id))
      .filter((item): item is PaletteItem => item !== undefined)
      .slice(0, PALETTE_RECENT_LIMIT);
    const shown = new Set(recent.map((item) => item.id));
    byGroup.set("recent", recent);
    for (const item of all) {
      if (shown.has(item.id)) continue;
      byGroup.set(item.group, [...(byGroup.get(item.group) ?? []), item]);
    }
  } else {
    for (const group of PALETTE_GROUP_ORDER) {
      if (group === "recent" || group === "messages") continue;
      const ranked = rankFuzzy(all.filter((item) => item.group === group), query, (item) => ({
        label: item.label,
        words: item.words,
      }));
      byGroup.set(group, ranked);
    }
    byGroup.set("messages", messageItems(context));
  }
  return PALETTE_GROUP_ORDER.flatMap((group) => {
    const items = byGroup.get(group) ?? [];
    return items.length ? [{ group, label: paletteGroupLabel(group), items }] : [];
  });
}

/** For Recent rows: "Category: Command", as Cursor's palette writes it. */
export function paletteCategoryLabel(item: PaletteItem): string {
  return t("palette.categoryCommand", { category: paletteGroupLabel(item.group), command: item.label });
}

// Recent: this computer's convenience only (a viewer's own list, never
// shared), so plain localStorage, guarded: a private window or blocked
// storage simply has no recent list.
export const PALETTE_RECENTS_KEY = "sagax.palette.recent.v1";

type RecentStore = Pick<Storage, "getItem" | "setItem"> | null | undefined;

function defaultStore(): RecentStore {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function loadPaletteRecents(store: RecentStore = defaultStore()): string[] {
  try {
    const parsed: unknown = JSON.parse(store?.getItem(PALETTE_RECENTS_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string").slice(0, PALETTE_RECENT_LIMIT)
      : [];
  } catch {
    return [];
  }
}

/** Puts an item first in Recent. Transcript hits are one-off finds and stay
 * out; so does the goal's stop, which only makes sense while a goal works. */
export function rememberPaletteRecent(id: string, store: RecentStore = defaultStore()): string[] {
  const current = loadPaletteRecents(store);
  if (id.startsWith("msg:") || id === "goal:stop") return current;
  const next = [id, ...current.filter((existing) => existing !== id)].slice(0, PALETTE_RECENT_LIMIT);
  try {
    store?.setItem(PALETTE_RECENTS_KEY, JSON.stringify(next));
  } catch {
    /* quota or blocked storage: Recent stays as it was */
  }
  return next;
}
