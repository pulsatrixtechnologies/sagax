// Chat widgets on the server
// (docs/superpowers/specs/2026-10-13-chat-widgets-design.md): the two agents
// tools that post and replace a widget message, and the press that answers
// one. A bot's tree is normalised, scrubbed of secrets and given its text
// fallback here, once; everything after that reads the stored message.
//
// Both tools arrive on the internal options-card route, whose handler calls
// createAgentCard: a body with `tool` is a widget call, a body without one is
// the Watcher's legacy options card, unchanged.
import {
  parseWidgetInput, resolveWidgetAction, widgetActions, widgetFields, widgetToText, WIDGET_LIMITS,
  type WidgetAction, type WidgetNode, type WidgetPayload, type WidgetRoot, type WidgetSettled,
} from "../shared/widget.ts";
import { parsePageProposal, type PageKind } from "../shared/published-pages.ts";
import type { MausColor } from "../shared/wire.ts";
import { createAppCard, isAppTool } from "./chat-apps.ts";
import { createOptionsCard } from "./options-card.ts";
import { ASK_CHOICE_TOOL, parseAskChoiceInput } from "../shared/options-card.ts";
import { isSecretName, mask, redactSecretsInText } from "./redact.ts";
import type { AgentCardResult, AgentCardStore } from "./chat-card-types.ts";

export type { AgentCardResult, AgentCardStore } from "./chat-card-types.ts";

const ROOM_REFUSAL = "Widgets are not available in rooms yet. Answer in text.";
const NO_SUCH_WIDGET = "No widget with that id in this conversation.";
/** What a widget with nothing readable in it (a lone spacer) is called, so
 * the row still has words to preview, replay and reply to. */
const EMPTY_FALLBACK = "[widget]";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Everything below a node's own props. Every string loses its secrets. Keys
 * are this app's (label, action, dataKey) except under an action's `payload`
 * and in a chart's `data` rows, where the bot chose them. There a key is
 * scrubbed too, and a key that names a secret (api_key, db_password: the
 * test server/redact.ts redactSecrets uses) masks its string value whatever
 * that value looks like, as does a {name, value} entry so named. A chart's
 * series and axis name the same keys as strings, and the same string always
 * scrubs to the same result, so they still line up. */
function redactValue(value: unknown, botKeys: boolean): unknown {
  if (typeof value === "string") return redactSecretsInText(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, botKeys));
  if (!isRecord(value)) return value;
  const named = botKeys && typeof value.name === "string" && typeof value.value === "string" && isSecretName(value.name);
  return Object.fromEntries(Object.entries(value).map(([key, inner]) => [
    botKeys ? redactSecretsInText(key) : key,
    botKeys && typeof inner === "string" && (isSecretName(key) || (named && key === "value"))
      ? mask(inner)
      : redactValue(inner, botKeys || key === "payload"),
  ]));
}

/** One canonical node with every string in it scrubbed. `type` and `id` are
 * the server's own (a node name, "n12") and can hold nothing of the bot's:
 * they stay as written, so a held secret that happens to spell part of one
 * can never rename a node or break the ref a press names it by. */
function redactNode(node: WidgetNode): WidgetNode {
  const out: WidgetNode = { type: node.type, id: node.id };
  for (const [key, value] of Object.entries(node)) {
    if (key === "type" || key === "id") continue;
    out[key] = key === "children" && Array.isArray(value)
      ? (value as WidgetNode[]).map(redactNode)
      : redactValue(value, key === "data");
  }
  return out;
}

/** parseWidgetInput made every action label and field name distinct. Two
 * that held different secrets of one length now read the same; a press could
 * no longer say which it meant. */
function stillDistinct(root: WidgetRoot): boolean {
  const labels = widgetActions(root).filter((entry) => !entry.client).map((entry) => entry.label);
  const names = widgetFields(root).map((field) => field.name);
  return new Set(labels).size === labels.length && new Set(names).size === names.length;
}

/** JSON with every object's keys in one order, so two trees that hold the
 * same things compare equal however they were built. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) => (isRecord(inner)
    ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
    : inner));
}

function clip(text: string): string {
  return text.length <= WIDGET_LIMITS.fallback ? text : `${text.slice(0, WIDGET_LIMITS.fallback - 1).trimEnd()}…`;
}

type CanonicalWidget =
  | { ok: true; root: WidgetRoot; text: string; masked: boolean }
  | { ok: false; status: 400; error: string };

/** The tree as it is stored and the text that stands in for it. Scrubbed
 * before clipped: half a key no longer looks like one. */
function canonicalWidget(input: Record<string, unknown>): CanonicalWidget {
  const parsed = parseWidgetInput(input.widget);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
  const given = input.fallback_text;
  if (given !== undefined && given !== null && typeof given !== "string") {
    return { ok: false, status: 400, error: "fallback_text: must be a string." };
  }
  const root = redactNode(parsed.value);
  if (!stillDistinct(root)) {
    return { ok: false, status: 400, error: "widget: two actions or fields read the same once secrets were removed; give each a plain, distinct label and name." };
  }
  const text = clip(redactSecretsInText(given?.trim() || widgetToText(root)));
  // The bot is told when the scrub changed what it wrote: a payload field it named `key` for an id reads back masked.
  return { ok: true, root, text: text || EMPTY_FALLBACK, masked: stable(root) !== stable(parsed.value) };
}

/** One call on the internal card route: show_widget, update_widget, or (no
 * `tool`) the legacy options card. The route has already checked that the
 * conversation is the calling bot's own. */
export function createAgentCard(args: {
  store: AgentCardStore;
  bot: { id: string; name: string; color: MausColor };
  threadId: string;
  input: unknown;
  /** Told the row a widget call wrote. The calling turn's own session made
   * it, so it must not be offered back to that session as a message it has
   * not seen (server/delta-context.ts Handoffs.authored). */
  authored?(messageId: string): void;
  /** propose_page (server/published-pages.ts): stores a proposed version,
   * never a published one. Absent: the tool is refused. */
  proposePage?(input: { pageId?: string; title: string; kind: PageKind; content: string }):
    { ok: true; pageId: string; version: number } | { ok: false; status: 400 | 404 | 409; error: string };
}): AgentCardResult {
  const { store, bot, threadId, input } = args;
  if (!isRecord(input) || input.tool === undefined) return createOptionsCard(args);
  if (input.tool === ASK_CHOICE_TOOL) return createChoiceCard(args, input);
  if (input.tool === "propose_page") return proposePageCard(args, input);
  if (isAppTool(input.tool)) return createAppCard({ store, bot, threadId, input, authored: args.authored });
  if (input.tool !== "show_widget" && input.tool !== "update_widget") {
    return { ok: false, status: 400, error: "tool: must be show_widget or update_widget." };
  }
  if (store.groupByThread(threadId)) return { ok: false, status: 409, error: ROOM_REFUSAL };

  if (input.tool === "show_widget") {
    const widget = canonicalWidget(input);
    if (!widget.ok) return widget;
    // No `from`: in a direct thread a bot-authored row that carries one is
    // replayed as another bot's line (directContext in server/index.ts).
    const message = store.appendMessage(threadId, { role: "bot", kind: "widget", text: widget.text, widget: { v: 1, root: widget.root } });
    args.authored?.(message.id);
    return { ok: true, messageId: message.id, ...(widget.masked ? { masked: true as const } : {}) };
  }

  const existing = store.messagesFor(threadId).find((message) => message.id === input.widget_id);
  if (!existing || existing.kind !== "widget" || !existing.widget || (existing.from && existing.from.botId !== bot.id)) {
    return { ok: false, status: 404, error: NO_SUCH_WIDGET };
  }
  if (existing.widget.settled) return { ok: false, status: 409, error: "The person already answered that widget. Show a new one." };
  const widget = canonicalWidget(input);
  if (!widget.ok) return widget;
  // A new tree renumbers its nodes: the revision lets a press made on the old
  // one be told apart (prepareWidgetPress).
  const rev = (existing.widget.rev ?? 0) + 1;
  const patched = store.patchMessage(threadId, existing.id, { text: widget.text, widget: { v: 1, root: widget.root, rev } });
  if (!patched) return { ok: false, status: 404, error: NO_SUCH_WIDGET };
  args.authored?.(patched.id);
  return { ok: true, messageId: patched.id, ...(widget.masked ? { masked: true as const } : {}) };
}

/** ask_choice: any bot may draw the passive choice card. */
function createChoiceCard(args: Parameters<typeof createAgentCard>[0], input: Record<string, unknown>): AgentCardResult {
  const parsed = parseAskChoiceInput(input);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
  const message = args.store.appendMessage(args.threadId, {
    role: "bot", kind: "options", card: parsed.value,
    // a direct thread replays a bot row that carries `from` as another bot's line
    ...(args.store.groupByThread(args.threadId) ? { from: { botId: args.bot.id, name: args.bot.name, color: args.bot.color } } : {}),
  });
  args.authored?.(message.id);
  return { ok: true, messageId: message.id };
}

/** A bot's page proposal: the version is stored as proposed and the row the
 * person publishes it from (`pagePublish`) is written. Nothing is served
 * until the person's Publish (server/routes/published-pages.ts). */
function proposePageCard(args: Parameters<typeof createAgentCard>[0], input: Record<string, unknown>): AgentCardResult {
  const { store, threadId } = args;
  if (store.groupByThread(threadId)) return { ok: false, status: 409, error: "Pages are not available in rooms. Propose it in a direct conversation." };
  if (!args.proposePage) return { ok: false, status: 403, error: "Published pages are not available on this server." };
  const parsed = parsePageProposal(input);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
  const proposed = args.proposePage(parsed.value);
  if (!proposed.ok) return proposed;
  const title = redactSecretsInText(parsed.value.title);
  const message = store.appendMessage(threadId, {
    role: "bot",
    kind: "text",
    text: `Page proposed: ${title} (version ${proposed.version}). Review it, then choose who can see it before publishing.`,
    pagePublish: { pageId: proposed.pageId, version: proposed.version, title },
  });
  args.authored?.(message.id);
  return { ok: true, messageId: message.id, pageId: proposed.pageId, version: proposed.version };
}

/** The widget's stored payload, when the row is a widget of this thread. */
function storedWidget(store: Pick<AgentCardStore, "messagesFor">, threadId: string, messageId: string): WidgetPayload | undefined {
  return store.messagesFor(threadId).find((message) => message.id === messageId && message.kind === "widget")?.widget;
}

export type WidgetPress =
  | {
      ok: true;
      messageId: string;
      /** The person's message: the label, then one line per filled field. */
      text: string;
      /** The control that was pressed and the action the bot attached to it:
       * what the model is told was pressed (server/replies.ts ReplyTarget). */
      label: string;
      action: WidgetAction;
      /** This press folds the widget (confirm, cancel, submit) and has not yet. */
      settles: boolean;
      /** Call once the message is accepted, with its `queueId` when it was
       * queued rather than started or steered. */
      settle(queueId?: string): void;
    }
  | { ok: false; status: 400 | 404 | 409; error: string };

const BAD_PRESS = "widgetAction must be {messageId, ref, values?, rev?}, with values an object of text and on/off fields.";
const STALE_PRESS = "This widget changed. Check it and press again.";

function isValues(value: unknown): value is Record<string, string | boolean> | undefined | null {
  if (value === undefined || value === null) return true;
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string" || typeof entry === "boolean");
}

/** Absent (or null) is revision 0: a client that does not send one. */
function isRevision(value: unknown): value is number | undefined | null {
  return value === undefined || value === null || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
}

/** A press on a widget, checked against the stored tree and turned into the
 * message it sends (POST /api/bots/:id/messages with `widgetAction`). Writes
 * nothing until `settle()`.
 *
 * `rev` names the revision of the tree the press was made on (absent: 0, a
 * tree update_widget never replaced). A press made on an older tree is
 * refused: its ref may now be another button.
 *
 * A retry carries the `sendId` of the press that settled the widget: it is
 * resolved as if the widget were still live, so the same text comes back for
 * the send path to match to the message it already has, and its `settle()`
 * does nothing. A settled widget cannot be replaced, so that tree is still
 * the one the press was made on. */
export function prepareWidgetPress(
  store: Pick<AgentCardStore, "messagesFor" | "patchMessage">,
  threadId: string,
  widgetAction: unknown,
  sendId: string | undefined,
): WidgetPress {
  if (!isRecord(widgetAction)) return { ok: false, status: 400, error: BAD_PRESS };
  const { messageId, ref, values, rev } = widgetAction;
  if (typeof messageId !== "string" || !/^[\w-]+$/.test(messageId) ||
      typeof ref !== "string" || ref.length < 1 || ref.length > 64 || !isValues(values) || !isRevision(rev)) {
    return { ok: false, status: 400, error: BAD_PRESS };
  }
  const stored = () => storedWidget(store, threadId, messageId);
  const payload = stored();
  if (!payload?.root) return { ok: false, status: 404, error: "That widget is not in this conversation." };
  const retry = sendId !== undefined && payload.settled?.sendId === sendId;
  // An answered widget says so (below) whichever tree the press was made on.
  if (!retry && !payload.settled && (rev ?? 0) !== (payload.rev ?? 0)) return { ok: false, status: 409, error: STALE_PRESS };
  const resolved = resolveWidgetAction(retry ? { v: 1, root: payload.root } : payload, ref, values ?? undefined);
  if (!resolved.ok) return resolved;
  const { label, action, tone } = resolved;
  // What the person had in the fields, kept for the read-only Details view.
  // Cancel sends none, and a widget with no fields has none to keep.
  const sent = Object.keys(resolved.values).length > 0 ? { values: resolved.values } : {};
  return {
    ok: true,
    messageId,
    text: resolved.text,
    label,
    action,
    settles: Boolean(tone) && !retry,
    settle: (queueId) => {
      // Read again: two requests for one press can both get here, and the
      // bot may have replaced the tree while the message was on its way.
      const current = stored();
      if (retry || !tone || !current || current.settled) return;
      const settled: WidgetSettled = { ref, label, tone, at: Date.now(), ...(sendId ? { sendId } : {}), ...sent, ...(queueId ? { queueId } : {}) };
      store.patchMessage(threadId, messageId, { widget: { ...current, settled } });
    },
  };
}

/** A queued send was cancelled before it was delivered. If it was the press
 * that answered a widget, the person's answer never reached the bot: the
 * widget is live again. A press that was delivered (drained, or steered in)
 * is no longer in the queue, so its cancel fails and this is never called. */
export function reopenCancelledPress(store: Pick<AgentCardStore, "messagesFor" | "patchMessage">, threadId: string, queueId: string): void {
  const waiting = store.messagesFor(threadId).filter((message) =>
    message.kind === "widget" && message.widget?.settled?.queueId === queueId);
  for (const message of waiting) {
    const { settled: _settled, ...live } = message.widget!;
    store.patchMessage(threadId, message.id, { widget: live });
  }
}
