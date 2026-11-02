// Shared Sidebar helpers (extracted from Sidebar.tsx, #1383).
import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import {
  BOT_CHATS_SECTION_ID,
  BOTS_SECTION_ID,
  BUILT_IN_SECTION_ID,
  CHANNELS_SECTION_ID,
  PEOPLE_SECTION_ID,
  PINNED_SECTION_ID,
  isMyTeamSectionName,
  sidebarSectionLabel,
  userSectionName,
} from "@/lib/sidebar-layout";
import {
  EMPTY_PERSONAL_SECTIONS,
  assignToPersonalSection,
  editPersonalSections,
  itemKey,
  usePersonalSections,
  type PersonalSections,
  type SectionEditError,
  type SectionItemKind,
} from "@/lib/personal-sections";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import type { Bot, Group } from "@/state/store";

export const GENERAL_SECTION_ID = "builtin:general";
/** A bot or a group dragged onto a section header or its rows. */
export const ITEM_DRAG_TYPE = "application/x-sagax-sidebar-item";
export const SIDEBAR_WIDTH_KEY = "omb-sidebar-width-v2";
export const SIDEBAR_MIN_WIDTH = 240;
export const SIDEBAR_MAX_WIDTH = 400;
export const SIDEBAR_DEFAULT_WIDTH = 280;

export const COMPOSE_DISMISS = new Set([
  "select",
  "showTeamMap",
  "showRoutines",
  "showAchievements",
  "switchTask",
  "switchGroupTask",
  "newTask",
  "togglePlugins",
  "toggleAppSettings",
]);

const SECTION_LABEL_KEYS: Record<string, LocaleKey> = {
  [PINNED_SECTION_ID]: "sidebar.section.pinned",
  [CHANNELS_SECTION_ID]: "sidebar.section.channels",
  [BOT_CHATS_SECTION_ID]: "sidebar.section.botChats",
  [BOTS_SECTION_ID]: "sidebar.section.bots",
  [PEOPLE_SECTION_ID]: "sidebar.section.people",
};

/** Fade the list's edges the way Grok Bot does: the top 28px once there is
 * something scrolled above, the bottom 48px while there is more below. The
 * mask is the only depth effect the dark sidebar has; there is no shadow. */
export function useScrollFade() {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ top: false, bottom: false });
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const top = el.scrollTop > 1;
    const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
    setEdges((prev) => (prev.top === top && prev.bottom === bottom ? prev : { top, bottom }));
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [measure]);
  const mask = `linear-gradient(to bottom, ${edges.top ? "transparent 0, black 28px" : "black 0"}, ${edges.bottom ? "black calc(100% - 48px), transparent 100%" : "black 100%"})`;
  return { ref, onScroll: measure, style: { maskImage: mask, WebkitMaskImage: mask } as React.CSSProperties };
}

export function readSidebarWidth(): number {
  try {
    const stored = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
    if (Number.isFinite(stored) && stored >= SIDEBAR_MIN_WIDTH && stored <= SIDEBAR_MAX_WIDTH) return stored;
  } catch { /* default width */ }
  return SIDEBAR_DEFAULT_WIDTH;
}

/** Bot-to-bot threads and People are automatic views, not folders to file into. */
export function isAutomaticSidebarSection(id: string): boolean {
  return id === BOT_CHATS_SECTION_ID || id === PEOPLE_SECTION_ID;
}

/** The four built-in section names come from the catalog; a section someone
 * named themselves is their text and stays exactly as typed. */
export function sectionLabel(id: string): string {
  if (id === GENERAL_SECTION_ID) return t("sidebar.section.general");
  if (id === BUILT_IN_SECTION_ID) return t("sidebar.section.builtIn");
  const name = userSectionName(id);
  if (name !== null && isMyTeamSectionName(name)) return t("sidebar.section.myTeam");
  const key = SECTION_LABEL_KEYS[id];
  return key ? t(key) : sidebarSectionLabel(id);
}

/** On an organization server the sidebar's sections are the viewer's own
 * folders (src/lib/personal-sections.ts): they share nothing. Null on a
 * solo server, where the server's sections are the one person's. */
export function usePersonalLayout(): PersonalSections | null {
  const org = usePerspicaxOrg() !== null;
  const stored = usePersonalSections();
  return org ? stored ?? EMPTY_PERSONAL_SECTIONS : null;
}

export function sectionEditMessage(code: SectionEditError): string {
  if (code === "reserved") return t("sidebar.section.reserved");
  if (code === "exists") return t("sidebar.section.exists");
  if (code === "full") return t("sidebar.section.full");
  return t("sidebar.section.namePlaceholder");
}

/** Files a bot or a group in one of the viewer's own sections ("" puts it
 * back in Unassigned). An error text, or null. */
export function assignPersonalSection(kind: SectionItemKind, id: string, name: string, known?: ReadonlySet<string>): string | null {
  const code = editPersonalSections((prefs) => assignToPersonalSection(prefs, itemKey(kind, id), name, known));
  return code ? sectionEditMessage(code) : null;
}

export type BotConfirmKind = "archive" | "delete";

/** A confirmation may span live fleet updates; never authorize from its snapshot. */
export function currentArchivableBot(bots: readonly Bot[], id: string): Bot | undefined {
  const active = bots.filter((candidate) => !candidate.hidden);
  if (active.length <= 1) return undefined;
  return active.find((candidate) => candidate.id === id && !candidate.chiefOfStaff);
}

/** The bot or group a sidebar drag carries, or null. */
export function parseItemDrag(raw: string): { kind: SectionItemKind; id: string } | null {
  try {
    const parsed = JSON.parse(raw) as { kind?: unknown; id?: unknown };
    if ((parsed.kind === "bot" || parsed.kind === "group") && typeof parsed.id === "string" && parsed.id) return { kind: parsed.kind, id: parsed.id };
  } catch {
    /* not ours */
  }
  return null;
}


export function botConfirmCopy(kind: BotConfirmKind, name: string) {
  return kind === "archive"
    ? {
        title: t("sidebar.confirm.archiveTitle", { name }),
        body: t("sidebar.confirm.archiveBody", { name }),
        confirmLabel: t("sidebar.bot.archive"),
        tone: "neutral" as const,
      }
    : {
        title: t("sidebar.confirm.deleteTitle", { name }),
        body: t("sidebar.confirm.deleteBody", { name }),
        confirmLabel: t("common.delete"),
        tone: "danger" as const,
      };
}


export function roomDeleteCopy(group: Pick<Group, "name" | "dm">) {
  const isBotChat = Boolean(group.dm);
  return {
    title: t("sidebar.room.deleteConfirmTitle", { name: group.name }),
    body: isBotChat
      ? t("sidebar.room.deleteChatBody", { name: group.name })
      : t("sidebar.room.deleteChannelBody", { name: group.name }),
    confirmLabel: isBotChat ? t("sidebar.room.deleteChat") : t("sidebar.room.deleteChannel"),
    tone: "danger" as const,
  };
}
