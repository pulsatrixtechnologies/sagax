// One voice call is many ordinary messages (the bot still receives each
// turn). The thread draws them as a single card. A person line with
// voiceCall.callId opens the call; later bot text stays in it until the
// next person line that is not that call. Approvals, questions and tool
// chips stay in the thread, as do requests that run as parallel tasks and
// their results (#4216).
import type { CollapsedItem, ExchangeRun } from "@/lib/bot-exchange";
import type { Message } from "@/state/store";

export interface SpokenLine {
  id: string;
  role: "user" | "bot";
  /** Room replies name the member. A 1:1 bot line leaves this empty. */
  name?: string;
  text: string;
}

export interface VoiceCallCardModel {
  callId: string;
  anchorId: string;
  messages: Message[];
}

export interface VoiceCallPlan {
  hidden: Set<string>;
  /** First spoken line of the call, the row the card replaces. */
  cards: Map<string, VoiceCallCardModel>;
  callOf: Map<string, string>;
  byCall: Map<string, VoiceCallCardModel>;
}

function personCallId(message: Message): string | null {
  if (message.role !== "user" || message.kind !== "text" || message.peerAsk) return null;
  return message.voiceCall?.callId ?? null;
}

function spokenBotText(message: Message): boolean {
  return message.role === "bot" && message.kind === "text" && !message.peerAsk && Boolean(message.text?.trim());
}

export function voiceCallPlan(messages: readonly Message[]): VoiceCallPlan {
  const hidden = new Set<string>();
  const cards = new Map<string, VoiceCallCardModel>();
  const callOf = new Map<string, string>();
  const byCall = new Map<string, VoiceCallCardModel>();
  let current: string | null = null;

  const take = (callId: string, message: Message) => {
    let card = byCall.get(callId);
    if (!card) {
      card = { callId, anchorId: message.id, messages: [] };
      byCall.set(callId, card);
      cards.set(message.id, card);
    }
    card.messages.push(message);
    hidden.add(message.id);
    callOf.set(message.id, callId);
  };

  for (const message of messages) {
    if (message.role === "user") {
      const callId = personCallId(message);
      if (!callId) {
        current = null;
        continue;
      }
      current = callId;
      // #4216: a request that runs beside the others as a parallel task
      // keeps its own row, next to its task card and its result
      if (message.text?.trim() && !message.parallelTask) take(callId, message);
      continue;
    }
    if (current && spokenBotText(message) && !message.parallelTask) take(current, message);
  }
  return { hidden, cards, callOf, byCall };
}

export type VoiceFold =
  | { kind: "keep"; message: Message }
  | { kind: "card"; card: VoiceCallCardModel }
  | { kind: "skip" };

/** What one transcript row does with a message. `seen` is the call ids
 * already given a card in this window. */
export function foldVoiceMessage(message: Message, plan: VoiceCallPlan, seen: Set<string>): VoiceFold {
  const direct = plan.cards.get(message.id);
  if (direct && !seen.has(direct.callId)) {
    seen.add(direct.callId);
    return { kind: "card", card: direct };
  }
  const callId = plan.callOf.get(message.id);
  if (!callId) return { kind: "keep", message };
  if (!seen.has(callId)) {
    const card = plan.byCall.get(callId);
    if (card) {
      seen.add(callId);
      return { kind: "card", card };
    }
  }
  return { kind: "skip" };
}

/** Spoken lines inside the card. A `continues` turn is the whole sentence,
 * so it replaces the fragment sent just before it. */
export function spokenLines(messages: readonly Message[]): SpokenLine[] {
  const lines: SpokenLine[] = [];
  for (const message of messages) {
    const text = message.text?.trim();
    if (!text || (message.role !== "user" && message.role !== "bot") || message.kind !== "text") continue;
    if (message.role === "user" && message.voiceCall?.continues && lines.at(-1)?.role === "user") {
      const previous = lines.at(-1)!;
      lines[lines.length - 1] = { ...previous, id: message.id, text };
      continue;
    }
    lines.push({
      id: message.id,
      role: message.role,
      ...(message.role === "bot" && message.from?.name ? { name: message.from.name } : {}),
      text,
    });
  }
  return lines;
}

/** The live call bar's bubbles (the last `limit` text lines of the call),
 * by the card's rule: a `continues` turn is the whole sentence, so it takes
 * the place of the fragment sent just before it. Without it, a turn sent
 * early on its stable words and sent again whole showed twice: the fragment's
 * bubble, then the whole sentence repeating it. */
export function callBarLines(messages: readonly Message[], limit = 8): Message[] {
  const lines: Message[] = [];
  for (const message of messages) {
    if (message.kind !== "text" || !message.text?.trim()) continue;
    if (message.role === "user" && message.voiceCall?.continues && lines.at(-1)?.role === "user") {
      lines[lines.length - 1] = message;
      continue;
    }
    lines.push(message);
  }
  return lines.slice(-limit);
}

/** m:ss, minutes padded (`00:34`). An hour or more is h:mm:ss. */
export function formatVoiceCallDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function voiceCallDurationMs(
  messages: readonly { at: number }[],
  now: number,
  clock?: { startedAt: number; endedAt: number | null } | null,
): number {
  if (clock && clock.endedAt === null) return Math.max(0, now - clock.startedAt);
  if (clock && clock.endedAt !== null) return Math.max(0, clock.endedAt - clock.startedAt);
  const first = messages[0]?.at;
  const last = messages.at(-1)?.at;
  if (first === undefined || last === undefined) return 0;
  return Math.max(0, last - first);
}

export function voiceCallTranscriptText(lines: readonly SpokenLine[], you: string, bot: string): string {
  return lines.map((line) => `${line.role === "user" ? you : (line.name || bot)}: ${line.text}`).join("\n");
}

/** The card's date stamp uses the lines actually on screen. The model still
 * holds the whole call, including lines above a tail window. */
export function voiceCallVisibleSpan(
  messages: readonly Message[],
  visibleIds: ReadonlySet<string>,
): { first: Message; last: Message } {
  const visible = messages.filter((message) => visibleIds.has(message.id));
  const span = visible.length > 0 ? visible : messages;
  return { first: span[0]!, last: span.at(-1)! };
}

export type VoiceTranscriptPiece =
  | { kind: "message"; message: Message }
  | { kind: "exchange"; run: ExchangeRun }
  | { kind: "card"; card: VoiceCallCardModel };

/** Walk one collapsed row. Spoken call lines leave the exchange or the
 * bubble list and become one card, in the order they appear. */
export function foldCollapsedEntry(entry: CollapsedItem, plan: VoiceCallPlan, seen: Set<string>): VoiceTranscriptPiece[] {
  if (entry.kind === "message") {
    const fold = foldVoiceMessage(entry.message, plan, seen);
    if (fold.kind === "keep") return [entry];
    if (fold.kind === "card") return [{ kind: "card", card: fold.card }];
    return [];
  }
  const pieces: VoiceTranscriptPiece[] = [];
  let kept: Message[] = [];
  const flushKept = () => {
    if (!kept.length) return;
    const same = kept.length === entry.run.messages.length;
    pieces.push({
      kind: "exchange",
      run: same
        ? entry.run
        : { ...entry.run, id: `${entry.run.id}:${kept[0]!.id}`, messages: kept },
    });
    kept = [];
  };
  for (const message of entry.run.messages) {
    const fold = foldVoiceMessage(message, plan, seen);
    if (fold.kind === "keep") {
      kept.push(message);
      continue;
    }
    flushKept();
    if (fold.kind === "card") pieces.push({ kind: "card", card: fold.card });
  }
  flushKept();
  return pieces;
}
