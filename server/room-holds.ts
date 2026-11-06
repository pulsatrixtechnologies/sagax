/** Holding one room member instead of stopping the whole room.
 *
 * A person who writes "stop @Scout" (or "@Scout halt", "pause @Scout") means
 * that one bot, not the room: the member is HELD — skipped by every route
 * that would give it a turn (an @mention, the lead, everyone, Auto, a
 * teammate's chained @mention) until the person addresses it again without a
 * stop word, says "resume", or presses Resume. "@everyone stop" / "@all stop"
 * holds every member; "@everyone resume" / "@all resume" / a bare "resume"
 * releases them all. Words the person quotes or pastes (code, quotes,
 * blockquotes) are never a directive.
 *
 * Holds are room-wide, not per conversation: a stop has to stick when the
 * next message lands in another of the room's conversations.
 *
 * The design follows Hermes Agent's desktop group chat (MIT), ported to this
 * room model rather than copied. Pure: no store, no I/O. */
import { isMentionBoundary, isMentionNameContinuation } from "../shared/mention-boundary.ts";
import type { RoomHold, RoomHeldMessage } from "../shared/wire.ts";

/** A stop word within this many words of a mention addresses that mention.
 * "@x please halt" is 2; "@x go, das ist halt ein Test" is 4 and is prose. */
const STOP_WINDOW = 2;
const STOP_WORDS = new Set(["stop", "halt", "pause"]);
/** Messages addressed to a held member that its next turn is shown. */
export const MAX_HELD_MESSAGES = 20;

export type HoldDirective = {
  hold: string[];
  holdAll: boolean;
  release: string[];
  releaseAll: boolean;
};

/** Reduce what the person quotes or pastes to the @tokens it carries (so a
 * mention keeps its place in the proximity window) or to one neutral word. */
export function maskQuotedAndCode(value: string): string {
  const mentionsOnly = (span: string): string => (span.match(/@[\p{L}\p{N}._-]+/gu) ?? []).join(" ") || "quoted";
  const kept: string[] = [];
  let fence = "";
  for (const line of value.split("\n")) {
    if (fence) {
      // An unterminated fence (a paste cut short) swallows the rest.
      const closing = line.trim().startsWith(fence);
      kept.push(closing ? "" : mentionsOnly(line));
      if (closing) fence = "";
      continue;
    }
    const opened = /^\s*(`{3,}|~{3,})/.exec(line);
    if (opened) {
      fence = opened[1]!;
      continue;
    }
    if (/^\s*>/.test(line)) {
      kept.push(mentionsOnly(line));
      continue;
    }
    // Typographic quotes too: smart-quote substitution rewrites straight ones.
    kept.push(line.replace(/`[^`\n]*`/g, mentionsOnly).replace(/["“”][^"“”\n]*["“”]/g, mentionsOnly));
  }
  return kept.join("\n");
}

/** Where the stop words sit relative to the @tokens: "adjacent" when one is
 * within STOP_WINDOW words of a mention, "distant" when the message has a
 * stop word but none that close (ambiguous: neither holds nor releases), null
 * without one. */
export function stopWordPlacement(text: string): "adjacent" | "distant" | null {
  const tokens = maskQuotedAndCode(text).toLowerCase().match(/@[\p{L}\p{N}._-]+|[\p{L}\p{N}_-]+/gu) ?? [];
  const mentions: number[] = [];
  const stops: number[] = [];
  tokens.forEach((token, index) => {
    if (token.startsWith("@")) mentions.push(index);
    else if (STOP_WORDS.has(token)) stops.push(index);
  });
  if (stops.some((stop) => mentions.some((mention) => Math.abs(stop - mention) <= STOP_WINDOW))) return "adjacent";
  return stops.length ? "distant" : null;
}

/** "@everyone" or "@all" as a whole tag, outside quoted or pasted text. */
export function addressesEveryone(text: string): boolean {
  const surface = maskQuotedAndCode(text);
  for (const word of ["everyone", "all"]) {
    for (let at = surface.indexOf("@"); at !== -1; at = surface.indexOf("@", at + 1)) {
      const candidate = surface.slice(at + 1, at + 1 + word.length);
      if (
        isMentionBoundary(surface, at) &&
        candidate.toLocaleLowerCase() === word &&
        !isMentionNameContinuation(surface.slice(at + 1 + word.length))
      ) return true;
    }
  }
  return false;
}

/** A message that is only "resume" (or "resume all", "@all resume", …). */
function isBareResume(text: string): boolean {
  const words = maskQuotedAndCode(text).toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [];
  return words.length > 0 && words[0] === "resume" && words.slice(1).every((word) => ["all", "everyone", "please"].includes(word));
}

/** What one human room message does to holds. `mentioned` are the member ids
 * the message @mentions (resolved by the caller from the same text). A stop
 * word next to a mention holds the mentioned members (everyone for @all /
 * @everyone); a direct mention without a stop word releases them; addressing
 * everyone without one, or a bare "resume", releases every hold. A stop word
 * far from every mention is ambiguous and changes nothing: re-dispatching a
 * bot the person just told to stop is the one mistake this must not make. */
export function classifyHoldDirective(text: string, mentioned: readonly string[]): HoldDirective {
  const everyone = addressesEveryone(text);
  const stop = stopWordPlacement(text);
  if (stop === "adjacent") return { hold: [...mentioned], holdAll: everyone, release: [], releaseAll: false };
  return {
    hold: [],
    holdAll: false,
    release: stop === "distant" ? [] : [...mentioned],
    releaseAll: stop === null && (everyone || isBareResume(text)),
  };
}

export type HoldChange = {
  holds: Record<string, RoomHold>;
  /** Members this message newly held: a turn they are running is interrupted. */
  held: string[];
  /** Members this message released. */
  released: string[];
};

/** The room's holds after one human message. Returns the same object when
 * nothing changed. `memberIds` are the room's members; only they are held. */
export function applyHoldDirective(
  holds: Record<string, RoomHold> | undefined,
  directive: HoldDirective,
  memberIds: readonly string[],
  at: number,
): HoldChange {
  const prior = holds ?? {};
  if (directive.releaseAll) {
    const released = Object.keys(prior);
    return { holds: released.length ? {} : prior, held: [], released };
  }
  let next = prior;
  const held: string[] = [];
  const released: string[] = [];
  const toHold = directive.holdAll ? memberIds : directive.hold.filter((id) => memberIds.includes(id));
  for (const id of toHold) {
    if (next[id]) continue;
    if (next === prior) next = { ...prior };
    next[id] = { at };
    held.push(id);
  }
  for (const id of directive.release) {
    if (!next[id]) continue;
    if (next === prior) next = { ...prior };
    delete next[id];
    released.push(id);
  }
  return { holds: next, held, released };
}

/** Remember a message addressed to a held member, oldest dropped first. */
export function rememberHeldMessage(
  heldMessages: Record<string, RoomHeldMessage[]> | undefined,
  botId: string,
  entry: RoomHeldMessage,
): Record<string, RoomHeldMessage[]> {
  const current = heldMessages?.[botId] ?? [];
  if (current.some((item) => item.messageId === entry.messageId)) return heldMessages ?? {};
  return { ...heldMessages, [botId]: [...current, entry].slice(-MAX_HELD_MESSAGES) };
}

/** The activity line a skipped held member leaves in the room. */
export function heldMemberLine(name: string): string {
  return `${name} is held (stopped by you) — @mention it or say resume`;
}
