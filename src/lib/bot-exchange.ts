// Bot-to-bot lines leave the main transcript as one chip per contiguous run.
// A reply to the person stays inline. A later summary for the person has no
// request of its own, so this never scans backward past requestMessageId.
import type { Message } from "@/state/store";
import { isStatusActivity } from "@/lib/activity-runs";
import { peerLine } from "@/lib/peer-message";
import { localDay } from "@/lib/transcript-derivations";

/** Same gap the phone uses before a quiet date stamp starts a new cluster. */
export const STRETCH_GAP_MS = 30 * 60 * 1000;

export interface ExchangeParty {
  id?: string;
  name: string;
  color?: string;
}

export interface ExchangeMember {
  id: string;
  name: string;
  color?: string;
}

export interface ExchangeRun {
  id: string;
  messages: Message[];
  /** The other bot named on the chip. */
  party: ExchangeParty;
  /** Sheet header, the viewer's bot first when this is their 1:1. */
  ends: ExchangeParty[];
}

export type CollapsedItem =
  | { kind: "message"; message: Message }
  | { kind: "exchange"; run: ExchangeRun };

export interface CollapseOptions {
  /** The bot whose 1:1 this transcript is. Absent in a shared room. */
  selfBotId?: string;
  /** That same bot, for the sheet header. */
  self?: ExchangeParty;
  /** Bot-to-bot channel: group.dm and not a people DM. */
  pairChannel?: boolean;
  members?: readonly ExchangeMember[];
  /** Full transcript so a reply can see a request that sits above the window. */
  lookup?: readonly Message[];
}

type WireBits = {
  requestMessageId?: string;
  roomRequest?: { id: string; phase: "request" | "result" };
};

function wire(message: Message): WireBits {
  return message as Message & WireBits;
}

function partyOf(from: { botId: string; name: string; color?: string }): ExchangeParty {
  return { id: from.botId, name: from.name, ...(from.color ? { color: from.color } : {}) };
}

/** Cards, navigation chips, failures, and the person's own lines stay inline. */
function blocksExchange(message: Message): boolean {
  if (
    message.kind === "options" ||
    message.kind === "secret" ||
    message.kind === "access" ||
    message.kind === "routine.run" ||
    message.kind === "goal.run"
  ) return true;
  if (message.threadRef || message.comm) return true;
  if (isStatusActivity(message)) return true;
  if (message.kind === "activity" && message.tool?.name.startsWith("error:")) return true;
  if (message.role === "user" && !peerLine(message)) return true;
  return false;
}

/** A tool step, a screen frame or a digest: work, not words. It never
 * names or starts a run, so a tool call is never drawn as a line of the
 * exchange. */
function quietRow(message: Message): boolean {
  return message.kind === "activity" || message.kind === "screen" || message.kind === "digest";
}

/** Tool, screen, or digest noise that may sit inside a run. A step still
 * running, or one a stop left without an outcome, is absorbed too; a failed
 * step stays inline, where the chat decides whether to show it. */
function absorbable(message: Message): boolean {
  if (blocksExchange(message) || message.parallelTask) return false;
  if (message.kind === "screen" || message.kind === "digest") return true;
  return message.kind === "activity" && message.tool?.ok !== false;
}

/** Who the line is for, when the line itself is bot-to-bot. No request walk. */
function audienceParty(message: Message, options: CollapseOptions): ExchangeParty | null {
  if (blocksExchange(message) || quietRow(message)) return null;
  const peer = peerLine(message);
  if (peer) return { id: peer.botId, name: peer.name };
  const extra = wire(message);
  if (options.pairChannel && message.role === "bot" && message.from?.name) {
    const other = options.members?.find((member) => member.id !== message.from?.botId);
    if (other?.name) return { id: other.id, name: other.name, ...(other.color ? { color: other.color } : {}) };
    return partyOf(message.from);
  }
  if (extra.roomRequest && message.from?.name && message.from.botId !== options.selfBotId) {
    return partyOf(message.from);
  }
  if (options.selfBotId && message.role === "bot" && message.from?.name && message.from.botId !== options.selfBotId) {
    return partyOf(message.from);
  }
  return null;
}

function directParty(message: Message, options: CollapseOptions, byId: ReadonlyMap<string, Message>): ExchangeParty | null {
  if (blocksExchange(message) || quietRow(message)) return null;
  const direct = audienceParty(message, options);
  if (direct) return direct;
  // This bot's own line joins only when its stored request is bot-to-bot.
  if (!options.selfBotId || message.role !== "bot") return null;
  const requestId = wire(message).requestMessageId;
  if (!requestId || requestId === message.id) return null;
  const request = byId.get(requestId);
  if (!request) return null;
  return audienceParty(request, { ...options, pairChannel: false });
}

function dedupe(parties: readonly ExchangeParty[]): ExchangeParty[] {
  const out: ExchangeParty[] = [];
  for (const party of parties) {
    const key = party.id ?? party.name;
    if (!key || out.some((item) => (item.id ?? item.name) === key)) continue;
    out.push(party);
  }
  return out;
}

/** One bot in the run names the chip. Several: the first bot that is not self. */
export function chipParty(parties: readonly ExchangeParty[], selfId?: string): ExchangeParty {
  const unique = dedupe(parties);
  if (unique.length <= 1) return unique[0]!;
  return unique.find((party) => party.id !== selfId) ?? unique[0]!;
}

function sheetEnds(parties: readonly ExchangeParty[], self?: ExchangeParty): ExchangeParty[] {
  const body = dedupe(parties);
  if (!self?.name) return body;
  return dedupe([self, ...body]);
}

/** Fold each contiguous bot-to-bot run into one chip. Everything else stays. */
export function collapseBotExchanges(messages: readonly Message[], options: CollapseOptions = {}): CollapsedItem[] {
  const byId = new Map<string, Message>();
  for (const message of options.lookup ?? []) byId.set(message.id, message);
  for (const message of messages) byId.set(message.id, message);
  const marked = messages.map((message) => ({
    message,
    party: directParty(message, options, byId),
    absorb: false,
  }));
  for (const entry of marked) {
    if (!entry.party) entry.absorb = absorbable(entry.message);
  }
  const items: CollapsedItem[] = [];
  let index = 0;
  while (index < marked.length) {
    const current = marked[index]!;
    if (!current.party) {
      items.push({ kind: "message", message: current.message });
      index += 1;
      continue;
    }
    let last = index;
    let cursor = index + 1;
    while (cursor < marked.length) {
      if (marked[cursor]!.party) {
        last = cursor;
        cursor += 1;
        continue;
      }
      if (marked[cursor]!.absorb) {
        cursor += 1;
        continue;
      }
      break;
    }
    const slice = marked.slice(index, last + 1);
    const parties = slice.flatMap((entry) => (entry.party ? [entry.party] : []));
    const runMessages = slice.map((entry) => entry.message);
    items.push({
      kind: "exchange",
      run: {
        id: `exchange:${runMessages[0]!.id}`,
        messages: runMessages,
        party: chipParty(parties, options.selfBotId),
        ends: sheetEnds(parties, options.self),
      },
    });
    for (let extra = last + 1; extra < cursor; extra += 1) {
      items.push({ kind: "message", message: marked[extra]!.message });
    }
    index = cursor;
  }
  return items;
}

/** First line of a visible cluster: no previous line, a new day, or a long pause. */
export function startsNewStretch(prevAt: number | undefined, at: number): boolean {
  if (prevAt === undefined) return true;
  if (localDay(prevAt) !== localDay(at)) return true;
  return at - prevAt > STRETCH_GAP_MS;
}

/** "Today 5:17 AM", "Yesterday 7:18 PM", or "Sat, Oct 3 7:45 AM". `time` is already formatted.
 * Day names come from i18n (`chat.day.today` / `chat.day.yesterday`); the rest is the app locale. */
export function transcriptDateLabel(
  at: number,
  now: number,
  labels: { today: string; yesterday: string },
  locale: string,
  time: string,
): string {
  const diffDays = localDay(now) - localDay(at);
  const label = diffDays === 0
    ? labels.today
    : diffDays === 1
      ? labels.yesterday
      : new Date(at).toLocaleDateString(locale, { weekday: "short", month: "short", day: "numeric" });
  return `${label} ${time}`;
}

/** True when openThread on that party stays in this 1:1 (same bot). Any other
 * party would select that bot and leave; onGo must then return false so the
 * in-column sheet stays (Close Chat returns here). */
export function exchangeJumpStays(partyId: string | undefined, currentBotId: string | undefined): boolean {
  return Boolean(partyId && currentBotId && partyId === currentBotId);
}

/** A Messaged chip whose group is a bot-to-bot DM. Clicking it must not
 * select that channel: the exchange is read in this column. */
export function commIsBotDm(
  comm: { groupId: string } | undefined,
  groups: readonly { id: string; dm?: boolean; peopleDm?: boolean }[],
): boolean {
  if (!comm) return false;
  const group = groups.find((candidate) => candidate.id === comm.groupId);
  return Boolean(group?.dm && !group.peopleDm);
}

export function visibleEdge(item:
  | { kind: "exchange"; run: ExchangeRun }
  | { kind: "message"; message: Message }
  | { kind: "run" | "turn" | "voiceCall"; messages: Message[] }
): { first: Message; last: Message } {
  if (item.kind === "exchange") {
    return { first: item.run.messages[0]!, last: item.run.messages.at(-1)! };
  }
  if (item.kind === "message") return { first: item.message, last: item.message };
  return { first: item.messages[0]!, last: item.messages.at(-1)! };
}

/** Words to show inside the sheet. A peer line drops its provenance note.
 * A tool step has no words: its name is never a line of the exchange. */
export function exchangeBody(message: Message): string {
  const peer = peerLine(message);
  if (peer) return peer.body;
  if (quietRow(message)) return "";
  return message.text ?? "";
}

/** How the open sheet draws one stored row: a line (speaker, bubble), a
 * tool chip (only with Settings > Tool calls on, like the chat itself), or
 * nothing (screen frames, digests, and tool steps with Tool calls off). */
export function exchangeSheetRow(message: Message, showToolCalls: boolean): "line" | "tool" | null {
  if (message.kind === "activity") return showToolCalls && message.tool ? "tool" : null;
  return quietRow(message) ? null : "line";
}

/** Who the sheet credits: the peer, else `from`, else the viewer's bot. */
export function exchangeSpeaker(message: Message, fallback?: ExchangeParty): ExchangeParty {
  const peer = peerLine(message);
  if (peer) return { id: peer.botId, name: peer.name };
  if (message.from?.name) return partyOf(message.from);
  if (fallback?.name) return fallback;
  return { name: "" };
}
