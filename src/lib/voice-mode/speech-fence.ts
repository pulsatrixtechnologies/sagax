// What a live call may speak after a barge-in (issue #292).
//
// The player already bumps its own generation on cancel. LiveCall still
// used to clear `dropOldReply` on the next send, so a dying turn's text
// that landed after the new user line was spoken. This fence is the
// single source for: keep dropping the old answer across the send, accept
// only a new stream or a reply proven to belong to the latest user line.
export interface SpeechFence {
  generation: number;
  dropOldReply: boolean;
  dropStream: string | null;
  /** Thinking barge-in has no cut prefix. Ignore live until it goes empty
   * so a late delta of the cancelled turn is not spoken as the new answer. */
  waitForClear: boolean;
}

export function createSpeechFence(): SpeechFence {
  return { generation: 0, dropOldReply: false, dropStream: null, waitForClear: false };
}

/** Confirmed barge-in: the rest of that answer is never spoken. */
export function cancelSpeech(fence: SpeechFence, currentStream?: string | null): SpeechFence {
  const cut = currentStream ?? "";
  return {
    generation: fence.generation + 1,
    dropOldReply: true,
    dropStream: cut,
    waitForClear: cut === "",
  };
}

/** The running turn is being stopped; keep dropping its stream. */
export function interruptBot(fence: SpeechFence, currentStream?: string | null): SpeechFence {
  const cut = currentStream ?? fence.dropStream ?? "";
  return {
    ...fence,
    dropOldReply: true,
    dropStream: cut,
    waitForClear: cut === "",
  };
}

/** A new utterance went out. Do not reopen a cut answer; a send with no
 * barge-in leaves drop off so the next reply still speaks. */
export function noteUtteranceSent(fence: SpeechFence): SpeechFence {
  return {
    generation: fence.generation + 1,
    dropOldReply: fence.dropOldReply,
    dropStream: fence.dropStream,
    waitForClear: fence.waitForClear,
  };
}

function isCutContinuation(live: string, cut: string | null): boolean {
  if (cut === null || cut === "") return false;
  const prefix = cut.slice(0, 16);
  return live.length >= prefix.length && live.startsWith(prefix);
}

/** Live assistant text to feed the voice, or null to ignore. */
export function streamText(fence: SpeechFence, live: string | undefined): { text: string | null; fence: SpeechFence } {
  const empty = live === undefined || live === "";
  if (empty) {
    if (fence.waitForClear) return { text: null, fence: { ...fence, waitForClear: false } };
    return { text: null, fence };
  }
  if (fence.waitForClear) return { text: null, fence };
  if (isCutContinuation(live, fence.dropStream)) return { text: null, fence };
  if (fence.dropStream !== null && fence.dropStream !== "") {
    return { text: live, fence: { ...fence, dropStream: null, dropOldReply: false, waitForClear: false } };
  }
  if (fence.dropOldReply) {
    return { text: live, fence: { ...fence, dropOldReply: false, dropStream: null, waitForClear: false } };
  }
  return { text: live, fence };
}

export interface FenceMessage {
  id: string;
  role: "bot" | "user";
  kind: string;
  text?: string;
  requestMessageId?: string;
  parallelTask?: { role?: string; requestMessageId?: string };
}

export function shouldSpeakReply(fence: SpeechFence, opts: {
  replyIndex: number;
  lastUserIndex: number;
  lastUserId?: string;
  requestMessageId?: string;
  replyText: string;
}): "speak" | "skip" {
  if (opts.replyIndex < opts.lastUserIndex) return "skip";
  if (isCutContinuation(opts.replyText, fence.dropStream)) return "skip";
  if (fence.dropOldReply) {
    if (opts.requestMessageId && opts.lastUserId && opts.requestMessageId === opts.lastUserId) return "speak";
    // Speech-only barge-in: a later result that is not the cut block still
    // speaks (LiveCall announces it). A thinking interrupt has no prefix.
    if (fence.dropStream) return "speak";
    return "skip";
  }
  return "speak";
}

export function settleReplies(
  fence: SpeechFence,
  messages: FenceMessage[],
  freshIds: Iterable<string>,
): { fence: SpeechFence; speak: { id: string; text: string }[]; skip: string[] } {
  // #4216: a request that runs as its own parallel task is answered by its
  // own result row; it does not make the running turn's answer an old one
  const lastUserIndex = messages.findLastIndex((message) => message.role === "user" && message.parallelTask?.role !== "request");
  const lastUserId = lastUserIndex >= 0 ? messages[lastUserIndex]?.id : undefined;
  const speak: { id: string; text: string }[] = [];
  const skip: string[] = [];
  let next = fence;
  for (const id of freshIds) {
    const replyIndex = messages.findIndex((message) => message.id === id);
    const reply = replyIndex >= 0 ? messages[replyIndex] : undefined;
    if (!reply || reply.role !== "bot" || reply.kind !== "text" || !reply.text?.trim()) continue;
    if (shouldSpeakReply(next, {
      replyIndex,
      lastUserIndex,
      lastUserId,
      requestMessageId: reply.parallelTask?.requestMessageId || reply.requestMessageId,
      replyText: reply.text,
    }) === "speak") {
      speak.push({ id: reply.id, text: reply.text });
      next = { ...next, dropOldReply: false, dropStream: null, waitForClear: false };
    } else {
      skip.push(reply.id);
    }
  }
  return { fence: next, speak, skip };
}

/** Tool chips while the thinking cue is playing: duplex still says them. */
export function shouldNarrateToolChip(opts: { duplex: boolean; playerBusy: boolean }): boolean {
  return opts.duplex || !opts.playerBusy;
}
