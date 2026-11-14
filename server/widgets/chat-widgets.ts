// Chat widgets on the server
// (docs/superpowers/specs/2026-10-13-chat-widgets-design.md): the two agents
// tools that post and replace a widget message, and the press that answers
// one. A bot's tree is normalised, scrubbed of secrets and given its text
// fallback here, once; everything after that reads the stored message.
//
// Both tools arrive on the internal options-card route, whose handler calls
// createAgentCard: a body with `tool` is a widget call, a body without one is
// the Watcher's legacy options card, unchanged.
import type { PageSourceChange, PageSourceDigest } from "../pages/published-pages.ts";
import {
  parseWidgetInput, resolveWidgetAction, widgetActions, widgetFields, widgetToText, WIDGET_LIMITS,
  type WidgetAction, type WidgetAppAction, type WidgetNode, type WidgetPayload, type WidgetRoot, type WidgetSettled,
} from "../../shared/widget.ts";
import { parsePageProposal, type PageKind } from "../../shared/published-pages.ts";
import type { MausColor } from "../../shared/wire.ts";
import { createAppCard, isAppTool } from "./chat-apps.ts";
import { createOptionsCard } from "./options-card.ts";
import { ASK_CHOICE_TOOL, parseAskChoiceInput } from "../../shared/options-card.ts";
import type { ApprovalMode } from "../../shared/approval-mode.ts";
import { fullAccessChoiceAnswer } from "../approvals/full-access-gate.ts";
import { questionCardTitle } from "../approvals/approval-words.ts";
import { lastPersonText, turnLanguage } from "../turns/turn-language.ts";
import { choiceOptionsFor } from "../approvals/final-confirmation.ts";
import { isSecretName, mask, redactSecretsInText } from "../redact.ts";
import type { AgentCardResult, AgentCardStore } from "./chat-card-types.ts";
import { CHOOSE_PAGE_TARGET_TOOL } from "../drivers/agents-artifact-tools.ts";
import {
  pageTargetQuestionOptions,
  resolvePageTargets,
  shouldShowPageTargetCard,
  type PageTargetAvailability,
  type PageTargetChoiceCardData,
  type PageTargetIntent,
} from "../../shared/page-targets.ts";
import type { AskQuestionOption } from "../../shared/ask-question.ts";
import type { Message } from "../store.ts";
import { askTextKey, closedAskCard, pendingKeyedCard, replacedAskCard } from "./ask-choice-keys.ts";
import { resolveAddressee, roomPeopleLine, type RoomPerson } from "../rooms/room-ask-cards.ts";
import type { AskAddressee } from "../../shared/wire.ts";

export type { AgentCardResult, AgentCardStore } from "./chat-card-types.ts";

const ROOM_REFUSAL = "Widgets are not available in rooms yet. Answer in text.";
const NO_SUCH_WIDGET = "No widget with that id in this conversation.";
/** ask_choice where nobody watches, when its question card could not be raised. */
export const QUESTION_NOT_RAISED = "The question card could not be shown to the person. Nothing is waiting for them: do not say a card is shown. Ask again, or end the run saying what you need from them.";
const PAGE_TARGET_ROOM = "Publish targets are not available in rooms. Propose a page or artifact in a direct conversation.";
const PAGE_TARGET_NONE = "No publish target is available for this bot and conversation.";
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
   * not seen (server/context/delta-context.ts Handoffs.authored). */
  authored?(messageId: string): void;
  /** propose_page (server/pages/published-pages.ts): stores a proposed version,
   * never a published one. Absent: the tool is refused. */
  proposePage?(input: { pageId?: string; title: string; kind: PageKind; content: string; path?: string; designSystem?: string; designTokens?: unknown }):
    { ok: true; pageId: string; version: number; bytes?: number; sha256?: string; given?: PageSourceDigest; changedBy?: PageSourceChange[] } | { ok: false; status: 400 | 404 | 409; error: string };
  /** #1905: the level the calling turn runs at (index.ts sourceApprovalMode),
   * so a may-I ask_choice under Full access is answered, not drawn. */
  approvalLevel?: ApprovalMode;
  /** The language setting of the person the card asks (index.ts
   * languageOfPerson): the card's default title falls back to it when the
   * conversation has no line of theirs yet. */
  personLanguage?: string | null;
  /** 2026-11-03 (a routine's choice card reached nobody): where the person
   * is not watching the conversation (a routine run's hidden task, an AI
   * client's hidden conversation), ask_choice is raised as a real question
   * card through the request path (index.ts raiseHarnessQuestion): it
   * waits in the Approvals inbox, the member API, a notification and the
   * run's status, and its answer comes back as the person's next message.
   * Null: the card could not be raised, and the tool fails saying so. */
  raiseQuestion?(choice: {
    title: string;
    question: string;
    options: string[];
    /** #2048: rich options (label + description + id) and durable payload. */
    questionOptions?: AskQuestionOption[];
    pageTargetChoice?: PageTargetChoiceCardData;
    /** #4205, #4219: what the card carries from its first frame (its key,
     * whether it holds, its addressee), so its notification reads them. */
    card?: { askKey?: string; noHold?: true; askTo?: AskAddressee };
  }): { messageId: string } | null;
  /** #4219: the conversation is a room: its people, whom a card can be
   * addressed to. `fromRun`: the card comes from a routine run whose
   * source is this room, and holds nothing. */
  room?: { people: RoomPerson[]; name?: string; fromRun?: boolean };
  /** #4233: the card comes from a routine run that reports by its streak and
   * whose routine can run several times a day (routines.ts
   * asksHoldNothing): ask_choice without wait reads as wait false there. */
  repeatingRun?: boolean;
  /** #4219: a pending card was re-addressed to another person of the room:
   * they get its notification. */
  notifyAddressee?(threadId: string, messageId: string): void;
  /** #4205: ask_choice keys. `find`: the pending card raised with a key in
   * the bot's conversations with the same person (ask-choice-keys.ts
   * AskKeyIndex, which reads only the conversation holding it);
   * `remember`: a keyed card was drawn; `retire`: close one pending card (a
   * question card is retired with its request). Absent: this conversation
   * only, closed by a store patch. */
  askKeys?: {
    find(key: string, accepts: (message: Message) => boolean): { threadId: string; message: Message } | null;
    remember(key: string, threadId: string, messageId: string): void;
    retire(threadId: string, message: Message): void;
  };
  /** #2048: availability and remembered default for choose_page_target. */
  pageTargetContext?: {
    defaultId?: string | null;
    availability: PageTargetAvailability;
  };
}): AgentCardResult {
  const { store, bot, threadId, input } = args;
  if (!isRecord(input) || input.tool === undefined) return createOptionsCard(args);
  // full-access: ask-choice
  if (input.tool === ASK_CHOICE_TOOL) return createChoiceCard(args, input);
  if (input.tool === CHOOSE_PAGE_TARGET_TOOL) return choosePageTargetCard(args, input);
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

/** ask_choice: any bot may draw the passive choice card. #1905 (2026-11-02):
 * under Full access a may-I ("May I continue?", "Should I contact the
 * verifier?") is the person's own answer already (full-access-gate.ts
 * fullAccessChoiceAnswer): the card is drawn settled on the recommended
 * option, the first one, and the tool result tells the model to go on. A
 * real decision, or a fact only the person can supply, keeps its card.
 * #4205: a decision (decision true, or a key) is never answered for the
 * person; a key replaces its pending card in place or retires it; wait
 * false raises a card that holds no turn and no routine run. */
function createChoiceCard(args: Parameters<typeof createAgentCard>[0], input: Record<string, unknown>): AgentCardResult {
  const parsed = parseAskChoiceInput(input);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
  // the key's card where the index puts it, else in this conversation (a
  // card drawn in the chat before a restart)
  // #4219: in a room several bots ask: a key names the asking bot's own
  // card, so the lookup itself skips another bot's card with the same key
  const own = (message: Message) => !message.from || message.from.botId === args.bot.id;
  const findKeyed = (key: string) => args.askKeys?.find(key, own)
    ?? pendingKeyedCard(args.threadId, args.store.messagesFor(args.threadId), key, own);
  const closeCard = (threadId: string, message: Message) => {
    if (args.askKeys) args.askKeys.retire(threadId, message);
    else args.store.patchMessage(threadId, message.id, { card: closedAskCard(message.card!) });
  };
  if ("retire" in parsed) {
    const found = findKeyed(parsed.retire.key);
    if (!found) return { ok: true, messageId: "", retired: 0 };
    closeCard(found.threadId, found.message);
    return { ok: true, messageId: "", retired: 1 };
  }
  const value = parsed.value;
  const inRoom = Boolean(args.store.groupByThread(args.threadId));
  // #4219: the person of the room the card is addressed to (a room only,
  // never a conversation between a bot and a person or two people)
  let askTo: AskAddressee | undefined;
  if (value.to) {
    if (!args.room) return { ok: false, status: 400, error: "to: only a card in a room is addressed to one of its people. Leave to out here." };
    const resolved = resolveAddressee(value.to, args.room.people);
    if (!resolved.ok) return { ok: false, status: 400, error: resolved.error };
    askTo = resolved.addressee;
  }
  // #4219: a keyed or addressed card of a room is a real question card in
  // the room, answered by its people; from a routine run it holds nothing
  const roomAsk = Boolean(args.room) && Boolean(value.key || askTo);
  // #4233: a repeating routine's run holds nothing unless wait is true
  const holds = (value.wait ?? !args.repeatingRun) && !(roomAsk && args.room?.fromRun);
  // #2901: Yes/No on "A, or B?" answers neither path; offer the two paths.
  const given = value.options;
  value.options = choiceOptionsFor(value.subtitle, given);
  // #2911: two paths are a real decision, never a may-I, so Full access
  // keeps the card instead of taking the first path for the person.
  // #4205: so is a question raised as a decision or with a key.
  // #4219: so is a card addressed to one person
  const decision = value.options !== given || value.decision === true || value.key !== undefined || askTo !== undefined;
  const from = inRoom ? { from: { botId: args.bot.id, name: args.bot.name, color: args.bot.color } } : {};
  // #4233: an unkeyed card a repeating routine's run raises holding nothing
  // is keyed by its text, so the next run's same ask replaces it in place
  const askKey = value.key ?? (!holds && args.repeatingRun && !inRoom ? askTextKey(value.subtitle) : undefined);
  const keyed = { ...(askKey ? { askKey } : {}), ...(holds ? {} : { noHold: true as const }), ...(askTo ? { askTo } : {}) };
  const addressed = askTo ? { addressedTo: askTo.name } : {};
  // #4219: in a room the bot reads whom it can address
  const roomPeopleResult = {
    ...(roomAsk && args.room?.people.length ? { people: roomPeopleLine(args.room.people) } : {}),
    // #4219: a routine run's card lives in its source room, answered there
    ...(roomAsk && args.room?.fromRun ? { inRoom: args.room.name?.trim() || "this routine's room" } : {}),
  };
  // #2909: an option's detail (ask_choice {label, detail}) rides as its
  // description, so the notification and the card say what each answer does
  const details = value.details;
  const questionOptions = details?.some(Boolean)
    ? value.options.map((label, index) => (details[index] ? { label, description: details[index] } : { label }))
    : undefined;
  // #4205: the same key again replaces its pending card in place
  // #4219: in a room too, and a new `to` re-addresses it
  if (askKey && (!from.from || roomAsk)) {
    const found = findKeyed(askKey);
    if (found) {
      const card = replacedAskCard(found.message.card!, { question: value.subtitle, options: value.options, noHold: !holds, ...(questionOptions ? { questionOptions } : {}), ...(askTo ? { askTo } : {}) });
      const patched = args.store.patchMessage(found.threadId, found.message.id, { card });
      if (patched) {
        args.authored?.(patched.id);
        if (askTo && askTo.id !== found.message.card!.askTo?.id) args.notifyAddressee?.(found.threadId, patched.id);
        const waits = Boolean(card.requestId) && found.threadId === args.threadId;
        const to = card.askTo ? { addressedTo: card.askTo.name } : {};
        return { ok: true, messageId: patched.id, replaced: true, ...to, ...roomPeopleResult, ...(waits ? { waitsForPerson: true as const } : {}), ...(holds ? {} : { holds: false as const }) };
      }
    }
  }
  // QA 0.8.77: a card drawn in the conversation (passive or settled) shows
  // its title as is, so the default one is worded in the conversation's
  // language, like a raised question card (#3158). The raised path keeps the
  // English default: raiseHarnessQuestion tells it apart from a given title.
  const { key: _key, wait: _wait, decision: _decision, to: _to, ...cardValue } = value;
  const shownCard = input.title === undefined
    ? { ...cardValue, title: questionCardTitle(turnLanguage(lastPersonText(args.store.messagesFor(args.threadId)), args.personLanguage)) || cardValue.title }
    : cardValue;
  const answered = decision ? null : fullAccessChoiceAnswer(args.approvalLevel, { title: value.title, question: value.subtitle, options: value.options });
  if (answered) {
    // full-access: ask-choice
    const settled = args.store.appendMessage(args.threadId, {
      role: "bot", kind: "options", card: { ...shownCard, answered: "answer", answeredText: answered.choice, autoApplied: true },
      ...from,
    });
    args.authored?.(settled.id);
    return { ok: true, messageId: settled.id, answered: { choice: answered.choice, question: value.subtitle } };
  }
  if (args.raiseQuestion && (!from.from || roomAsk)) {
    const raised = args.raiseQuestion({
      title: value.title,
      question: value.subtitle,
      options: value.options,
      ...(questionOptions ? { questionOptions } : {}),
      ...(Object.keys(keyed).length ? { card: keyed } : {}),
    });
    // Never a passive card here: nobody would see it, and the bot would say it showed one.
    if (!raised) return { ok: false, status: 409, error: QUESTION_NOT_RAISED };
    // #4205: the card carries its key and whether it holds the run
    if (keyed.askKey || keyed.noHold || keyed.askTo) {
      const row = args.store.messagesFor(args.threadId).find((message) => message.id === raised.messageId);
      if (row?.card) args.store.patchMessage(args.threadId, row.id, { card: { ...row.card, ...keyed } });
      if (keyed.askKey) args.askKeys?.remember(keyed.askKey, args.threadId, raised.messageId);
    }
    args.authored?.(raised.messageId);
    return { ok: true, messageId: raised.messageId, waitsForPerson: true, ...addressed, ...roomPeopleResult, ...(holds ? {} : { holds: false as const }) };
  }
  // a direct thread replays a bot row that carries `from` as another bot's line
  // full-access: ask-choice
  const message = args.store.appendMessage(args.threadId, {
    role: "bot", kind: "options", card: { ...shownCard, ...keyed },
    ...from,
  });
  if (keyed.askKey) args.askKeys?.remember(keyed.askKey, args.threadId, message.id);
  args.authored?.(message.id);
  return { ok: true, messageId: message.id, ...(holds ? {} : { holds: false as const }) };
}

/** #2048: choose which surface hosts a new page or artifact. One available
 * target or a remembered default returns immediately; otherwise a question
 * card (same family as ask_choice) lists the offers. */
function choosePageTargetCard(args: Parameters<typeof createAgentCard>[0], input: Record<string, unknown>): AgentCardResult {
  const { store, threadId } = args;
  if (store.groupByThread(threadId)) return { ok: false, status: 409, error: PAGE_TARGET_ROOM };
  const intentRaw = input.intent;
  const intent: PageTargetIntent = intentRaw === "page" || intentRaw === "artifact" || intentRaw === "any" ? intentRaw : "any";
  const ctx = args.pageTargetContext ?? { availability: { pages: true, artifacts: true, claudeArtifacts: false } };
  const resolution = resolvePageTargets({
    intent,
    availability: ctx.availability,
    defaultId: ctx.defaultId,
  });
  if (resolution.available.length === 0) {
    const why = resolution.unavailable.map((row) => `${row.name}: ${row.reason ?? "unavailable"}`).join(" ");
    return { ok: false, status: 409, error: why ? `${PAGE_TARGET_NONE} ${why}` : PAGE_TARGET_NONE };
  }
  const targets = [...resolution.available, ...resolution.unavailable].map((row) => ({
    id: row.id,
    tool: row.tool,
    name: row.name,
    description: row.description,
    available: row.available,
    ...(row.icon ? { icon: row.icon } : {}),
    ...(row.reason ? { reason: row.reason } : {}),
  }));
  if (resolution.auto && resolution.autoReason) {
    return {
      ok: true,
      messageId: "",
      auto: {
        id: resolution.auto.id,
        tool: resolution.auto.tool,
        name: resolution.auto.name,
        description: resolution.auto.description,
        ...(resolution.auto.icon ? { icon: resolution.auto.icon } : {}),
        reason: resolution.autoReason,
      },
      targets,
    };
  }
  if (!shouldShowPageTargetCard(resolution)) {
    return { ok: false, status: 409, error: PAGE_TARGET_NONE };
  }
  const questionOptions = pageTargetQuestionOptions(resolution.available);
  const pageTargetChoice: PageTargetChoiceCardData = {
    version: 1,
    targets: resolution.available.map((row) => ({
      id: row.id,
      tool: row.tool,
      name: row.name,
      ...(row.icon ? { icon: row.icon } : {}),
    })),
  };
  const title = "Where should I publish this?";
  const question = "Pick the surface for this page or artifact.";
  const labels = questionOptions.map((option) => option.label);
  if (args.raiseQuestion) {
    const raised = args.raiseQuestion({
      title,
      question,
      options: labels,
      questionOptions,
      pageTargetChoice,
    });
    if (!raised) return { ok: false, status: 409, error: QUESTION_NOT_RAISED };
    args.authored?.(raised.messageId);
    return { ok: true, messageId: raised.messageId, waitsForPerson: true, targets };
  }
  const from = store.groupByThread(threadId) ? { from: { botId: args.bot.id, name: args.bot.name, color: args.bot.color } } : {};
  // full-access: ask-choice (publish-target choice)
  const message = store.appendMessage(threadId, {
    role: "bot",
    kind: "options",
    card: {
      title,
      subtitle: question,
      options: labels,
      requestType: "question",
      questionRequest: { version: 1, questions: [{ question, options: questionOptions, custom: false }] },
      pageTargetChoice,
    },
    ...from,
  });
  args.authored?.(message.id);
  return { ok: true, messageId: message.id, targets };
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
    text: `${parsed.value.kind === "design" ? "Design" : "Page"} proposed: ${title} (version ${proposed.version}). Review it, then choose who can see it before publishing.`,
    pagePublish: { pageId: proposed.pageId, version: proposed.version, title },
  });
  args.authored?.(message.id);
  return {
    ok: true, messageId: message.id, pageId: proposed.pageId, version: proposed.version,
    // #3488: the stored source's size and SHA-256, to compare with a file
    ...(proposed.sha256 ? { bytes: proposed.bytes, sha256: proposed.sha256 } : {}),
    ...(proposed.given ? { given: proposed.given, changedBy: proposed.changedBy ?? [] } : {}),
  };
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
       * what the model is told was pressed (server/messages/replies.ts ReplyTarget). */
      label: string;
      action: WidgetAction;
      /** This press folds the widget (confirm, cancel, submit) and has not yet. */
      settles: boolean;
      /** The device already opened this in-app destination: the press is
       * recorded for the bot as done and starts no turn. */
      device?: WidgetAppAction;
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
  const { label, action, tone, device } = resolved;
  // What the person had in the fields, kept for the read-only Details view.
  // Cancel sends none, and a widget with no fields has none to keep.
  const sent = Object.keys(resolved.values).length > 0 ? { values: resolved.values } : {};
  return {
    ok: true,
    messageId,
    text: resolved.text,
    label,
    action,
    settles: Boolean(tone) && !retry && !device,
    ...(device ? { device } : {}),
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
