// Pinned chat pages: a few published pages the person keeps one click away
// in the chat top bar. Renderer-only data: no bot sees it, no server stores
// it. Distinct from Library pin / favorite (page.pinned on the server).

/** Where a published page lives for a top-bar pin. */
export interface PinnedChatPage {
  pageId: string;
  botId: string;
  threadId: string;
}

export type WebPanel = { id: string; name: string; page: PinnedChatPage };

export const MAX_WEB_PANELS = 6;
export const MAX_WEB_PANEL_NAME = 40;

const MAX_REF_ID = 200;
const PAGE_ID = /^[A-Za-z0-9_-]{8,40}$/;

/** A page's title as a panel name: one line, at most 40 characters. */
export function pinnedPageName(title: string): string {
  return title.replace(/\s+/g, " ").trim().slice(0, MAX_WEB_PANEL_NAME).trim();
}

function chatPageRef(value: unknown): PinnedChatPage | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const { pageId, botId, threadId } = value as Record<string, unknown>;
  const ok = (part: unknown): part is string =>
    typeof part === "string" && part.length > 0 && part.length <= MAX_REF_ID;
  if (!ok(pageId) || !PAGE_ID.test(pageId) || !ok(botId) || !ok(threadId)) return undefined;
  return { pageId, botId, threadId };
}

/** The stored list, keeping only entries that still validate, at most six.
 * Never throws: a corrupt value reads as no panels. */
export function parseWebPanels(raw: string | null | undefined): WebPanel[] {
  if (!raw) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  const panels: WebPanel[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (panels.length >= MAX_WEB_PANELS) break;
    if (!entry || typeof entry !== "object") continue;
    const { id, name, page } = entry as Record<string, unknown>;
    if (typeof id !== "string" || !id || seen.has(id) || typeof name !== "string") continue;
    const ref = chatPageRef(page);
    const title = pinnedPageName(name);
    if (!ref || !title) continue;
    seen.add(id);
    panels.push({ id, name: title, page: ref });
  }
  return panels;
}

/** The panel that pins this chat page, if any. */
export function findPinnedPage(panels: readonly WebPanel[], page: PinnedChatPage): WebPanel | undefined {
  return panels.find((panel) => panel.page.pageId === page.pageId);
}

/** The list with this chat page pinned (named after its title) or, when it already is, unpinned.
 * Pinning onto a full list changes nothing. */
export function togglePinnedPage(
  panels: readonly WebPanel[],
  page: PinnedChatPage,
  title: string,
): readonly WebPanel[] {
  const pinned = findPinnedPage(panels, page);
  if (pinned) return panels.filter((panel) => panel !== pinned);
  if (panels.length >= MAX_WEB_PANELS) return panels;
  return [...panels, { id: newWebPanelId(panels), name: pinnedPageName(title) || "Page", page }];
}

export function newWebPanelId(existing: readonly WebPanel[]): string {
  let n = existing.length + 1;
  const taken = new Set(existing.map((panel) => panel.id));
  while (taken.has(`panel-${n}`)) n++;
  return `panel-${n}`;
}
