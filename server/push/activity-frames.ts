// Which live frames become Live Activity pushes. Reuses the same notify
// audience rules as alert pushes (./frames.ts): a person's own bots only.
import type { LiveActivityUpdate } from "./activity-hub.ts";
import type { NotifyNote } from "./frames.ts";

export interface ActivityFrameDeps {
  /** Who should see this bot's Live Activity (person isolation). */
  activityPeople(note: Pick<NotifyNote, "botId" | "threadId" | "kind" | "audience">): string[];
  /** Bot notifications muted for this person. */
  muted(note: NotifyNote, person: string): boolean;
  now(): number;
}

const text = (value: unknown) => (typeof value === "string" ? value : "");

/** Map a notify / bot frame into Live Activity updates for the right people. */
export function liveActivityUpdatesForFrame(
  payload: Record<string, unknown>,
  deps: ActivityFrameDeps,
): LiveActivityUpdate[] {
  const at = deps.now();
  if (payload.kind === "notify" && payload.notification && typeof payload.notification === "object") {
    const raw = payload.notification as Record<string, unknown>;
    const noteKind = text(raw.kind);
    if (raw.quietOnPhones === true) return [];
    const botId = text(raw.botId);
    if (!botId) return [];
    const botName = text(raw.botName) || "Bot";
    const threadId = text(raw.threadId) || undefined;
    const note: NotifyNote = {
      kind: noteKind,
      botId,
      botName,
      threadId: threadId ?? "",
      title: text(raw.title),
      body: text(raw.body),
      ...(Array.isArray(raw.audience) ? { audience: raw.audience.filter((id): id is string => typeof id === "string") } : {}),
      ...(text(raw.requestId) ? { requestId: text(raw.requestId) } : {}),
      ...(text(raw.ask).trim() ? { ask: text(raw.ask).trim() } : {}),
      ...(Array.isArray(raw.choices) ? { choices: raw.choices.filter((c): c is string => typeof c === "string" && c.trim().length > 0) } : {}),
    };
    let phase: LiveActivityUpdate["phase"] | null = null;
    if (noteKind === "approval" || noteKind === "question") phase = "needsYou";
    else if (noteKind === "done") phase = "done";
    else return [];
    const people = [...new Set((note.audience ?? deps.activityPeople(note)).map((id) => id.trim().toLowerCase()).filter(Boolean))];
    return people.filter((person) => !deps.muted(note, person)).map((personId) => ({
      personId,
      botId,
      botName,
      phase,
      line: phase === "needsYou" ? (note.ask || note.body || note.title) : note.body || note.title,
      ...(threadId ? { threadId } : {}),
      ...(phase === "needsYou" && note.requestId ? { requestId: note.requestId } : {}),
      ...(phase === "needsYou" && noteKind === "approval" ? { options: note.choices?.length ? note.choices : ["Allow", "Deny"], isPermission: true } : {}),
      ...(phase === "needsYou" && noteKind === "question" && note.choices?.length ? { options: note.choices, isPermission: false } : {}),
      sinceMs: at,
    }));
  }
  if (payload.kind === "bot" && payload.bot && typeof payload.bot === "object" && !Array.isArray(payload.bot)) {
    const bot = payload.bot as Record<string, unknown>;
    const botId = text(bot.id);
    if (!botId) return [];
    const activity = text(bot.activity);
    const botName = text(bot.name) || "Bot";
    const threadId = text(bot.threadId) || undefined;
    let phase: LiveActivityUpdate["phase"] | null = null;
    if (activity === "working") phase = "working";
    else if (activity === "waiting-on-you") phase = "needsYou";
    else if (activity === "idle" || activity === "parked.computer") phase = "done";
    else return [];
    // Audience: privateThreads owner, else explicit audience on the frame.
    const audience = Array.isArray(payload.audience)
      ? payload.audience.filter((id): id is string => typeof id === "string")
      : typeof payload.audience === "string" ? [payload.audience] : null;
    const people = audience
      ? [...new Set(audience.map((id) => id.trim().toLowerCase()).filter(Boolean))]
      : deps.activityPeople({ botId, threadId: threadId ?? "", kind: "done" });
    // needsYou from bot frames without a card: still update the island; the
    // notify with requestId/options arrives separately when present.
    return people.map((personId) => ({
      personId,
      botId,
      botName,
      phase,
      line: phase === "working" ? text(bot.workingLabel) || text(bot.stepLabel) || "" : "",
      ...(threadId ? { threadId } : {}),
      sinceMs: at,
    }));
  }
  // An ask answered or expired: end that bot's activity with "answered".
  if (payload.kind === "notify-withdraw" && text(payload.threadId)) {
    return [];
  }
  return [];
}
