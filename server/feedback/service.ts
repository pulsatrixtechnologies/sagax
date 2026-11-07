// The Feedback bot (#2618): one shared system bot every signed-in person can
// write to. It runs a short conversation in the ordinary chat (never a
// separate thread), shows what will leave the server, files the report as a
// GitHub issue with the server's own token, and posts the issue's status
// back into the same conversation. Without a token, reports wait in a local
// queue and are retried. The same flow runs inline when someone types
// /feedback in any chat, and any bot's conversation can get one pre-drafted
// offer when the person sounds frustrated.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "../atomic.ts";
import {
  frustrationSignal, isFeedbackCommand, type FeedbackKind, type FeedbackReportView, type FeedbackSource,
  type FeedbackStartRequest, type FeedbackStartResponse, type FeedbackStatus,
} from "../../shared/feedback.ts";
import type { AnonymizeNames } from "./anonymize.ts";
import { anonymize } from "./anonymize.ts";
import type { FeedbackConfig } from "./config.ts";
import {
  feedbackAnswers, feedbackLanguage, isCancelOption, isSendOption, nextFeedbackStep, OFFER_OPTIONS, openFeedbackStep, parseKind,
  SEND_OPTIONS, type FeedbackAnswers, type FeedbackLanguage, type FeedbackMarker, type FlowCard, type FlowMessage,
} from "./flow.ts";
import { fileIssue, issueStatus, type GithubFiler } from "./github.ts";
import { buildReport, type FiledReport, type ReportContext, type ReportSpan } from "./report.ts";

export interface StoredMessage extends FlowMessage {
  id: string;
  at: number;
  sendId?: string;
  sender?: unknown;
}

interface BotLike {
  id: string;
  name: string;
  threadId: string;
  systemBot?: "feedback";
}

/** The slice of the server store the service uses. */
export interface FeedbackStore {
  bots: readonly BotLike[];
  bot(id: string): BotLike | undefined;
  createBot(profile: { name?: string; title?: string; description?: string; color?: string }, options: { seedMessages?: boolean }): BotLike;
  patchBot(id: string, patch: { systemBot?: "feedback" }): BotLike | null;
  activePath(threadId: string): StoredMessage[];
  appendMessage(threadId: string, message: Omit<StoredMessage, "id" | "at">): StoredMessage;
}

export interface FeedbackDeps {
  dataDir: string;
  store: FeedbackStore;
  config: () => FeedbackConfig;
  /** The person's own thread with a bot (routeThreadId on the request). */
  threadFor: (bot: BotLike) => string;
  names: () => AnonymizeNames;
  serverLines: () => string[];
  spans: () => ReportSpan[];
  serverVersion: () => string;
  fetch?: typeof fetch;
  now?: () => number;
}

type RecordStatus = "draft" | "cancelled" | FeedbackStatus;

interface FeedbackRecord {
  id: string;
  owner: string | null;
  botId: string;
  threadId: string;
  lang: FeedbackLanguage;
  createdAt: number;
  updatedAt: number;
  status: RecordStatus;
  preset: Partial<FeedbackAnswers>;
  context: ReportContext;
  offer?: boolean;
  kind?: FeedbackKind;
  report?: FiledReport;
  issueNumber?: number;
  issueUrl?: string;
  duplicate?: boolean;
  attempts?: number;
  nextTryAt?: number;
  lastError?: string;
  /** The queued notice was posted once already. */
  queuedNoticed?: boolean;
}

export interface FeedbackMessageInput {
  botId: string;
  threadId: string;
  text: string;
  principalId: string | null;
  sendId?: string;
  sender?: unknown;
}

const RETRY_MS = 5 * 60_000;
const POLL_WINDOW_MS = 60 * 24 * 60 * 60_000;
const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;

const WORDS = {
  fr: {
    hello: "Je m'occupe de votre signalement. J'ai joint la version, la page et les journaux récents; tout est anonymisé et rien ne part sans votre accord.",
    previewIntro: "Voici ce qui sera envoyé à l'équipe, une fois anonymisé :",
    previewTitle: "Envoyer ce signalement?",
    previewSubtitle: "Écrivez un détail pour l'ajouter, ou envoyez tel quel. La capture d'écran reste sur le serveur.",
    offerTitle: "On dirait que quelque chose ne marche pas.",
    offerSubtitle: (summary: string) => `Je peux envoyer un signalement à l'équipe avec ce message, la version et les journaux récents, anonymisés :\n\n« ${summary} »`,
    cancelled: "Annulé : rien n'a été envoyé.",
    queuedNoToken: "Signalement prêt et gardé ici : l'envoi à l'équipe n'est pas encore configuré sur ce serveur. Je réessaie toutes les 5 minutes.",
    queuedError: "L'envoi n'a pas passé pour l'instant; le signalement est gardé ici et je réessaie automatiquement.",
    sent: (link: string) => `Envoyé à l'équipe : ${link}. Je vous tiens au courant ici.`,
    duplicate: (link: string) => `Un signalement semblable est déjà ouvert (${link}) : j'y ai ajouté le vôtre.`,
    received: (link: string) => `Reçu par l'équipe (${link}).`,
    in_progress: (link: string) => `L'équipe y travaille (${link}).`,
    resolved: (link: string) => `Résolu (${link}). Merci pour le signalement!`,
  },
  en: {
    hello: "I'll take care of your report. I attached the version, the page and recent logs; everything is anonymized and nothing leaves without your OK.",
    previewIntro: "Here is what will be sent to the team, once anonymized:",
    previewTitle: "Send this report?",
    previewSubtitle: "Type a detail to add it, or send it as is. The screenshot stays on the server.",
    offerTitle: "Looks like something isn't working.",
    offerSubtitle: (summary: string) => `I can send a report to the team with this message, the version and recent logs, anonymized:\n\n"${summary}"`,
    cancelled: "Cancelled: nothing was sent.",
    queuedNoToken: "Report ready and kept here: sending to the team is not set up on this server yet. I retry every 5 minutes.",
    queuedError: "Sending did not go through for now; the report is kept here and I retry on my own.",
    sent: (link: string) => `Sent to the team: ${link}. I'll keep you posted here.`,
    duplicate: (link: string) => `A similar report is already open (${link}): I added yours to it.`,
    received: (link: string) => `Received by the team (${link}).`,
    in_progress: (link: string) => `The team is working on it (${link}).`,
    resolved: (link: string) => `Resolved (${link}). Thanks for the report!`,
  },
} as const;

function newReportId(): string {
  return `fb${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function oneLine(text: string, max: number): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

export function createFeedbackService(deps: FeedbackDeps) {
  const { dataDir, store } = deps;
  const now = deps.now ?? Date.now;
  const dir = join(dataDir, "feedback");
  const reportsFile = join(dir, "reports.json");
  const pending = new Set<Promise<unknown>>();
  let records: FeedbackRecord[] = [];
  try {
    if (existsSync(reportsFile)) records = JSON.parse(readFileSync(reportsFile, "utf8")) as FeedbackRecord[];
  } catch {
    records = [];
  }

  const save = () => {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileAtomic(reportsFile, JSON.stringify(records.slice(-2000), null, 1), { mode: 0o600 });
  };
  const byId = (id: string) => records.find((record) => record.id === id);
  const track = <T>(promise: Promise<T>) => {
    pending.add(promise);
    void promise.finally(() => pending.delete(promise));
    return promise;
  };

  function ensureBot(): BotLike {
    const found = store.bots.find((bot) => bot.systemBot === "feedback");
    if (found) return found;
    const bot = store.createBot({
      name: "Feedback",
      title: "Bogues, idées, questions",
      description: "Signalez un bogue, proposez une idée ou posez une question à l'équipe Sagax. / Report a bug, suggest an idea or ask the Sagax team a question.",
      color: "#7c5cff",
    }, { seedMessages: false });
    return store.patchBot(bot.id, { systemBot: "feedback" }) ?? bot;
  }

  function filer(): GithubFiler | null {
    const config = deps.config();
    if (!config.token) return null;
    return { repo: config.repo, token: config.token, ...(deps.fetch ? { fetch: deps.fetch } : {}) };
  }

  function post(threadId: string, marker: FeedbackMarker | undefined, message: { kind: "text"; text: string } | { kind: "options"; card: FlowCard }) {
    return store.appendMessage(threadId, { role: "bot", ...message, ...(marker ? { feedback: marker } : {}) });
  }

  function draft(input: { owner: string | null; botId: string; threadId: string; lang: FeedbackLanguage; source: FeedbackSource; preset?: Partial<FeedbackAnswers>; context?: Partial<ReportContext>; offer?: boolean }): FeedbackRecord {
    // a newer report in the same conversation replaces an unfinished one
    for (const record of records) {
      if (record.threadId === input.threadId && record.status === "draft" && !record.offer) record.status = "cancelled";
    }
    const record: FeedbackRecord = {
      id: newReportId(),
      owner: input.owner,
      botId: input.botId,
      threadId: input.threadId,
      lang: input.lang,
      createdAt: now(),
      updatedAt: now(),
      status: "draft",
      preset: input.preset ?? {},
      context: { source: input.source, ...input.context },
      ...(input.offer ? { offer: true } : {}),
    };
    records.push(record);
    save();
    return record;
  }

  function answersOf(record: FeedbackRecord): FeedbackAnswers {
    return feedbackAnswers(store.activePath(record.threadId), record.id, record.preset);
  }

  function reportOf(record: FeedbackRecord): FiledReport {
    const context: ReportContext = {
      ...record.context,
      serverVersion: deps.serverVersion(),
      serverLines: deps.serverLines(),
      spans: deps.spans(),
    };
    return buildReport(answersOf(record), context, deps.names());
  }

  /** The next question, or the preview card. */
  function advance(record: FeedbackRecord): void {
    const step = nextFeedbackStep(record.lang, answersOf(record), record.id);
    if (step.kind === "ask") {
      post(record.threadId, step.marker, step.message);
      return;
    }
    const report = reportOf(record);
    const words = WORDS[record.lang];
    const body = report.body.length > 6000 ? `${report.body.slice(0, 5999)}…` : report.body;
    post(record.threadId, undefined, { kind: "text", text: `${words.previewIntro}\n\n**${report.title}**\n\n${body}` });
    post(record.threadId, { step: "preview", reportId: record.id }, {
      kind: "options",
      card: { title: words.previewTitle, subtitle: words.previewSubtitle, options: [...SEND_OPTIONS[record.lang]] },
    });
  }

  function link(record: FeedbackRecord): string {
    return record.issueUrl ? `[#${record.issueNumber}](${record.issueUrl})` : `#${record.issueNumber}`;
  }

  function postStatus(record: FeedbackRecord, line: string): void {
    post(record.threadId, { step: "status", reportId: record.id }, { kind: "text", text: line });
  }

  async function fileRecord(record: FeedbackRecord): Promise<void> {
    const target = filer();
    const words = WORDS[record.lang];
    if (!target) {
      record.status = "queued";
      record.nextTryAt = now() + RETRY_MS;
      if (!record.queuedNoticed) postStatus(record, words.queuedNoToken);
      record.queuedNoticed = true;
      save();
      return;
    }
    try {
      const issue = await fileIssue(target, record.report!);
      record.status = "sent";
      record.issueNumber = issue.number;
      record.issueUrl = issue.url;
      record.duplicate = issue.duplicate;
      delete record.nextTryAt;
      delete record.lastError;
      record.updatedAt = now();
      postStatus(record, issue.duplicate ? words.duplicate(link(record)) : words.sent(link(record)));
    } catch (error) {
      record.status = "queued";
      record.attempts = (record.attempts ?? 0) + 1;
      record.nextTryAt = now() + Math.min(RETRY_MS * record.attempts, 6 * 60 * 60_000);
      // never the token: the filer's errors carry only method, path and status
      record.lastError = anonymize(error instanceof Error ? error.message : String(error), {}).slice(0, 300);
      if (!record.queuedNoticed) postStatus(record, words.queuedError);
      record.queuedNoticed = true;
    }
    save();
  }

  function submit(record: FeedbackRecord): void {
    const answers = answersOf(record);
    record.kind = answers.kind ?? "bug";
    record.report = reportOf(record);
    record.status = "queued";
    record.updatedAt = now();
    save();
    track(fileRecord(record));
  }

  function cancel(record: FeedbackRecord): void {
    record.status = "cancelled";
    record.updatedAt = now();
    save();
    post(record.threadId, { step: "status", reportId: record.id }, { kind: "text", text: WORDS[record.lang].cancelled });
  }

  function presetFrom(text: string): Partial<FeedbackAnswers> {
    if (!text) return {};
    const kind = parseKind(text);
    if (!kind) return { describe: text };
    // a bare kind word ("a bug") answers the kind and nothing more
    if (text.split(/\s+/).length <= 3) return { kind };
    return kind === "bug" ? { kind, actual: text } : { kind, describe: text };
  }

  /** The person's message in a feedback conversation, or a /feedback typed
   * anywhere. Returns the stored message when the flow took it (no turn
   * runs), null when the message is not the flow's. */
  function handleMessage(input: FeedbackMessageInput): StoredMessage | null {
    const bot = store.bot(input.botId);
    if (!bot) return null;
    const text = input.text.trim();
    const messages = store.activePath(input.threadId);
    const userMessage = () => store.appendMessage(input.threadId, {
      role: "user", kind: "text", text, ...(input.sendId ? { sendId: input.sendId } : {}), ...(input.sender ? { sender: input.sender } : {}),
    });

    // an offer card answered, even after the bot went on talking
    if (isSendOption(text) || isCancelOption(text)) {
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const marker = messages[index]!.feedback;
        if (marker?.step !== "offer") continue;
        const record = byId(marker.reportId);
        if (!record || record.status !== "draft") break;
        const stored = userMessage();
        if (isSendOption(text)) submit(record);
        else cancel(record);
        return stored;
      }
    }

    const command = isFeedbackCommand(text);
    let record: FeedbackRecord | undefined;
    let marker: FeedbackMarker | null = null;
    if (!command) {
      marker = openFeedbackStep(messages);
      record = marker ? byId(marker.reportId) : undefined;
      if (record && record.status !== "draft") record = undefined;
      if (record && marker?.step === "offer") record = undefined;
      // in another bot's chat, only while the flow's question is the last word
      if (record && bot.systemBot !== "feedback") {
        const lastBot = [...messages].reverse().find((message) => message.role === "bot");
        if (lastBot?.feedback?.reportId !== record.id) record = undefined;
      }
    }

    if (!record) {
      if (!command && bot.systemBot !== "feedback") return null;
      const rest = command ? text.replace(/^\/feedback\b/i, "").trim() : text;
      const stored = userMessage();
      const fresh = draft({
        owner: input.principalId,
        botId: bot.id,
        threadId: input.threadId,
        lang: feedbackLanguage(rest || text),
        source: command ? "slash" : "chat",
        preset: presetFrom(rest),
      });
      advance(fresh);
      return stored;
    }

    const stored = userMessage();
    if (marker?.step === "preview") {
      if (isSendOption(text)) submit(record);
      else if (isCancelOption(text)) cancel(record);
      else advance(record);
      return stored;
    }
    advance(record);
    return stored;
  }

  function start(owner: string | null, request: FeedbackStartRequest): FeedbackStartResponse {
    const bot = ensureBot();
    const threadId = deps.threadFor(bot);
    const lang: FeedbackLanguage = request.locale ?? "fr";
    const id = newReportId();
    let screenshot = false;
    const match = typeof request.screenshot === "string" ? /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(request.screenshot) : null;
    if (match) {
      const bytes = Buffer.from(match[1]!, "base64");
      if (bytes.length > 0 && bytes.length <= MAX_SCREENSHOT_BYTES) {
        mkdirSync(join(dir, "shots"), { recursive: true, mode: 0o700 });
        writeFileSync(join(dir, "shots", `${id}.png`), bytes, { mode: 0o600 });
        screenshot = true;
      }
    }
    const record = draft({
      owner,
      botId: bot.id,
      threadId,
      lang,
      source: request.source,
      preset: request.source === "error" ? { kind: "bug" } : {},
      context: {
        platform: request.platform,
        ...(request.appVersion ? { appVersion: String(request.appVersion).slice(0, 80) } : {}),
        ...(request.os ? { os: String(request.os).slice(0, 120) } : {}),
        ...(request.page ? { page: String(request.page).slice(0, 120) } : {}),
        ...(request.error ? { error: String(request.error).slice(0, 4000) } : {}),
        ...(Array.isArray(request.clientLogs) ? { clientLogs: request.clientLogs.slice(-60).map((line) => String(line).slice(0, 1000)) } : {}),
        screenshot,
      },
    });
    record.id = id;
    save();
    post(threadId, undefined, { kind: "text", text: WORDS[lang].hello });
    advance(record);
    return { botId: bot.id, threadId };
  }

  /** After an ordinary message to any bot: one pre-drafted offer per
   * conversation when the person sounds frustrated. */
  function maybeOffer(input: { botId: string; threadId: string; text: string; principalId: string | null }): void {
    const bot = store.bot(input.botId);
    if (!bot || bot.systemBot === "feedback" || isFeedbackCommand(input.text)) return;
    if (records.some((record) => record.threadId === input.threadId && record.offer)) return;
    const earlier = store.activePath(input.threadId)
      .filter((message) => message.role === "user" && message.kind === "text" && message.text && message.text.trim() !== input.text.trim())
      .map((message) => message.text!);
    const signal = frustrationSignal(input.text, earlier);
    if (!signal) return;
    const lang = feedbackLanguage(input.text);
    const record = draft({
      owner: input.principalId,
      botId: bot.id,
      threadId: input.threadId,
      lang,
      source: "frustration",
      preset: { kind: "bug", actual: input.text },
      context: { signal },
      offer: true,
    });
    const words = WORDS[lang];
    const summary = oneLine(anonymize(input.text, deps.names()), 200);
    post(input.threadId, { step: "offer", reportId: record.id }, {
      kind: "options",
      card: { title: words.offerTitle, subtitle: words.offerSubtitle(summary), options: [...OFFER_OPTIONS[lang]] },
    });
  }

  /** Retry the queue and read filed issues' status back (every 5 minutes). */
  async function tick(): Promise<void> {
    const target = filer();
    for (const record of records) {
      if (record.status === "queued" && record.report && (record.nextTryAt ?? 0) <= now() && target) {
        await fileRecord(record);
        continue;
      }
      if (!target || !record.issueNumber || record.duplicate) continue;
      if (record.status !== "sent" && record.status !== "received" && record.status !== "in_progress") continue;
      if (now() - record.createdAt > POLL_WINDOW_MS) continue;
      try {
        const status = await issueStatus(target, record.issueNumber);
        if (status === record.status || status === "sent" && record.status === "sent") continue;
        if (status === "sent") continue;
        record.status = status;
        record.updatedAt = now();
        const words = WORDS[record.lang];
        postStatus(record, status === "received" ? words.received(link(record)) : status === "in_progress" ? words.in_progress(link(record)) : words.resolved(link(record)));
        save();
      } catch {
        // read again on the next tick
      }
    }
  }

  function list(owner: string | null): FeedbackReportView[] {
    return records
      .filter((record) => record.owner === owner && record.report && record.status !== "draft" && record.status !== "cancelled")
      .map((record) => ({
        id: record.id,
        kind: record.kind ?? "bug",
        title: record.report!.title,
        status: record.status as FeedbackStatus,
        createdAt: record.createdAt,
        ...(record.issueNumber ? { issueNumber: record.issueNumber } : {}),
        ...(record.issueUrl ? { issueUrl: record.issueUrl } : {}),
      }))
      .reverse();
  }

  return {
    ensureBot,
    start,
    handleMessage,
    maybeOffer,
    tick,
    list,
    flush: async () => { await Promise.all(pending); },
  };
}

export type FeedbackService = ReturnType<typeof createFeedbackService>;
