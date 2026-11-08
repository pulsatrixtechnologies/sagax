// Which live frames become pushes, and for whom. The server already
// broadcasts everything a person should hear about (server/index.ts
// broadcast): a `notify` frame (a person's direct message, a bot that
// finished, a bot waiting on an answer, an approval, a takeover, a turn
// that could not start, a routine that failed or waited too long, an
// incident), a `nudge` frame and an `achievements` frame. This reads them
// and returns the PushMessage of each person concerned; ./hub.ts decides when.
import { pushAvatarUrl, type PushKind, type PushMessage, type PushSenderLook } from "./payload.ts";

/** The `notify` kinds a phone hears about, as the push kind it carries.
 * Takeover is `approval` so it wakes at once (priority 10) and skips the
 * rate limit: the bot is blocked on the person. It carries no `prompt` and
 * no `requestId`, so the banner has no Allow or Deny. */
export const NOTIFY_PUSH_KINDS: Readonly<Record<string, PushKind>> = Object.freeze({
  message: "message",
  done: "message",
  question: "approval",
  approval: "approval",
  takeover: "approval",
  // a proactive or routine report with something for the person (#2697):
  // wakes the phone at once, like an ask, without Allow / Deny
  "needs-you": "approval",
  // a proactive proposal card (#2697): a card-level push, so the person's
  // daily budget and quiet hours (#2695) decide; Do it / Not now on the banner
  proposal: "message",
  wait: "message",
  "turn-failed": "message",
  incident: "message",
  "routine-failed": "routine",
  "routine-deferred": "routine",
});

export interface NotifyNote {
  kind: string;
  botId: string;
  botName: string;
  threadId: string;
  groupId?: string;
  title: string;
  body: string;
  audience?: string[];
  avatarUrl?: string;
  requestId?: string;
  needsKey?: boolean;
  routineRunId?: string;
  routineName?: string;
  ask?: string;
  choices?: string[];
  /** #2909: the buttons' short labels; absent with choices: Open only. */
  choiceLabels?: string[];
  /** #2909: the readable whole context (multi-line). */
  context?: string;
  /** #2909: the chat message holding the card. */
  cardId?: string;
  proposalId?: string;
}

export interface FramePushDeps {
  /** Who a bot's notification without `audience` is for: the person whose
   * thread it is, else the bot's owner (an approval: the owner). */
  notificationPeople(note: NotifyNote): string[];
  /** This person turned that bot's notifications off. */
  muted(note: NotifyNote, person: string): boolean;
  /** The person asked for system notifications of achievements. */
  achievementNotifications(person: string): boolean;
  achievementName(id: string, person: string): string | undefined;
  /** A bot's look (colour, character, skin, crop), so the phone draws its
   * mascot on the banner. Absent: the phone shows the picture or the icon. */
  botLook?(botId: string): PushSenderLook | undefined;
  now(): number;
}

const text = (value: unknown) => (typeof value === "string" ? value : "");

export function pushesForFrame(payload: Record<string, unknown>, deps: FramePushDeps): PushMessage[] {
  const at = deps.now();
  if (payload.kind === "notify" && payload.notification && typeof payload.notification === "object") {
    const raw = payload.notification as Record<string, unknown>;
    const kind = NOTIFY_PUSH_KINDS[text(raw.kind)];
    if (!kind) return [];
    const avatarUrl = pushAvatarUrl(raw.avatarUrl);
    const note: NotifyNote = {
      kind: text(raw.kind),
      botId: text(raw.botId),
      botName: text(raw.botName),
      threadId: text(raw.threadId),
      ...(text(raw.groupId) ? { groupId: text(raw.groupId) } : {}),
      title: text(raw.title),
      body: text(raw.body),
      ...(Array.isArray(raw.audience) ? { audience: raw.audience.filter((id): id is string => typeof id === "string") } : {}),
      ...(avatarUrl ? { avatarUrl } : {}),
      ...(text(raw.requestId) ? { requestId: text(raw.requestId).slice(0, 128) } : {}),
      ...(raw.needsKey === true ? { needsKey: true } : {}),
      ...(text(raw.routineRunId) ? { routineRunId: text(raw.routineRunId).slice(0, 128) } : {}),
      ...(text(raw.routineName) ? { routineName: text(raw.routineName).slice(0, 80) } : {}),
      ...(text(raw.ask).trim() ? { ask: text(raw.ask).trim() } : {}),
      ...(text(raw.proposalId) ? { proposalId: text(raw.proposalId).slice(0, 128) } : {}),
      ...(Array.isArray(raw.choices) ? { choices: raw.choices.filter((choice): choice is string => typeof choice === "string" && choice.trim().length > 0) } : {}),
      ...(Array.isArray(raw.choiceLabels) ? { choiceLabels: raw.choiceLabels.filter((label): label is string => typeof label === "string" && label.trim().length > 0) } : {}),
      ...(text(raw.context).trim() ? { context: text(raw.context) } : {}),
      ...(text(raw.cardId) ? { cardId: text(raw.cardId).slice(0, 128) } : {}),
    };
    // an AI client's conversation over MCP never rings a phone or a watch
    if (raw.quietOnPhones === true) return [];
    // the bot wrote it with notify false: in the chat, never on a phone
    // (#2695: one marked FYI still reaches the signal gate, which keeps it for the brief)
    if (raw.notify === false && raw.level !== "fyi") return [];
    const people = note.audience ?? deps.notificationPeople(note);
    const unique = [...new Set(people.map((id) => id.trim().toLowerCase()).filter(Boolean))];
    const senderName = note.botName.trim();
    const senderId = note.botId.trim();
    // a bot's own banner wears its mascot; a person's message has no bot id
    const senderLook = senderName && senderId ? deps.botLook?.(senderId) : undefined;
    return unique.filter((person) => !deps.muted(note, person)).map((personId) => ({
      kind,
      personId,
      title: note.title,
      body: note.body,
      ...(note.threadId ? { threadId: note.threadId } : {}),
      ...(note.botId ? { botId: note.botId } : {}),
      ...(note.groupId ? { groupId: note.groupId } : {}),
      ...(senderName ? { senderName } : {}),
      ...(senderId ? { senderId } : {}),
      ...(note.avatarUrl ? { avatarUrl: note.avatarUrl } : {}),
      ...(senderLook ? { senderLook } : {}),
      ...(note.requestId ? { requestId: note.requestId } : {}),
      ...(note.kind === "approval" || note.kind === "question" ? { prompt: note.kind as "approval" | "question" } : {}),
      ...(note.kind === "approval" && note.needsKey ? { needsKey: true } : {}),
      ...(note.routineRunId ? { routineRunId: note.routineRunId } : {}),
      ...(note.routineName ? { routineName: note.routineName } : {}),
      ...(note.ask && (note.kind === "approval" || note.kind === "question") ? { ask: note.ask } : {}),
      ...((note.kind === "question" || note.kind === "needs-you") && note.choices?.length ? { choices: note.choices } : {}),
      // #2909: labels only when one per choice, else the banner offers Open
      ...((note.kind === "question" || note.kind === "needs-you") && note.choices?.length
        && note.choiceLabels?.length === note.choices.length ? { choiceLabels: note.choiceLabels } : {}),
      ...(note.context && (note.kind === "approval" || note.kind === "question" || note.kind === "needs-you") ? { context: note.context } : {}),
      ...(note.cardId ? { cardId: note.cardId } : {}),
      ...(note.kind === "needs-you" && !note.requestId ? { needsYou: true } : {}),
      ...(note.kind === "proposal" && note.proposalId ? { proposalId: note.proposalId } : {}),
      at,
    }));
  }
  if (payload.kind === "nudge" && typeof payload.audience === "string" && payload.audience.trim()) {
    const name = text(payload.fromName).trim() || "Someone";
    const open = payload.open && typeof payload.open === "object" ? payload.open as { groupId?: unknown; threadId?: unknown } : null;
    return [{
      kind: "nudge",
      personId: payload.audience.trim().toLowerCase(),
      title: `${name} sent you a nudge`,
      body: "Open the conversation to answer.",
      titleLocKey: "%@ sent you a nudge",
      titleLocArgs: [name],
      bodyLocKey: "Open the conversation to answer.",
      ...(text(open?.threadId) ? { threadId: text(open?.threadId) } : {}),
      ...(text(open?.groupId) ? { groupId: text(open?.groupId) } : {}),
      ...(text(payload.fromId) ? { fromId: text(payload.fromId) } : {}),
      ...(text(payload.id) ? { id: text(payload.id) } : {}),
      senderName: name,
      ...(text(payload.fromId) ? { senderId: text(payload.fromId) } : {}),
      at: typeof payload.at === "number" && Number.isFinite(payload.at) ? payload.at : at,
    }];
  }
  if (payload.kind === "achievements" && typeof payload.audience === "string" && Array.isArray(payload.unlocked)) {
    const person = payload.audience.trim().toLowerCase();
    if (!person || !payload.unlocked.length || !deps.achievementNotifications(person)) return [];
    const names = payload.unlocked
      .map((entry) => (entry && typeof entry === "object" ? deps.achievementName(text((entry as { id?: unknown }).id), person) : undefined))
      .filter((name): name is string => Boolean(name));
    return [{
      kind: "achievement",
      personId: person,
      title: "Achievement unlocked",
      titleLocKey: "Achievement unlocked",
      body: names.join(", "),
      at,
    }];
  }
  return [];
}
