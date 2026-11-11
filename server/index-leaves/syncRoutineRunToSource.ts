// @ts-nocheck
/** syncRoutineRunToSource (#1388). Pure move from server/index.ts. */
import { wakeTopicOf } from "../routines/routine-run-card.ts";
import type { RoutineRun } from "../routines/routines.ts";
import { textLanguage } from "../../shared/looks-french.ts";
import { withoutRoutineMarkers } from "../../shared/routine-result.ts";
import { needsYouNotificationWords } from "../runtime-events/question-notification-words.ts";
export type Host = Record<string, any>;

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
 * its report. The answer is what the run says now, even after a quiet end. */
export function createRoutineRunLateCard(getHost: () => Host): (runThreadId: string, target: string, report: string) => { text: string; routineRun: any } | undefined {
  return (runThreadId, target, report) => {
    const host = getHost();
    const run = host.routines?.runForThread(runThreadId);
    if (!run) return undefined;
    const existing = host.store.messagesFor(target)?.findLast?.((message) => message.kind === "routine.run" && message.routineRun?.runId === run.id);
    return routineRunCardRow(host, { ...run, quiet: undefined }, target, report, existing, report);
  };
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
    // #3479: a lasting problem was said by its first run already, unless
    // this run also has new items only the person can do.
    if (reportable && (!run.problemRepeat || attentionFound) && own?.routineRunId === run.id) {
      host.store.patchTask(run.botId, own.threadId, { routineRunId: undefined, ...(reportableUnread ? { unread: true } : {}) });
    }
    return null;
  }
  const source = target;
  const sourceThreadId = source.threadId;
  const existing = host.store.messagesFor(sourceThreadId).find(
    (message) => message.kind === "routine.run" && message.routineRun?.runId === run.id,
  );
  // Never posted and nothing for the person: the chat is left alone.
  if (!existing && !reportable) return sourceThreadId;
  const zone = routineRunZone(host, run);
  // #3479: the same problem as the previous run is said once. The row of the
  // first run with it is updated in place (how many runs, since when): no
  // new row, no unread, no notification. The run stays in the run list.
  // A repeat run with new items only the person can do posts its card and
  // rings as any other run: nothing waiting for the person stays hidden.
  if (!existing && !attentionFound && run.status === "completed" && run.problems && run.problemRepeat) {
    const firstRunId = run.problemRepeat.firstRunId;
    const anchor = host.store.messagesFor(sourceThreadId).findLast?.((message) => message.kind === "routine.run"
      && (message.routineRun?.runId === firstRunId || message.routineRun?.repeat?.firstRunId === firstRunId));
    if (anchor?.routineRun) {
      const repeated = { ...anchor.routineRun, repeat: { ...run.problemRepeat, lastAt: run.finishedAt ?? run.problemRepeat.since } };
      const anchorLanguage = textLanguage(`${anchor.routineRun.summary ?? ""}\n${run.routineName ?? ""}`)
        ?? (run.runAs ? host.languageOfPerson?.(run.runAs) : undefined);
      host.store.patchMessage(sourceThreadId, anchor.id, { text: host.routineRunFallbackText(repeated, anchorLanguage, zone), routineRun: repeated });
      return sourceThreadId;
    }
  }
  const { text, routineRun: card } = routineRunCardRow(host, run, sourceThreadId, host.routineFullReport(run), existing, run.output);
  const statusChanged = existing?.routineRun?.status !== run.status;
  const runBotRecord = host.store.bot(run.botId);
  const attention = attentionFound && runBotRecord && run.threadId
    ? host.attentionCard(runBotRecord, run.threadId, host.store.taskByThread(run.botId, run.threadId) ?? undefined,
      `run:${run.id}`, attentionFound, { id: run.id, routineName: run.routineName }, { ticketUrl: host.attentionTicketUrl })
    : undefined;
  const attentionNew = Boolean(attention && !existing?.attention);
  let cardId: string | undefined = existing?.id;
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
