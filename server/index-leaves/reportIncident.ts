// @ts-nocheck
/** reportIncident (#1388). Pure move from server/index.ts. */
import { admit } from "../admission.ts";
import { reportBackgroundError } from "../background-error.ts";
import { DATA_DIR } from "../config.ts";
import { deliverableNotification } from "../notify.ts";
import { appendProblem, problemReason } from "../org/org-problem-log.ts";
import { chiefForBot, incidentChip, INCIDENTS_THREAD_TITLE, incidentText } from "../peers/incidents.ts";
import { incidentIsOps } from "../peers/ops-incidents.ts";
import { redactSecretsInText } from "../redact.ts";
import { OPS_INCIDENTS_THREAD_TITLE } from "../../shared/signal-levels.ts";
import { CONFIDENTIAL_INCIDENT_TEXT } from "../threads/confidential-threads.ts";
import { queueSteeredMessage } from "../turns/steer-queue.ts";
export type Host = Record<string, any>;

export function createReportIncident(getHost: () => Host): any {
function reportIncident(input: { kind: IncidentKind; bot: BotRecord; threadId: string; detail: string; routine?: { routineId: string; runAs?: string }; run?: Incident["run"]; title?: string }): void {
  const host = getHost();
  const { bot, threadId } = input;
  const task = host.store.taskByThread(bot.id, threadId);
  // A confidential thread's incident carries no text: no title, request,
  // reply, cause or reason, in the console's problem log or anywhere else,
  // and it reaches the thread's owner only, never a Primary Bot's thread.
  if (task?.confidential === true) {
    void appendProblem(DATA_DIR, {
      kind: input.kind, botId: bot.id, botName: bot.name, ownerPrincipalId: host.effectiveBotOwner(bot) || null, threadId,
      title: null, engine: (task.modelSelection ?? bot.modelSelection)?.instanceId ?? null,
      detail: CONFIDENTIAL_INCIDENT_TEXT
    }).catch(reportBackgroundError);
    if (host.incidentLedger.note(threadId).muted) return;
    if (input.kind === "could-not-start" || input.kind === "routine-failed") return;
    host.notify(deliverableNotification("incident", bot, threadId, CONFIDENTIAL_INCIDENT_TEXT, { avatarUrl: bot.avatarUrl }));
    return;
  }
  // The console's Overview and Incidents (server/org/org-problem-log.ts): every
  // incident, before the delegation and storm rules below decide who hears.
  const failedCause = input.kind === "failed" ? host.latestFailedTurnCause(threadId) : null;
  void appendProblem(DATA_DIR, {
    kind: input.kind, botId: bot.id, botName: bot.name, ownerPrincipalId: host.effectiveBotOwner(bot) || null, threadId,
    // a run names itself: the thread it reported into may be a conversation's
    title: input.title ?? task?.title ?? host.store.groupByThread(threadId)?.name ?? null,
    engine: (task?.modelSelection ?? bot.modelSelection)?.instanceId ?? null,
    ...(input.routine ? { routineId: input.routine.routineId, ...(input.routine.runAs ? { runAsPrincipalId: input.routine.runAs } : {}) } : {}),
    // The reason code may read the turn's last reply (a provider error the
    // engine printed as text, "429 Too Many Requests"); only the cause row
    // or the stop reason is stored, never a message text (decision T7).
    ...(failedCause === null && input.kind === "failed" ? { reason: problemReason("failed", `${input.detail} ${host.incidentContext(threadId).lastReply ?? ""}`) } : {}),
    detail: redactSecretsInText(failedCause ?? input.detail)
  }).catch(reportBackgroundError);
  // #3480: a failed routine of a bot in quiet mode posts nothing and rings
  // nothing: no Primary Bot report (its reply would land unread in the main
  // conversation with a sound). The run keeps its outcome in its routine's
  // runs, the problem log above keeps the incident, and the line written
  // when quiet mode goes off counts it.
  if (input.kind === "routine-failed" && host.botQuietMode?.(bot.id) === true) return;
  // #3480: a failed or stalled background turn of a quiet bot (a wake, a
  // teammate's or an AI client's work: relayViaOf) is the same: no report,
  // no sound. The problem log keeps it and the line written when quiet mode
  // goes off counts it as a run with problems. The person's own
  // conversation still reports as before.
  if ((input.kind === "failed" || input.kind === "stalled") && host.botQuietMode?.(bot.id) === true && host.relayViaOf?.(bot.id, threadId)) {
    const runId = host.routines?.runForThread?.(threadId)?.id ?? `${input.kind}:${threadId}:${Date.now()}`;
    host.keepQuietRun?.(bot.id, runId, true);
    return;
  }
  // A thread another bot opened and is watching is that bot's to handle:
  // the delegator is woken with the failure already (wakeDelegationSource).
  // A thread running coordinated work is its requester's to handle: the
  // runtime reports the failure there (the report hook). Since every turn
  // opens a root, a live root of the thread's own is no longer such work:
  // only an assigner still awaiting it is (upstream a5b2e437fd).
  if (task?.openedBy?.delegationId || host.delegationWatch.has(threadId) || host.coordinator.assignerOf(threadId)) return;
  const group = host.store.groupByThread(threadId);
  const incident: Incident = {
    kind: input.kind,
    bot,
    threadId,
    title: input.title ?? task?.title ?? null,
    room: group?.name ?? null,
    detail: redactSecretsInText(input.detail),
    ...(input.run ? { run: input.run } : {}),
    ...host.incidentContext(threadId)
  };
  const count = host.incidentLedger.note(threadId);
  // a crash loop is one incident, not a storm
  if (count.muted) return;
  // On an organization server the report (title, room, detail, link) goes
  // to a Primary Bot of the bot's own owner only, never the first one found.
  const chief = chiefForBot(host.store.bots, bot, host.IDENTITY.kind === "perspicax" ? (candidate) => host.primaryBotSameOwner(candidate, bot) : undefined);
  // A run that could not start and a failed routine have already buzzed
  // the person (turn-failed, routine-failed) by the time they get here; a
  // failure or stall mid-run has not. One notification per failure, never two.
  const alreadyNotified = input.kind === "could-not-start" || input.kind === "routine-failed";
  const tellThePerson = () => {
    if (alreadyNotified) return;
    host.notify(deliverableNotification("incident", bot, threadId, incidentChip(incident), {
      avatarUrl: bot.avatarUrl,
      ...(group ? { group: { id: group.id, name: group.name } } : {})
    }));
  };
  // no Primary Bot on duty, or the Primary Bot itself broke: the person is next
  if (!chief) {
    tellThePerson();
    return;
  }
  // #2695: engine and provider noise is an ops incident: one line in the
  // Primary Bot's "Ops incidents" thread, no chief turn, no push. "Team
  // incidents" keeps what needs a decision.
  if (incidentIsOps(input.kind, `${input.detail} ${incident.lastReply ?? ""}`)) {
    const ops = host.store.tasks(chief.id).find((candidate) => candidate.title === OPS_INCIDENTS_THREAD_TITLE && !candidate.archivedAt)
      ?? host.store.createTask(chief.id, OPS_INCIDENTS_THREAD_TITLE, false, undefined, { botId: chief.id, name: chief.name, at: Date.now() });
    if (ops && ops.threadId !== threadId) {
      host.store.appendMessage(ops.threadId, {
        role: "bot",
        kind: "activity",
        tool: { name: incidentChip(incident), ok: false },
        threadRef: { botId: bot.id, threadId, title: task?.title ?? (group ? group.name : `${bot.name}'s conversation`) }
      });
    }
    return;
  }
  const incidents = host.store.tasks(chief.id).find((candidate) => candidate.title === INCIDENTS_THREAD_TITLE && !candidate.archivedAt)
    ?? host.store.createTask(chief.id, INCIDENTS_THREAD_TITLE, false, undefined, { botId: chief.id, name: chief.name, at: Date.now() });
  if (!incidents || incidents.threadId === threadId) {
    tellThePerson();
    return;
  }
  host.store.appendMessage(incidents.threadId, {
    role: "bot",
    kind: "activity",
    tool: { name: incidentChip(incident), ok: false },
    threadRef: { botId: bot.id, threadId, title: task?.title ?? (group ? group.name : `${bot.name}'s conversation`) }
  });
  const text = incidentText(incident, count);
  // the report carries the broken bot's name as its provenance: it is about
  // that bot's work and nobody was at the keyboard; `incident` marks it as
  // the harness's report about that thread (turnAnswers, incidentRefused)
  const peerAsk = { botId: bot.id, name: bot.name, unattended: true,
    incident: { threadId, ...(alreadyNotified ? { notified: true } : {}) } };
  // The incidents thread is reused, so the previous report may still be
  // running there: this one waits in that thread's queue and drains when
  // the Chief is free — with any others that waited — never refused.
  const decision = admit("incident", {}, {
    threadBusy: host.threadBusy(chief.id, incidents.threadId),
    atCapacity: host.botAtThreadCapacity(chief.id),
    groupTurn: Boolean(host.activeGroupTurnForBot(chief.id))
  });
  if (decision.action === "queue") {
    queueSteeredMessage(chief.id, incidents.threadId, text, { reason: decision.reason, unattended: true, peerAsk });
    return;
  }
  void host.startTurn(chief.id, text, { threadId: incidents.threadId, unattended: true, peerAsk }).catch((error) => {
    host.incidentRefused(chief, incidents.threadId, [peerAsk], error instanceof Error ? error.message : String(error));
  });
}
  return reportIncident;
}
