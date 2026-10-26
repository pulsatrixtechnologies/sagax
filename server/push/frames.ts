// Which live frames become pushes, and for whom. The server already
// broadcasts everything a person should hear about (server/index.ts
// broadcast): a `notify` frame (a person's direct message, a bot that
// finished, a bot waiting on an answer, an approval, a routine that
// failed), a `nudge` frame and an `achievements` frame. This reads them and
// returns the PushMessage of each person concerned; ./hub.ts decides when.
import { pushAvatarUrl, type PushKind, type PushMessage } from "./payload.ts";

/** The `notify` kinds a phone hears about, as the push kind it carries. */
export const NOTIFY_PUSH_KINDS: Readonly<Record<string, PushKind>> = Object.freeze({
  message: "message",
  done: "message",
  question: "approval",
  approval: "approval",
  "routine-failed": "routine",
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
    };
    const people = note.audience ?? deps.notificationPeople(note);
    const unique = [...new Set(people.map((id) => id.trim().toLowerCase()).filter(Boolean))];
    const senderName = note.botName.trim();
    const senderId = note.botId.trim();
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
      ...(note.requestId ? { requestId: note.requestId } : {}),
      ...(note.kind === "approval" || note.kind === "question" ? { prompt: note.kind as "approval" | "question" } : {}),
      ...(note.kind === "approval" && note.needsKey ? { needsKey: true } : {}),
      ...(note.routineRunId ? { routineRunId: note.routineRunId } : {}),
      ...(note.routineName ? { routineName: note.routineName } : {}),
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
