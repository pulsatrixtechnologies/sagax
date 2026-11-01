// Queue-and-steer for busy 1:1 bots.
//
// A message sent to a bot mid-turn used to bounce with a 409. Now it waits
// here until the bot settles, then lands in the thread and runs as ONE
// follow-up turn whose prompt is the queued texts separated by a blank line.
//
// The durable queue is NOT in `messages[]` while the current
// turn is running: appending immediately would make the queued line the
// active leaf, so remaining tool/assistant events of *this* turn would
// hang off a user line the model has not seen. Restart restores only sends
// whose dispatch has not begun. The composer shows a pending chip
// until drain appends the words.
//
// Unlike the delegation drain, an interrupted or failed turn does NOT
// discard this queue: delegations are a bot's fan-out (dropping them on
// Stop is a safety property), but these are the user's own words —
// stop-then-steer (queue a correction, hit Stop, the correction runs) is
// the feature.

import { newId } from "./contracts.ts";
import { chatFollowups, saveChatFollowup, settleChatFollowups } from "./message-db.ts";
import { drainCoalesceHead, WAITING_LINES_COALESCE_WINDOW_MS } from "./admission.ts";
import { SAFE_POINT_NOTE } from "./safe-point-preempt.ts";
import { spokenLineFields } from "./live-call-record.ts";
import { workOriginSchema, type WorkOrigin } from "./peer-provenance.ts";
import { voiceQueuePrompt } from "./voice-turn.ts";
import type { ResolvedSender, SteerQueueReason } from "../shared/wire.ts";
import type { BotRecord, Message } from "./store.ts";
import type { TurnSpeaker } from "./engine-access.ts";
import type { UsageTrigger } from "./usage-ledger.ts";

/** The slice of Store this module needs — narrow so tests can fake it. */
export interface SteerStore {
  bot(id: string): BotRecord | null;
  projectBotForTask?(botId: string, threadId: string): BotRecord | null;
  appendMessage(threadId: string, message: Omit<Message, "id" | "at">): Message;
  patchMessage(threadId: string, messageId: string, patch: Partial<Message>): Message | null;
}

interface QueueEntry {
  /** Keep ownership pinned even when the selected task changes. */
  botId: string;
  items: Array<{
    messageId: string;
    text: string;
    prompt: string;
    replyToId?: string;
    sendId?: string;
    /** The Data result the words were sent about: the prompt already carries
     * its hint; the drained line records it like an immediate send would. */
    dataContext?: Message["dataContext"];
    reason?: SteerQueueReason;
    /** The words were queued by a bot already running unattended (a
     * thread it opened on itself). The drained turn must inherit that:
     * a queue is a delay, not a person sitting down at the keyboard. */
    unattended?: boolean;
    peerAsk?: Message["peerAsk"];
    /** Where the work of a thread a bot opened on itself started: the turn
     * these words start hands work on as the opener's turn would have. */
    origin?: WorkOrigin;
    /** The person who sent the words: a queue is a delay, not a change of
     * author, so the drained line names them like an immediate send would. */
    sender?: ResolvedSender;
    /** Who the usage ledger books the turn these words start to, captured
     * when they were sent. Absent on rows queued before this existed. */
    trigger?: UsageTrigger;
    /** Who the turn these words start speaks for (organization engine
     * gate), captured when they were sent. */
    speaker?: TurnSpeaker;
    /** Words said on a voice call: the drained line keeps the mark, so the
     * turn it starts gets the phone-call instruction. */
    voiceCall?: Message["voiceCall"];
    /** When the words were queued (epoch ms): drain-time coalescing splits
     * one sender's items when the gap between them outgrows the window. */
    queuedAt: number;
    /** The words were spoken in a Live call, not typed: the drained line
     * says so, like an immediate send would. */
    via?: "call";
    /** The Live call they were spoken on (Message.callId); only with via. */
    callId?: string;
    /** The words are already a row of the thread (a message steered into the
     * running turn that the bot set aside for after it, route_message
     * `after`): the drain starts the turn on that row instead of writing a
     * second one, and no pending chip shows them twice. */
    existingMessageId?: string;
  }>;
}

/** The first waiting line of a drained batch: the one that starts the turn. */
export type SteerQueueHead = Pick<QueueEntry["items"][number], "trigger" | "sender" | "peerAsk" | "speaker" | "origin">;

const queues = new Map<string, QueueEntry>(); // threadId → waiting sends

/** Every line one sender left waiting in a 1:1 thread joins the one
 * follow-up turn, whatever the gap (admission.ts). Senders and provenance
 * still never merge (coalesceIdentity). */
export const STEER_QUEUE_COALESCE_WINDOW_MS = WAITING_LINES_COALESCE_WINDOW_MS;

/** A thread's queue lifted out of the map while a live steer is attempted. */
export interface HeldSteerQueue {
  botId: string;
  threadId: string;
  items: QueueEntry["items"];
}

export function restoreSteeredMessages(): void {
  queues.clear();
  for (const row of chatFollowups("bot")) {
    if (row.status !== "pending") continue;
    const entry = queues.get(row.threadId) ?? { botId: row.ownerId, items: [] };
    if (entry.botId !== row.ownerId) throw new Error("queued task belongs to another bot");
    // A 1:1 line is only ever stamped "call" ("api" belongs to channel
    // rows), and only a spoken line keeps the call's id.
    const { via, callId, origin: storedOrigin, ...payload } = row.payload;
    const origin = workOriginSchema.safeParse(storedOrigin);
    entry.items.push({
      ...payload,
      ...spokenLineFields(via, callId),
      ...(origin.success ? { origin: origin.data } : {}),
      messageId: row.id,
      prompt: row.payload.prompt ?? row.payload.text,
      // rows queued before timestamps were kept read as queued at restore
      // time: the burst was still live when the restart interrupted it
      queuedAt: row.payload.queuedAt ?? Date.now(),
    });
    queues.set(row.threadId, entry);
  }
}
const listeners = new Set<() => void>();
const changed = () => {
  for (const listener of listeners) {
    try { listener(); }
    catch { console.warn("steer-queue: change listener failed"); }
  }
};

/** Public pending chips only: never expose provider prompts or reply context. */
export function queuedSteerSnapshot(ownsThread: (botId: string, threadId: string) => boolean):
  Record<string, Array<{ queueId: string; text: string; reason?: SteerQueueReason }>> {
  return Object.fromEntries([...queues]
    .filter(([threadId, entry]) => ownsThread(entry.botId, threadId))
    .map(([threadId, entry]) => [threadId, entry.items.filter((item) => !item.existingMessageId).map((item) => ({
      queueId: item.messageId, text: item.text, ...(item.reason ? { reason: item.reason } : {}),
    }))]));
}

/** Publish changes synchronously so every client can restore/cancel the queue. */
export function onSteeredQueueChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export interface QueuedSteer {
  id: string;
}

/** Hold a mid-turn send off the transcript until drain. */
export function queueSteeredMessage(
  botId: string,
  threadId: string,
  text: string,
  options: { prompt?: string; replyToId?: string; sendId?: string; dataContext?: Message["dataContext"]; reason?: SteerQueueReason; unattended?: boolean; peerAsk?: Message["peerAsk"]; origin?: WorkOrigin; sender?: ResolvedSender; trigger?: UsageTrigger; speaker?: TurnSpeaker; voiceCall?: Message["voiceCall"]; callId?: string; via?: "call"; existingMessageId?: string; front?: boolean } = {},
): QueuedSteer {
  const id = newId();
  const entry = queues.get(threadId) ?? { botId, items: [] };
  // A thread cannot legitimately change owners. Refuse to merge unrelated
  // queues even if a corrupt caller reuses a thread id.
  if (entry.botId !== botId) throw new Error("queued task belongs to another bot");
  const item = {
    messageId: id,
    text,
    prompt: options.prompt ?? text,
    replyToId: options.replyToId,
    sendId: options.sendId,
    dataContext: options.dataContext,
    reason: options.reason,
    unattended: options.unattended,
    peerAsk: options.peerAsk,
    ...(options.origin ? { origin: options.origin } : {}),
    sender: options.sender,
    trigger: options.trigger,
    ...(options.speaker ? { speaker: options.speaker } : {}),
    ...(options.voiceCall ? { voiceCall: options.voiceCall } : {}),
    queuedAt: Date.now(),
    ...spokenLineFields(options.via, options.callId),
    ...(options.existingMessageId ? { existingMessageId: options.existingMessageId } : {}),
  };
  saveChatFollowup({ id, kind: "bot", ownerId: botId, threadId, payload: item });
  if (options.front) {
    entry.items.unshift(item);
    promoteSteerQueue(threadId, entry);
  } else {
    entry.items.push(item);
    queues.set(threadId, entry);
  }
  changed();
  return { id };
}

/** Put this thread's queue ahead of the same bot's other waiting threads.
 * The drain and queuedThreadPosition both walk the map in insertion order. */
function promoteSteerQueue(threadId: string, entry: QueueEntry): void {
  const rest: Array<[string, QueueEntry]> = [];
  let placed = false;
  for (const [id, queued] of queues) {
    if (id === threadId) continue;
    if (!placed && queued.botId === entry.botId) {
      rest.push([threadId, entry]);
      placed = true;
    }
    rest.push([id, queued]);
  }
  if (!placed) rest.push([threadId, entry]);
  queues.clear();
  for (const [id, queued] of rest) queues.set(id, queued);
}

/** Where a thread stands among this bot's threads waiting for the bot to
 * become available (a full slot list or an active room turn):
 * 1 for the next to start. The drain visits queues in insertion order, so
 * insertion order is the line. Null when nothing of this bot's is waiting
 * on that thread. */
export function queuedThreadPosition(botId: string, threadId: string): number | null {
  let position = 0;
  for (const [candidate, entry] of queues) {
    if (entry.botId !== botId || !entry.items.some((item) => item.reason === "capacity" || item.reason === "group-turn")) continue;
    position += 1;
    if (candidate === threadId) return position;
  }
  return null;
}

/** Any queued correction supersedes a tool-planned continuation, whether it
 * waits for this thread's turn or for the bot's shared capacity. */
export function hasQueuedSteeredMessages(botId: string, threadId: string): boolean {
  const entry = queues.get(threadId);
  return entry?.botId === botId && entry.items.length > 0;
}

/** Whether one send still waits in its thread's queue. False while it is
 * out of the queue: drained onto the thread, held for a steer into the
 * running turn, or cancelled (editing a queued line cancels it). */
export function isSteeredMessageQueued(botId: string, threadId: string, queueId: string): boolean {
  const entry = queues.get(threadId);
  return entry?.botId === botId && entry.items.some((item) => item.messageId === queueId);
}

/** Drain every queue whose task is idle: append the held lines (leaf is now
 * the finished turn's last item), then one run per thread whose prompt is
 * the drained group's texts separated by a blank line. `userMessage` is the last appended line
 * so startTurn does not duplicate it; `excludeIds` is every drained line
 * so transcript-replay adapters do not also see earlier queued texts.
 * Entries leave the map BEFORE running so a settle racing another settle
 * can never fire the same queue twice. M2: only the leading coalesced
 * group drains per settle — every waiting line of one sender joins one turn
 * (2026-11-01: whatever the gap), and later groups (another sender or
 * provenance) wait for this turn's completion, preserving FIFO. */
export function drainSteeredMessages(
  store: SteerStore,
  run: (
    botId: string,
    threadId: string,
    prompt: string,
    userMessage: Message,
    excludeIds: string[],
    unattended: boolean,
    head: SteerQueueHead,
  ) => void | Promise<void>,
  isBlocked?: (botId: string, threadId: string, head: SteerQueueHead) => boolean,
): void {
  // deleting only the entry being visited is safe under Map iteration
  for (const [threadId, entry] of queues) {
    const bot = store.projectBotForTask
      ? store.projectBotForTask(entry.botId, threadId)
      : store.bot(entry.botId);
    if (!bot) {
      // the bot or task was deleted while messages waited
      settleChatFollowups(entry.items.map((item) => item.messageId), "cancelled");
      queues.delete(threadId);
      changed();
      continue;
    }
    if (bot.busy || isBlocked?.(entry.botId, threadId, entry.items[0])) continue;
    // isBlocked may re-enter this drain (its first coordinator read opens
    // the job runtime, whose restart changes fire a drain): when that nested
    // drain already took this entry, `entry` is stale, and draining it again
    // would append and dispatch the same words twice.
    if (queues.get(threadId) !== entry) continue;
    // Lines said on a voice call never pile up into turns: every waiting
    // line of the same call and person drains at once, and the turn answers
    // the newest with the earlier ones as its context (voiceQueuePrompt).
    const group = entry.items[0]?.voiceCall ? callLineGroup(entry.items) : drainCoalesceHead(entry.items, coalesceIdentity, (item) => item.queuedAt, undefined, STEER_QUEUE_COALESCE_WINDOW_MS);
    // committed to draining: the entry leaves the map before anything runs,
    // so a settle racing another settle can never fire the same queue twice
    const ids = group.map((item) => item.messageId);
    settleChatFollowups(ids, "dispatching");
    const rest = entry.items.slice(group.length);
    if (rest.length > 0) queues.set(threadId, { botId: entry.botId, items: rest });
    else queues.delete(threadId);
    changed();
    const appended: Message[] = [];
    for (const item of group) {
      // Already a row (route_message after): the turn starts on it.
      const existing = item.existingMessageId ? store.patchMessage(threadId, item.existingMessageId, { queueId: item.messageId }) : null;
      if (existing) {
        appended.push(existing);
        continue;
      }
      // queueId is the pending-chip identity from the 202; append still
      // assigns a fresh transcript id so replay/exclude keep using message.id.
      appended.push(
        store.appendMessage(threadId, {
          role: "user",
          kind: "text",
          text: item.text,
          replyToId: item.replyToId,
          sendId: item.sendId,
          ...(item.dataContext ? { dataContext: item.dataContext } : {}),
          queueId: item.messageId,
          peerAsk: item.peerAsk,
          sender: item.sender,
          ...(item.voiceCall ? { voiceCall: item.voiceCall } : {}),
          ...spokenLineFields(item.via, item.callId),
        }),
      );
    }
    const last = appended.at(-1);
    if (!last) continue;
    // Keep each queued message on its own Markdown block boundary. A single
    // newline can merge a trailing standalone attachment tag with the next
    // message into one HTML block, which makes that attachment stop being a
    // native image when the combined follow-up is dispatched.
    const prompt = group[0]?.voiceCall ? voiceQueuePrompt(group.map((item) => item.prompt)) : joinQueuedPrompts(group.map((item) => item.prompt));
    const running = run(
      entry.botId,
      threadId,
      prompt,
      last,
      appended.map((message) => message.id),
      // one unattended line makes the whole drained turn unattended: a
      // person's words in the same group cannot re-attend a bot's own
      group.some((item) => item.unattended === true),
      // the first waiting line is the one that starts this turn
      { trigger: group[0].trigger, sender: group[0].sender, peerAsk: group[0].peerAsk, speaker: group[0].speaker, origin: group[0].origin },
    );
    void Promise.resolve(running).then(
      () => settleChatFollowups(ids, null),
      () => settleChatFollowups(ids, "interrupted"),
    ).catch((error) => console.warn("steer-queue: could not settle durable follow-up", error));
  }
}

/** The prompts of one drained group, blank-line separated. Lines that each
 * waited behind the same safe-point pause say so once, at the top. */
function joinQueuedPrompts(prompts: string[]): string {
  const marker = `${SAFE_POINT_NOTE}\n`;
  let noted = false;
  return prompts.map((prompt) => {
    if (!prompt.startsWith(marker)) return prompt;
    if (!noted) {
      noted = true;
      return prompt;
    }
    return prompt.slice(marker.length);
  }).join("\n\n");
}

/** A queued item's coalescing identity: WHO sent it, with provenance as
 * part of the identity. A person's texts merge only with that same
 * person's; a bot's own queued work (peerAsk/unattended) never merges with
 * anyone's person texts, nor with its own work from another request, and
 * unattributed local sends (the loopback owner) are one identity — the
 * transcript already names them all the same.
 * Team incidents reports are Sagax's, whichever bot broke (none
 * carries a request's origin): the ones that waited behind a busy Chief are
 * answered as one turn.
 * A spoken line never drains with a typed line or another call's line:
 * each call's record contains only turns its own lines started. */
function coalesceIdentity(item: QueueEntry["items"][number]): string {
  if (item.peerAsk?.incident) return "incident";
  if (item.peerAsk) return `peer:${item.peerAsk.botId}:${item.unattended === true ? "unattended" : "attended"}:${JSON.stringify(item.origin ?? null)}`;
  if (item.unattended === true) return "unattended";
  // an unnamed person is never merged into the operator's own words
  const person = item.sender
    ? `person:${item.sender.id ?? item.sender.name}`
    : item.speaker?.origin === "person" ? "person:unknown" : "person:local";
  // the "call:" prefix cannot begin any other identity; a row from a build
  // that kept no call id is still a spoken line, in a call of its own
  return item.via === "call" ? `call:${item.callId ?? ""}|${person}` : person;
}

/** The leading lines said on one voice call by one person, whatever the gap
 * between them: one turn answers them (the newest, the rest as context). */
function callLineGroup(items: QueueEntry["items"]): QueueEntry["items"] {
  const head = items[0]!;
  const identity = coalesceIdentity(head);
  const group: QueueEntry["items"] = [];
  for (const item of items) {
    if (item.voiceCall?.callId !== head.voiceCall?.callId || coalesceIdentity(item) !== identity) break;
    group.push(item);
  }
  return group;
}

/** Find the receipt for a retry whose message is still waiting to drain. */
export function queuedSteeredMessage(
  botId: string,
  threadId: string,
  sendId: string,
): { id: string; text: string; replyToId?: string; reason?: SteerQueueReason } | null {
  const entry = queues.get(threadId);
  if (!entry || entry.botId !== botId) return null;
  const item = entry.items.find((candidate) => candidate.sendId === sendId);
  return item ? { id: item.messageId, text: item.text, replyToId: item.replyToId, ...(item.reason ? { reason: item.reason } : {}) } : null;
}

/** Drop one waiting send owned by this bot so it never drains. The queue id
 * is stable even if the bot switches away from the task while the request is
 * in flight. Returns false when it was already drained, belongs to another
 * bot, or dispatch has already started. */
export function cancelSteeredMessage(botId: string, messageId: string, expectedThreadId?: string): boolean {
  for (const [threadId, entry] of queues) {
    if (entry.botId !== botId || (expectedThreadId !== undefined && threadId !== expectedThreadId)) continue;
    const items = entry.items.filter((item) => item.messageId !== messageId);
    if (items.length === entry.items.length) continue;
    settleChatFollowups([messageId], "cancelled");
    if (items.length === 0) queues.delete(threadId);
    else queues.set(threadId, { botId: entry.botId, items });
    changed();
    return true;
  }
  return false;
}

/** Cancel everything waiting for one thread (a parallel task stopped before
 * it started). Returns how many lines were dropped. */
export function cancelThreadQueue(botId: string, threadId: string): number {
  const entry = queues.get(threadId);
  if (!entry || entry.botId !== botId) return 0;
  queues.delete(threadId);
  settleChatFollowups(entry.items.map((item) => item.messageId), "cancelled");
  changed();
  return entry.items.length;
}

/** Duplex barge-in on a call: drop every queued follow-up on this thread
 * so the latest utterance is the only one that runs. Typed chat still
 * keeps its queue on interrupt (see file header). */
export function discardSteeredQueue(botId: string, threadId: string): number {
  return cancelThreadQueue(botId, threadId);
}

/** Atomically lift a thread's whole queue out of the map for a live steer.
 * The entry leaves first so a settle that starts draining while the adapter
 * is still thinking can never also dispatch the same words as a follow-up
 * turn. The caller must either restore the held queue or settle its rows. */
export function holdSteeredQueue(botId: string, threadId: string, queueId: string): HeldSteerQueue | null {
  const entry = queues.get(threadId);
  if (!entry || entry.botId !== botId || !entry.items.some((item) => item.messageId === queueId)) return null;
  queues.delete(threadId);
  changed();
  return { botId, threadId, items: entry.items };
}

/** Put a held queue back after the steer was refused. Words queued while the
 * hold was open keep their place behind the restored items. */
export function restoreHeldSteeredQueue(held: HeldSteerQueue): void {
  const existing = queues.get(held.threadId);
  if (existing && existing.botId !== held.botId) throw new Error("queued task belongs to another bot");
  queues.set(held.threadId, {
    botId: held.botId,
    items: existing ? [...held.items, ...existing.items] : held.items,
  });
  changed();
}

/** Mark a held queue's durable rows delivered: the words were folded into the
 * running turn, so a restart must not replay them as a fresh follow-up. */
export function settleHeldSteeredQueue(held: HeldSteerQueue): void {
  settleChatFollowups(held.items.map((item) => item.messageId), null);
}

/** Test helper: how many messages remain queued for a thread. */
export function _queuedCount(threadId: string): number {
  return queues.get(threadId)?.items.length ?? 0;
}
