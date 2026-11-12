// @ts-nocheck
/** syncRoutineRunToSource (#1388). Pure move from server/index.ts. */
import { wakeTopicOf } from "../routines/routine-run-card.ts";
import { routineReportOutcome, routineRowLogLine, routineRunMayWriteRow } from "../routines/routine-report.ts";
import type { RoutineRun } from "../routines/routines.ts";
import { textLanguage } from "../../shared/looks-french.ts";
import { clipReadable, withoutRoutineMarkers } from "../../shared/routine-result.ts";
import { needsYouNotificationWords } from "../runtime-events/question-notification-words.ts";
import { ROUTINE_PROBLEM_STREAK_TOLD, routineReportsByStreak } from "../../shared/routine-repeat.ts";

/** #3990: the run of this run's streak that tells the person (the first
 * for a routine that runs at most once a day, the third for one that can
 * run several times a day: shared/routine-repeat.ts routineProblemToldAt). */
const toldAt = (host: Host, run: RoutineRun): number => host.routines?.problemToldAt?.(run) ?? ROUTINE_PROBLEM_STREAK_TOLD;
import { redactSecretsInText } from "../redact.ts";
export type Host = Record<string, any>;

/** #3990: one log line per routine run row written, updated or taken back. */
function rowLog(...args: Parameters<typeof routineRowLogLine>): void {
  console.info(routineRowLogLine(...args));
}

/** #2694: the person's feedback on this run's attention cards (thumbs-down,
 * "less", "never"), read as on the relayed card: muted, quiet or normal. */
export function routineAttentionLevel(host: Host, run: Pick<RoutineRun, "botId" | "webhookId" | "proactive">): "muted" | "quiet" | "normal" {
  // #3423: a chosen watch's alert is what the person asked for; its exits
  // are the person's choice, never an old mute of every watch of the bot
  if (run.proactive?.watches?.length) return "normal";
  const level = host.backgroundBriefs?.wakeLevel?.(run.botId, wakeTopicOf(run) ?? "attention");
  return level === "muted" || level === "quiet" ? level : "normal";
}

/** #3479: the zone a run's card and its fallback text give times in: the
 * person's, else the routines' own. */
function routineRunZone(host: Host, run: RoutineRun): string | undefined {
  const person = run.runAs ?? host.effectiveRunAs?.({ botId: run.botId });
  return (person && host.isPrincipalId?.(person) ? host.botSettings?.person?.(person)?.timeZone : null) ?? host.routineTimeZone?.();
}

/** The one card write of a run's routine.run row: the card from its report,
 * the person's feedback on a wake (#2694) and the lasting-problem count later
 * runs put on the row (#3479) kept across updates, the fallback text in the
 * language the run wrote in (#3219) and the person's zone. */
function routineRunCardRow(host: Host, run: RoutineRun, sourceThreadId: string, report: string | undefined, existing: any, languageText: string | undefined): { text: string; routineRun: any } {
  const fresh = host.routineRunCard(run, sourceThreadId, report);
  const kept = existing?.routineRun;
  const card = {
    ...fresh,
    ...(kept?.feedback ? { feedback: kept.feedback } : {}),
    ...(kept?.repeat && !fresh.repeat ? { repeat: kept.repeat } : {}),
  };
  const language = textLanguage(`${languageText ?? ""}\n${run.routineName ?? ""}`)
    ?? (run.runAs ? host.languageOfPerson?.(run.runAs) : undefined);
  return { text: host.routineRunFallbackText(card, language, routineRunZone(host, run)), routineRun: card };
}

/** #3581: a run's late answer (a teammate's reply after the run ended) goes
 * onto the run's own card through the same card write, with that answer as
 * its report. The answer is what the run says now, even after a quiet end.
 * #3990: an answer that ends with the nothing-to-report line stays quiet, so
 * its card is never a report for the person. */
export function createRoutineRunLateCard(getHost: () => Host): (runThreadId: string, target: string, report: string) => { text: string; routineRun: any } | undefined {
  return (runThreadId, target, report) => {
    const host = getHost();
    const run = host.routines?.runForThread(runThreadId);
    if (!run) return undefined;
    const existing = host.store.messagesFor(target)?.findLast?.((message) => message.kind === "routine.run" && message.routineRun?.runId === run.id);
    const quiet = routineReportOutcome(report).quiet ? true : undefined;
    return routineRunCardRow(host, { ...run, quiet }, target, report, existing, report);
  };
}

const FINISHED = new Set(["completed", "failed", "blocked"]);

/** #3695, #3990: what a finished routine run says in the chat
 * (shared/routine-repeat.ts), whatever starts its routine. `out`: nothing.
 * `tell`: the streak's one summary card, now. `count`: that card's count and
 * last run, in place. `recovered`: that card says it works again, in place.
 * Null: the run is not one of those (the ordinary rule applies). */
type StreakSay = "out" | "tell" | "count" | "recovered";

function problemRun(run: RoutineRun): boolean {
  return run.status === "failed" || run.status === "blocked" || (run.status === "completed" && Boolean(run.problems));
}

/** The streak's one summary card in this conversation (#3695): the card
 * whose count started at the run's first problem run; when the run ended
 * its streak, the card of that streak. */
function repeatAnchor(host: Host, threadId: string, run: RoutineRun): any {
  const rows = host.store.messagesFor(threadId) ?? [];
  const told = (message: any) => message.kind === "routine.run" && message.routineRun?.repeat?.streak;
  if (run.problemRepeat) {
    const firstRunId = run.problemRepeat.firstRunId;
    return rows.findLast?.((message: any) => told(message) && message.routineRun.repeat.firstRunId === firstRunId);
  }
  if (run.recovered) {
    const since = run.recovered.since;
    return rows.findLast?.((message: any) => told(message) && message.routineRun.routineId === run.routineId && message.routineRun.repeat?.since === since);
  }
  return undefined;
}

/** The streak's state for this run, or null outside it. */
function streakSay(host: Host, run: RoutineRun, threadId: string): { say: StreakSay; anchor?: any } | null {
  if (!FINISHED.has(run.status) || run.target === "room-goal") return null;
  const told = toldAt(host, run);
  if (problemRun(run)) {
    const count = run.problemRepeat?.count ?? 1;
    if (count < told) return { say: "out" };
    const anchor = repeatAnchor(host, threadId, run);
    return anchor ? { say: "count", anchor } : { say: "tell" };
  }
  if (run.recovered && run.recovered.afterRuns >= told) {
    const anchor = repeatAnchor(host, threadId, run);
    return anchor ? { say: "recovered", anchor } : { say: "out" };
  }
  return { say: "out" };
}

/** #3695: the streak's card, its count and last run, and when the run that
 * tells the person failed before its bot could write, the streak's own
 * failure texts (deduplicated) as its words. */
function streakCard(host: Host, run: RoutineRun, card: any): any {
  const repeat = run.problemRepeat
    ? { ...run.problemRepeat, lastAt: run.finishedAt ?? run.problemRepeat.since, streak: true }
    : { firstRunId: run.id, since: run.finishedAt ?? run.createdAt, count: 1, lastAt: run.finishedAt ?? run.createdAt, streak: true };
  const texts = run.status === "completed" ? [] : host.routines?.problemStreakTexts?.(run) ?? [];
  return {
    ...card,
    repeat,
    ...(texts.length ? { error: clipReadable(redactSecretsInText(texts.join("\n")), 500) } : {}),
  };
}

/** #3695: the streak's card says it works again, in place: what was wrong
 * stays in its words (a failed run's words become its summary), the state
 * turns to works again. */
function recoveredCard(anchorCard: any, run: RoutineRun): any {
  const { problems: _problems, repeat: _repeat, error, autoPausedAfter: _paused, ...rest } = anchorCard;
  // a streak told by a failed run: its failure words stay as the card's words
  const summary = rest.summary || error || undefined;
  // #3990: still the streak's card once it works again (routineRunRowOutOfChat)
  return { ...rest, ...(summary ? { summary } : {}), status: "completed", recovered: { ...run.recovered!, streak: true } };
}

export function createSyncRoutineRunToSource(getHost: () => Host): any {
function syncRoutineRunToSource(run: RoutineRun): string | null{
  const host = getHost();

  const known = host.routineSourceOwner(run);
  // #3219, #3479: the run's markers (NOTHING_TO_REPORT, SAME_PROBLEM) never
  // show in its own thread, in every shape the report reader takes. #3515:
  // its final words are routine output, read by the one shared strip; the
  // store strips only the exact tokens from every other bot row.
  if (run.status === "completed" && run.threadId) {
    const last = host.store.messagesFor(run.threadId)?.findLast?.((message) => message.role === "bot" && !message.kind && typeof message.text === "string" && message.text.trim());
    const text = last ? withoutRoutineMarkers(last.text) : undefined;
    if (last && text !== last.text) host.store.patchMessage(run.threadId, last.id, { text });
  }
  // 2026-11-05: a completed report with items only the person can do
  // ([HUMAIN], needs_human, a question) always posts, as a card with them.
  const attentionLevel = run.status === "completed" && !run.quiet ? routineAttentionLevel(host, run) : "normal";
  // #2694: "never" (or votes under the mute line) on these cards: none at all.
  const attentionFound = run.status === "completed" && !run.quiet && attentionLevel !== "muted" ? host.personAttention(host.routineFullReport(run) ?? run.output) : undefined;
  // Thumbs-down or "less": the card still comes, without ringing or unread.
  const attentionRings = attentionLevel === "normal";
  // #3581: what the run posts is the shared rule (routineRunReportable)
  const reportableRun = { ...run, needsPerson: run.status === "waiting" && host.routineRunNeedsPerson(run), postResults: host.routineEffectivePostResults(run) };
  const reportable = host.routineRunReportable({ ...reportableRun, attention: Boolean(attentionFound) });
  // A card posted only for quieted attention items: in the chat, never unread.
  const reportableUnread = attentionRings ? reportable : host.routineRunReportable({ ...reportableRun, attention: false });
  // #3990: a completed result of a routine the person set to post each one
  // (a clock routine that runs once a day or less often, a wake they chose)
  const postsResult = run.status === "completed" && !run.quiet && !run.problems && reportableRun.postResults;
  // #3695, #3990: every other run that is not the person's reports by its
  // routine's streak, whatever starts the routine
  const byStreak = FINISHED.has(run.status) && routineReportsByStreak(run) && !postsResult;
  /** #3990: whether this run may put its row in the conversation now, or
   * keep the one it has: the one gate (routineRunMayWriteRow). Its works
   * again is the streak card's to tell, so its own row is read without it. */
  const mayWrite = (existing: boolean, streakTells: boolean): boolean => routineRunMayWriteRow({
    ...reportableRun, recovered: undefined, attention: Boolean(attentionFound), byStreak: routineReportsByStreak(run),
    streakTells, autoPaused: Boolean(run.autoPaused), existing,
  });
  // A bot run's task stays hidden (Automations, Open run) from its start.
  // 2026-10-28: a webhook's run too (it used to take the bot's live chat;
  // now it runs in its own task and reports into the one conversation).
  const execution = run.target === "bot" && run.threadId && run.threadId !== known?.threadId
    ? host.store.taskByThread(run.botId, run.threadId)
    : null;
  if (execution && run.status === "running" && !execution.routineRunId && host.store.messagesFor(execution.threadId).length === 0) {
    // Only a fresh execution, before dispatch adds any transcript. A person
    // can later promote it by writing in it; replaying or marking the old
    // receipt seen must never hide that conversation again.
    host.store.patchTask(run.botId, execution.threadId, { routineRunId: run.id, unread: false });
  } else if (known && execution?.routineRunId === run.id && execution.unread) {
    // Already this run. Clear the dot without rewriting the tag, so a
    // promoted thread (tag cleared, transcript present) stays visible.
    host.store.patchTask(run.botId, execution.threadId, { unread: false });
  }
  // Its destination gone (deleted, or never one): the run reports into the
  // bot's one conversation (2026-10-28, shared/single-stream.ts), never as
  // a conversation of its own (that made a new topic out of a run's task).
  const runBot = !known && run.target === "bot" ? host.store.bot(run.botId) : undefined;
  const conversation = runBot && !runBot.hidden ? host.conversationOrStart(runBot, host.privateThreads() && run.runAs ? run.runAs : undefined) : undefined;
  const target = known ?? (runBot && conversation && conversation !== run.threadId ? { bot: runBot, group: undefined, threadId: conversation } : null);
  if (!target) {
    // Nowhere at all to report (a Cloud guest's run): a run with something
    // for the person becomes a conversation of its own; a quiet one stays
    // in Automations.
    const own = run.threadId ? host.store.taskByThread(run.botId, run.threadId) : null;
    // Thumbs-down or "less" (quiet): it still surfaces, never unread.
    // #3695, #3990: a run that reports by its streak surfaces only when it
    // is the one of its streak that tells the person (toldAt), unless it
    // has items only the person can do or paused its routine.
    const streakOnly = byStreak && !attentionFound && !run.autoPaused;
    const tells = streakOnly ? problemRun(run) && (run.problemRepeat?.count ?? 1) === toldAt(host, run) : !run.problemRepeat || attentionFound;
    if (reportable && tells && mayWrite(false, streakOnly && tells) && own?.routineRunId === run.id) {
      host.store.patchTask(run.botId, own.threadId, { routineRunId: undefined, ...(reportableUnread ? { unread: true } : {}) });
    }
    return null;
  }
  const source = target;
  const sourceThreadId = source.threadId;
  const existing = host.store.messagesFor(sourceThreadId).find(
    (message) => message.kind === "routine.run" && message.routineRun?.runId === run.id,
  );
  const zone = routineRunZone(host, run);
  // #3695, #3990: a run the person started, a run that waits on them, items
  // only they can do, a result they set the routine to post and a routine
  // that paused itself are told as always; every other finished run writes
  // nothing, whatever starts its routine, except the streak's one card.
  const streak = streakSay(host, run, sourceThreadId);
  const waits = run.status === "waiting" && reportableRun.needsPerson;
  if (streak && (streak.say === "count" || streak.say === "recovered")) {
    const anchorCard = streak.say === "count"
      ? { ...streak.anchor.routineRun, repeat: { ...streak.anchor.routineRun.repeat, ...run.problemRepeat, lastAt: run.finishedAt ?? run.problemRepeat!.since, streak: true } }
      : recoveredCard(streak.anchor.routineRun, run);
    const anchorLanguage = textLanguage(`${anchorCard.summary ?? ""}\n${run.routineName ?? ""}`)
      ?? (run.runAs ? host.languageOfPerson?.(run.runAs) : undefined);
    host.store.patchMessage(sourceThreadId, streak.anchor.id, { text: host.routineRunFallbackText(anchorCard, anchorLanguage, zone), routineRun: anchorCard });
    rowLog("streak", "patch", anchorCard, false);
  }
  // #3990: the one gate. A row this run put there for a request that no
  // longer waits, on a run that ended with nothing for the person (a wake on
  // a teammate's message whose approval was answered), is taken back: the
  // run log keeps the run.
  const ownIsAnchor = Boolean(existing && streak?.anchor && streak.anchor.id === existing.id);
  if (!mayWrite(Boolean(existing), streak?.say === "tell" || ownIsAnchor)) {
    if (existing && FINISHED.has(run.status) && host.store.removeMessage?.(sourceThreadId, existing.id)) rowLog("run", "remove", { ...existing.routineRun, status: run.status }, false);
    return sourceThreadId;
  }
  // a run told on its own (its card below) says its state there; the
  // streak's card already says the works again
  if (streak?.say === "recovered" && !ownIsAnchor) run = { ...run, recovered: undefined };
  const row = routineRunCardRow(host, run, sourceThreadId, host.routineFullReport(run), existing, run.output);
  // #3695: the streak's one summary card, with its count and since when
  const card = streak?.say === "tell" ? streakCard(host, run, row.routineRun) : row.routineRun;
  const text = card === row.routineRun ? row.text : host.routineRunFallbackText(card, textLanguage(`${run.output ?? ""}\n${run.routineName ?? ""}`)
    ?? (run.runAs ? host.languageOfPerson?.(run.runAs) : undefined), zone);
  const statusChanged = existing?.routineRun?.status !== run.status;
  const runBotRecord = host.store.bot(run.botId);
  const attention = attentionFound && runBotRecord && run.threadId
    ? host.attentionCard(runBotRecord, run.threadId, host.store.taskByThread(run.botId, run.threadId) ?? undefined,
      `run:${run.id}`, attentionFound, { id: run.id, routineName: run.routineName }, { ticketUrl: host.attentionTicketUrl })
    : undefined;
  const attentionNew = Boolean(attention && !existing?.attention);
  let cardId: string | undefined = existing?.id;
  rowLog("run", existing ? "patch" : "append", card, waits || Boolean(attention));
  if (existing) {
    host.store.patchMessage(sourceThreadId, existing.id, { text, routineRun: card, ...(attention ? { attention } : {}) });
  } else {
    const message: Omit<Message, "id" | "at"> = {
      role: "bot",
      kind: "routine.run",
      text,
      routineRun: card,
      ...(attention ? { attention } : {})
    };
    if (source.group) {
      message.from = { botId: source.bot.id, name: source.bot.name, color: source.bot.color };
    }
    cardId = host.store.appendMessage(sourceThreadId, message)?.id;
  }
  // Something for the person turns the conversation unread, once per state.
  if (reportableUnread && (statusChanged || (attentionNew && attentionRings))) {
    if (source.group) host.store.patchGroup(source.group.id, { unread: true });
    else host.store.patchTask(source.bot.id, sourceThreadId, { unread: true });
  }
  // Items only the person can do ring once, whatever postResults says.
  if (attention && attentionNew && attentionRings && runBotRecord) {
    // #2909: the person reads what happened and what each answer does
    // before choosing; the tap opens the chat on this card.
    const words = needsYouNotificationWords(attention);
    host.notify(host.deliverableNotification("needs-you", runBotRecord, sourceThreadId, words.line, {
      avatarUrl: runBotRecord.avatarUrl, routineRunId: run.id, routineName: run.routineName,
      ...(words.question ? { question: words.question } : {}), context: words.context,
      ...(words.choices.length ? { choices: words.choices } : {}),
      ...(cardId ? { cardId } : {}),
    }));
  }
  return sourceThreadId;

}
  return syncRoutineRunToSource;
}
