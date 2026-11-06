// @ts-nocheck
/** reportIncident (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createReportIncident(getHost: () => Host): any {
function reportIncident(input: { kind: IncidentKind; bot: BotRecord; threadId: string; detail: string; routine?: { routineId: string; runAs?: string }; run?: Incident["run"]; title?: string }) {
  const host = getHost();
  const { DATA_DIR, deliverableNotification, queueSteeredMessage } = host;
  const { bot, threadId } = input;
  const task = host.store.taskByThread(bot.id, threadId);
  // A confidential thread's incident carries no text: no title, request,
  // reply, cause or reason, in the console's problem log or anywhere else,
  // and it reaches the thread's owner only, never a Primary Bot's thread.
  if (task?.confidential === true) {
    void host.appendProblem(DATA_DIR, {
      kind: input.kind, botId: bot.id, botName: bot.name, ownerPrincipalId: host.effectiveBotOwner(bot) || null, threadId,
      title: null, engine: (task.modelSelection ?? bot.modelSelection)?.instanceId ?? null,
      detail: host.CONFIDENTIAL_INCIDENT_TEXT
    });
    if (host.incidentLedger.note(threadId).muted) return;
    if (input.kind === "could-not-start" || input.kind === "routine-failed") return;
    host.notify(deliverableNotification("incident", bot, threadId, host.CONFIDENTIAL_INCIDENT_TEXT, { avatarUrl: bot.avatarUrl }));
    return;
  }
  // The console's Overview and Incidents (server/org/org-problem-log.ts): every
  // incident, before the delegation and storm rules below decide who hears.
  const failedCause = input.kind === "failed" ? host.latestFailedTurnCause(threadId) : null;
  void host.appendProblem(DATA_DIR, {
    kind: input.kind, botId: bot.id, botName: bot.name, ownerPrincipalId: host.effectiveBotOwner(bot) || null, threadId,
    // a run names itself: the thread it reported into may be a conversation's
    title: input.title ?? task?.title ?? host.store.groupByThread(threadId)?.name ?? null,
    engine: (task?.modelSelection ?? bot.modelSelection)?.instanceId ?? null,
    ...(input.routine ? { routineId: input.routine.routineId, ...(input.routine.runAs ? { runAsPrincipalId: input.routine.runAs } : {}) } : {}),
    // The reason code may read the turn's last reply (a provider error the
    // engine printed as text, "429 Too Many Requests"); only the cause row
    // or the stop reason is stored, never a message text (decision T7).
    ...(failedCause === null && input.kind === "failed" ? { reason: problemReason("failed", `${input.detail} ${host.incidentContext(threadId).lastReply ?? ""}`) } : {}),
    detail: host.redactSecretsInText(failedCause ?? input.detail)
  });
  // A thread another bot opened and is watching is that bot's to handle:
  // the delegator is woken with the failure already (wakeDelegationSource).
  if (task?.openedBy?.delegationId || host.delegationWatch.has(threadId) || host.coordinator.activeDirect(threadId)) return;
  const group = host.store.groupByThread(threadId);
  const incident: Incident = {
    kind: input.kind,
    bot,
    threadId,
    title: input.title ?? task?.title ?? null,
    room: group?.name ?? null,
    detail: host.redactSecretsInText(input.detail),
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
  const decision = host.admit("incident", {}, {
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
