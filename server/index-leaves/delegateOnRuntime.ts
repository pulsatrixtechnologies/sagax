// @ts-nocheck
/** delegateOnRuntime (#1388). Pure move from server/index.ts. */
import { requestPeerApproval, peerApprovalFailure } from "../peers/peer-approval.ts";
import { receiptName, peerDeliveryReceipt } from "../peers/peer-delivery.ts";
import { canReachPeer } from "../peers/peer-roster.ts";
export type Host = Record<string, any>;

export function createDelegateOnRuntime(getHost: () => Host): any {
async function delegateOnRuntime(from: BotRecord, target: BotRecord, message: string, capability: InternalCapability,
  delegated: (taskId: string) => void, external = false, mode: "work" | "consult" = "work", key?: string): Promise<[number, Record<string, unknown>]> {
  const host = getHost();
  const room = host.store.groupByThread(capability.threadId);
  const address = { ...(room ? { groupId: room.id } : {}), threadId: capability.threadId, botId: from.id };
  // The teammate's name as this sender may read it at the moment it is
  // written (receiptName): `target` is the live record, which a rename
  // patches in place while a card waits, so it is never trusted for a name.
  const shownName = () => receiptName(host.store.bot(from.id), host.store.bot(target.id));
  const refused = (detail: string, status = 200): [number, Record<string, unknown>] => [status, { error: detail,
    receipt: peerDeliveryReceipt({ botId: target.id, botName: shownName(), outcome: "failed", detail: `${detail}: nothing was queued` }) }];
  if (target.id === from.id) return refused("a bot cannot delegate to itself");
  const problem = host.roomHandoffProblem(address) ?? host.roomHandoffProblem({ threadId: target.threadId, botId: target.id }, address);
  if (problem) return refused(problem, 403);
  let approvalGranted = false;
  // An external runtime's call is not held open on the card: its work waits
  // queued for the person's review (reviewHolds) and the caller polls.
  // A routine or webhook run's own delegate_bot is not held either (the
  // ledger it replaces asked once the turn ended): its run waits on the
  // work. Its ask_bot keeps asking at once, as it always did.
  const reviewLater = (external || (mode === "work" && Boolean(host.activeRoutineRunForThread(address.threadId)))) && host.peerReviewRequired(from, address.threadId);
  if (host.peerReviewRequired(from, address.threadId) && !reviewLater) {
    // full-access: peer-contact
    const verdict = await requestPeerApproval(host.approvalBus, from, target, message, "delegate_bot", address.threadId);
    if (!host.internalCapabilityIsActive(capability)) return refused("the turn that asked has ended", 409);
    if (verdict !== "allow") {
      const failure = peerApprovalFailure(verdict);
      return [403, { error: verdict === "deny" ? "Denied by user; no work sent." : `${failure.error}; no work sent.`, approvals: [{ botId: target.id, ...failure }] }];
    }
    // The card may have been open for minutes. Read both bots again before
    // anything touches the teammate, as ask_bot did before it moved onto the
    // runtime: one hidden, unshared or moved out of reach meanwhile gets no
    // thread and no work, and the refusal names it by the id that was
    // addressed, never by its new name (isolation between people).
    const sender = host.store.bot(from.id);
    const current = host.store.bot(target.id);
    if (!sender || !current || !canReachPeer(sender, current)) return refused("that bot is no longer available to this bot");
    approvalGranted = true;
  }
  const continued = host.store.workThread(target.id, from.id, address.threadId);
  const task = continued ?? host.store.createTask(target.id, `@${from.name} · work`, false, undefined,
    { botId: from.id, name: from.name, kind: "work", threadId: address.threadId, at: Date.now() });
  if (!task) return refused("no such bot", 404);
  if (continued) host.adoptReservedWorkThread(target.id, task.threadId);
  host.applyDelegatedLevel(
    from,
    address.threadId,
    host.store.bot(target.id)!,
    task.threadId,
    capability.roomHandoffId ?? capability.generation,
  );
  try {
    const sourceText = [...host.store.messagesFor(address.threadId)].reverse().find(m => m.role === "user" && m.kind === "text")?.text ?? "";
    const { node, duplicate } = external
      ? host.coordinator.enqueueExternal(address, { threadId: task.threadId, botId: target.id }, message, approvalGranted, mode, key)
      : host.coordinator.enqueue(address, capability.generation, capability.roomHandoffId,
        { threadId: task.threadId, botId: target.id }, target.id, message, approvalGranted, false, sourceText, undefined,
        host.turnOrigin(capability), mode, host.joinPerson(address.threadId), false, undefined, host.coordinationRequestId(address.threadId));
    // An external caller has no turn to end: its check reads at once.
    if (!external) delegated(node.id);
    else host.coordinator.tick();
    if (duplicate && !continued) host.store.deleteTask(target.id, task.threadId);
    else if (!continued) host.threadStarters.set(task.threadId, host.openerFrom(address.threadId));
    // A repeat answers the request already made without a fresh route check,
    // so the name is read here too, like every name this function writes.
    const shown = shownName();
    const called = shown ? `@${shown}` : "the teammate";
    if (!duplicate) host.store.appendMessage(address.threadId, { role: "bot", kind: "activity",
      from: { botId: from.id, name: from.name, color: from.color },
      tool: { name: `Sent to ${shown ?? "Teammate"}`, ok: true },
      threadRef: { botId: target.id, threadId: node.threadId, title: host.store.taskByThread(target.id, node.threadId)?.title ?? "Teammate work" } });
    return [200, { queued: true, taskId: node.id, ...(shown ? { toBotName: shown } : {}), ...(duplicate ? { duplicate: true } : {}),
      message: reviewLater ? `Queued for review: ${called} will pick it up once the user approves.`
        : external ? `Delegated: ${called} is picking it up now.` : "Queued on the job runtime: end your turn; the result resumes you automatically.",
      ...(reviewLater ? { approvalRequired: true } : {}),
      receipt: peerDeliveryReceipt({ botId: target.id, botName: shown, outcome: duplicate && node.status !== "queued" ? "injected" : "queued",
        detail: duplicate ? `already sent: it is ${node.status} and its result will resume you`
          : reviewLater ? "the teammate's turn waits on the user's approval" : "queued; it runs after your current turn ends", taskId: node.id }) }];
  } catch (error) {
    if (!continued) host.store.deleteTask(target.id, task.threadId);
    return refused(error instanceof Error ? error.message : String(error));
  }
}
  return delegateOnRuntime;
}
