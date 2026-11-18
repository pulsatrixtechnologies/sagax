// A bot's chat in a window of its own (the bot row menu's "New window",
// issue #4639). It rides the artifact window bridge, as a page window does
// (src/lib/page-windows.ts): one system window per bot, keyed `chat:<botId>`,
// so asking again brings that window forward and the desktop app keeps its
// size and place (electron/artifact-window.mjs). In a browser it is a new
// browser window on the same address. The window draws the bot's own chat
// (ChatView) with no sidebar (BotChatWindow.tsx).
import { artifactWindowPath, CHAT_WINDOW_PREFIX } from "@/components/artifacts/artifact-windows";

const ID = /^[A-Za-z0-9_-]{1,100}$/;

/** First-open size of a bot's window: a phone-wide column, tall. Mirrored by
 * CHAT_WINDOW_SIZE in electron/artifact-window.mjs. */
export const CHAT_WINDOW_SIZE = Object.freeze({ width: 480, height: 760 });

export function chatWindowId(botId: string): string {
  return `${CHAT_WINDOW_PREFIX}${botId}`;
}

/** The bot id a window id names, or null. Pure. */
export function botIdOfChatWindow(id: string): string | null {
  if (typeof id !== "string" || !id.startsWith(CHAT_WINDOW_PREFIX)) return null;
  const botId = id.slice(CHAT_WINDOW_PREFIX.length);
  return ID.test(botId) ? botId : null;
}

/** Whether this surface can open a second window at all: the desktop app, or
 * a browser that can open one. Where it cannot, the menu hides the item. */
export function canOpenBotInOwnWindow(): boolean {
  if (typeof window === "undefined") return false;
  if (window.ogb?.artifactWindow) return typeof window.ogb.artifactWindow.open === "function";
  return typeof window.open === "function" && !/Android|iPhone|iPad/i.test(globalThis.navigator?.userAgent ?? "");
}

/** Open the bot's chat in its own window, or bring that window forward.
 * Resolves false when nothing could be opened. */
export async function openBotInOwnWindow(bot: { id: string; name: string }): Promise<boolean> {
  if (!ID.test(bot.id)) return false;
  const desktop = typeof window !== "undefined" ? window.ogb?.artifactWindow : undefined;
  if (desktop) {
    const result = await desktop
      .open({ botId: bot.id, artifactId: chatWindowId(bot.id), title: bot.name, ...CHAT_WINDOW_SIZE })
      .catch(() => "refused" as const);
    return result !== "refused";
  }
  if (typeof window === "undefined" || typeof window.open !== "function") return false;
  // A named window: asking again for the same bot reuses (focuses) it. Sized
  // so the browser opens a window, not a tab.
  const features = `popup=yes,width=${CHAT_WINDOW_SIZE.width},height=${CHAT_WINDOW_SIZE.height}`;
  const opened = window.open(artifactWindowPath(bot.id, chatWindowId(bot.id)), chatWindowId(bot.id), features);
  opened?.focus?.();
  return opened !== null;
}
