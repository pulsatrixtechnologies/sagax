// @ts-nocheck
/** syncRoutineRunToSource (#1388). Pure move from server/index.ts. */
import { wakeTopicOf } from "../routines/routine-run-card.ts";
import { routineReportOutcome, routineRowLogLine, routineRunMayWriteRow, type RoutineRunRowFacts } from "../routines/routine-report.ts";
import type { RoutineRun } from "../routines/routines.ts";
import { textLanguage } from "../../shared/looks-french.ts";
import { clipReadable, withoutRoutineMarkers } from "../../shared/routine-result.ts";
import { needsYouNotificationWords } from "../runtime-events/question-notification-words.ts";
import { routineReportsByStreak, routineRunRowInEveryChat, routineRunRowOutOfChat } from "../../shared/routine-repeat.ts";
import { redactSecretsInText } from "../redact.ts";
import { routineRunWidget } from "../routines/routine-run-widget.ts";
import { signalKeys } from "../proactive/signal-ledger.ts";
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
    // #4234: the widget the run drew here stays named across updates
    ...(kept?.widgetId ? { widgetId: kept.widgetId } : {}),
  };
  const language = textLanguage(`${languageText ?? ""}\n${run.routineName ?? ""}`)
    ?? (run.runAs ? host.languageOfPerson?.(run.runAs) : undefined);
  return { text: host.routineRunFallbackText(card, language, routineRunZone(host, run)), routineRun: card };
}

/** #3581: what the run reports by (the shared rule, routineRunReportable):
 * whether a request waits on the person and whether its routine posts its
 * results. */
function reportFacts(host: Host, run: RoutineRun): any {
  return { ...run, needsPerson: run.status === "waiting" && host.routineRunNeedsPerson(run), postResults: host.routineEffectivePostResults(run) };
}

/** #3990, #4051: the facts the one row gate (routineRunMayWriteRow) reads,
 * for the run's card write and its late answer alike. Its works again is
 * the streak card's to tell, so its own row is read without it; items for
 * the person on its row are still for them. */
function rowFacts(host: Host, run: RoutineRun, facts: { attention: boolean; existing: any; streakTells: boolean }): RoutineRunRowFacts {
  return {
    ...reportFacts(host, run), recovered: undefined, attention: facts.attention || Boolean(facts.existing?.attention),
    byStreak: routineReportsByStreak(run), streakTells: facts.streakTells, autoPaused: Boolean(run.autoPaused), existing: Boolean(facts.existing),
  };
}

/** #4051: whether the desktop chat draws this row (routineRunRowOutOfChat):
 * a row it would leave out is never written, marked unread or rung for. */
function drawn(card: any, attention: unknown): boolean {
  return !routineRunRowOutOfChat({ kind: "routine.run", attention: attention ? true : undefined, routineRun: card });
}

/** #4051: whether every desktop in use draws this row
 * (routineRunRowInEveryChat): only such a row marks its conversation unread
 * or rings. */
function drawnEverywhere(card: any, attention: unknown): boolean {
  return routineRunRowInEveryChat({ kind: "routine.run", attention: attention ? true : undefined, routineRun: card });
}

/** #3581: a run's late answer (a teammate's reply after the run ended) goes
 * onto the run's own card through the same card write, with that answer as
 * its report. The answer is what the run says now, even after a quiet end.
 * #4051: `said` is the answer with its markers (the store keeps them as data
 * on the row: shared/routine-result.ts withRunMarkers), read by the same
 * report reader as a run's own end, and the row gate reads the same facts as
 * the card write. Undefined when the answer may not reach the chat (nothing
 * written, nothing unread, nothing rung); `rings` when it is something for
 * the person (unread and a notification). */
export function createRoutineRunLateRow(getHost: () => Host): (runThreadId: string, target: string, said: string) => { text: string; routineRun: any; rings: boolean } | undefined {
  return (runThreadId, target, said) => {
    const host = getHost();
    const stored = host.routines?.runForThread(runThreadId);
    if (!stored) return undefined;
    const outcome = routineReportOutcome(said);
    const run: RoutineRun = {
      ...stored,
      output: outcome.report || undefined,
      quiet: outcome.quiet && !outcome.declared ? true : undefined,
      problems: outcome.declared ? outcome.declared.reason : undefined,
      recovered: undefined,
    };
    const existing = host.store.messagesFor(target)?.findLast?.((message) => message.kind === "routine.run" && message.routineRun?.runId === run.id);
    const found = run.quiet ? undefined : host.personAttention(said);
    const streakTells = Boolean(existing?.routineRun?.repeat?.streak);
    if (!routineRunMayWriteRow(rowFacts(host, run, { attention: Boolean(found), existing, streakTells }))) return undefined;
    const row = routineRunCardRow(host, run, target, outcome.report, existing, outcome.report);
    if (!drawn(row.routineRun, existing?.attention ?? found)) return undefined;
    return { ...row, rings: host.routineRunReportable({ ...reportFacts(host, run), attention: Boolean(found) }) && drawnEverywhere(row.routineRun, existing?.attention ?? found) };
  };
}

const FINISHED = new Set(["completed", "failed", "blocked"]);
const LIVE = new Set(["queued", "running", "waiting"]);

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
 * whose count started at the run's streak's first problem run (the run
 * itself when it is the first); when the run ended its streak, the card of
 * that streak (by its first run, the streak's identity). */
function repeatAnchor(host: Host, threadId: string, run: RoutineRun): any {
  const rows = host.store.messagesFor(threadId) ?? [];
  const told = (message: any) => message.kind === "routine.run" && message.routineRun?.repeat?.streak;
  if (problemRun(run)) {
    const firstRunId = run.problemRepeat?.firstRunId ?? run.id;
    return rows.findLast?.((message: any) => told(message) && message.routineRun.repeat.firstRunId === firstRunId);
  }
  if (run.recovered) {
    // the streak it ended, by its first run (the streak's identity,
    // sameStreak); a run settled before #4050 by its routine and its start
    const { firstRunId, since } = run.recovered;
    return rows.findLast?.((message: any) => told(message) && (firstRunId
      ? message.routineRun.repeat.firstRunId === firstRunId
      : message.routineRun.routineId === run.routineId && message.routineRun.repeat?.since === since));
  }
  return undefined;
}

/** #4050: the run tells the person (RoutineManager.tellsPerson, the one
 * reading of `tellsStreak`, a run settled before it by its count). */
function tellsPerson(host: Host, run: RoutineRun): boolean {
  return host.routines?.tellsPerson?.(run) ?? run.tellsStreak === true;
}

/** The streak's state for this run, or null outside it. #4050: the run
 * that tells is the one its streak named when it finished (`tellsStreak`),
 * never a reading again; a count only ever goes up and works again is said
 * once (the card then leaves its streak). */
function streakSay(host: Host, run: RoutineRun, threadId: string): { say: StreakSay; anchor?: any } | null {
  if (!FINISHED.has(run.status) || run.target === "room-goal") return null;
  if (problemRun(run)) {
    const anchor = repeatAnchor(host, threadId, run);
    if (anchor) return (run.problemRepeat?.count ?? 1) > (anchor.routineRun.repeat.count ?? 0) ? { say: "count", anchor } : { say: "out" };
    return { say: tellsPerson(host, run) ? "tell" : "out" };
  }
  if (run.recovered) {
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
  let attentionFound = run.status === "completed" && !run.quiet && attentionLevel !== "muted" ? host.personAttention(host.routineFullReport(run) ?? run.output) : undefined;
  // Thumbs-down or "less": the card still comes, without ringing or unread.
  const attentionRings = attentionLevel === "normal";
  // #3581: what the run posts is the shared rule (routineRunReportable)
  const reportableRun = reportFacts(host, run);
  let reportable = host.routineRunReportable({ ...reportableRun, attention: Boolean(attentionFound) });
  // A card posted only for quieted attention items: in the chat, never unread.
  let reportableUnread = attentionRings ? reportable : host.routineRunReportable({ ...reportableRun, attention: false });
  // #3990: a completed result of a routine the person set to post each one
  // (a clock routine that runs once a day or less often, a wake they chose)
  const postsResult = run.status === "completed" && !run.quiet && !run.problems && reportableRun.postResults;
  // #3695, #3990: every other run that is not the person's reports by its
  // routine's streak, whatever starts the routine
  const byStreak = FINISHED.has(run.status) && routineReportsByStreak(run) && !postsResult;
  /** #3990: whether this run may put its row in the conversation now, or
   * keep the one it has: the one gate (routineRunMayWriteRow, rowFacts). */
  const mayWrite = (existing: any, streakTells: boolean): boolean =>
    routineRunMayWriteRow(rowFacts(host, run, { attention: Boolean(attentionFound), existing, streakTells }));
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
    // is the one of its streak that tells the person (`tellsStreak`), unless
    // it has items only the person can do or paused its routine.
    const streakOnly = byStreak && !attentionFound && !run.autoPaused;
    const tells = streakOnly ? problemRun(run) && tellsPerson(host, run) : !run.problemRepeat || attentionFound;
    if (reportable && tells && mayWrite(undefined, streakOnly && tells) && own?.routineRunId === run.id) {
      host.store.patchTask(run.botId, own.threadId, { routineRunId: undefined, ...(reportableUnread ? { unread: true } : {}) });
    }
    return null;
  }
  const source = target;
  const sourceThreadId = source.threadId;
  // #4233: the items only the person can do of a completed run (a routine's
  // or a wake's) are keyed cards in the bot's conversations with the person,
  // one per item: the same item of the next run replaces its card, an item
  // this run no longer lists is retired (a run that lists none retires them
  // all). Only what no card could carry stays on the run's attention card.
  // A person who asked for these less (quiet) or never (muted) keeps what
  // their feedback gave.
  if (run.status === "completed" && attentionLevel === "normal" && run.target !== "room-goal" && host.personItemCards) {
    const human = attentionFound?.kind === "human" ? attentionFound : undefined;
    const items = (human?.items ?? []).map((item: any) => {
      const url = item.ticketId && run.threadId ? host.attentionTicketUrl?.(run.threadId, item.ticketId) : undefined;
      return url ? { ...item, ticketUrl: url } : item;
    });
    const left = host.personItemCards(run, sourceThreadId, items);
    if (left && human) {
      attentionFound = left.length ? { ...human, items: left } : undefined;
      reportable = host.routineRunReportable({ ...reportableRun, attention: Boolean(attentionFound) });
      reportableUnread = reportable;
    }
  }
  const existing = host.store.messagesFor(sourceThreadId).find(
    (message) => message.kind === "routine.run" && message.routineRun?.runId === run.id,
  );
  const zone = routineRunZone(host, run);
  // #4050: a row that is already its streak's card (the summary, or its
  // works again) is the streak's: a sync again of its run (marking it seen,
  // Mark all as read, an upgrade) leaves it as it is
  if (existing && FINISHED.has(run.status) && (existing.routineRun?.repeat?.streak || existing.routineRun?.recovered?.streak)) return sourceThreadId;
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
  const tells = streak?.say === "tell";
  // a run that reports by its streak never says works again on its own
  // row: that is the streak card's to tell (#4051: a row that carried it
  // was left out of the chat after it rang)
  if (routineReportsByStreak(run) && run.recovered) run = { ...run, recovered: undefined };
  const row = routineRunCardRow(host, run, sourceThreadId, host.routineFullReport(run), existing, run.output);
  // #3695: the streak's one summary card, with its count and since when
  const card = tells ? streakCard(host, run, row.routineRun) : row.routineRun;
  // #3990: the one gate. A row this run put there for a request that no
  // longer waits, on a run that ended with nothing for the person (a wake on
  // a teammate's message whose approval was answered), is taken back: the
  // run log keeps the run. #4051: so is a row the chat would not draw, and
  // a row of a run that settled otherwise (cancelled, superseded, missed)
  // never keeps its live state.
  if (!mayWrite(existing, tells) || !drawn(card, attentionFound)) {
    if (existing && !LIVE.has(run.status) && host.store.removeMessage?.(sourceThreadId, existing.id)) rowLog("run", "remove", { ...existing.routineRun, status: run.status }, false);
    return sourceThreadId;
  }
  // #4234: a finished run's widget for the person is drawn at its row, in
  // this conversation, usable there (rooms draw no widget)
  if (run.status === "completed" && !source.group) {
    const widgetId = routineRunWidget(host.store, { runThreadId: run.threadId, conversationId: sourceThreadId, keptId: existing?.routineRun?.widgetId });
    if (widgetId) {
      card.widgetId = widgetId;
      // it waits on the person until answered: Today, the pinned row and the
      // connector's list read it from the run (server/approvals/today-rows.ts)
      host.routines?.noteRunForm?.(run.id, { threadId: sourceThreadId, widgetId });
    }
  }
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
  if (reportableUnread && drawnEverywhere(card, attentionFound) && (statusChanged || (attentionNew && attentionRings))) {
    if (source.group) host.store.patchGroup(source.group.id, { unread: true });
    else host.store.patchTask(source.bot.id, sourceThreadId, { unread: true });
  }
  // Items only the person can do ring once, whatever postResults says.
  if (attention && attentionNew && attentionRings && runBotRecord) {
    // #2909: the person reads what happened and what each answer does
    // before choosing; the tap opens the chat on this card.
    const words = needsYouNotificationWords(attention);
    // #4250: told through tellPerson, once per run and card (a restart included)
    host.tellPerson(host.routineRunPerson(run, runBotRecord), {
      key: signalKeys.runNeedsYou(run.id, cardId ?? sourceThreadId), kind: "needs-you", bot: runBotRecord.id,
      label: run.routineName, ref: { threadId: sourceThreadId },
      notification: { notification: host.deliverableNotification("needs-you", runBotRecord, sourceThreadId, words.line, {
        avatarUrl: runBotRecord.avatarUrl, routineRunId: run.id, routineName: run.routineName,
        ...(words.question ? { question: words.question } : {}), context: words.context,
        ...(words.choices.length ? { choices: words.choices } : {}),
        ...(cardId ? { cardId } : {}),
      }) },
    });
  }
  return sourceThreadId;

}
  return syncRoutineRunToSource;
}
