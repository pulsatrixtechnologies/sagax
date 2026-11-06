// @ts-nocheck
/** finalizeDelegationWatch (#1388). Pure move from server/index.ts. */
import { masteryDelegationFacts } from "../achievements/achievements-mastery.ts";
import { getOrCreateChannel, mirrorReply, mirrorActivity } from "../comms-visibility.ts";
import { recordDelegationReceipt } from "../peers/delegation-receipts.ts";
import { canReachPeer } from "../peers/peer-roster.ts";
export type Host = Record<string, any>;

export function createFinalizeDelegationWatch(getHost: () => Host): any {
function finalizeDelegationWatch(
  threadId: string,
  ok: boolean,
  reply = "",
  failureName = "Delegated turn did not finish",
): boolean {
  const host = getHost();
  const watched = host.delegationWatch.get(threadId);
  if (!watched) return false;
  host.delegationWatch.delete(threadId);
  const target = host.store.bot(watched.toBotId);
  const targetName = target?.name ?? watched.toBotName ?? watched.toBotId;
  const source = watched.sourceBotId
    ? host.store.bot(watched.sourceBotId)
    : (watched.sourceThreadId ? host.store.botByThread(watched.sourceThreadId) : undefined);
  if (!watched.oneWay && source && target && !canReachPeer(source, target)) {
    ok = false;
    reply = "";
    failureName = "Result withheld: team or peer access changed while the teammate was working";
  }
  // The receipt and the wake carry the whole account (stoppedTurnText); a
  // chip shows its first line.
  const failureChip = failureName.split("\n", 1)[0]!.slice(0, 180);
  // The receipt is written before any mirror short-circuits: the delegating
  // bot's check/wait_delegation must see a terminal state even when the
  // channel or target is gone.
  if (watched.taskId && watched.sourceThreadId) {
    const worker = host.store.taskByThread(watched.toBotId, threadId)?.autoModel;
    recordDelegationReceipt({
      id: watched.taskId,
      sourceThreadId: watched.sourceThreadId,
      toBotId: watched.toBotId,
      toBotName: host.store.bot(watched.toBotId)?.name ?? watched.toBotId,
      status: ok ? "done" : "failed",
      result: ok ? reply : failureName,
      ...(worker?.role === "worker" ? { workerModel: { engine: worker.engineLabel, model: worker.modelLabel, ...(worker.taskClass ? { taskClass: worker.taskClass } : {}) } } : {})
    });
    host.recordMastery(masteryDelegationFacts({
      person: host.achievementThreadPerson(watched.sourceThreadId),
      sourceThreadId: watched.sourceThreadId,
      toBotId: watched.toBotId,
      ok,
      id: watched.taskId,
      sourceModel: host.masteryThreadModel(watched.sourceThreadId),
      workerModel: worker?.model ?? host.store.taskByThread(watched.toBotId, threadId)?.modelSelection?.model ?? target?.modelSelection?.model ?? null
    }));
  }
  if (watched.oneWay) {
    if (!ok && host.store.taskByThread(watched.toBotId, threadId)) {
      host.store.appendMessage(threadId, {
        role: "bot",
        kind: "activity",
        tool: { name: `Send failed — ${failureChip}`, ok: false, ...(watched.taskId ? { handoffId: watched.taskId } : {}) }
      });
    }
    return true;
  }
  let channel: GroupRecord | undefined = watched.channelId ? host.store.group(watched.channelId) : undefined;
  let terminalThreadId: string | undefined = watched.sourceThreadId;

  if (source && watched.sourceThreadId) {
    const sourceGroup = host.store.groupByThread(watched.sourceThreadId);
    if (sourceGroup) {
      // Shared-channel (or DM) source: revalidate membership, since a roster
      // change while the target ran must not force a result into a group
      // that no longer contains both bots.
      const sourceStillMember = sourceGroup.memberIds.includes(source.id);
      const targetStillMember = target ? sourceGroup.memberIds.includes(target.id) : false;
      if (!sourceStillMember || !targetStillMember) {
        if (target) {
          channel = getOrCreateChannel(host.store, source, target);
          terminalThreadId = channel.threadId;
        } else {
          // Target is gone: the source may still see the original group, but
          // there is no peer to share a DM with. Keep the group for source.
          terminalThreadId = sourceStillMember ? watched.sourceThreadId : undefined;
          channel = undefined;
        }
      }
      if (terminalThreadId) {
        if (ok && reply.trim()) {
          const sourceReply: Omit<Message, "id" | "at"> = {
            role: "bot",
            kind: "text",
            text: `@${targetName} replied to the delegated task:\n\n${reply.trim()}`
          };
          if (target) sourceReply.from = { botId: target.id, name: target.name, color: target.color };
          host.store.appendMessage(terminalThreadId, sourceReply);
        } else {
          host.store.appendMessage(terminalThreadId, {
            role: "bot",
            kind: "activity",
            tool: {
              name: ok
                ? `Delegation to @${targetName} completed without a text reply`
                : `Delegation to @${targetName} failed — ${failureChip}`,
              ok
            }
          });
        }
        if (channel && terminalThreadId === channel.threadId && !channel.dm) {
          host.store.patchGroup(channel.id, { unread: true });
        }
      }
      // Group/DM sources do not have a single direct task to mark or wake.
      // The delegated result is already in the shared transcript; a group
      // continuation is the responsibility of the room's own turn engine.
    } else if (host.store.taskByThread(source.id, watched.sourceThreadId)) {
      // 1:1 source: the source thread is the delegating bot's own task.
      if (ok && reply.trim()) {
        const sourceReply: Omit<Message, "id" | "at"> = {
          role: "bot",
          kind: "text",
          text: `@${targetName} replied to the delegated task:\n\n${reply.trim()}`
        };
        if (target) sourceReply.from = { botId: target.id, name: target.name, color: target.color };
        host.store.appendMessage(watched.sourceThreadId, sourceReply);
      } else {
        host.store.appendMessage(watched.sourceThreadId, {
          role: "bot",
          kind: "activity",
          tool: {
            name: ok
              ? `Delegation to @${targetName} completed without a text reply`
              : `Delegation to @${targetName} failed — ${failureChip}`,
            ok
          }
        });
      }
      host.markTaskContextExternallyUpdated(source, watched.sourceThreadId);
      // Peer wake: a settled delegated turn resumes the source bot so it
      // folds the result in and answers the user, instead of sitting idle
      // with the reply only visible in the thread (the "delegated and went
      // silent" gap). Failures wake it too — the user must hear the task did
      // not finish. Idle-checked and burst-capped so a busy source or a
      // re-delegating loop cannot spin up runs. An external runtime polls
      // for the receipt instead; waking would answer it a second time.
      if (watched.completionOwner !== "external") {
        const wakeSpeaker = host.threadContinuationSpeaker(watched.sourceThreadId);
        if (ok) {
          host.wakeDelegationSource(source, watched.sourceThreadId, targetName, undefined, watched.routineRunId, wakeSpeaker);
        } else {
          host.wakeDelegationSource(source, watched.sourceThreadId, targetName, failureName || "the delegated turn did not finish", watched.routineRunId, wakeSpeaker);
        }
      }
    }
  }

  if (target && channel) {
    if (ok && reply.trim()) mirrorReply(host.commsBus, target, reply, channel);
    else if (ok) mirrorActivity(host.commsBus, target, channel, "Delegated turn completed", true);
    else mirrorActivity(host.commsBus, target, channel, failureChip, false);
  }
  return true;
}
  return finalizeDelegationWatch;
}
