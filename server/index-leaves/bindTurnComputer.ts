// @ts-nocheck
/** bindTurnComputer (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createBindTurnComputer(getHost: () => Host): any {
async function bindTurnComputer(owner: TurnOwner, resource: string, exclusive = false) {
  const host = getHost();
  const { newId } = host;

  // Every computer claim passes here: a kind the organisation disallows, or a
  // Cloud home never offers, is refused at claim time, whichever path selected it.
  const kind = computerKindForResource(resource), refusal = kind && host.computerPlaceRefusal(kind);
  if (refusal) throw Object.assign(new Error(refusal.message), { code: refusal.code });
  const active = () => host.activeInternalGenerationByThread.get(owner.threadId) === owner.generation &&
    host.turnResourceOwners.get(owner.threadId)?.generation === owner.generation;
  let waitingMessage: Message | undefined;
  // Who holds the desktop, as the chip and the give-up error name them: a
  // bot running a titled thread, or a room. Read once, when the wait begins.
  let holder: ComputerHolder | undefined;
  let holderThreadRef: { botId: string; threadId: string; title: string } | undefined;
  const deadline = Date.now() + host.COMPUTER_WAIT_MAX_MS;
  // The wait is history the transcript keeps (#1647): the waiting chip stays
  // exactly as written, a resolution line is appended beside it, and the
  // turn.wait_* events carry the same facts for the inspector log.
  let waitedSince: number | undefined;
  let waitEnded = false;
  const waitEventBase = () => {
    const selection = host.store.botByThread(owner.threadId)?.modelSelection;
    const instance = selection ? host.registry.get(selection.instanceId) : null;
    return {
      eventId: newId(),
      provider: instance?.driverKind ?? "harness",
      ...(instance && selection ? { providerInstanceId: selection.instanceId } : {}),
      threadId: owner.threadId,
      createdAt: new Date().toISOString()
    };
  };
  const endWait = (outcome: "acquired" | "parked" | "stopped") => {
    if (!waitingMessage || waitEnded) return;
    waitEnded = true;
    const waitedMs = waitedSince === undefined ? 0 : Date.now() - waitedSince;
    // Acquisition is the only wait that completes: it is the sample the
    // per-resource estimate is built from (#1652).
    if (outcome === "acquired") host.turnResources.noteWait(resource, waitedMs);
    const text = outcome === "acquired"
      ? computerFreeAfterText(holder, waitedMs)
      : outcome === "parked"
        ? computerParkedText(holder, host.COMPUTER_WAIT_MAX_MS)
        : computerStoppedWaitingText(holder, waitedMs);
    host.store.appendMessage(owner.threadId, {
      role: "bot", kind: "activity",
      tool: { name: text, ok: true },
      ...(holderThreadRef ? { threadRef: holderThreadRef } : {})
    });
    host.bus.publish({
      ...waitEventBase(),
      type: "turn.wait_ended",
      resource,
      ...(holder ? { holder } : {}),
      waitedMs,
      outcome
    });
  };
  try {
    while (true) {
      if (!active()) throw new host.DirectTurnSetupCancelled("Computer wait cancelled");
      if (!exclusive || host.claimTurnResource(owner, resource)) break;
      if (!waitingMessage) {
        // Arrival in the waitlist is the chip's timestamp: the position it
        // reads is where this turn sits the moment it starts waiting (#1652).
        const position = host.turnResources.startWaiting(resource, owner);
        const estimateMs = host.turnResources.waitEstimateMs(resource);
        const blocker = host.turnResources.blocker(resource, owner);
        const holderBot = blocker && host.store.botByThread(blocker.threadId);
        const holderTask = holderBot && blocker && host.store.taskByThread(holderBot.id, blocker.threadId);
        const holderRoom = !holderBot && blocker ? host.store.groupByThread(blocker.threadId) : null;
        holder = holderBot
          ? { name: holderBot.name, ...(holderTask?.title ? { task: holderTask.title } : {}) }
          : holderRoom ? { name: holderRoom.name } : undefined;
        holderThreadRef = holderBot && holderTask?.title
          ? { botId: holderBot.id, threadId: holderTask.threadId, title: holderTask.title }
          : undefined;
        waitingMessage = host.store.appendMessage(owner.threadId, {
          role: "bot", kind: "activity",
          tool: { name: computerWaitingText(holder, { position, estimateMs }) },
          ...(holderThreadRef ? { threadRef: holderThreadRef } : {})
        });
        waitedSince = Date.now();
        host.bus.publish({
          ...waitEventBase(),
          type: "turn.wait_started",
          resource,
          position,
          ...(holder ? { holder } : {})
        });
      }
      if (Date.now() >= deadline) {
        // ADR-2 (#1651): the ceiling parks the turn — settled, with a
        // registered resume — instead of failing it. The owner mark lets the
        // live lazy-claim rejection path park the same way.
        endWait("parked");
        owner.computerParkedOn = resource;
        throw new host.ComputerWaitParked(computerParkedText(holder, host.COMPUTER_WAIT_MAX_MS), resource, owner.generation);
      }
      await new Promise<void>(resolve => setTimeout(resolve, 100));
    }
  } finally {
    // Never patch the waiting chip over: the queue position this turn held
    // stays visible beside what the wait came to.
    endWait(active() && host.turnResources.owns(resource, owner) ? "acquired" : "stopped");
    // Whatever the wait came to, this turn is no longer waiting: an owner
    // left at the front would block the grant for everyone behind it.
    host.turnResources.stopWaiting(resource, owner);
  }
  host.turnResourceOwners.set(owner.threadId, owner);
  host.turnComputerResources.set(owner.threadId, { owner, resource });
  // This computer's own screen (2026-10-28): the turn's first screen action
  // says so in the conversation, whatever the model said before it; the
  // banner with Stop reads the same seat (GET /api/computer/host-control).
  if (exclusive && resource === host.HOST_COMPUTER_RESOURCE && !owner.hostControlAnnounced && host.turnResources.owns(resource, owner)) {
    owner.hostControlAnnounced = true;
    host.store.appendMessage(owner.threadId, { role: "bot", kind: "activity", tool: { name: host.HOST_CONTROL_NOTICE, ok: true } });
  }

}
  return bindTurnComputer;
}
