// @ts-nocheck
/** syncRoutineRunToSource (#1388). Pure move from server/index.ts. */
import { wakeTopicOf } from "../routines/routine-run-card.ts";
import type { RoutineRun } from "../routines/routines.ts";
import { textLanguage } from "../../shared/looks-french.ts";
import { ROUTINE_QUIET_MARKER, isSameProblemLine } from "../routines/routine-report.ts";
import { needsYouNotificationWords } from "../runtime-events/question-notification-words.ts";
import { quietModeLevel, quietRunHadProblems } from "../../shared/quiet-mode.ts";
export type Host = Record<string, any>;

/** #2694: the person's feedback on this run's attention cards (thumbs-down,
 * "less", "never"), read as on the relayed card: muted, quiet or normal. */
export function routineAttentionLevel(host: Host, run: Pick<RoutineRun, "botId" | "webhookId" | "proactive">): "muted" | "quiet" | "normal" {
  // #3480: a bot in quiet mode shows the card, never rings it
  const quiet = host.botQuietMode?.(run.botId) === true;
  // #3423: a chosen watch's alert is what the person asked for; its exits
  // are the person's choice, never an old mute of every watch of the bot
  if (run.proactive?.watches?.length) return quietModeLevel("normal", quiet);
  const level = host.backgroundBriefs?.wakeLevel?.(run.botId, wakeTopicOf(run) ?? "attention");
  return quietModeLevel(level === "muted" || level === "quiet" ? level : "normal", quiet);
}

export function createSyncRoutineRunToSource(getHost: () => Host): any {
function syncRoutineRunToSource(run: RoutineRun): string | null{
  const host = getHost();

  const known = host.routineSourceOwner(run);
  // #3219: the NOTHING_TO_REPORT marker is a status the parser consumes; the
  // run's own thread never shows it raw.
  if (run.status === "completed" && run.threadId) {
    // #3479: the same-problem line in every shape routineReportOutcome reads.
    const isMarker = (line: string) => line.trim() === ROUTINE_QUIET_MARKER || isSameProblemLine(line);
    const last = host.store.messagesFor(run.threadId)?.findLast?.((message) => message.role === "bot" && !message.kind && typeof message.text === "string" && message.text.trim());
    const lines = last?.text ? last.text.split(/\r?\n/) : [];
    if (lines.some(isMarker)) {
      host.store.patchMessage(run.threadId, last.id, { text: lines.filter((line) => !isMarker(line)).join("\n").replace(/\n{3,}/g, "\n\n").trim() });
    }
  }
  // 2026-11-05: a completed report with items only the person can do
  // ([HUMAIN], needs_human, a question) always posts, as a card with them.
  const attentionLevel = run.status === "completed" && !run.quiet ? routineAttentionLevel(host, run) : "normal";
  // #2694: "never" (or votes under the mute line) on these cards: none at all.
  const attentionFound = run.status === "completed" && !run.quiet && attentionLevel !== "muted" ? host.personAttention(host.routineFullReport(run) ?? run.output) : undefined;
  // Thumbs-down or "less": the card still comes, without ringing or unread.
  const attentionRings = attentionLevel === "normal";
  // #3480: a bot in quiet mode posts only what needs the person's answer,
  // and nothing it posts turns the conversation unread
  const quietMode = host.botQuietMode?.(run.botId) === true;
  const reportableRun = { ...run, needsPerson: run.status === "waiting" && host.routineRunNeedsPerson(run), postResults: host.routineEffectivePostResults(run), quietMode };
  const reportable = host.routineRunReportable({ ...reportableRun, attention: Boolean(attentionFound) });
  // A card posted only for quieted attention items: in the chat, never unread.
  const reportableUnread = quietMode ? false : attentionRings ? reportable : host.routineRunReportable({ ...reportableRun, attention: false });
  // What quiet mode kept out of the chat, counted once per run for the line
  // written when it goes off (the run itself stays in its routine's runs).
  if (quietMode && ["completed", "failed", "blocked"].includes(run.status)
    && host.routineRunReportable({ ...reportableRun, quietMode: false, postResults: host.routinePostResultsOwn?.(run) ?? reportableRun.postResults, attention: Boolean(attentionFound) })
    && !reportable) {
    host.keepQuietRun?.(run.botId, run.id, quietRunHadProblems(run));
  }
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
  // #3479: the fallback text gives times in the person's zone, as the card.
  const person = run.runAs ?? host.effectiveRunAs?.({ botId: run.botId });
  const zone = (person && host.isPrincipalId?.(person) ? host.botSettings?.person?.(person)?.timeZone : null) ?? host.routineTimeZone?.();
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
  const fresh = host.routineRunCard(run, sourceThreadId, host.routineFullReport(run));
  // #2694: the person's feedback on a wake stays on its card across updates
  const card = existing?.routineRun?.feedback ? { ...fresh, feedback: existing.routineRun.feedback } : fresh;
  // #3219: the line follows the language the run wrote in, else the person's.
  const language = textLanguage(`${run.output ?? ""}\n${run.routineName ?? ""}`)
    ?? (run.runAs ? host.languageOfPerson?.(run.runAs) : undefined);
  const text = host.routineRunFallbackText(card, language, zone);
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
