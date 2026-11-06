// @ts-nocheck
/** Preamble for the main runtime bus subscriber (#1388). Pure move. */
export function runRuntimeEventPreamble(event: any, host: any): any | null {
  if (host.shouldIgnoreProviderEvent(event)) return;
  const localVmTarget = host.localVmThreadTargets.get(event.threadId);
  if (localVmTarget) {
    host.localVmLeaseFor(localVmTarget).touch(event.threadId);
    host.localVmIdleFor(localVmTarget).touch();
  }
  if (event.type === "turn.completed" && !host.store.botByThread(event.threadId)) {
    host.releaseLocalVmThread(event.threadId);
  }
  const coordinatorTurnsForThread = host.groupGoalCoordinatorTurns.get(event.threadId);
  const ambiguousCoordinatorText = !event.turnId && (coordinatorTurnsForThread?.size ?? 0) > 1;
  const goalCoordinatorTurn = host.groupGoalCoordinatorTurnForEvent(event);
  const completedTurnId = event.type === "turn.completed"
    ? groupGoalCompletionTurnId(event.turnId, goalCoordinatorTurn?.turnId)
    : event.turnId;
  if (goalCoordinatorTurn?.discard && host.retiredProviderTurns.has(event.turnId)) {
    host.removeGroupGoalCoordinatorTurn(event.threadId, goalCoordinatorTurn);
    return;
  }
  // Buffer every coordinator text item for the whole provider turn. A model
  // can split the private envelope across assistant items (or emit multiple
  // envelopes), so sanitizing item-by-item can leak protocol into the chat.
  if (
    event.type === "item.completed" &&
    event.itemType === "assistant_text" &&
    (goalCoordinatorTurn || ambiguousCoordinatorText)
  ) {
    if (goalCoordinatorTurn && !goalCoordinatorTurn.discard) goalCoordinatorTurn.assistantItems.push(event.text);
    return;
  }
  // Goal coordinators speak a private control envelope. Their incidental
  // artifacts are private too; never leak one into the public room.
  if (
    event.type === "item.completed" &&
    event.itemType === "assistant_image" &&
    (goalCoordinatorTurn || ambiguousCoordinatorText)
  ) return;
  if (
    event.type === "content.delta" &&
    event.streamKind === "assistant_text" &&
    (goalCoordinatorTurn || ambiguousCoordinatorText)
  ) return;
  const coordinatorVisibleText = goalCoordinatorTurn && !goalCoordinatorTurn.discard && event.type === "turn.completed"
    ? parseGroupGoalDecision(goalCoordinatorTurn.assistantItems.join("\n")).visibleText
    : "";
  if (goalCoordinatorTurn && event.type === "turn.completed") {
    host.removeGroupGoalCoordinatorTurn(event.threadId, goalCoordinatorTurn);
  }
  if (coordinatorVisibleText) {
    const publicAssistantEvent: RuntimeEvent = {
      ...event,
      eventId: `${event.eventId}-goal-text`,
      type: "item.completed",
      itemType: "assistant_text",
      text: coordinatorVisibleText
    };
    host.broadcast({ kind: "runtime", event: publicAssistantEvent });
  }
  const staleOwner = host.directRequestOwners.get(event.threadId);
  const staleAssistant = isStaleAssistantOutput({
    eventTurnId: event.turnId,
    cancelledTurnIds: host.cancelledVoiceTurns.get(event.threadId),
    // the owner fence is for voice call turns only (see voiceCall above)
    ...(staleOwner?.voiceCall ? { ownerStopped: staleOwner.stopped, ownerTurnId: staleOwner.turnId } : {})
  });
  if (event.type === "content.delta" && event.streamKind === "assistant_text") {
    if (!staleAssistant) {
      host.voiceLatency.mark(event.threadId, "firstToken");
      noteFirstResponse(event.threadId);
    }
  } else if (event.type === "item.completed" && event.itemType === "assistant_text") {
    if (!staleAssistant) noteFirstResponse(event.threadId);
  } else if (event.type === "turn.completed") host.voiceLatency.settled(event.threadId);
  const privateImageEvent = event.type === "item.completed" && event.itemType === "assistant_image";
  // The durable message patch below is the public frame. Sending raw base64
  // through runtime SSE would multiply large bytes across every app window.
  if (!privateImageEvent && !dropCancelledVoiceEvent(staleAssistant, event)) {
    // Exact executable input is internal matching metadata, not inspector UI.
    // The event bus's persistence redactor does not scrub its live event.
    const publicEvent = event.type === "request.opened" ? { ...event, command: undefined } : host.withoutPrivateFields(event);
    host.broadcast({ kind: "runtime", event: publicEvent });
    // A relayed teammate reply (coordinate_bots relay) streams in the
    // requester's conversation too; only its visible text, never reasoning.
    // It waits for the requester's own turn to end (its "I asked …" line runs
    // beside the teammate), then sends what it held as one delta.
    // Redacted as a whole, and the last word held back until it ends, so a
    // secret split across deltas never streams; a redaction that changes
    // what was already sent stops the mirror (the bubble still comes).
    const relay = event.type === "content.delta" && event.streamKind === "assistant_text" ? host.relayStreams.get(event.threadId) : undefined;
    if (relay && !relay.stopped && event.type === "content.delta") {
      relay.full += event.delta;
      const redacted = host.redactSecretsInText(relay.full);
      const cut = Math.max(redacted.lastIndexOf(" "), redacted.lastIndexOf("\n")) + 1;
      const ready = redacted.slice(0, cut);
      if (!ready.startsWith(relay.sent)) {
        relay.stopped = true;
        if (relay.shown) host.clearRelayedStream(relay.to);
        host.relayShown.delete(relay.to);
      } else if (ready.length > relay.sent.length && !host.liveTurnByThread.has(relay.to)) {
        host.broadcast({ kind: "runtime", event: { ...publicEvent, threadId: relay.to, eventId: `${event.eventId}-relay`, delta: ready.slice(relay.sent.length) } as RuntimeEvent });
        relay.sent = ready;
        relay.shown = true;
        host.relayShown.add(relay.to);
      }
    }
  }
  // #1984: recover a final confirmation before the routine manager settles
  // the run or the MCP wait observes completion. Output supplies a question,
  // never a grant: its answer still goes through every ordinary write gate.
  // Existing tool cards keep their own identity, choices and lifecycle.
  if (event.type === "turn.completed") {
    const threadBot = host.store.botByThread(event.threadId);
    const task = threadBot && host.store.taskByThread(threadBot.id, event.threadId);
    const request = host.directRequestOwners.get(event.threadId);
    const personLine = request?.messageId
      ? host.store.messagesFor(event.threadId).find((line) => line.id === request.messageId)
      : host.lastPersonMessage(event.threadId);
    const text = host.lastReply.get(event.threadId) ?? "";
    const confirmation = host.finalConfirmation({
      text,
      routineRun: host.routineRunThread(event.threadId),
      mcpStarted: host.isAgentConversation(task) || host.notificationInHiddenThread(event.threadId) || personLine?.aiClient === true,
      ok: event.ok,
      stopped: host.stoppedTurns.has(event.threadId) || request?.stopped === true || event.stopReason === "interrupted" || event.stopReason === "cancelled",
      hasCard: Boolean(host.openPersonCard(event.threadId)),
    });
    if (confirmation && threadBot && task && !host.store.groupByThread(event.threadId)) {
      host.raiseHarnessQuestion(event.threadId, {
        title: "Your bot has a question", question: confirmation,
        options: host.finalConfirmationOptions(host.languageOfPerson(task.ownerPrincipalId ?? host.recordedBotOwner(threadBot))),
      }, "output");
    }
  }
  const routineRun = privateImageEvent ? null : (host.routines?.handleRuntimeEvent(event) ?? null);
  const ownerBot = host.store.botByThread(event.threadId);
  const bot = ownerBot ? host.botForThread(ownerBot.id, event.threadId) ?? undefined : undefined;
  const group = bot ? undefined : host.store.groupByThread(event.threadId);
  if (!bot && !group) return;
  const speaker = group ? host.groupSpeakers.get(event.threadId) : undefined;

  const pushMessage = (m: Omit<Message, "id" | "at">) => {
    const owner = bot ? host.directRequestOwners.get(event.threadId) : undefined;
    const proven = owner?.messageId && !owner.stopped && owner.generation === host.directTurnGenerationByThread.get(event.threadId) &&
      owner.turnId && (!event.turnId || event.turnId === owner.turnId);
    // One line per routed reply: the routed speaker's first text of its turn.
    const routed = group && m.role === "bot" && m.kind === "text" ? host.routedRoomReplies.get(event.threadId) : undefined;
    const routedBy = routed && speaker && routed.botId === speaker.botId ? routed.routedBy : undefined;
    if (routedBy) host.routedRoomReplies.delete(event.threadId);
    // The quote chip above a 1:1 reply: which of the person's messages it
    // answers, when that is worth showing (server/turns/reply-to-turn.ts).
    const quoteId = proven && !group && m.role === "bot" && m.kind === "text" && !m.replyToId
      ? host.botReplyQuoteId(host.store.messagesFor(event.threadId), owner?.messageId)
      : undefined;
    const message = host.store.appendMessage(event.threadId, group && m.role === "bot" ? { ...m, from: speaker, ...(routedBy ? { routedBy } : {}) }
      : proven ? { ...m, requestMessageId: owner.messageId, ...(quoteId ? { replyToId: quoteId } : {}) } : m);
    return message;
  };
  // A client abort sometimes arrives as assistant text or as runtime.error.
  // That is a stop, not a failure: store one stopped row, drop any text the
  // turn said before it, so neither the digest nor a finished notification
  // reads a half reply, and mark the turn stopped for turn.completed.
  // One turn can emit both; the second copy is the same stop.
  const pushStoppedTurn = (turnId: string | undefined) => {
    host.lastReply.delete(event.threadId);
    host.stoppedTurns.set(event.threadId, turnId ?? host.liveTurnByThread.get(event.threadId));
    // one line per stop: a typed stop may have confirmed it already
    if (host.stoppedRowSinceLastPerson(event.threadId, turnId)) return;
    pushMessage({ role: "bot", kind: "activity", tool: { name: host.STOPPED_TURN_NAME, ok: true }, turnId });
  };
  const pushAssistantText = (text: string, turnId: string | undefined) => {
    const spoken = host.assistantTranscript(text);
    if (spoken.kind === "stopped") {
      pushStoppedTurn(turnId);
      return;
    }
    // #1372: a 1:1 goal's marker is read, then taken out of what is shown.
    const goalSettled = bot ? host.soloGoals.noteReply(event.threadId, spoken.text) : null;
    spoken.text = withoutSoloGoalMarker(spoken.text);
    if (goalSettled) host.appendSoloGoalRow(event.threadId, soloGoalLine(goalSettled), turnId);
    // #1329: the condition's marker is read, then taken out of what is shown.
    if (bot) host.finishUntilRuns.noteReply(event.threadId, spoken.text);
    spoken.text = withoutFinishUntilMarker(spoken.text);
    if (!spoken.text.trim()) return;
    spoken.text = host.citeAppFigures(host.dashFreeReply(spoken.text, event.threadId, bot), host.appPiecesByThread.get(event.threadId) ?? []);
    // "👍" written after reacting 👍 says the same thing twice: the
    // reaction stands alone and no bubble is written.
    const reactor = bot?.id ?? speaker?.botId;
    if (reactor && host.echoesOwnReaction(event.threadId, reactor, spoken.text)) return;
    // The same words again in the same turn (a model that says "Let me
    // check" before every step): one bubble, not one per step.
    if (host.turnReplyRepeats.repeated(event.threadId, turnId, spoken.text)) return;
    const roomRan = !bot && speaker ? host.roomTurnRuns.get(event.threadId) : undefined;
    const ran = bot ? host.turnRunByThread.get(event.threadId) : roomRan && roomRan.botId === speaker?.botId ? roomRan.run : undefined;
    pushMessage({ role: "bot", kind: "text", text: spoken.text, turnId, ...(ran ? { turnRun: ran } : {}) });
    host.lastReply.set(event.threadId, spoken.text);
  };

  if (coordinatorVisibleText) pushAssistantText(coordinatorVisibleText, completedTurnId);
  if (bot) host.handoffs.onEvent(event);
  // The in-memory handoff / unseen path owns what a completed turn carried.
  // Clear the durable held journal for this thread so a later crash does not
  // start a second follow-up for words the session already settled.
  if (bot && event.type === "turn.completed") {
    try { clearHeldSteersForThread(DATA_DIR, event.threadId); } catch (error) {
      console.warn(`held-steers: could not clear completed turn: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (event.turnId) host.liveTurnByThread.set(event.threadId, event.turnId);
  const requestOwner = bot ? host.directRequestOwners.get(event.threadId) : undefined;
  if (requestOwner && event.turnId && !requestOwner.turnId && event.type === "turn.started" &&
      host.directTurnDispatchClaims.get(event.threadId)?.id === requestOwner.generation) requestOwner.turnId = event.turnId;
  const liveTurnId = event.turnId ?? host.liveTurnByThread.get(event.threadId);
  return {
    bot, group, speaker, pushMessage, pushStoppedTurn, pushAssistantText, routineRun, privateImageEvent, staleAssistant, requestOwner, completedTurnId, goalCoordinatorTurn, ownerBot, coordinatorVisibleText, ambiguousCoordinatorText, liveTurnId,
  };
}
