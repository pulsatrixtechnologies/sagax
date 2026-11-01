// Opening a published page: the one way (2026-10-28; lot 5 layout 2026-10-31).
//
//   openPage(page)            in its conversation frame, when that
//                             conversation is on screen; else in a window
//                             of its own. ChatView lays the panel beside the
//                             chat on desktop and full screen on a phone
//                             (src/lib/page-chat-layout.ts).
//   openPage(page, "window")  in a window of its own (src/lib/page-windows.ts)
//
// Every place that opens a page calls openPage: the card in the chat, the
// chip over a message, the Library, Settings > Pages, the open page's
// « Open in a window ». Both destinations draw the same PageSurface
// (src/components/PageViewer.tsx), so a page looks and closes the same
// everywhere. The desktop app's single frame hook (electron/page-frames.mjs)
// then serves the page in whichever window it lands in.
//
// The panel: one at a time per app window. The conversation stays mounted
// (beside the page on desktop, under it on a phone), so closing the page
// puts the person back exactly where they were. A ChatView says it can host
// the panel for its bot (registerPagePanelHost); without a host on screen,
// asking for the panel would have shown nothing (the Library of a bot whose
// conversation is not on screen), so the page opens in its own window
// instead. Each page also keeps the place its reader last scrolled to (only
// a number, in memory for this window), so a page the bot changes, or a page
// opened again, is drawn at the same place.
import { useEffect, useSyncExternalStore } from "react";

import { openPageInOwnWindow } from "./page-windows";

export interface OpenPage {
  pageId: string;
  /** The conversation the page belongs to: its bot and thread. */
  botId: string;
  threadId: string;
  /** The title known when it was opened (the card's), until the page answers. */
  title: string;
  /** The version to show first; absent: the newest. */
  version?: number;
  /** When it was opened: the bot's line over the composer shows what came after. */
  openedAt?: number;
}

const ID = /^[A-Za-z0-9_-]{8,40}$/;
const MAX_PLACES = 200;

let current: OpenPage | null = null;
const listeners = new Set<() => void>();
const places = new Map<string, number>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Where a page opens: over its conversation, or in a window of its own. */
export type PageOpenWhere = "panel" | "window";

/** Where a page ended up, or null when nothing could open. */
export type PageOpened = PageOpenWhere | null;

/** The conversations on screen that can draw the panel: botId -> how many
 * (a bot's conversation and its side panel are two). */
const hosts = new Map<string, number>();

/** A conversation says it draws the page panel for this bot while mounted.
 * Returns the function that takes it back. */
export function registerPagePanelHost(botId: string): () => void {
  hosts.set(botId, (hosts.get(botId) ?? 0) + 1);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    const left = (hosts.get(botId) ?? 1) - 1;
    if (left > 0) hosts.set(botId, left);
    else hosts.delete(botId);
  };
}

/** Whether a conversation on screen can draw the panel for this bot. */
export function hasPagePanelHost(botId: string): boolean {
  return (hosts.get(botId) ?? 0) > 0;
}

/** A conversation on screen: it hosts the page panel for its bot. */
export function usePagePanelHost(botId: string, enabled = true): void {
  useEffect(() => (enabled ? registerPagePanelHost(botId) : undefined), [botId, enabled]);
}

/** Which way a page opens, given where it was asked and whether its
 * conversation is on screen. Pure. */
export function pageOpenWay(where: PageOpenWhere, hosted: boolean): PageOpenWhere {
  return where === "panel" && hosted ? "panel" : "window";
}

/**
 * Open a page: over its conversation when asked so and that conversation is
 * on screen, else in a window of its own. Resolves where it opened, or null
 * when nothing could open (no desktop bridge and no window.open).
 */
export async function openPage(page: OpenPage, where: PageOpenWhere = "panel"): Promise<PageOpened> {
  if (!ID.test(page.pageId)) return null;
  const way = pageOpenWay(where, hasPagePanelHost(page.botId));
  if (way === "panel") {
    openPagePanel(page);
    return "panel";
  }
  const opened = await openPageInOwnWindow({ id: page.pageId, botId: page.botId, title: page.title });
  return opened ? "window" : null;
}

/** Open a page over its conversation (another open page is replaced).
 * Callers open a page through openPage; this is the panel itself. */
export function openPagePanel(page: OpenPage): void {
  if (!ID.test(page.pageId)) return;
  current = { ...page, openedAt: page.openedAt ?? Date.now() };
  emit();
}

/** The open page was renamed: a message sent from it names the new title. */
export function renameOpenPage(pageId: string, title: string): void {
  if (!current || current.pageId !== pageId || current.title === title) return;
  current = { ...current, title };
  emit();
}

/** Close the open page; with `pageId`, only when that page is the open one. */
export function closePagePanel(pageId?: string): void {
  if (!current || (pageId && current.pageId !== pageId)) return;
  current = null;
  emit();
}

/** The open page, when it belongs to this bot's conversation. Pure. */
export function openPageFor(page: OpenPage | null, botId: string, threadId: string | undefined): OpenPage | null {
  return page && page.botId === botId && (!threadId || page.threadId === threadId) ? page : null;
}

export function currentOpenPage(): OpenPage | null {
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useOpenPage(): OpenPage | null {
  return useSyncExternalStore(subscribe, currentOpenPage, currentOpenPage);
}

/** Remember how far down a page its reader is. */
export function rememberPagePlace(pageId: string, y: number): void {
  if (!ID.test(pageId) || !Number.isSafeInteger(y) || y < 0) return;
  places.delete(pageId);
  places.set(pageId, y);
  while (places.size > MAX_PLACES) places.delete(places.keys().next().value!);
}

/** Where a page was last read; 0 for a page not read yet. */
export function pagePlace(pageId: string): number {
  return places.get(pageId) ?? 0;
}

/** Tests: nothing open, no place kept, no host on screen. */
export function resetOpenPage(): void {
  current = null;
  places.clear();
  hosts.clear();
  emit();
}

/** The newest version of a page the conversation names (its cards), so an
 * open page follows the bot's changes. Pure. */
export function latestPageVersionIn(messages: ReadonlyArray<{ pagePublish?: { pageId: string; version: number } }>, pageId: string): number | undefined {
  let latest: number | undefined;
  for (const message of messages) {
    const ref = message.pagePublish;
    if (ref && ref.pageId === pageId && (latest === undefined || ref.version > latest)) latest = ref.version;
  }
  return latest;
}
