// join_meeting: a bot asks to join a meeting as a notetaker. The request is
// a consent card the person answers; nothing joins before their tap, and no
// standing permission (Full access, an always-allow rule, a Live call's yes)
// ever answers it: each meeting is its own outward action.
//
// Once approved, a MeetingSession runs in a private browser of the bot's.
// The card shows its live state. The transcript lives in memory only, for
// the length of the meeting, and is handed to the bot's next turn for the
// summary and action items: no audio and no transcript file is ever
// written. The only file is DATA_DIR/meetings/live.json (0600), the ids of
// the meetings running now, so a restart can close their cards.
import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { MEETING_PROVIDER_LABELS, SUPPORTED_MEETING_PROVIDERS, findMeetingLink, meetingDisplayName } from "../../shared/meeting-links.ts";
import { MEETINGS_DISABLED, MEETING_LIVE_STATUSES, type MeetingRequestCardData } from "../../shared/meeting-request.ts";
import { meetingAnnouncement } from "./meet-scripts.ts";
import { MeetingSession, type MeetingBrowser, type MeetingOutcome, type TranscriptLine } from "./meeting-session.ts";
import { meetingSummaryPrompt } from "./meeting-summary.ts";

const MAX_REASON = 500;
/** Meeting browsers running at once on one server: each is a full Chrome. */
export const MEETING_MAX_CONCURRENT = 2;

interface CardLike {
  title: string;
  subtitle: string;
  options: string[];
  answered?: string;
  dismissed?: boolean;
  held?: string;
  requestId?: string;
  tool?: string;
  meetingRequest?: MeetingRequestCardData;
  ownerRule?: { tool: string; scope: Record<string, string>; description: string };
  ruleSaved?: { id: string; behavior: "allow" | "ask" | "deny"; description: string };
}

export interface MeetingStore {
  bot(id: string): { id: string; name: string; color: string } | undefined | null;
  messagesFor(threadId: string): Array<{ id: string; card?: CardLike }>;
  appendMessage(threadId: string, message: { role: "bot"; kind: "options"; card: CardLike; from?: { botId: string; name: string; color: string } }): { id: string };
  patchMessage(threadId: string, messageId: string, patch: { card: CardLike }): unknown;
}

export interface MeetingTranscriber {
  transcribe(audio: Uint8Array, mime: string): Promise<string>;
}

export interface MeetingServiceDeps {
  store: MeetingStore;
  dataDir: string;
  now?: () => number;
  /** Why this bot cannot join a meeting now (no browser), or null. */
  browserRefusal(botId: string): string | null;
  /** A fresh, private browser for one meeting. */
  openBrowser(botId: string, meetingId: string): Promise<MeetingBrowser>;
  /** Transcription paid like the person's voice mode, or why not. */
  transcriber(args: { botId: string; threadId: string; principalId: string; speaker?: unknown }): Promise<MeetingTranscriber | { error: string }>;
  /** Start the bot's summary turn in the conversation. */
  summarize(botId: string, threadId: string, prompt: string): void;
  /** One audit line per state change that matters (requested, approved, ended). */
  audit?(event: { kind: string; botId: string; threadId: string; requestId: string; principalId?: string; detail?: string }): void;
  /** Settings > Developer > Experimental > Meeting notetaker (off by default). While
   * off, nothing is staged, approved or left through this service. */
  enabled?: () => boolean;
  /** Test hook: the session factory. */
  session?(options: ConstructorParameters<typeof MeetingSession>[0]): Pick<MeetingSession, "run" | "requestLeave">;
  /** #2091 (decided 2026-11-05): the Always allow the person kept for meetings of
   * this provider (index.ts keptCardRule); kept, the bot joins at once as them. */
  keptRule?(botId: string, threadId: string, candidate: { tool: string; scope: Record<string, string>; description: string }): { id: string; ownerId: string; behavior: "allow" | "ask" | "deny"; description: string } | undefined;
}

export type MeetingResolveResult =
  | { claimed: false }
  | { claimed: true; status: number; error: string; code?: string }
  | { claimed: true; outcome: "allowed-once" | "rejected"; alreadySettled?: true };

function cardTitle(data: MeetingRequestCardData, botName: string): string {
  return data.supported
    ? `${botName} veut rejoindre une réunion ${MEETING_PROVIDER_LABELS[data.provider]} pour prendre des notes`
    : `${MEETING_PROVIDER_LABELS[data.provider]} : pas encore pris en charge`;
}

export function createMeetingService(deps: MeetingServiceDeps) {
  const now = deps.now ?? Date.now;
  const enabled = () => deps.enabled?.() ?? true;
  const dir = join(deps.dataDir, "meetings");
  const liveIndex = join(dir, "live.json");
  const sessions = new Map<string, Pick<MeetingSession, "run" | "requestLeave">>();
  /** Bots with a meeting being approved, joining or running: reserved
   * synchronously, before any await, so two taps cannot start two. */
  const busyBots = new Set<string>();

  const ensureDir = () => mkdirSync(dir, { recursive: true, mode: 0o700 });
  const writePrivate = (path: string, value: unknown) => {
    ensureDir();
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    try { chmodSync(path, 0o600); } catch { /* best effort on Windows */ }
  };
  const readLive = (): Array<{ threadId: string; requestId: string }> => {
    try {
      const parsed = JSON.parse(readFileSync(liveIndex, "utf8")) as unknown;
      return Array.isArray(parsed) ? parsed.filter((row): row is { threadId: string; requestId: string } =>
        Boolean(row) && typeof row.threadId === "string" && typeof row.requestId === "string") : [];
    } catch { return []; }
  };
  const writeLive = () => writePrivate(liveIndex, [...sessions.keys()].map((key) => JSON.parse(key) as { threadId: string; requestId: string }));
  const keyOf = (threadId: string, requestId: string) => JSON.stringify({ threadId, requestId });

  function find(threadId: string, requestId: string) {
    const message = deps.store.messagesFor(threadId).find((row) => row.card?.requestId === requestId && row.card.meetingRequest);
    return message?.card?.meetingRequest ? { message, card: message.card, data: message.card.meetingRequest } : null;
  }

  function patch(threadId: string, requestId: string, change: Partial<MeetingRequestCardData>, cardChange: Partial<CardLike> = {}): void {
    const found = find(threadId, requestId);
    if (!found) return;
    deps.store.patchMessage(threadId, found.message.id, {
      card: { ...found.card, ...cardChange, meetingRequest: { ...found.data, ...change } },
    });
  }

  function liveFor(botId: string): boolean {
    return busyBots.has(botId);
  }

  async function finished(data: MeetingRequestCardData, outcome: MeetingOutcome, started: number): Promise<void> {
    const endedAt = now();
    sessions.delete(keyOf(data.threadId, data.requestId));
    busyBots.delete(data.botId);
    try { writeLive(); } catch { /* the index is a recovery aid only */ }
    // A participant objected (Loi 25, conservative default): nothing said in
    // that meeting is kept, shown or summarized.
    const objected = outcome.endReason === "participant";
    const lines = objected ? [] : outcome.lines;
    if (objected) outcome.lines.length = 0;
    const nothing = objected
      ? "Left at a participant's request: nothing was kept."
      : outcome.status === "ended" && !lines.length
        ? `${outcome.detail ?? ""} ${outcome.recorded ? "Nothing was transcribed." : "Nothing was recorded."}`.trim()
        : outcome.detail;
    const summarizing = lines.length > 0;
    patch(data.threadId, data.requestId, {
      status: outcome.status, endedAt,
      ...(nothing ? { detail: nothing } : {}),
      ...(outcome.endReason ? { endReason: outcome.endReason } : {}),
      // The live tail leaves the card once the meeting is over: the notes
      // carry what matters, and an objection keeps nothing at all.
      ...(objected ? { transcriptTail: undefined, segments: undefined } : summarizing ? { transcriptTail: undefined } : {}),
    });
    deps.audit?.({ kind: `meeting.${outcome.status}`, botId: data.botId, threadId: data.threadId, requestId: data.requestId, ...(outcome.detail ? { detail: outcome.detail } : {}) });
    if (summarizing) {
      deps.summarize(data.botId, data.threadId, meetingSummaryPrompt({
        providerLabel: MEETING_PROVIDER_LABELS[data.provider],
        code: data.code,
        startedAt: started,
        endedAt,
        lines,
        ended: outcome.detail,
      }));
    }
  }

  const service = {
    /** Cards left live by a server that stopped mid-meeting: say so. */
    recoverInterrupted(): number {
      if (!existsSync(liveIndex)) return 0;
      let count = 0;
      for (const row of readLive()) {
        const found = find(row.threadId, row.requestId);
        if (found && MEETING_LIVE_STATUSES.has(found.data.status)) {
          patch(row.threadId, row.requestId, { status: "failed", detail: "The server stopped during the meeting.", endedAt: now() });
          count++;
        }
      }
      try { writePrivate(liveIndex, []); } catch { /* ignore */ }
      return count;
    },

    /** The bot's request: one consent card in the conversation. */
    submit(args: { botId: string; threadId: string; url: string; reason: string }): { requestId: string; messageId: string; supported: boolean; provider: string } | { error: string; code?: string } {
      if (!enabled()) return { ...MEETINGS_DISABLED };
      const link = findMeetingLink(args.url);
      if (!link) return { error: "That is not a Google Meet, Zoom or Teams meeting link. Ask the person for the meeting's https link." };
      const bot = deps.store.bot(args.botId);
      if (!bot) return { error: "unknown bot" };
      const supported = SUPPORTED_MEETING_PROVIDERS.has(link.provider);
      if (supported) {
        const refusal = deps.browserRefusal(args.botId);
        if (refusal) return { error: refusal };
        if (liveFor(args.botId)) return { error: "You are already in a meeting. Wait for it to end, or ask the person to press Leave on its card." };
      }
      const requestId = randomUUID();
      const meetingRule = { tool: "sagax:meeting", scope: { provider: link.provider }, description: `Join ${MEETING_PROVIDER_LABELS[link.provider]} meetings as a notetaker` };
      const data: MeetingRequestCardData = {
        requestId,
        botId: bot.id,
        threadId: args.threadId,
        provider: link.provider,
        url: link.url,
        code: link.code,
        displayName: meetingDisplayName(bot.name),
        reason: args.reason.trim().slice(0, MAX_REASON),
        supported,
        status: supported ? "pending" : "declined",
        ...(supported ? {} : { detail: `${MEETING_PROVIDER_LABELS[link.provider]} meetings are not supported yet; Google Meet is.` }),
      };
      // other people are in that meeting: the isolation hold keeps this
      // consent card at Full (full-access-gate.ts); full-access: isolation
      const message = deps.store.appendMessage(args.threadId, {
        role: "bot",
        kind: "options",
        from: { botId: bot.id, name: bot.name, color: bot.color },
        card: {
          title: cardTitle(data, bot.name),
          subtitle: data.reason || link.url,
          options: supported ? ["Rejoindre et prendre des notes", "Pas cette fois"] : ["Pas cette fois"],
          requestId,
          tool: "join_meeting",
          meetingRequest: data,
          // #2091: what Always allow keeps on this card
          ownerRule: meetingRule,
        },
      });
      deps.audit?.({ kind: "meeting.requested", botId: bot.id, threadId: args.threadId, requestId, detail: `${link.provider} ${link.code}` });
      const kept = supported ? deps.keptRule?.(bot.id, args.threadId, meetingRule) : undefined;
      if (kept?.behavior === "allow") {
        patch(args.threadId, requestId, {}, { ruleSaved: { id: kept.id, behavior: kept.behavior, description: kept.description } });
        void service.resolve({ threadId: args.threadId, requestId, behavior: "allow", principalId: kept.ownerId, speaker: { principalId: kept.ownerId } });
      }
      return { requestId, messageId: message.id, supported, provider: link.provider };
    },

    /** The person's answer on the card. */
    async resolve(args: { threadId: string; requestId: string; behavior: "allow" | "deny" | "answer"; principalId: string; personName?: string; speaker?: unknown }): Promise<MeetingResolveResult> {
      const found = find(args.threadId, args.requestId);
      if (!found) return { claimed: false };
      if (!enabled()) return { claimed: true, status: 403, ...MEETINGS_DISABLED };
      const { card, data } = found;
      if (card.answered || card.dismissed || data.status !== "pending") {
        return { claimed: true, outcome: card.answered === "allow" ? "allowed-once" : "rejected", alreadySettled: true };
      }
      /** A refusal the card keeps showing while it stays open. */
      const refuse = (error: string): MeetingResolveResult => {
        patch(args.threadId, args.requestId, { detail: error });
        return { claimed: true, status: 409, error };
      };
      if (args.behavior !== "allow" || !data.supported) {
        patch(args.threadId, args.requestId, { status: "declined" }, { answered: "deny", held: undefined });
        deps.audit?.({ kind: "meeting.declined", botId: data.botId, threadId: args.threadId, requestId: args.requestId, principalId: args.principalId });
        return { claimed: true, outcome: "rejected" };
      }
      const browserRefusal = deps.browserRefusal(data.botId);
      if (browserRefusal) return refuse(browserRefusal);
      // Reserve before the first await: a second tap, or another card of the
      // same bot, sees the slot taken.
      if (busyBots.has(data.botId)) return refuse("This bot is already in another meeting. Wait for it to end, or press Leave on its card.");
      if (busyBots.size >= MEETING_MAX_CONCURRENT) {
        return refuse(`${MEETING_MAX_CONCURRENT} meetings are already running on this server. Try again when one ends.`);
      }
      busyBots.add(data.botId);
      const release = () => { busyBots.delete(data.botId); };
      // From here until the session holds the slot, any exception releases it.
      let handedOff = false;
      try {
      let transcriber: MeetingTranscriber | { error: string };
      try {
        transcriber = await deps.transcriber({ botId: data.botId, threadId: args.threadId, principalId: args.principalId, speaker: args.speaker });
      } catch (error) {
        release();
        return refuse(`Speech to text could not be checked: ${error instanceof Error ? error.message : String(error)}`);
      }
      if ("error" in transcriber) { release(); return refuse(transcriber.error); }
      const live = find(args.threadId, args.requestId);
      if (!live || live.card.answered || live.data.status !== "pending") {
        release();
        return { claimed: true, outcome: live?.card.answered === "allow" ? "allowed-once" : "rejected", alreadySettled: true };
      }
      // Settled now, before anything opens: a second tap cannot start a second join.
      patch(args.threadId, args.requestId, { status: "joining", startedAt: now(), detail: undefined }, { answered: "allow", held: undefined });
      deps.audit?.({ kind: "meeting.approved", botId: data.botId, threadId: args.threadId, requestId: args.requestId, principalId: args.principalId });
      let browser: MeetingBrowser;
      try {
        browser = await deps.openBrowser(data.botId, args.requestId);
      } catch (error) {
        release();
        patch(args.threadId, args.requestId, { status: "failed", detail: `The bot's browser could not start: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300), endedAt: now() });
        return { claimed: true, outcome: "allowed-once" };
      }
      const started = now();
      const options = {
        url: data.url,
        displayName: data.displayName,
        botName: deps.store.bot(data.botId)?.name ?? "",
        announcement: meetingAnnouncement(data.displayName, args.personName),
        browser,
        transcribe: (audio: Uint8Array, mime: string) => transcriber.transcribe(audio, mime),
        update: (change: Partial<MeetingRequestCardData>) => patch(args.threadId, args.requestId, change),
        onLine: (_line: TranscriptLine) => undefined,
      };
      const session = deps.session ? deps.session(options) : new MeetingSession(options);
      sessions.set(keyOf(args.threadId, args.requestId), session);
      handedOff = true;
      try { writeLive(); } catch { /* recovery aid only */ }
      void session.run()
        .then((outcome) => finished(data, outcome, started))
        .catch((error) => finished(data, { status: "failed", detail: error instanceof Error ? error.message : String(error), lines: [], recorded: false }, started));
      return { claimed: true, outcome: "allowed-once" };
      } finally {
        if (!handedOff) release();
      }
    },

    /** The person pressed Leave on the live card. */
    leave(threadId: string, requestId: string): { ok: true } | { ok: false; status: number; error: string; code?: string } {
      if (!enabled()) return { ok: false, status: 403, ...MEETINGS_DISABLED };
      const session = sessions.get(keyOf(threadId, requestId));
      if (!session) return { ok: false, status: 409, error: "The bot is not in this meeting any more." };
      session.requestLeave();
      patch(threadId, requestId, { status: "ending" });
      return { ok: true };
    },

    /** The server is stopping: leave every meeting. */
    leaveAll(): void {
      for (const session of sessions.values()) session.requestLeave();
    },

    isMeetingCard(threadId: string, requestId: string): boolean {
      return Boolean(find(threadId, requestId));
    },
  };
  return service;
}

export type MeetingService = ReturnType<typeof createMeetingService>;
