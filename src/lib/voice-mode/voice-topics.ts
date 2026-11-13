// Open topics on a live call (issue #292, Quasar requirement 9).
// The call is an orchestrator: a long task can keep running as background
// work while the person asks about something else. Barge-in cancels the
// spoken reply, not that background work, unless they say stop.
export type VoiceTopicStatus = "active" | "background" | "done" | "announced";
export type VoiceIntent = "stop" | "correction" | "new_topic";

export interface VoiceTopic {
  id: string;
  label: string;
  status: VoiceTopicStatus;
}

export type TopicEvent =
  | { type: "start"; id: string; label: string }
  | { type: "background"; id: string }
  | { type: "done"; id: string }
  | { type: "announced"; id: string }
  | { type: "drop"; id: string };

function fold(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").trim();
}

export function topicLabel(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 48 ? `${line.slice(0, 45).trimEnd()}...` : line;
}

/** What a stop says, as whole word sequences (folded, no punctuation). */
const STOP_PHRASES = [
  "stop", "stop that", "stop it", "stop ca", "arrete", "arrete ca", "arrete toi", "arretez", "arrete tout",
  "cancel", "cancel that", "cancel it", "tais toi", "taisez vous", "shut up", "enough", "that s enough", "thats enough",
  "ca suffit", "never mind", "laisse faire", "laisse tomber", "nevermind",
].map((phrase) => phrase.split(" "));
/** Words a stop may carry around it: fillers and politeness ("ok stop",
 * "stop please", "arrête ça s'il te plaît"). "s il te plait" is folded to
 * one word first. */
const STOP_COMPANIONS = new Set([
  "ok", "okay", "please", "stp", "svp", "merci", "thanks", "hey", "euh", "um", "uh", "hum", "bon", "ben", "la", "non", "no", "juste", "just", "wait", "attends",
  "stop", "arrete",
]);
const MAX_STOP_COMPANIONS = 2;

function stopWords(text: string): string[] {
  const folded = fold(text).replace(/\bs\W*il (te|vous) pla[iî]t\b/g, "stp");
  return folded.match(/[a-z0-9]+/g) ?? [];
}

/** The whole utterance is a stop ("stop", "arrête ça", "ok stop", "stop
 * please", with at most two filler or polite words), never a request that
 * starts with the word: "Stop le service AcmeGuard sur SRV-01" is work
 * to do, not a stop. */
export function isStopUtterance(text: string): boolean {
  const words = stopWords(text);
  if (!words.length) return false;
  for (const phrase of STOP_PHRASES) {
    for (let at = 0; at + phrase.length <= words.length; at++) {
      if (!phrase.every((word, i) => words[at + i] === word)) continue;
      const rest = [...words.slice(0, at), ...words.slice(at + phrase.length)];
      if (rest.length <= MAX_STOP_COMPANIONS && rest.every((word) => STOP_COMPANIONS.has(word))) return true;
    }
  }
  return false;
}

export function isCorrectionUtterance(text: string): boolean {
  const folded = fold(text);
  if (isStopUtterance(text)) return false;
  return /^(no,|non,)\s/.test(folded)
    || /^non pas\b/.test(folded)
    || /^(i meant|je voulais dire)\b/.test(folded)
    || /^(plutot|au lieu)\b/.test(folded)
    || /^(actually|corrige)\b/.test(folded)
    || /^change that\b/.test(folded)
    || /\b(instead|au lieu)\b/.test(folded);
}

export function classifyVoiceIntent(text: string): VoiceIntent {
  if (isStopUtterance(text)) return "stop";
  if (isCorrectionUtterance(text)) return "correction";
  return "new_topic";
}

export function isNewVoiceTopic(text: string): boolean {
  return classifyVoiceIntent(text) === "new_topic";
}

/** A finished topic's result after a short lead naming it. The result is
 * already the spoken part of the answer (answer-budget.ts spokenAnswer):
 * #4216, it is said whole, never clipped mid-sentence. */
export function announceTopic(label: string, result: string): string {
  return `For ${label}: ${result.replace(/\s+/g, " ").trim()}`;
}

export function applyTopicEvent(topics: VoiceTopic[], event: TopicEvent): VoiceTopic[] {
  switch (event.type) {
    case "start":
      return [
        ...topics.map((topic) => topic.status === "active" ? { ...topic, status: "background" as const } : topic),
        { id: event.id, label: event.label, status: "active" },
      ];
    case "background":
      return topics.map((topic) => topic.id === event.id ? { ...topic, status: "background" } : topic);
    case "done":
      return topics.map((topic) => topic.id === event.id ? { ...topic, status: "done" } : topic);
    case "announced":
      return topics.map((topic) => topic.id === event.id ? { ...topic, status: "announced" } : topic);
    case "drop":
      return topics.filter((topic) => topic.id !== event.id);
  }
}

export function openTopics(topics: VoiceTopic[]): VoiceTopic[] {
  return topics.filter((topic) => topic.status === "active" || topic.status === "background");
}

/** Rebuild open topics from the call thread so the model can refer back. */
export function topicsFromCallMessages(messages: Array<{
  id: string;
  role?: string;
  text?: string;
  voiceCall?: unknown;
  parallelTask?: { role?: string; state?: string; requestMessageId?: string };
}>): VoiceTopic[] {
  let topics: VoiceTopic[] = [];
  for (const message of messages) {
    if (message.role === "user" && message.voiceCall && message.text?.trim()) {
      if (isStopUtterance(message.text)) {
        for (const open of openTopics(topics)) topics = applyTopicEvent(topics, { type: "drop", id: open.id });
        continue;
      }
      if (topics.length === 0 || isNewVoiceTopic(message.text)) {
        topics = applyTopicEvent(topics, { type: "start", id: message.id, label: topicLabel(message.text) });
      }
    }
    const card = message.parallelTask;
    if (card?.role === "card") {
      const id = card.requestMessageId ?? message.id;
      if (card.state === "running" || card.state === "queued") topics = applyTopicEvent(topics, { type: "background", id });
      else if (card.state === "done" || card.state === "failed" || card.state === "stopped") {
        topics = applyTopicEvent(topics, { type: "done", id });
      }
    }
  }
  return topics;
}

/** Lines for the phone-call prompt. Empty when nothing is open. */
export function voiceCallTopicsNote(topics: VoiceTopic[]): string {
  const open = openTopics(topics);
  if (!open.length) return "";
  const lines = [
    "Open topics on this call. Refer back to them by these names when it helps (\"for the other thing you asked...\"):",
    ...open.map((topic) => `- ${topic.label} (${topic.status === "background" ? "still running in the background" : "current"})`),
  ];
  return lines.join("\n");
}

/** #4216: the send receipt of a line said on a call says the bot's parallel
 * limit refused it a task of its own, so it waits in the queue: the call
 * says so, like a task card that waits for a slot. */
export function callSendWaitsForSlot(receipt: unknown): boolean {
  const body = receipt as { queued?: unknown; reason?: unknown } | null | undefined;
  return body?.queued === true && body.reason === "capacity";
}

export function callHasBackgroundWork(messages: Array<{
  kind?: string;
  tool?: { name?: string; ok?: boolean };
  parallelTask?: { role?: string; state?: string };
}>): boolean {
  return messages.some((message) => {
    const state = message.parallelTask?.state;
    return message.parallelTask?.role === "card" && (state === "running" || state === "queued");
  });
}

/** New words join the running call turn (steer) instead of replacing it
 * only while its own tool is in flight: replacing would kill the work.
 * A live parallel card does not count (a replace never touches it), nor a
 * chip an earlier, replaced utterance left unsettled. Barge-in stays
 * card-only (`callHasBackgroundWork`). */
export function callHasParkableWork(messages: Array<{
  role?: string;
  kind?: string;
  tool?: { name?: string; ok?: boolean };
  parallelTask?: { role?: string; state?: string };
}>): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (message.role === "user" && !message.parallelTask) return false;
    if (message.kind === "activity" && message.tool && !message.parallelTask
      && message.tool.ok !== true && message.tool.ok !== false) return true;
  }
  return false;
}

export function howToSpeakTopicResult(opts: {
  replyUserId?: string;
  lastUserId?: string;
  isParallelResult?: boolean;
}): "full" | "announce" | "skip" {
  // #4216: several requests run side by side on a call; each result says
  // which one it answers, even the one asked last
  if (opts.isParallelResult) return "announce";
  if (opts.replyUserId && opts.lastUserId && opts.replyUserId !== opts.lastUserId) return "announce";
  return "full";
}

/** The user line this bot reply answers. Parallel request rows sit between
 * a background topic and its later call-thread result, so they are skipped
 * when walking back. */
export function sourceUserId(
  messages: Array<{
    id: string;
    role?: string;
    parallelTask?: { role?: string; requestMessageId?: string };
    requestMessageId?: string;
  }>,
  replyIndex: number,
  row?: {
    parallelTask?: { requestMessageId?: string };
    requestMessageId?: string;
  },
): string | undefined {
  const linked = row?.parallelTask?.requestMessageId || row?.requestMessageId;
  if (linked) return linked;
  for (let i = replyIndex - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role === "user" && message.parallelTask?.role !== "request") return message.id;
  }
}
