// Several "Go to conversation" lines in a row read as a stack of identical
// receipts. They fold into one compact chip ("3 conversations with [faces]
// 3 agents") that lists each target once. A line is either a collapsed
// bot-to-bot exchange or an opened-thread receipt; rows that draw nothing
// between two lines (hidden tool steps) do not break the stack.
import type { Message } from "@/state/store";
import type { ExchangeParty, ExchangeRun } from "@/lib/bot-exchange";
import { isStatusActivity } from "@/lib/activity-runs";
import { isAppleMobileWebClient } from "@/lib/tool-activity-rows";
import { failedTurnCause } from "@/lib/failed-turn";
import { isCancelledTranscriptRow } from "../../shared/client-cancel";
import { shownCwWidget } from "../../shared/cw-widgets/tool-call";

export type GotoTarget =
  | { kind: "exchange"; key: string; run: ExchangeRun }
  | { kind: "thread"; key: string; message: Message };

export interface GotoGroup {
  kind: "gotoGroup";
  id: string;
  /** One per target, deduplicated, ordered by each target's latest line. */
  targets: GotoTarget[];
  /** Every stored row the stack covers, hidden ones included (unread divider, dates, search). */
  messages: Message[];
}

type AnyItem =
  | { kind: "exchange"; run: ExchangeRun }
  | { kind: "message"; message: Message }
  | { kind: string; messages: Message[] };

function itemMessages(item: AnyItem): Message[] {
  if (item.kind === "exchange" && "run" in item) return item.run.messages;
  if ("message" in item) return [item.message];
  if ("messages" in item) return item.messages;
  return [];
}

/** The target of one go-to line, or null when the item is something else. */
export function gotoTargetOf(item: AnyItem): GotoTarget | null {
  if (item.kind === "exchange" && "run" in item) {
    const party = item.run.party;
    return { kind: "exchange", key: `bot:${party.id ?? party.name}`, run: item.run };
  }
  if (item.kind === "message" && "message" in item) {
    const ref = item.message.threadRef;
    if (!ref || !item.message.tool) return null;
    return { kind: "thread", key: `thread:${ref.botId}:${ref.threadId}`, message: item.message };
  }
  return null;
}

function partyKey(party: ExchangeParty): string {
  return party.id ?? party.name;
}

/** Same target twice: one entry, the latest line's party, every stored row of both runs. */
function mergeExchange(earlier: ExchangeRun, later: ExchangeRun): ExchangeRun {
  const seen = new Set<string>();
  const messages = [...earlier.messages, ...later.messages].filter((message) => {
    if (seen.has(message.id)) return false;
    seen.add(message.id);
    return true;
  });
  const ends: ExchangeParty[] = [];
  for (const party of [...later.ends, ...earlier.ends]) {
    if (!ends.some((known) => partyKey(known) === partyKey(party))) ends.push(party);
  }
  return { id: later.id, messages, party: later.party, ends };
}

/** Deduplicate by target, keep the most recent, order by latest occurrence. */
export function dedupeGotoTargets(lines: readonly GotoTarget[]): GotoTarget[] {
  const byKey = new Map<string, { target: GotoTarget; last: number }>();
  lines.forEach((line, index) => {
    const known = byKey.get(line.key);
    if (known && known.target.kind === "exchange" && line.kind === "exchange") {
      byKey.set(line.key, { target: { ...line, run: mergeExchange(known.target.run, line.run) }, last: index });
      return;
    }
    byKey.set(line.key, { target: line, last: index });
  });
  return [...byKey.values()].sort((a, b) => a.last - b.last).map((entry) => entry.target);
}

/** Fold every stretch of two or more go-to lines into one group. `silent`
 * names the items that draw nothing (hidden tool steps): they sit inside a
 * stretch without breaking it, and stay outside one that ends before them. */
export function collapseGotoLines<T extends AnyItem>(
  items: readonly T[],
  silent: (item: T) => boolean,
): Array<T | GotoGroup> {
  const out: Array<T | GotoGroup> = [];
  let index = 0;
  while (index < items.length) {
    const first = items[index]!;
    const firstTarget = gotoTargetOf(first);
    if (!firstTarget) {
      out.push(first);
      index += 1;
      continue;
    }
    const lines: GotoTarget[] = [firstTarget];
    let last = index;
    let cursor = index + 1;
    while (cursor < items.length) {
      const candidate = items[cursor]!;
      const target = gotoTargetOf(candidate);
      if (target) {
        lines.push(target);
        last = cursor;
        cursor += 1;
        continue;
      }
      if (silent(candidate)) {
        cursor += 1;
        continue;
      }
      break;
    }
    if (lines.length < 2) {
      out.push(first);
      index += 1;
      continue;
    }
    const covered = items.slice(index, last + 1);
    out.push({
      kind: "gotoGroup",
      id: `goto:${itemMessages(first)[0]?.id ?? index}`,
      targets: dedupeGotoTargets(lines),
      messages: covered.flatMap(itemMessages),
    });
    index = last + 1;
  }
  return out;
}

/** What a list row and the stacked faces show for one target. */
export interface GotoEntryView {
  key: string;
  /** A bot face; null draws the cube used for threads and rooms. */
  bot: { id?: string; name: string; color?: string } | null;
  /** Bot name, or the thread's title. */
  label: string;
  /** The bot or room a thread belongs to, under its title. */
  detail?: string;
  /** The agent this target counts toward, absent for a room. */
  agentKey?: string;
}

export function gotoEntryView(
  target: GotoTarget,
  owners: { bots: readonly { id: string; name: string; color?: string }[]; groups?: readonly { id: string; name: string }[] },
): GotoEntryView {
  if (target.kind === "exchange") {
    const party = target.run.party;
    const bot = party.id ? owners.bots.find((candidate) => candidate.id === party.id) : undefined;
    return {
      key: target.key,
      bot: bot ?? { ...(party.id ? { id: party.id } : {}), name: party.name, ...(party.color ? { color: party.color } : {}) },
      label: party.name,
      agentKey: `bot:${partyKey(party)}`,
    };
  }
  const ref = target.message.threadRef!;
  const bot = owners.bots.find((candidate) => candidate.id === ref.botId);
  const room = bot ? undefined : owners.groups?.find((candidate) => candidate.id === ref.botId);
  const owner = bot?.name ?? room?.name ?? "";
  return {
    key: target.key,
    bot: null,
    label: ref.title || owner,
    ...(ref.title && owner ? { detail: owner } : {}),
    ...(bot ? { agentKey: `bot:${bot.id}` } : {}),
  };
}

/** Distinct agents across the targets, newest first, for the stacked faces. */
export function gotoAgents(
  entries: readonly GotoEntryView[],
  owners: { bots: readonly { id: string; name: string; color?: string }[] },
): { key: string; bot: { id?: string; name: string; color?: string } }[] {
  const out: { key: string; bot: { id?: string; name: string; color?: string } }[] = [];
  for (const entry of [...entries].reverse()) {
    if (!entry.agentKey || out.some((known) => known.key === entry.agentKey)) continue;
    const id = entry.agentKey.slice("bot:".length);
    const bot = entry.bot ?? owners.bots.find((candidate) => candidate.id === id) ?? { name: id };
    out.push({ key: entry.agentKey, bot });
  }
  return out;
}

/** A 1:1 chat item that draws nothing: a folded tool run or a lone tool step
 * with Settings > Tool calls off. Mirrors ChatView's own rules; anything it
 * does not know stays visible and so ends a stack of go-to lines. */
export function silentChatItem(item: AnyItem, showToolCalls: boolean, appleMobileWeb: boolean = isAppleMobileWebClient()): boolean {
  if (showToolCalls) return false;
  // a group with a turn's narration still shows that narration
  if (item.kind === "run" && "messages" in item) return !item.messages.some((message) => shownCwWidget(message.tool) || message.kind !== "activity");
  if (item.kind !== "message" || !("message" in item)) return false;
  const message = item.message;
  if (message.kind !== "activity" || !message.tool || message.state) return false;
  if (isCancelledTranscriptRow(message)) return false;
  // A thread receipt, a Data receipt and a widget stay visible: the threads
  // toggle, not this one, governs the first. A comm chip is verbose detail
  // on desktop (silent with tool calls off, JC 2026-10-22), but stays on
  // Apple mobile web, where it is the only trace a teammate was consulted.
  if (message.threadRef || message.dataResult || message.tool.widget) return false;
  if (message.comm) return !appleMobileWeb && message.tool.ok !== false;
  if (message.parallelTask?.role === "card" || isStatusActivity(message)) return false;
  return failedTurnCause(message.tool.name) === null;
}
