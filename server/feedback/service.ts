// The Feedback bot (#2618): one shared system bot every signed-in person can
// write to. It runs a short conversation in the ordinary chat (never a
// separate thread), shows what will leave the server, files the report as a
// GitHub issue with the server's own token, and posts the issue's status
// back into the same conversation. Without a token, reports wait in a local
// queue and are retried. The same flow runs inline when someone types
// /feedback in any chat, and any bot's conversation can get one pre-drafted
// offer when the person sounds frustrated.
import { textLanguage } from "../../shared/looks-french.ts";
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
  feedbackAnswers, feedbackLanguage, isCancelOption, isSendOption, nextFeedbackStep, offerCard, openFeedbackStep, parseKind,
  SEND_OPTIONS, type FeedbackAnswers, type FeedbackLanguage, type FeedbackMarker, type FlowCard, type FlowMessage,
} from "./flow.ts";
import { fileIssue, issueStatus, type GithubFiler } from "./github.ts";
import { buildReport, stripAttachments, type FiledReport, type ReportContext, type ReportSpan } from "./report.ts";

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
  /** Every thread the bot has (one per person), for the card sweep (#3081). */
  tasks?: ReadonlyArray<{ threadId: string }>;
}

/** The slice of the server store the service uses. */
export interface FeedbackStore {
  bots: readonly BotLike[];
  bot(id: string): BotLike | undefined;
  createBot(profile: { name?: string; title?: string; description?: string; color?: string }, options: { seedMessages?: boolean }): BotLike;
  patchBot(id: string, patch: { systemBot?: "feedback" }): BotLike | null;
  activePath(threadId: string): StoredMessage[];
  appendMessage(threadId: string, message: Omit<StoredMessage, "id" | "at">): StoredMessage;
  /** Marks a card answered (the server store's patchMessage). */
  patchMessage?(threadId: string, messageId: string, patch: { card: FlowCard }): unknown;
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
  /** The answer is a click on the flow's own card: it never waits for the
   * card to be the last word, whatever the busy bot said since. */
  viaCard?: boolean;
}

const RETRY_MS = 5 * 60_000;
const POLL_WINDOW_MS = 60 * 24 * 60 * 60_000;
/** #3018: an unfinished report nobody touched for this long is dropped and its card retired. */
export const DRAFT_TTL_MS = 7 * 24 * 60 * 60_000;
const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;

const WORDS = {
  fr: {
    hello: "Je m'occupe de votre signalement. J'ai joint la version, la page et les journaux récents; tout est anonymisé et rien ne part sans votre accord.",
    previewIntro: "Voici ce qui sera envoyé à l'équipe, une fois anonymisé :",
    previewTitle: "Envoyer ce signalement?",
    previewSubtitle: "Écrivez un détail pour l'ajouter, ou envoyez tel quel. La capture d'écran reste sur le serveur.",
    cancelled: "Annulé : rien n'a été envoyé.",
    queuedNoToken: (manual: string) => `En file d'attente : signalement prêt et gardé ici. Ce serveur n'a pas de jeton GitHub pour l'envoyer à l'équipe : un administrateur du serveur doit définir la variable SAGAX_FEEDBACK_GITHUB_TOKEN (ou l'enregistrer par PUT /api/admin/feedback-config). Je réessaie toutes les 5 minutes. En attendant, vous pouvez ${manual}.`,
    manualLink: (url: string) => `[ouvrir le signalement sur GitHub](${url}) vous-même (il est déjà rempli)`,
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
    cancelled: "Cancelled: nothing was sent.",
    queuedNoToken: (manual: string) => `Queued: report ready and kept here. This server has no GitHub token to send it to the team: a server admin must set the SAGAX_FEEDBACK_GITHUB_TOKEN environment variable (or save it with PUT /api/admin/feedback-config). I retry every 5 minutes. Meanwhile you can ${manual}.`,
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

function oneLine(text: string, max: number): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
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
    if (!bot) return { ok: false, status: 404, error: "The Feedback bot is gone." };
    const options = message.card?.options ?? [];
    const picked = options.find((option) => option.toLowerCase() === text.trim().toLowerCase());
    if (!picked && !text.trim()) return { ok: false, status: 400, error: `Pick one of: ${options.join(", ")}.` };
    handleMessage({ botId: bot.id, threadId, text: picked ?? text.trim(), principalId, viaCard: true });
    return { ok: true, status: 200 };
  }

  function draft(input: { owner: string | null; botId: string; threadId: string; lang: FeedbackLanguage; source: FeedbackSource; preset?: Partial<FeedbackAnswers>; context?: Partial<ReportContext>; offer?: boolean }): FeedbackRecord {
    // a newer report in the same conversation replaces an unfinished one
    for (const record of records) {
      if (record.threadId === input.threadId && record.status === "draft" && !record.offer) record.status = "cancelled";
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
    record.updatedAt = now();
    const step = nextFeedbackStep(record.lang, answersOf(record), record.id);
    if (step.kind === "ask") {
      post(record.threadId, step.marker, step.message);
      return;
    }
    const report = reportOf(record);
    const words = WORDS[record.lang];
    const body = report.body.length > 6000 ? `${report.body.slice(0, 5999)}…` : report.body;
    post(record.threadId, undefined, { kind: "text", text: `${words.previewIntro}\n\n**${report.title}**\n\n${body}` });
    // the Feedback product's send preview (a report to a third party, the person's own send); full-access: exempt
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
    const answers = answersOf(record);
    record.kind = answers.kind ?? "bug";
    record.report = reportOf(record);
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
    const userMessage = () => (settleCards(input.threadId, text), store.appendMessage(input.threadId, {
      role: "user", kind: "text", text, ...(input.sendId ? { sendId: input.sendId } : {}), ...(input.sender ? { sender: input.sender } : {}),
    }));

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
      if (record && bot.systemBot !== "feedback" && !input.viaCard) {
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
        lang: languageFor(input.principalId, rest || text),
        source: command ? "slash" : "chat",
        preset: presetFrom(rest),
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

  function start(owner: string | null, request: FeedbackStartRequest): FeedbackStartResponse {
    const bot = ensureBot();
    const threadId = deps.threadFor(bot);
    const lang: FeedbackLanguage = request.locale ?? languageFor(owner, null);
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
      preset: request.source === "error" ? { kind: "bug" } : request.text ? presetFrom(request.text) : {},
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
    // #3218: the card follows the conversation's language (the words of the
    // person's messages), before the app setting.
    const spoken = textLanguage([...earlier.slice(-3), input.text].join("\n"));
    const lang = spoken ?? languageFor(input.principalId, input.text);
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
    const summary = oneLine(anonymize(stripAttachments(input.text).text, deps.names()), 200);
    // the Feedback product's offer, never a permission; full-access: exempt
    post(input.threadId, { step: "offer", reportId: record.id }, { kind: "options", card: offerCard(lang, summary) });
  }

  /** Retry the queue and read filed issues' status back (every 5 minutes). */
  /** #3081: every thread of the Feedback bot, not only those that still have
   * a report record: a card whose report is gone from disk sits in a thread
   * nothing else would sweep. Runs at startup and on every tick. */
  function sweepOrphanCards(): void {
    for (const bot of store.bots) {
      if (bot.systemBot !== "feedback") continue;
      const threads = new Set<string>([bot.threadId, ...(bot.tasks ?? []).map((task) => task.threadId)]);
      for (const threadId of threads) {
        try { retireStaleCards(threadId); } catch { /* the next sweep */ }
      }
    }
  }

  let swept = false;
  async function tick(): Promise<void> {
    sweepOrphanCards();
    // #3018: drafts left unfinished expire; cards left behind by earlier
    // versions (one per reopened flow) are retired once after a start.
    const stale = new Set<string>();
    for (const record of records) {
      if (record.status === "draft" && now() - (record.updatedAt ?? record.createdAt) > DRAFT_TTL_MS) {
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
    ensureBot,
    start,
    handleMessage,
    answerCard,
    maybeOffer,
    tick,
    sweepOrphanCards,
    list,
    flush: async () => { await Promise.all(pending); },
  };
}

export type FeedbackService = ReturnType<typeof createFeedbackService>;
