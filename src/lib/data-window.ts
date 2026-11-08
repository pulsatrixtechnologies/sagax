// The Data window (experimental, Settings > Developer > Experimental features): a bot's
// Data results (src/components/data) in a window of their own, opened from
// the chat header's Data button or a result's "Open in Data".
//
// Desktop app: main opens one BrowserWindow per bot (electron/data-window.mjs).
// Browser or PWA: a named window per bot on the same route, the way
// /desktop-viewer opens beside the app. Either way the window draws this app
// on `/data-window#bot=<id>[&card=<id>]` (src/components/data/DataWindow.tsx).
//
// The two pages talk over a BroadcastChannel of this origin: the window says
// which result is in view (the main page's composer sends it with the next
// message, as the old Data tab did), and the main page asks an open window
// to show a card.
import type { DataViewContext } from "../../shared/data-context";

export const DATA_WINDOW_PATH = "/data-window";
const CHANNEL = "sagax-data-window";
const BOT_ID = /^[a-zA-Z0-9:_-]{1,64}$/;
const CARD_ID = /^[a-zA-Z0-9:_-]{1,128}$/;

export type DataWindowMessage =
  | { type: "view"; botId: string; view: DataViewContext | null }
  | { type: "card"; botId: string; cardId: string };

export interface DataWindowTarget {
  botId: string;
  cardId?: string;
}

export function dataWindowHref(botId: string, cardId?: string): string {
  const params = new URLSearchParams({ bot: botId });
  if (cardId) params.set("card", cardId);
  return `${DATA_WINDOW_PATH}#${params}`;
}

/** The bot and card a Data window's address names, or null. */
export function readDataWindowTarget(hash: string): DataWindowTarget | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const botId = params.get("bot") ?? "";
  if (!BOT_ID.test(botId)) return null;
  const cardId = params.get("card") ?? "";
  return CARD_ID.test(cardId) ? { botId, cardId } : { botId };
}

/** The browser window name for a bot's Data window: asking again reuses it. */
export function dataWindowName(botId: string): string {
  return `sagax-data-${botId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function channel(): BroadcastChannel | null {
  try {
    return typeof BroadcastChannel === "function" ? new BroadcastChannel(CHANNEL) : null;
  } catch {
    return null;
  }
}

export function postDataWindowMessage(message: DataWindowMessage): void {
  const port = channel();
  if (!port) return;
  try {
    port.postMessage(message);
  } finally {
    port.close();
  }
}

function isMessage(value: unknown): value is DataWindowMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  if (typeof message.botId !== "string" || !BOT_ID.test(message.botId)) return false;
  if (message.type === "card") return typeof message.cardId === "string" && CARD_ID.test(message.cardId);
  if (message.type !== "view") return false;
  const view = message.view as Record<string, unknown> | null;
  return view === null || (typeof view === "object" && typeof view.botId === "string" && typeof view.threadId === "string" && typeof view.cardId === "string");
}

export function subscribeDataWindowMessages(listener: (message: DataWindowMessage) => void): () => void {
  const port = channel();
  if (!port) return () => {};
  port.onmessage = (event: MessageEvent) => {
    if (isMessage(event.data)) listener(event.data);
  };
  return () => port.close();
}

/** "off": the server answered that its switch is off; "unavailable": the
 * desktop could not ask it (electron/data-window.mjs). */
export type OpenDataWindowResult = "created" | "focused" | "refused" | "blocked" | "off" | "unavailable";

/** Opens (or brings forward) this bot's Data window, on `cardId` if given.
 * The caller checks the experimental switch first; main checks it again. */
export async function openDataWindow(request: { botId: string; title: string; cardId?: string }): Promise<OpenDataWindowResult> {
  if (!BOT_ID.test(request.botId)) return "refused";
  const cardId = request.cardId && CARD_ID.test(request.cardId) ? request.cardId : undefined;
  const bridge = window.ogb?.dataWindow;
  if (bridge) {
    const result = await bridge.open({ botId: request.botId, title: request.title, ...(cardId ? { cardId } : {}) }).catch(() => "refused" as const);
    // An open window keeps its address: ask it for the card instead.
    if (result === "focused" && cardId) postDataWindowMessage({ type: "card", botId: request.botId, cardId });
    return result;
  }
  // A named window: the second ask navigates the same one (a hash change, no reload).
  const opened = window.open(dataWindowHref(request.botId, cardId), dataWindowName(request.botId));
  if (!opened) return "blocked";
  opened.focus();
  return "created";
}

/** The tool that loads a table into the bot's database, under whatever
 * prefix the engine gives an MCP tool (`mcp__<server>__data_load`, ...). */
const DATA_LOAD_TOOL = /(?:^|[_.:/-])data_load$/;

/** Whether this conversation has something the Data window can show: a
 * result the bot put on its sheet (the DataResultChip line `data_show`
 * leaves) or a table it loaded (`data_load`, shown under Sources). Read
 * from the messages the page already has, so the chat header's Data entry
 * follows the conversation live without asking the server. */
export function conversationHasData(messages: ReadonlyArray<{ dataResult?: unknown; tool?: { name: string; ok?: boolean } }> | undefined): boolean {
  if (!messages) return false;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!;
    if (message.dataResult) return true;
    if (message.tool && message.tool.ok !== false && DATA_LOAD_TOOL.test(message.tool.name)) return true;
  }
  return false;
}
