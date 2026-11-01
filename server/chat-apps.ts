// Live chat apps on the server: the two agent tools that post and replace a
// live HTML surface in a conversation (show_html, update_html). A bot's page
// is validated, scrubbed of secrets and given its text fallback here, once;
// everything after that reads the stored message.
//
// Both tools arrive on the same internal options-card route as the chat
// widgets (server/chat-widgets.ts createAgentCard), which has already checked
// that the conversation is the calling bot's own. The page itself is never
// rendered on the server; it is drawn in the app's existing sandboxed frame
// (src/components/AppMessage.tsx -> src/lib/rich-blocks.ts), an opaque-origin
// iframe with "allow-scripts" only and a no-network CSP. This module adds no
// bridge and no network egress, so the sandbox is reused as-is, never widened.
import { APP_VERSION, appToText, parseAppInput, type AppPayload } from "../shared/app.ts";
import { redactSecretsInText } from "./redact.ts";
import type { AgentCardResult, AgentCardStore } from "./chat-card-types.ts";

const ROOM_REFUSAL = "Live apps are not available in rooms. Show it in a direct conversation.";
const NO_SUCH_APP = "No live app with that id in this conversation.";

type CanonicalApp =
  | { ok: true; payload: Omit<AppPayload, "rev">; text: string; masked: boolean }
  | { ok: false; error: string };

/** The page and title as they are stored, with every string scrubbed of
 * anything that reads as a secret, plus the text that stands in for the live
 * surface. `masked` is true when the scrub changed what the bot wrote, so the
 * bot can be told a secret it put in the page was removed. */
function canonicalApp(input: Record<string, unknown>): CanonicalApp {
  const parsed = parseAppInput(input);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const html = redactSecretsInText(parsed.html);
  const title = parsed.title === undefined ? undefined : redactSecretsInText(parsed.title);
  const masked = html !== parsed.html || title !== parsed.title;
  const payload: Omit<AppPayload, "rev"> = { v: APP_VERSION, html, ...(title ? { title } : {}) };
  return { ok: true, payload, text: appToText({ html, title }), masked };
}

/** One call on the internal card route for a live app: show_html posts a new
 * surface, update_html replaces one in place. The caller (createAgentCard)
 * has already confirmed the thread is this bot's own direct conversation. */
export function createAppCard(args: {
  store: AgentCardStore;
  bot: { id: string };
  threadId: string;
  input: Record<string, unknown>;
  authored?(messageId: string): void;
}): AgentCardResult {
  const { store, bot, threadId, input } = args;
  if (store.groupByThread(threadId)) return { ok: false, status: 409, error: ROOM_REFUSAL };

  if (input.tool === "show_html") {
    const app = canonicalApp(input);
    if (!app.ok) return { ok: false, status: 400, error: app.error };
    // No `from`: a bot-authored row that carries one is replayed as another
    // bot's line in a direct thread (directContext in server/index.ts).
    const message = store.appendMessage(threadId, { role: "bot", kind: "app", text: app.text, app: app.payload });
    args.authored?.(message.id);
    return { ok: true, messageId: message.id, ...(app.masked ? { masked: true as const } : {}) };
  }

  const appId = input.app_id;
  if (typeof appId !== "string") return { ok: false, status: 400, error: "app_id: must be the id show_html returned." };
  const existing = store.messagesFor(threadId).find((message) => message.id === appId);
  if (!existing || existing.kind !== "app" || !existing.app || (existing.from && existing.from.botId !== bot.id)) {
    return { ok: false, status: 404, error: NO_SUCH_APP };
  }
  const app = canonicalApp(input);
  if (!app.ok) return { ok: false, status: 400, error: app.error };
  // A new page is a new revision: a renderer remounts the frame on it, so a
  // live update is a clean replace, never mistaken for the page navigating.
  const rev = (existing.app.rev ?? 0) + 1;
  const patched = store.patchMessage(threadId, existing.id, { text: app.text, app: { ...app.payload, rev } });
  if (!patched) return { ok: false, status: 404, error: NO_SUCH_APP };
  args.authored?.(patched.id);
  return { ok: true, messageId: patched.id, ...(app.masked ? { masked: true as const } : {}) };
}

/** True when a card-route call is a live-app tool. */
export function isAppTool(tool: unknown): tool is "show_html" | "update_html" {
  return tool === "show_html" || tool === "update_html";
}
