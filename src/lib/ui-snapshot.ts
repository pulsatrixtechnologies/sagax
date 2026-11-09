// The workspace as this computer's own page last showed it: the sidebar
// (bots, rooms, their threads) and the open conversation's last messages.
//
// The desktop keeps it encrypted (electron/ui-snapshot.mjs, one per local
// data folder) so the next launch draws the window before the local server
// answers. That drawing is read only: the reducer marks it provisional, every
// write the page would send waits (src/lib/write-gate.ts), the window takes
// no input (App), and the server's own snapshot replaces it wholesale
// (reducer "hydrate"), never merged. Only what the sidebar and the open
// conversation already show is kept: no instructions, folders, approval
// settings, usage or tokens.
import type { AppState, Bot, Group, GroupTask, Message, Task } from "@/state/store";
import { brandStatus, isBrandStatus, type BrandStatus } from "./brand";

export const UI_SNAPSHOT_VERSION = 1;
/** Messages of the open conversation kept: more than one window of them. */
export const UI_SNAPSHOT_MESSAGES = 40;
/** Older than this, a snapshot is not drawn. */
export const UI_SNAPSHOT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** A launch that waits longer than this for the server drops the drawing. */
export const UI_SNAPSHOT_PROVISIONAL_MS = 5_000;

export interface UiSnapshot {
  version: typeof UI_SNAPSHOT_VERSION;
  savedAt: number;
  /** the page that wrote it: another origin's snapshot is never drawn */
  origin: string;
  brand: BrandStatus;
  selectedId: string;
  sections: string[];
  bots: Bot[];
  groups: Group[];
}

const BOT_FIELDS = [
  "id", "threadId", "mainThreadId", "name", "title", "notifications", "color", "mascotExpression", "mascotBody", "mascotSkin",
  "mascotLook", "avatarUrl", "avatarCrop", "avatarZoom", "avatarFocusX", "avatarFocusY", "unread", "modelSelection", "pinned",
  "hidden", "section", "chiefOfStaff", "publicProfile", "pinnedMessageId", "hasMore",
] as const;
const TASK_FIELDS = ["threadId", "routineRunId", "hidden", "projectId", "title", "createdAt", "pinned", "updatedAt", "unread", "lastReadMessageId", "pinnedMessageId", "archivedAt", "snoozedUntil"] as const;
const GROUP_FIELDS = [
  "id", "threadId", "name", "memberIds", "humanIds", "defaultResponder", "unread", "pinned", "lastReadMessageId", "createdAt",
  "dm", "peopleDm", "memberProfiles", "pinnedMessageId", "section", "ownerId", "hasMore",
] as const;
const GROUP_TASK_FIELDS = ["threadId", "title", "createdAt", "pinned", "updatedAt", "archivedAt", "snoozedUntil", "projectId", "unread", "general"] as const;

function pick<T extends object>(value: T, fields: readonly string[]): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    const v = (value as Record<string, unknown>)[field];
    if (v !== undefined) out[field] = v;
  }
  return out as Partial<T>;
}

function keptMessages(messages: Message[] | undefined, open: boolean): Message[] {
  return open && Array.isArray(messages) ? messages.slice(-UI_SNAPSHOT_MESSAGES) : [];
}

/** What to keep of the live state, or null when it is not the server's yet. */
export function buildUiSnapshot(state: AppState, origin: string, now = Date.now(), brand: BrandStatus = brandStatus()): UiSnapshot | null {
  if (!allowed || !state.hydrated || state.provisional) return null;
  return {
    version: UI_SNAPSHOT_VERSION,
    savedAt: now,
    origin,
    brand,
    selectedId: state.selectedId,
    sections: [...(state.sections ?? [])],
    bots: state.bots.map((bot) => ({
      ...pick(bot, BOT_FIELDS),
      description: "",
      tasks: bot.tasks?.map((task) => pick(task, TASK_FIELDS) as Task),
      messages: keptMessages(bot.messages, bot.id === state.selectedId),
    }) as Bot),
    groups: state.groups.map((group) => ({
      ...pick(group, GROUP_FIELDS),
      bulletin: "",
      tasks: group.tasks?.map((task) => pick(task, GROUP_TASK_FIELDS) as GroupTask),
      messages: keptMessages(group.messages, group.id === state.selectedId),
    }) as Group),
  };
}

/** A stored snapshot this page may draw, or null. */
export function parseUiSnapshot(text: string | null, origin: string, now = Date.now()): UiSnapshot | null {
  if (!text) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const snapshot = value as Partial<UiSnapshot>;
  if (snapshot.version !== UI_SNAPSHOT_VERSION || snapshot.origin !== origin) return null;
  if (typeof snapshot.savedAt !== "number" || now - snapshot.savedAt > UI_SNAPSHOT_MAX_AGE_MS || snapshot.savedAt > now + 60_000) return null;
  if (!Array.isArray(snapshot.bots) || !Array.isArray(snapshot.groups) || !Array.isArray(snapshot.sections)) return null;
  if (typeof snapshot.selectedId !== "string" || !isBrandStatus(snapshot.brand)) return null;
  if (snapshot.bots.length === 0 && snapshot.groups.length === 0) return null;
  const wellFormed = (row: unknown) => Boolean(row) && typeof row === "object" &&
    typeof Reflect.get(row as object, "id") === "string" && typeof Reflect.get(row as object, "threadId") === "string" &&
    Array.isArray(Reflect.get(row as object, "messages"));
  if (!snapshot.bots.every(wellFormed) || !snapshot.groups.every(wellFormed)) return null;
  return snapshot as UiSnapshot;
}

// Only the owner on this computer's own page keeps one (main.tsx sets this
// once the server said who is looking): never a signed-in person, never a
// remote or organization page.
let allowed = false;
export function allowUiSnapshot(value: boolean): void {
  allowed = value;
}

// The snapshot main.tsx read for this launch, for the store's first state.
let launchSnapshot: UiSnapshot | null = null;
export function setLaunchSnapshot(snapshot: UiSnapshot | null): void {
  launchSnapshot = snapshot;
}
export function launchUiSnapshot(): UiSnapshot | null {
  return launchSnapshot;
}

/** This launch's stored snapshot, from the desktop; null in a browser. */
export async function readUiSnapshot(origin: string = location.origin): Promise<UiSnapshot | null> {
  const bridge = typeof window === "undefined" ? undefined : window.ogb?.uiSnapshot;
  if (!bridge) return null;
  try {
    return parseUiSnapshot(await bridge.read(), origin);
  } catch {
    return null;
  }
}

export function clearUiSnapshot(): void {
  void window.ogb?.uiSnapshot?.clear().catch(() => {});
}

/** Save at most every `delayMs`, the latest state, and once more as the page goes. */
export function createUiSnapshotWriter(build: () => UiSnapshot | null, delayMs = 5_000) {
  const bridge = typeof window === "undefined" ? undefined : window.ogb?.uiSnapshot;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    const snapshot = build();
    if (snapshot && bridge) void bridge.write(JSON.stringify(snapshot)).catch(() => false);
  };
  const onHide = () => { if (timer) flush(); };
  if (bridge) window.addEventListener("pagehide", onHide);
  return {
    schedule() {
      if (!bridge || timer) return;
      timer = setTimeout(flush, delayMs);
    },
    dispose() {
      if (timer) clearTimeout(timer);
      timer = null;
      if (bridge) window.removeEventListener("pagehide", onHide);
    },
  };
}
