// @ts-nocheck
/** startGroupTurn (#1388). Pure move from server/index.ts. */
import { reportBackgroundError } from "../background-error.ts";
import { llmThreadTitlesEnabled } from "../config.ts";
import { deciderReady } from "../decider/index.ts";
import { decideRoomResponder } from "../decider/room-routing.ts";
import { selectGroupGoalCoordinator, GROUP_GOAL_MAX_TURNS } from "../groups/group-goal-run.ts";
import { workOrigin } from "../peers/peer-provenance.ts";
import { stopWordPlacement } from "../room-holds.ts";
import { roomTurnNarrationIds } from "../room-reply.ts";
import { mentionedBots, roomResponders } from "../store.ts";
import { extractTurnImages } from "../turns/turn-images.ts";
import { channelTurnGate } from "../workers.ts";
import { randomUUID } from "node:crypto";
export type Host = Record<string, any>;

export function createStartGroupTurn(getHost: () => Host): any {
function startGroupTurn(
  groupId: string,
  text: string,
  replyTo?: Message,
  sendId?: string,
  channelMode: "chat" | "goal" = "chat",
  queueId?: string,
  options: StartGroupTurnOptions = {},
) {
  const host = getHost();
  const group = host.store.group(groupId);
  if (!group) throw Object.assign(new Error("no such group"), { status: 404 });
  // Capture the chosen thread once. Manual sends use the active task; a
  // scheduled team goal supplies its detached background task explicitly.
  const threadId = options.threadId ?? group.threadId;
  const ownsThread = group.dm
    ? group.threadId === threadId
    : Boolean(host.store.groupTaskByThread(group.id, threadId));
  if (!ownsThread) {
    throw Object.assign(new Error("no such room task"), { status: 404 });
  }
  const members = group.memberIds
    .map((id) => host.store.bot(id))
    .filter((bot): bot is NonNullable<typeof bot> => Boolean(bot));
  const availableMembers = members.filter((member) => !member.hidden);
  // Members the person stopped ("stop @Bot") take no turn from any route
  // until they are @mentioned again or resumed (room-holds.ts).
  const isHeld = (member: { id: string }) => host.roomHeld(group, member.id);
  const routableMembers = availableMembers.filter((member) => !isHeld(member));
  const requestedGoalCoordinator = options.goalCoordinatorBotId
    ? availableMembers.find((member) => member.id === options.goalCoordinatorBotId)
    : undefined;
  if (options.goalCoordinatorBotId && (channelMode !== "goal" || !requestedGoalCoordinator)) {
    throw Object.assign(new Error("the selected goal coordinator is not an active room member"), { status: 409 });
  }
  // An Auto room may ask the decision model who answers. It reads the room
  // as it stood before this message, which is appended just below.
  const autoCandidate = !group.dm && channelMode === "chat" && group.defaultResponder.kind === "auto" &&
    deciderReady(host.cfg, "roomRouting");
  const historyBeforeSend = autoCandidate
    ? (() => {
        const before = host.store.messagesFor(threadId);
        const narration = roomTurnNarrationIds(before);
        return before.filter((m) => m.kind === "text" && m.text && !narration.has(m.id)).slice(-host.GROUP_CONTEXT_MESSAGES);
      })()
    : [];
  // A coalesced drain appends every queued line under its own queueId (the
  // chips and sendId receipts stay per-item); the LAST line is the turn's
  // user message, exactly like the 1:1 drain's userMessage.
  const queuedGroup = options.queuedGroup;
  const message = queuedGroup && queuedGroup.length > 0
    ? (() => {
        for (const item of queuedGroup.slice(0, -1)) {
          host.store.appendMessage(threadId, {
            role: "user",
            kind: "text",
            text: item.text,
            replyToId: item.replyToId,
            sendId: item.sendId,
            channelMode: item.mode,
            queueId: item.id,
            via: item.via,
            sender: item.sender
          });
        }
        const last = queuedGroup[queuedGroup.length - 1]!;
        return host.store.appendMessage(threadId, {
          role: "user",
          kind: "text",
          text: last.text,
          replyToId: replyTo?.id,
          sendId: last.sendId,
          channelMode: last.mode,
          queueId: last.id,
          via: last.via,
          sender: last.sender
        });
      })()
    : host.store.appendMessage(threadId, {
        role: "user",
        kind: "text",
        text,
        replyToId: replyTo?.id,
        sendId,
        channelMode,
        queueId,
        via: options.via,
        sender: options.sender
      });
  // Admitted (see startTurn): the room's speakers are booked to this sender.
  if (options.trigger) host.turnTriggers.set(threadId, options.trigger);
  const titled = group.dm ? null : host.store.titleGroupTaskFromFirstMessage(group.id, text, threadId);
  const snippet = titled?.title;

  const archived = members.filter((member) => member.hidden);
  const mentionedArchived = mentionedBots(text, archived.map(({ name }) => ({ name })))[0];
  if (mentionedArchived) {
    host.store.appendMessage(threadId, {
      role: "bot",
      kind: "activity",
      tool: {
        name: `${mentionedArchived.name} is archived and can't respond — restore it or mention an active room member.`,
        ok: false
      }
    });
  }
  let responders = roomResponders(text, members, group.defaultResponder);
  // An engine command reaches one bot only: the one it starts by naming,
  // else the lead (never everyone named in its arguments). Only a name that
  // bot's engine lists is one; any other `/word` is routed like any message.
  const commandRoute = options.commandRoute !== undefined
    ? options.commandRoute
    : host.cachedGroupEngineCommandRoute(group, threadId, text, availableMembers, channelMode, queuedGroup?.length ?? 0, options.sender?.id ? { origin: "person", principalId: options.sender.id } : { origin: "operator" });
  if (commandRoute) responders = availableMembers.filter((member) => member.id === commandRoute.botId);
  // A held member is passed over whoever chose it — its @mention, the lead,
  // everyone — and the room says so once; what addressed it is kept for its
  // next turn.
  if (!group.dm) {
    // The "stop @Bot" line itself is not something to show the bot later.
    const addressed = stopWordPlacement(text) === "adjacent" ? undefined : message.id;
    for (const held of responders.filter(isHeld)) host.noteHeldSkip(group.id, threadId, held, addressed);
    responders = responders.filter((responder) => !isHeld(responder));
  }
  const explicitlyMentionedLead = roomResponders(text, routableMembers, { kind: "mentions" })[0];
  const goalCoordinator = channelMode === "goal"
    ? requestedGoalCoordinator ?? explicitlyMentionedLead ?? selectGroupGoalCoordinator(routableMembers, group.defaultResponder)
    : null;
  // bot⇄bot channels: chipping in without a tag addresses the last speaker
  if (!responders.length && group.dm) {
    const lastSpeakerId = [...host.store.messagesFor(threadId)]
      .reverse()
      .find((msg) => msg.kind === "text" && msg.from)?.from?.botId;
    const last = availableMembers.find((b) => b.id === lastSpeakerId) ?? availableMembers[0];
    responders = last ? [last] : [];
  }
  // Auto with nobody addressed: the responders above are only the fallback
  // until the decision model answers, in the async round below. The append
  // and this function's return stay synchronous either way. It picks among
  // the members who are not held; a held fallback leaves the round to it.
  const autoRoute = autoCandidate && !goalCoordinator && !commandRoute && routableMembers.length > 1 &&
    roomResponders(text, availableMembers, { kind: "mentions" }).length === 0;

  if (!responders.length && !goalCoordinator && !autoRoute) {
    const defaultArchivedId = group.defaultResponder.kind === "member" ? group.defaultResponder.botId : undefined;
    const defaultArchived = archived.find((member) => member.id === defaultArchivedId);
    let unavailableMessage: string | undefined;
    // A people-only room has no bot to wait for: nothing to say.
    if (!mentionedArchived && !availableMembers.length && members.length) {
      unavailableMessage = "No active room members can respond — restore an archived bot or add an active member.";
    } else if (!mentionedArchived && defaultArchived) {
      unavailableMessage = `${defaultArchived.name} is archived and can't respond — restore it or mention an active room member.`;
    }
    if (unavailableMessage) {
      host.store.appendMessage(threadId, {
        role: "bot",
        kind: "activity",
        tool: { name: unavailableMessage, ok: false }
      });
    }
    return message;
  }

  // Machine turns never run on this host. Offline stays queued for that
  // device. Online does not mean the fleet runner starts it.
  const speakers = goalCoordinator ? [goalCoordinator] : responders;
  const gate = channelTurnGate({
    bots: speakers.map((bot) => ({ id: bot.id, host: bot.host })),
    workers: host.registeredWorkers,
    messageId: message.id,
    authorId: options.sender?.id ?? host.localPrincipalId(),
    queued: host.queuedWorkerTurns
  });
  host.replaceQueuedWorkerTurns(gate.queued);
  if (gate.status === "machine-offline") {
    host.store.appendMessage(threadId, {
      role: "bot",
      kind: "activity",
      tool: { name: host.MACHINE_OFFLINE_NOTE, ok: false }
    });
  }
  if (goalCoordinator) {
    if (!gate.fleetIds.includes(goalCoordinator.id)) return message;
  } else {
    responders = responders.filter((bot) => gate.fleetIds.includes(bot.id));
    if (!responders.length) return message;
  }

  // The snippet is only the fallback name here too. The member about to
  // answer supplies the same cheap one-shot the bot path uses, and the
  // swap lands only while the row still carries the snippet — a rename by
  // the person always wins. Channel tasks carry no peer provenance (no
  // assignment opens them), and a member whose engine offers no text
  // one-shot simply keeps the snippet.
  const titleText = extractTurnImages(text).text;
  const startTitle = (titleBot: (typeof members)[number]) => {
    const titleInstance = host.registry.get(titleBot.modelSelection.instanceId);
    // An engine the organisation disallows never receives the text, even for a title.
    if (titled && snippet && titleText.trim() && host.personalFeatureOn("llmThreadTitles", llmThreadTitlesEnabled(host.cfg), host.vaultPrincipalForThread(threadId)) && titleInstance?.generateText && !host.policyModelRefusal(titleInstance)) {
      void host.generateThreadTitle(host.botTitleEngine(titleBot, titleInstance), titleText)
        .then((title) => {
          if (title) host.store.retitleGroupTask(group.id, threadId, snippet, title);
        })
        .catch(() => undefined);
    }
  };
  // An Auto round titles with whoever the decision picks, once it has.
  if (!autoRoute) startTitle(goalCoordinator ?? responders[0]!);

  const operation = host.beginGroupTurnOperation(
    groupId,
    threadId,
    goalCoordinator || autoRoute ? [] : responders.map((responder) => responder.id),
  );
  if ((options.trigger?.kind === "user" || options.trigger?.kind === "owner") && workOrigin(message).kind === "user") {
    operation.humanRequestMessageId = message.id;
  }
  // Asked now, in parallel with any earlier room work still queued: the
  // answer is waited for only when this round's turn comes up. It never
  // rejects; a Stop aborts it through the operation's signal.
  const routing = autoRoute
    ? decideRoomResponder(host.decider, host.roomRoutingInput(group.name, text, availableMembers, historyBeforeSend, options.sender), {
        signal: operation.cancellation.signal
      })
    : null;
  if (queuedGroup && queuedGroup.length > 0) {
    // member turns use these stable ids to carry every burst line's words
    // and attachments through the turn that swallowed the burst
    operation.queuedQueueIds = queuedGroup.map((item) => item.id);
  }
  if (goalCoordinator) {
    const runId = options.goalRunId?.trim() || `goal-${Date.now().toString(36)}-${randomUUID()}`;
    const startedAt = Date.now();
    const detail = `${goalCoordinator.name} is coordinating this goal.`;
    const card = host.store.appendMessage(threadId, {
      role: "bot",
      kind: "goal.run",
      text: `Goal in progress: ${detail}`,
      from: { botId: goalCoordinator.id, name: goalCoordinator.name, color: goalCoordinator.color },
      goalRun: {
        runId,
        goal: text,
        status: "working",
        coordinatorBotId: goalCoordinator.id,
        coordinatorName: goalCoordinator.name,
        turnCount: 0,
        maxTurns: GROUP_GOAL_MAX_TURNS,
        detail,
        startedAt
      }
    });
    operation.goalRun = {
      runId,
      cardMessageId: card.id,
      goal: text,
      coordinatorBotId: goalCoordinator.id,
      coordinatorName: goalCoordinator.name,
      turnCount: 0,
      maxTurns: GROUP_GOAL_MAX_TURNS,
      startedAt,
      finished: false
    };
  }
  const prev = host.groupQueues.get(threadId) ?? Promise.resolve();
  const next = prev.then(async () => {
    if (operation.cancelled) return;
    const speaker = host.groupSpeakers.get(threadId);
    if (speaker) {
      const owner = host.store.bot(speaker.botId);
      host.store.appendMessage(threadId, {
        role: "bot",
        kind: "activity",
        tool: { name: `${owner?.name ?? "A room member"} is still stopping — this message was not dispatched`, ok: false }
      });
      return;
    }
    if (goalCoordinator) {
      await host.runGroupGoalOperation({ groupId, threadId, coordinator: goalCoordinator, members, operation });
    } else {
      let round = responders;
      let routedBy: RoutedBy | undefined;
      if (routing) {
        const route = await routing;
        if (operation.cancelled) return;
        const picked = route.kind === "member" ? routableMembers.filter((member) => member.id === route.botId)
          : route.kind === "everyone" ? routableMembers
            : [];
        if (picked.length && route.kind !== "fallback") {
          round = picked;
          routedBy = { provider: "jev", probability: Math.round(route.probability * 100) / 100 };
        }
        // What a routed round holds from the start, like any other round.
        for (const responder of round) operation.botIds.add(responder.id);
        if (round[0]) startTitle(round[0]);
      }
      const spoken = new Set<string>();
      const skillAuthoringClaim = { claimed: false };
      for (const responder of round) {
        if (operation.cancelled) break;
        if (spoken.has(responder.id)) continue;
        // A responder busy in another conversation takes its turn when it
        // frees (the host wakes each member in turn) — never skipped, only
        // bounded. Stop ends the round; a member the cap gave up on, or one
        // that vanished meanwhile, is passed over for this round only.
        const verdict = await host.waitForChatRoomMember(operation, threadId, responder);
        if (verdict === "stop") break;
        if (verdict === "skip") {
          spoken.add(responder.id);
          continue;
        }
        // This speaker's first reply line says the decision model chose it.
        const stamp = routedBy ? { botId: responder.id, routedBy } : undefined;
        if (stamp) host.routedRoomReplies.set(threadId, stamp);
        let proceed: boolean;
        try {
          proceed = await host.runGroupMemberTurn(
            groupId,
            threadId,
            responder.id,
            0,
            spoken,
            undefined,
            undefined,
            () => operation.cancelled,
            () => host.groupProviderHandshakeStarted(operation),
            () => host.groupProviderHandshakeSettled(operation),
            skillAuthoringClaim,
            undefined,
            operation,
          );
        } finally {
          if (stamp && host.routedRoomReplies.get(threadId) === stamp) host.routedRoomReplies.delete(threadId);
        }
        if (!proceed) break;
      }
    }
  });
  const tracked = next.finally(() => host.finishGroupTurnOperation(groupId, operation));
  host.groupQueues.set(threadId, tracked.catch(reportBackgroundError));
  return message;
}
  return startGroupTurn;
}
