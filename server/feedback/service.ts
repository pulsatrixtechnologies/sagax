// In-app feedback (#2618, #3299): `/feedback` typed in any chat is the one
// way in, and the report stays in that chat. The server reads the chat it is
// typed in (chat-facts.ts), asks at most one question, shows the exact,
// anonymized text that will leave, files it as a GitHub issue with the
// server's own token on Send, and posts the issue's status back into the
// same conversation. Without a token, reports wait in a local queue and are
// retried. There is no Feedback bot: a server that still has the one older
// versions made retires it at startup (retireFeedbackBot). No card offers a
// report on its own: a bot that hears frustration with Sagax tells the
// person to type /feedback (server/system-prompt.ts).
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "../atomic.ts";
import {
  FEEDBACK_PLATFORMS, isFeedbackCommand, type FeedbackAppContext, type FeedbackKind, type FeedbackReportView,
  type FeedbackSource, type FeedbackStatus,
} from "../../shared/feedback.ts";
import type { AnonymizeNames } from "./anonymize.ts";
import { anonymize } from "./anonymize.ts";
import { chatFacts, type ChatMessageLike } from "./chat-facts.ts";
import type { FeedbackConfig } from "./config.ts";
import {
  feedbackAnswers, feedbackLanguage, isCancelOption, isSendOption, nextFeedbackStep, openFeedbackStep,
  SEND_OPTIONS, type FeedbackAnswers, type FeedbackLanguage, type FeedbackMarker, type FlowCard, type FlowMessage,
} from "./flow.ts";
import { fileIssue, issueStatus, type GithubFiler } from "./github.ts";
import { buildReport, type FiledReport, type ReportContext, type ReportSpan } from "./report.ts";
import { feedbackText } from "./words.ts";

export interface StoredMessage extends FlowMessage, Omit<ChatMessageLike, "feedback" | "role" | "kind" | "text"> {
  id: string;
  at: number;
  sendId?: string;
  sender?: unknown;
}

interface BotLike {
  id: string;
  name: string;
  threadId: string;
}

/** The slice of the server store the service uses. */
export interface FeedbackStore {
  /** Bots as stored: a record from before #3299 may still carry `systemBot`. */
  bots: readonly (BotLike & { systemBot?: unknown })[];
  bot(id: string): BotLike | undefined;
  /** Removes a bot and its threads (retireFeedbackBot). */
  deleteBot?(id: string): boolean;
  activePath(threadId: string): StoredMessage[];
  appendMessage(threadId: string, message: Omit<StoredMessage, "id" | "at">): StoredMessage;
  /** Marks a card answered (the server store's patchMessage). */
  patchMessage?(threadId: string, messageId: string, patch: { card: FlowCard }): unknown;
}

export interface FeedbackDeps {
  dataDir: string;
  store: FeedbackStore;
  config: () => FeedbackConfig;
  names: () => AnonymizeNames;
  /** The engine (driver kind) and model a bot runs on. */
  engine?: (botId: string) => { engine?: string; model?: string };
  serverLines: () => string[];
  spans: () => ReportSpan[];
  serverVersion: () => string;
  /** The language the person reads the app in (their saved choice, else
   * what their app asks in, else the server's), as languageOfPerson gives
   * it. The flow's cards follow it; the message's words are only a guess
   * for when it is empty. */
  language?: (principalId: string | null) => string;
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
  /** The words typed after /feedback. */
  said: string;
  context: ReportContext;
  /** A report older versions offered on their own after a frustrated
   * message: retired at the first sweep (#3299). */
  offer?: boolean;
  kind?: FeedbackKind;
  /** The text the person was last shown on the preview: exactly what is
   * filed on Send (#3299). */
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
  /** What the app attached to /feedback (version, surface, page, logs). */
  app?: FeedbackAppContext;
  /** The answer is a click on the flow's own card: it never waits for the
   * card to be the last word, whatever the busy bot said since. */
  viaCard?: boolean;
}

const RETRY_MS = 5 * 60_000;
const POLL_WINDOW_MS = 60 * 24 * 60 * 60_000;
/** #3018: an unfinished report nobody touched for this long is dropped and its card retired. */
export const DRAFT_TTL_MS = 7 * 24 * 60 * 60_000;

const WORDS = {
  fr: {
    cancelled: "Annulé : rien n'a été envoyé.",
    queuedNoToken: (manual: string) => `En file d'attente : signalement prêt et gardé ici. Ce serveur n'a pas de jeton GitHub pour l'envoyer à l'équipe : un administrateur du serveur doit définir la variable SAGAX_FEEDBACK_GITHUB_TOKEN (ou l'enregistrer par PUT /api/admin/feedback-config). Il part dès que le jeton est défini. En attendant, tu peux ${manual}.`,
    manualLink: (url: string) => `[ouvrir le signalement sur GitHub](${url}) toi-même (il est déjà rempli)`,
    queuedError: "L'envoi n'a pas passé pour l'instant; le signalement est gardé ici et je réessaie automatiquement.",
    sent: (link: string) => `Envoyé à l'équipe : ${link}. Je te tiens au courant ici.`,
    duplicate: (link: string) => `Un signalement semblable est déjà ouvert (${link}) : j'y ai ajouté le tien.`,
    received: (link: string) => `Reçu par l'équipe (${link}).`,
    in_progress: (link: string) => `L'équipe y travaille (${link}).`,
    resolved: (link: string) => `Résolu (${link}). Merci pour le signalement!`,
  },
  en: {
    cancelled: "Cancelled: nothing was sent.",
    queuedNoToken: (manual: string) => `Queued: report ready and kept here. This server has no GitHub token to send it to the team: a server admin must set the SAGAX_FEEDBACK_GITHUB_TOKEN environment variable (or save it with PUT /api/admin/feedback-config). It goes out as soon as the token is set. Meanwhile you can ${manual}.`,
    manualLink: (url: string) => `[open the report on GitHub](${url}) yourself (it is already filled in)`,
    queuedError: "Sending did not go through for now; the report is kept here and I retry on my own.",
    sent: (link: string) => `Sent to the team: ${link}. I'll keep you posted here.`,
    duplicate: (link: string) => `A similar report is already open (${link}): I added yours to it.`,
    received: (link: string) => `Received by the team (${link}).`,
    in_progress: (link: string) => `The team is working on it (${link}).`,
    resolved: (link: string) => `Resolved (${link}). Thanks for the report!`,
  },
} as const;

/** A pre-filled "new issue" page: the fallback that needs no server token. */
export function manualIssueUrl(repo: string, report: { title: string; body: string; labels?: readonly string[] }): string {
  const body = report.body.length > 5000 ? `${report.body.slice(0, 4999)}…` : report.body;
  const query = new URLSearchParams({ title: report.title, body });
  if (report.labels?.length) query.set("labels", report.labels.join(","));
  return `https://github.com/${repo}/issues/new?${query.toString()}`;
}

function newReportId(): string {
  return `fb${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** The surface a request came from, when the app attached nothing (a
 * phone or another client typed /feedback). */
export function platformFromUserAgent(userAgent: string | undefined): FeedbackAppContext["platform"] | undefined {
  const agent = userAgent ?? "";
  if (/iPhone|iPad|CFNetwork|\biOS\b/.test(agent)) return "ios";
  if (/Electron\//.test(agent)) return "desktop";
  if (/Mozilla\//.test(agent)) return "web";
  return undefined;
}

/** French for any fr-* tag, English for any other tag, the guess from the
 * message's words when the person's language is unknown. */
export function feedbackLanguageFor(appLanguage: string | undefined, text: string): FeedbackLanguage {
  const tag = (appLanguage ?? "").trim().toLowerCase();
  if (tag) return tag.split(/[-_]/)[0] === "fr" ? "fr" : "en";
  return feedbackLanguage(text);
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
  /** No words to guess from (text null): French, as before. */
  const languageFor = (principalId: string | null, text: string | null): FeedbackLanguage => {
    let appLanguage: string | undefined;
    try {
      appLanguage = deps.language?.(principalId);
    } catch { /* the guess from the words */ }
    return text === null && !appLanguage?.trim() ? "fr" : feedbackLanguageFor(appLanguage, text ?? "");
  };
  const track = <T>(promise: Promise<T>) => {
    pending.add(promise);
    void promise.finally(() => pending.delete(promise));
    return promise;
  };

  /** #3299: older versions made a shared "Feedback" bot (no owner, empty
   * profile). It is removed with its threads; its unfinished reports are
   * dropped, its filed ones keep their status but post nowhere. */
  function retireFeedbackBot(): number {
    let removed = 0;
    for (const bot of store.bots.filter((entry) => entry.systemBot === "feedback")) {
      for (const record of records) {
        if (record.botId === bot.id && record.status === "draft") record.status = "cancelled";
      }
      if (store.deleteBot?.(bot.id)) removed += 1;
    }
    if (removed) save();
    return removed;
  }

  function filer(): GithubFiler | null {
    const config = deps.config();
    if (!config.token) return null;
    return { repo: config.repo, token: config.token, ...(deps.fetch ? { fetch: deps.fetch } : {}) };
  }

  function post(threadId: string, marker: FeedbackMarker | undefined, message: { kind: "text"; text: string } | { kind: "options"; card: FlowCard }) {
    // An options card is a real question card (requestId): the app, the
    // approvals queue and the MCP (sagax_approve) all answer it the same way.
    const shaped = message.kind === "options" && marker
      ? { ...message, card: { ...message.card, requestId: `fb-${marker.reportId}-${marker.step}-${now().toString(36)}`, requestType: "question" as const } }
      : message;
    return store.appendMessage(threadId, { role: "bot", ...shaped, ...(marker ? { feedback: marker } : {}) });
  }

  /** The person answered in words or on a card: close the open cards. */
  function settleCards(threadId: string, text: string): void {
    if (!store.patchMessage) return;
    for (const message of store.activePath(threadId)) {
      const card = message.card;
      if (message.role === "bot" && message.feedback && card?.requestId && !card.answered && !card.dismissed) {
        store.patchMessage(threadId, message.id, { card: { ...card, answered: "answer", answeredText: text } });
      }
    }
  }

  /** #3018: a feedback card whose source is dead (report superseded,
   * cancelled, sent or gone) or that a newer card of the same report replaced
   * is retired (dismissed): it never stays pending in the approvals queue. */
  function retireStaleCards(threadId: string): void {
    if (!store.patchMessage) return;
    const live = new Set<string>();
    const path = store.activePath(threadId);
    for (let index = path.length - 1; index >= 0; index -= 1) {
      const message = path[index]!;
      const card = message.card;
      if (message.role !== "bot" || !message.feedback || !card?.requestId || card.answered || card.dismissed) continue;
      const record = byId(message.feedback.reportId);
      if (record && record.status === "draft" && !live.has(record.id)) {
        live.add(record.id);
        continue;
      }
      store.patchMessage(threadId, message.id, { card: { ...card, dismissed: true } });
    }
  }

  /** A feedback card answered through the respond route (app click or MCP
   * sagax_approve): same path as typing the option. Null when the card is not
   * the Feedback flow's. */
  function answerCard(threadId: string, requestId: string, text: string, principalId: string | null): { ok: boolean; status: number; error?: string } | null {
    const message = store.activePath(threadId).find((row) => row.card?.requestId === requestId);
    const marker = message?.feedback;
    if (!message || !marker || message.role !== "bot") return null;
    if (message.card?.answered || message.card?.dismissed) return { ok: false, status: 409, error: "This card was already answered." };
    const record = byId(marker.reportId);
    const bot = record ? store.bot(record.botId) : store.bots.find((entry) => entry.threadId === threadId);
    if (!bot) return { ok: false, status: 404, error: "The bot of this report is gone." };
    const options = message.card?.options ?? [];
    const picked = options.find((option) => option.toLowerCase() === text.trim().toLowerCase());
    if (!picked && !text.trim()) return { ok: false, status: 400, error: `Pick one of: ${options.join(", ")}.` };
    handleMessage({ botId: bot.id, threadId, text: picked ?? text.trim(), principalId, viaCard: true });
    return { ok: true, status: 200 };
  }

  function draft(input: { owner: string | null; botId: string; threadId: string; lang: FeedbackLanguage; source: FeedbackSource; said: string; context?: Partial<ReportContext> }): FeedbackRecord {
    // a newer report in the same conversation replaces an unfinished one
    for (const record of records) {
      if (record.threadId === input.threadId && record.status === "draft") record.status = "cancelled";
    }
    retireStaleCards(input.threadId);
    const record: FeedbackRecord = {
      id: newReportId(),
      owner: input.owner,
      botId: input.botId,
      threadId: input.threadId,
      lang: input.lang,
      createdAt: now(),
      updatedAt: now(),
      status: "draft",
      said: input.said,
      context: { source: input.source, ...input.context },
    };
    records.push(record);
    save();
    return record;
  }

  function answersOf(record: FeedbackRecord): FeedbackAnswers {
    return feedbackAnswers(store.activePath(record.threadId), record.id, record.said ?? "");
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
    record.updatedAt = now();
    const step = nextFeedbackStep(record.lang, answersOf(record), record.id, record.context.error || record.context.chat?.error);
    if (step.kind === "ask") {
      delete record.report;
      save();
      post(record.threadId, step.marker, { kind: "text", text: feedbackText(record.lang, "feedback.server.detailQuestion") });
      return;
    }
    // #3299: the person sees the exact text that leaves, whole. It is kept
    // as shown: Send files this text, not one rebuilt from newer logs. A
    // detail added at the preview builds it again and shows it again.
    const report = reportOf(record);
    record.report = report;
    save();
    post(record.threadId, undefined, { kind: "text", text: `${feedbackText(record.lang, "feedback.server.previewIntro")}\n\n**${report.title}**\n\n${report.body}` });
    // the Feedback product's send preview (a report to a third party, the person's own send); full-access: exempt
    post(record.threadId, { step: "preview", reportId: record.id }, {
      kind: "options",
      card: { title: feedbackText(record.lang, "feedback.server.previewTitle"), subtitle: feedbackText(record.lang, "feedback.server.previewSubtitle"), options: [...SEND_OPTIONS[record.lang]] },
    });
  }

  function link(record: FeedbackRecord): string {
    return record.issueUrl ? `[#${record.issueNumber}](${record.issueUrl})` : `#${record.issueNumber}`;
  }

  function postStatus(record: FeedbackRecord, line: string): void {
    // a report of the retired Feedback bot keeps its status, in no chat
    if (!store.bot(record.botId)) return;
    post(record.threadId, { step: "status", reportId: record.id }, { kind: "text", text: line });
  }

  async function fileRecord(record: FeedbackRecord): Promise<void> {
    const target = filer();
    const words = WORDS[record.lang];
    if (!target) {
      // #3218: nothing to retry without a token: no timer, the report goes out once one is set
      record.status = "queued";
      delete record.nextTryAt;
      if (!record.queuedNoticed) postStatus(record, words.queuedNoToken(words.manualLink(manualIssueUrl(deps.config().repo, record.report!))));
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
    // the text on the preview card, as the person saw it
    record.report ??= reportOf(record);
    record.kind = kindOf(record.report);
    record.status = "queued";
    record.updatedAt = now();
    save();
    retireStaleCards(record.threadId);
    track(fileRecord(record));
  }

  function cancel(record: FeedbackRecord): void {
    record.status = "cancelled";
    record.updatedAt = now();
    save();
    retireStaleCards(record.threadId);
    post(record.threadId, { step: "status", reportId: record.id }, { kind: "text", text: WORDS[record.lang].cancelled });
  }

  function kindOf(report: FiledReport): FeedbackKind {
    return report.labels.includes("enhancement") ? "idea" : report.labels.includes("question") ? "question" : "bug";
  }

  /** What the app attached, cut to size. */
  function appContext(app: FeedbackAppContext | undefined, userAgent: string | undefined): Partial<ReportContext> {
    if (!app) {
      const platform = platformFromUserAgent(userAgent);
      return platform ? { platform } : {};
    }
    return {
      ...(FEEDBACK_PLATFORMS.includes(app.platform) ? { platform: app.platform } : {}),
      ...(app.appVersion ? { appVersion: String(app.appVersion).slice(0, 80) } : {}),
      ...(app.os ? { os: String(app.os).slice(0, 120) } : {}),
      ...(app.page ? { page: String(app.page).slice(0, 120) } : {}),
      ...(Array.isArray(app.clientLogs) ? { clientLogs: app.clientLogs.slice(-60).map((line) => String(line).slice(0, 1000)) } : {}),
    };
  }

  function serverFacts(botId: string, messages: readonly StoredMessage[]): Partial<ReportContext> {
    let engine: { engine?: string; model?: string } = {};
    try {
      engine = deps.engine?.(botId) ?? {};
    } catch { /* the chat's own facts */ }
    const chat = chatFacts(messages);
    return {
      ...(engine.engine ? { engine: engine.engine } : {}),
      ...(chat.model || engine.model ? { model: chat.model || engine.model } : {}),
      chat,
    };
  }

  /** A /feedback typed in any chat, or the person's answer to the flow's
   * open question or card. Returns the stored message when the flow took it
   * (no turn runs), null when the message is not the flow's. */
  function handleMessage(input: FeedbackMessageInput & { userAgent?: string }): StoredMessage | null {
    const bot = store.bot(input.botId);
    if (!bot) return null;
    const text = input.text.trim();
    const messages = store.activePath(input.threadId);
    const userMessage = () => (settleCards(input.threadId, text), store.appendMessage(input.threadId, {
      role: "user", kind: "text", text, ...(input.sendId ? { sendId: input.sendId } : {}), ...(input.sender ? { sender: input.sender } : {}),
    }));

    const command = isFeedbackCommand(text);
    let record: FeedbackRecord | undefined;
    let marker: FeedbackMarker | null = null;
    if (!command) {
      marker = openFeedbackStep(messages);
      record = marker ? byId(marker.reportId) : undefined;
      if (record && record.status !== "draft") record = undefined;
      // only while the flow's question is the last word of the chat
      if (record && !input.viaCard) {
        const lastBot = [...messages].reverse().find((message) => message.role === "bot");
        if (lastBot?.feedback?.reportId !== record.id) record = undefined;
      }
    }

    if (!record) {
      if (!command) return null;
      const rest = text.replace(/^\/feedback\b/i, "").trim();
      // the chat's facts are read before /feedback itself is stored
      const facts = serverFacts(bot.id, messages);
      const stored = userMessage();
      const fresh = draft({
        owner: input.principalId,
        botId: bot.id,
        threadId: input.threadId,
        lang: input.app?.locale ?? languageFor(input.principalId, rest || null),
        source: "slash",
        said: rest,
        context: { ...appContext(input.app, input.userAgent), ...facts },
      });
      advance(fresh);
      return stored;
    }

    const stored = userMessage();
    if (marker?.step === "preview") {
      if (isSendOption(text, true)) submit(record);
      else if (isCancelOption(text, true)) cancel(record);
      else advance(record);
      return stored;
    }
    advance(record);
    return stored;
  }

  /** Retry the queue and read filed issues' status back (every 5 minutes). */
  let swept = false;
  async function tick(): Promise<void> {
    // #3018: drafts left unfinished expire; cards left behind by earlier
    // versions (one per reopened flow) are retired once after a start.
    const stale = new Set<string>();
    for (const record of records) {
      // #3299: a card older versions offered on their own files nothing now
      const retired = record.offer && record.status === "draft";
      if (retired || record.status === "draft" && now() - (record.updatedAt ?? record.createdAt) > DRAFT_TTL_MS) {
        record.status = "cancelled";
        record.updatedAt = now();
        stale.add(record.threadId);
      }
      if (!swept) stale.add(record.threadId);
    }
    swept = true;
    if (stale.size) {
      save();
      for (const threadId of stale) {
        try { retireStaleCards(threadId); } catch { /* the next sweep */ }
      }
    }
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
    retireFeedbackBot,
    handleMessage,
    answerCard,
    tick,
    list,
    flush: async () => { await Promise.all(pending); },
  };
}

export type FeedbackService = ReturnType<typeof createFeedbackService>;
