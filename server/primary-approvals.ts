// sagax_approvals: a person's Primary Bot answers or cancels the approval
// cards that wait on that person, when the person asks for it in this turn
// (JC, 2026-10-20, Grok Bot parity: "le bot principal doit pouvoir
// absolument tout faire"). Exactly what a click does: the answer is the
// same POST /api/threads/:id/respond (or Cancel turn's interrupt, or Always
// allow this's custom rule) replayed with the person's own session, so every
// check of the click applies (whose card, an admin's card, a security key).
// A card of the person's own confidential thread is theirs too (JC
// 2026-10-20): answered like any other, its content never shown to the
// Primary Bot. Three rules are this module's:
// - only the person's own Primary Bot (never a teammate, another bot or a
//   bot shared by someone else), in a turn the person started themselves;
// - only on the person's explicit request in that turn's message, proved by
//   a quote of their words (shared/primary-request.ts) written after the
//   card appeared (a card raised later was never seen by them);
// - the card and the audit journal say "via <bot>".
// Nothing here answers a card itself.

import { createHash } from "node:crypto";

import { checkPersonQuote, messageNamesCard, normalizeWords, personWrote, type PrimaryIntent } from "../shared/primary-request.ts";

export type PrimaryDecision = "allow" | "always_allow" | "always_allow_this" | "deny" | "always_deny" | "answer";
export const PRIMARY_DECISIONS: readonly PrimaryDecision[] = ["allow", "always_allow", "always_allow_this", "deny", "always_deny", "answer"];

/** The turn a call comes from, once the gate said it is the person's own
 * request to their own Primary Bot. */
export type PrimaryTurn = {
  botId: string;
  botName: string;
  /** The person (principal id, or this computer's operator). */
  person: string;
  /** The message that started this turn, the person's own. */
  message: { id: string; text: string; at: number };
};

/** One card waiting on the person, as the click sees it. */
export type PrimaryCard = {
  threadId: string;
  requestId: string;
  botId: string;
  botName: string;
  /** when the card appeared (ms) */
  at: number;
  /** "Allow Katarina to run a command?" */
  title: string;
  /** one line under it: the command, the file, the change */
  line: string;
  /** the conversation or room, by name */
  where?: string;
  /** the bot that asked for the work, on a bot-to-bot card */
  askedBy?: string;
  kind: "permission" | "question" | "proposal";
  /** an Allow asks for one of the person's security keys */
  needsKey: boolean;
  /** a card of the person's confidential thread: listed without its words */
  confidential?: boolean;
  options: PrimaryDecision[];
  /** what Always allow keeps, in plain words */
  alwaysScope?: string;
  /** how Always allow is kept: the person's rule (the card's ownerRule) or
   * the engine's session allow */
  always?: "rule" | "session";
};

export type PrimaryResult = { status: number; body: Record<string, unknown> };

export type PrimaryApprovalsDeps = {
  /** The gate: the person's own Primary Bot, in a turn they started. */
  turn: (botId: string, threadId: string, generation: string) => PrimaryTurn | { status: number; code: string; error: string };
  /** The cards waiting on this person that they may answer. */
  pending: (turn: PrimaryTurn) => PrimaryCard[];
  /** The click: POST /api/threads/:threadId/respond as the person. */
  respond: (turn: PrimaryTurn, card: PrimaryCard, body: Record<string, unknown>) => Promise<PrimaryResult>;
  /** Always allow this: POST /api/custom-rules fromCard as the person. */
  customRule: (turn: PrimaryTurn, card: PrimaryCard) => Promise<PrimaryResult>;
  /** Undo that rule when the card's answer was then refused. */
  dropCustomRule: (turn: PrimaryTurn, ruleId: string) => Promise<unknown>;
  /** Cancel turn: the card's bot's interrupt for that conversation, as the person. */
  cancel: (turn: PrimaryTurn, card: PrimaryCard) => Promise<PrimaryResult>;
  /** One journal row per answer the bot gave for the person. */
  audit: (turn: PrimaryTurn, card: PrimaryCard, decision: PrimaryDecision | "cancel") => void;
  now?: () => number;
};

/** Which cards of the person's Approvals screen the Primary Bot may answer:
 * the ones the person answers themselves (`mine`; `org` only when they may
 * decide it, an admin's card for an admin), never one they only watch (a
 * teammate's, an admin's for a member). Their own confidential thread's
 * cards included (JC 2026-10-20): the screen lists those to its owner only. */
export function primaryAnswerable(item: { decidable: boolean; scope: string }): boolean {
  return item.decidable && (item.scope === "mine" || item.scope === "org");
}

/** The card a bare "oui" answers: the latest one the person could see when
 * they wrote (JC 2026-10-20). */
function latestSeen(cards: readonly PrimaryCard[], at: number): PrimaryCard | undefined {
  return cards.filter((card) => card.at <= at).sort((a, b) => b.at - a.at)[0];
}

/** The card in plain words, for the person: never a confidential thread's words. */
function cardWords(card: PrimaryCard): string {
  return card.confidential ? `${card.botName}'s card in a confidential conversation` : `"${card.title}"${card.line ? ` (${card.line})` : ""} from ${card.botName}`;
}

/** A card's handle for the bot: short, never its id. */
export function cardRef(threadId: string, requestId: string): string {
  return `c${createHash("sha256").update(`${threadId}\u0000${requestId}`).digest("hex").slice(0, 7)}`;
}

const INTENTS: Readonly<Record<PrimaryDecision | "cancel", readonly PrimaryIntent[]>> = {
  allow: ["allow"],
  always_allow: ["always"],
  always_allow_this: ["always"],
  deny: ["deny"],
  always_deny: ["deny", "always"],
  answer: ["answer"],
  cancel: ["cancel"],
};

/** A long message's bare yes counts for a card only when the message speaks
 * of one (security review 2026-10-20: "ok, résume ce courriel" or "le client
 * m'a dit oui" approves nothing). */
const SPEAKS_OF_A_CARD = /(?:^| )(?:cartes?|cards?|approb|approv|autoris|celle|celui|waiting|pending|permission|commande|command)/;
/** A card that appeared this close before the message may not be the one
 * the person meant: a bare yes then asks which (security review 2026-10-20). */
const JUST_RAISED_MS = 3_000;

/** Answers per message of the person: one "yes to all" covers a handful. */
const ANSWERS_PER_MESSAGE = 20;

function ok(text: string): PrimaryResult {
  return { status: 200, body: { text } };
}
function refused(status: number, code: string, error: string): PrimaryResult {
  return { status, body: { error, code } };
}

function ageOf(at: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}

export function createPrimaryApprovals(deps: PrimaryApprovalsDeps) {
  const now = deps.now ?? Date.now;
  const answered = new Map<string, number>();
  /** Messages whose yes already answered a card it did not name. */
  const implicit = new Set<string>();

  function listText(cards: PrimaryCard[], at: number): string {
    if (!cards.length) return "Nothing is waiting on the person.";
    const latest = latestSeen(cards, at);
    const lines = cards.map((card) => {
      if (card.confidential) {
        return `- card ${cardRef(card.threadId, card.requestId)}: ${card.botName}'s card in a confidential conversation (its words stay there), ${ageOf(card.at, now())}. Options: ${[...card.options, "cancel"].join(", ")}.${card.needsKey ? " Allow needs their security key: they answer it in Sagax." : ""}${card === latest ? " Latest." : ""}`;
      }
      const where = card.where ? ` in ${card.where}` : "";
      const asked = card.askedBy ? `, asked by ${card.askedBy}` : "";
      const key = card.needsKey ? " Allow needs their security key: they answer it in Sagax." : "";
      const scope = card.alwaysScope ? ` Always allow keeps: ${card.alwaysScope}.` : "";
      return `- card ${cardRef(card.threadId, card.requestId)}: ${card.title} ${card.line ? `(${card.line}) ` : ""}from ${card.botName}${where}${asked}, ${ageOf(card.at, now())}. Options: ${[...card.options, "cancel"].join(", ")}.${scope}${key}${card === latest ? " Latest." : ""}`;
    });
    return [
      `${cards.length} card${cards.length === 1 ? "" : "s"} waiting on the person:`,
      ...lines,
      "Answer one only when the person asked for it in their message: pass their own words as quote. A bare yes (\"oui\", \"vas-y\", \"approuve\") without naming a card answers the latest one they saw: omit card, then tell them which one it was.",
    ].join("\n").slice(0, 8000);
  }

  function find(turn: PrimaryTurn, ref: unknown): { card: PrimaryCard; others: PrimaryCard[] } | PrimaryResult {
    const cards = deps.pending(turn);
    const wanted = typeof ref === "string" ? ref.trim() : "";
    if (!wanted) {
      // no card named: the latest one the person saw (JC 2026-10-20)
      const card = latestSeen(cards, turn.message.at) ?? (cards.length === 1 ? cards[0] : undefined);
      if (card && !(cards.length > 1 && card.at > turn.message.at - JUST_RAISED_MS)) return { card, others: cards.filter((row) => row !== card) };
      return refused(400, "card_required", cards.length ? `Pass card: one of ${cards.map((row) => cardRef(row.threadId, row.requestId)).join(", ")} (action list says which is which).` : "Nothing is waiting on the person.");
    }
    const card = cards.find((row) => cardRef(row.threadId, row.requestId) === wanted);
    return card ? { card, others: cards.filter((row) => row !== card) } : refused(404, "no_card", "No such card waiting on the person (answered, expired, or not theirs). Call action list.");
  }

  function proved(turn: PrimaryTurn, card: PrimaryCard, others: PrimaryCard[], decision: PrimaryDecision | "cancel", quote: unknown): PrimaryResult | null {
    // a card raised after the person spoke was never in front of them
    if (card.at > turn.message.at) {
      return refused(403, "card_after_request", "This card appeared after the person's message, so they have not asked for it. Tell them it is waiting and let them say.");
    }
    // A yes is bound to its card: the person's message names this one (its
    // bot, the bot that asked, or its handle), or it is the latest card they
    // saw (JC 2026-10-20: a bare "oui" answers the latest, whatever the
    // message's length and however many wait; the answer says which). A
    // bot's name names its card only when no other card is that bot's.
    const names = [
      others.some((row) => row.botName === card.botName) ? undefined : card.botName,
      card.askedBy && !others.some((row) => row.askedBy === card.askedBy) ? card.askedBy : undefined,
      cardRef(card.threadId, card.requestId),
    ];
    const named = messageNamesCard(turn.message.text, names);
    if (!named) {
      if (others.length > 0 && (latestSeen([card, ...others], turn.message.at) !== card || card.at > turn.message.at - JUST_RAISED_MS)) {
        return refused(403, "card_not_named", "The person's message does not say which card, and this one is not clearly the latest they saw: ask them (name the bot, or the card), or let them answer it.");
      }
      // security review 2026-10-20: a yes that names no card answers one
      // card per message, never the next ones in a row
      if (implicit.has(turn.message.id)) return refused(403, "card_not_named", "A yes that names no card answers one card. Ask the person about the others.");
    }
    for (const intent of INTENTS[decision]) {
      const check = checkPersonQuote({ quote, message: turn.message.text, intent, anyLength: true });
      if (!check.ok) return refused(403, check.code, check.reason);
      // a bare yes in a long message: only when the message speaks of a card
      if ((intent === "allow" || intent === "deny") && !named && !checkPersonQuote({ quote, message: turn.message.text, intent }).ok &&
        !SPEAKS_OF_A_CARD.test(normalizeWords(turn.message.text)) && !messageNamesCard(turn.message.text, [card.botName, ...others.map((row) => row.botName)])) {
        return refused(403, "not_asked", "The person's yes is not about a card (their message speaks of something else). Ask them, or let them answer it.");
      }
    }
    const count = answered.get(turn.message.id) ?? 0;
    if (count >= ANSWERS_PER_MESSAGE) return refused(429, "too_many", "That message already answered many cards. Ask the person again.");
    return null;
  }

  function note(turn: PrimaryTurn, card?: PrimaryCard): void {
    if (card && !messageNamesCard(turn.message.text, [card.botName, card.askedBy, cardRef(card.threadId, card.requestId)])) {
      implicit.add(turn.message.id);
      if (implicit.size > 2_000) implicit.delete(implicit.values().next().value!);
    }
    answered.set(turn.message.id, (answered.get(turn.message.id) ?? 0) + 1);
    if (answered.size > 2_000) answered.delete(answered.keys().next().value!);
  }

  async function answer(turn: PrimaryTurn, card: PrimaryCard, decision: PrimaryDecision, text: unknown): Promise<PrimaryResult> {
    if (!card.options.includes(decision)) {
      return refused(400, "option_unknown", `This card's options: ${[...card.options, "cancel"].join(", ")}.`);
    }
    let result: PrimaryResult;
    if (decision === "always_allow_this") {
      const saved = await deps.customRule(turn, card);
      if (saved.status >= 400) return saved;
      result = await deps.respond(turn, card, { behavior: "allow" });
      // the card refused the answer (a security key): the rule goes too
      const ruleId = (saved.body.rule as { id?: unknown } | undefined)?.id;
      if (result.status >= 400 && typeof ruleId === "string") await deps.dropCustomRule(turn, ruleId);
    } else if (decision === "answer") {
      const words = typeof text === "string" ? text.trim() : "";
      if (!words) return refused(400, "text_required", "answer needs text: the person's answer to the question.");
      if (!personWrote(turn.message.text, words)) return refused(403, "not_their_words", "text must be the person's own answer, copied from their message.");
      result = await deps.respond(turn, card, { behavior: "answer", message: words.slice(0, 4000) });
    } else {
      const body: Record<string, unknown> = decision === "allow" ? { behavior: "allow" }
        : decision === "always_allow" ? (card.always === "rule" ? { behavior: "allow", rule: "allow" } : { behavior: "allow", always: true })
          : decision === "always_deny" ? { behavior: "deny", rule: "deny", message: "Denied by the user." }
            : { behavior: "deny", message: "Denied by the user." };
      result = await deps.respond(turn, card, body);
    }
    if (result.status >= 400) return result;
    note(turn, card);
    deps.audit(turn, card, decision);
    const done = decision === "deny" || decision === "always_deny" ? "Denied" : decision === "answer" ? "Answered" : "Allowed";
    const rule = decision === "always_allow" || decision === "always_allow_this" ? ", and the rule is saved in their Settings > Security" : decision === "always_deny" ? ", and the deny rule is saved" : "";
    return ok(`${done} for the person: ${cardWords(card)}${rule}. The card reads "via ${turn.botName}". Tell the person which card it was.`);
  }

  async function handle(input: { args: Record<string, unknown>; botId: string; threadId: string; generation: string }): Promise<PrimaryResult> {
    const gate = deps.turn(input.botId, input.threadId, input.generation);
    if ("error" in gate) return refused(gate.status, gate.code, gate.error);
    const action = input.args.action;
    if (action === "list") return ok(listText(deps.pending(gate), gate.message.at));
    if (action !== "answer" && action !== "cancel") return refused(400, "action", "action is list, answer or cancel.");
    const found = find(gate, input.args.card);
    if ("status" in found && "body" in found) return found;
    const { card, others } = found as { card: PrimaryCard; others: PrimaryCard[] };
    if (action === "cancel") {
      const refusal = proved(gate, card, others, "cancel", input.args.quote);
      if (refusal) return refusal;
      const result = await deps.cancel(gate, card);
      if (result.status >= 400) return result;
      note(gate, card);
      deps.audit(gate, card, "cancel");
      return ok(`Stopped ${card.botName}'s turn for the person: ${cardWords(card)}.`);
    }
    const decision = input.args.decision;
    if (typeof decision !== "string" || !(PRIMARY_DECISIONS as readonly string[]).includes(decision)) {
      return refused(400, "decision", `decision is one of ${PRIMARY_DECISIONS.join(", ")} (or action cancel).`);
    }
    const refusal = proved(gate, card, others, decision as PrimaryDecision, input.args.quote);
    if (refusal) return refusal;
    return answer(gate, card, decision as PrimaryDecision, input.args.text);
  }

  return { handle };
}
