// What a bot's finished turn leaves for the person (2026-11-05, the
// maintainer: "when bots receive the result of a routine or of bot-to-bot
// communication, they do nothing with it. They should write to me and show
// me cards"). A dispatch pass ended in a thread another bot opened with two
// items marked [HUMAIN] for the person, and nobody told them.
//
// Read from the result's own structured signals only, never by guessing at
// words:
// - an item tag on a line of its own: [HUMAIN], [HUMAN], [NEEDS_HUMAN],
//   [NEEDS HUMAN], [ACTION REQUISE], [ACTION REQUIRED] (Flow reports and the
//   routine contract write them);
// - a `needs_human` / `humain` array in a JSON object of the result (a Flow
//   report or verify output quoted whole);
// - the runtime's question marker (`NEEDS INPUT: <question>`);
// - the run contract's own failure line (`RUN_STATUS: failed|partial: <why>`).
// Undefined when there is none: the turn stays where it is.

export type PersonAttentionKind = "human" | "question" | "failure";

export interface PersonAttentionItem {
  /** The item as the bot wrote it, without its tag or bullet (markdown kept). */
  text: string;
  /** The ConnectWise ticket it names, when it names exactly one first. */
  ticketId?: number;
  /** A deep link to that ticket (server side, from the site it knows). */
  ticketUrl?: string;
}

export interface PersonAttention {
  kind: PersonAttentionKind;
  items: PersonAttentionItem[];
  /** The answers the bot offered, when it listed them as data; otherwise
   * read from the question's own closing list (attentionChoices). */
  choices?: string[];
}

/** At most this many items ride one card; the thread keeps the rest. */
export const PERSON_ATTENTION_MAX_ITEMS = 12;
const ITEM_MAX = 600;

const TAG = /\[\s*(?:HUMAIN|HUMAN|NEEDS[_ -]HUMAN|ACTION[_ -]REQUISE|ACTION[_ -]REQUIRED)\s*\]/i;
const TAG_LINE = new RegExp(`^\\s*(?:[-*+•]|\\d+[.)])?\\s*(?:\\*\\*|__)?\\s*${TAG.source}\\s*(?:\\*\\*|__)?\\s*[:—–-]?\\s*(.*)$`, "i");
const QUESTION_LINE = /^\s*[*_`]*NEEDS INPUT\s*:[*_`]*\s*(.+)$/i;
const STATUS_LINE = /^[\s`*_>]*RUN[_ ]STATUS\s*:?[\s`*_]*(failed|failure|partial|partially)\b[\s`*_]*[:—–-]?\s*(.*)$/i;
/** The ticket an item leads with: `**100201**`, `#100201`, `ticket 100201`. */
const TICKET = /(?:\*\*|#|\b(?:ticket|billet)\s+#?)(\d{4,9})\b|^\s*(\d{5,9})\b/i;
const JSON_KEYS = ["needs_human", "needsHuman", "humain", "human", "for_person", "forPerson"] as const;

function clip(text: string): string {
  const clean = text.trim();
  return clean.length > ITEM_MAX ? `${clean.slice(0, ITEM_MAX - 1).trimEnd()}…` : clean;
}

function ticketOf(text: string): number | undefined {
  const match = TICKET.exec(text);
  const raw = match?.[1] ?? match?.[2];
  const id = raw ? Number(raw) : NaN;
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

function item(text: string, ticket?: unknown): PersonAttentionItem | undefined {
  const words = clip(text);
  if (!words) return undefined;
  const fromField = typeof ticket === "number" ? ticket : typeof ticket === "string" ? Number(ticket.replace(/^#/, "")) : NaN;
  const ticketId = Number.isInteger(fromField) && fromField > 0 ? fromField : ticketOf(words);
  return ticketId ? { text: words, ticketId } : { text: words };
}

/** A tagged line and the lines that continue it (indented, or plain text
 * up to the next bullet, tag or blank line). */
function taggedItems(lines: string[]): PersonAttentionItem[] {
  const out: PersonAttentionItem[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = TAG_LINE.exec(lines[index]!);
    if (!match) continue;
    const parts = [match[1] ?? ""];
    while (index + 1 < lines.length) {
      const next = lines[index + 1]!;
      if (!next.trim() || /^\s*(?:[-*+•]|\d+[.)])\s/.test(next) || TAG_LINE.test(next) || QUESTION_LINE.test(next) || STATUS_LINE.test(next.trim()) || /^\s*#/.test(next)) break;
      parts.push(next.trim());
      index += 1;
    }
    const found = item(parts.join(" "));
    if (found) out.push(found);
  }
  return out;
}

function jsonCandidates(text: string): unknown[] {
  const out: unknown[] = [];
  const blocks = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/gi)].map((match) => match[1]!);
  const whole = text.trim();
  if (/^[[{]/.test(whole)) blocks.push(whole);
  for (const block of blocks) {
    try {
      out.push(JSON.parse(block));
    } catch {
      // not JSON
    }
  }
  return out;
}

function jsonItems(value: unknown, depth = 0): PersonAttentionItem[] {
  if (depth > 4 || value === null || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.slice(0, 50).flatMap((entry) => jsonItems(entry, depth + 1));
  const record = value as Record<string, unknown>;
  const out: PersonAttentionItem[] = [];
  for (const key of JSON_KEYS) {
    const list = record[key];
    if (!Array.isArray(list)) continue;
    for (const entry of list.slice(0, 50)) {
      if (typeof entry === "string") {
        const found = item(entry);
        if (found) out.push(found);
      } else if (entry && typeof entry === "object") {
        const row = entry as Record<string, unknown>;
        const words = [row.text, row.reason, row.why, row.action, row.summary, row.note, row.message].find((part): part is string => typeof part === "string" && part.trim().length > 0);
        const ticket = row.ticket ?? row.ticketId ?? row.ticket_id ?? row.id;
        const label = words ?? (ticket !== undefined ? `#${String(ticket)}` : "");
        const found = item(ticket !== undefined && words && !words.includes(String(ticket)) ? `#${String(ticket)}: ${words}` : label, ticket);
        if (found) out.push(found);
      }
    }
  }
  if (out.length) return out;
  for (const child of Object.values(record)) {
    if (child && typeof child === "object") out.push(...jsonItems(child, depth + 1));
    if (out.length) break;
  }
  return out;
}

function unique(items: PersonAttentionItem[]): PersonAttentionItem[] {
  const seen = new Set<string>();
  const out: PersonAttentionItem[] = [];
  for (const entry of items) {
    const key = entry.ticketId ? `t${entry.ticketId}:${entry.text.slice(0, 40)}` : entry.text;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
    if (out.length >= PERSON_ATTENTION_MAX_ITEMS) break;
  }
  return out;
}

/** The structured signals of a finished turn's words that need the person,
 * or undefined when there are none. Items win over a question, a question
 * over a declared failure. */
export function personAttention(text: string | undefined): PersonAttention | undefined {
  const raw = (text ?? "").trim();
  if (!raw) return undefined;
  const lines = raw.split(/\r?\n/);
  const human = unique([...taggedItems(lines), ...jsonCandidates(raw).flatMap((value) => jsonItems(value))]);
  if (human.length) return { kind: "human", items: human };
  const questions = unique(lines.map((line) => QUESTION_LINE.exec(line)?.[1]).filter((line): line is string => Boolean(line?.trim())).map((line) => item(line)!).filter(Boolean));
  if (questions.length) return { kind: "question", items: questions };
  for (const line of lines) {
    const match = STATUS_LINE.exec(line.trim());
    if (!match) continue;
    const reason = match[2]!.replace(/[`*_]+$/g, "").trim();
    const failed = /^fail/i.test(match[1]!);
    const found = item(reason || (failed ? "The bot reported that the work failed." : "The bot reported that only part of the work was done."));
    return found ? { kind: "failure", items: [found] } : undefined;
  }
  return undefined;
}

/** The card a person's conversation shows for it (WireMessage.attention). */
export interface PersonAttentionCard extends PersonAttention {
  /** The bot whose turn said it. */
  botId: string;
  botName: string;
  /** Where it was said: the thread the button opens. */
  threadId: string;
  threadTitle?: string;
  /** The message it was read from: one card per message. */
  sourceMessageId: string;
  /** Another bot opened that thread (a hand-off): named on the card. */
  openedBy?: { botId: string; name: string };
  /** A routine run's task: the button opens the run. */
  routineRunId?: string;
  routineName?: string;
  /** The person marked it handled. */
  handledAt?: number;
}

/** One line for a client that does not draw the card, and for the push. */
export function personAttentionText(card: Pick<PersonAttentionCard, "kind" | "items" | "botName">): string {
  const lead = card.kind === "question" ? `${card.botName} has a question for you` : card.kind === "failure" ? `${card.botName} needs a decision` : `${card.botName} needs you`;
  const list = card.items.map((entry) => `- ${entry.text.replace(/\s+/g, " ")}`).join("\n");
  return `${lead}:\n${list}`;
}

const CHOICE_MAX = 80;
const CHOICES_MAX = 8;
/** "(create, archive only, or nothing for now) ?" closing the question. */
const CLOSING_PARENS = /\(([^()]{3,400})\)\s*[?\uFF1F]\s*[*_]*\s*$/;
/** "...: create, archive only or nothing?" closing the question. */
const CLOSING_COLON = /:\s*([^:]{3,400}?)\s*[?\uFF1F]\s*[*_]*\s*$/;
const SEPARATOR = /\s*[,;/|]\s*(?:(?:ou|or)\s+)?|\s+(?:ou|or)\s+/i;

function splitChoices(list: string, needsOr: boolean): string[] {
  if (needsOr && !/\s(?:ou|or)\s/i.test(list)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list.split(SEPARATOR)) {
    const choice = raw.replace(/^[\s*_`"«»]+|[\s*_`"«».]+$/g, "").trim();
    if (!choice) continue;
    if (choice.length > CHOICE_MAX || /[?:]/.test(choice)) return [];
    const key = choice.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(choice);
  }
  return out.length >= 2 && out.length <= CHOICES_MAX ? out : [];
}

/**
 * The answers a question card offers as one-tap choices (2026-11-06, the
 * maintainer: the hand-off question "felt cheap like a form"): the bot's own
 * list when it gave one, else the list closing a single question, between
 * parentheses ("(create, archive only, or nothing for now)?") or after a
 * colon with an "or" ("Next: create, archive or nothing?"). Empty when there
 * is none; the person can always answer in words.
 */
export function attentionChoices(card: Pick<PersonAttention, "items" | "choices">): string[] {
  const given = (card.choices ?? []).map((choice) => choice.trim()).filter(Boolean);
  if (given.length) return given.slice(0, CHOICES_MAX);
  if (card.items.length !== 1) return [];
  const text = card.items[0]!.text.trim();
  const inParens = CLOSING_PARENS.exec(text);
  if (inParens) {
    const found = splitChoices(inParens[1]!, false);
    if (found.length) return found;
  }
  const afterColon = CLOSING_COLON.exec(text);
  return afterColon ? splitChoices(afterColon[1]!, true) : [];
}
