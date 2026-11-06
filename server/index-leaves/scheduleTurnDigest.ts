// @ts-nocheck
/** scheduleTurnDigest (#1388). Pure move from server/index.ts. */
import { reportBackgroundError } from "../background-error.ts";
import * as checkpoints from "../checkpoints.ts";
import { recordHanded, isContextMessage } from "../context/delta-context.ts";
import { buildTurnDigest, coverageForDriver, toolEvidence, renderDigest } from "../digest.ts";
export type Host = Record<string, any>;

export function createScheduleTurnDigest(getHost: () => Host): any {
async function scheduleTurnDigest(input: {
  botId: string;
  botName: string;
  threadId: string;
  turnId: string;
  driverKind: string | undefined;
  instanceId?: string;
  reply: string;
  from?: Message["from"];
  isCurrent: () => boolean;
  usage?: { input: number; output: number; cachedInput?: number; costUsd?: number | null };
  succeeded?: boolean;
}): Promise<void> {
  const host = getHost();
  const at = Date.now();
  const startedAt = host.turnStartedAt.get(input.threadId);
  host.turnStartedAt.delete(input.threadId);
  const checkpoint = host.turnCheckpoints.get(input.threadId);
  host.turnCheckpoints.delete(input.threadId);
  const memory = host.memoryRowsByThread.get(input.threadId) ?? [];
  host.memoryRowsByThread.delete(input.threadId);
  try {
    if (!input.isCurrent()) return;
    const activities = host.store.activePath(input.threadId);
    const digest = buildTurnDigest({
      turnId: input.turnId,
      botId: input.botId,
      threadId: input.threadId,
      at,
      durationMs: startedAt ? Math.max(0, at - startedAt) : 0,
      activities,
      memory,
      reply: input.reply,
      ...(input.usage ? { usage: input.usage } : {}),
      hookCoverage: coverageForDriver(input.driverKind, toolEvidence(activities, input.turnId), activities.some(m => m.kind === "activity" && m.turnId === input.turnId && m.tool?.itemId))
    });
    // Organization server: which credentials this turn ran with (no secret).
    const ran = host.IDENTITY.kind === "perspicax" ? host.turnAccessByThread.get(input.threadId) : undefined;
    if (ran) digest.access = { via: ran.via, payer: ran.payer, ...(ran.payerPrincipalId ? { payerPrincipalId: ran.payerPrincipalId } : {}), ...(ran.routine ? { routine: true as const } : {}) };
    const message = host.store.appendMessage(input.threadId, {
        role: "bot",
        kind: "digest",
        text: renderDigest(digest),
        digest,
        turnId: input.turnId,
        requestMessageId: activities.find(message => message.turnId === input.turnId && message.requestMessageId)?.requestMessageId,
        turnSucceeded: input.succeeded,
        ...(input.from ? { from: input.from } : {})
      }, { kind: "digest.append", key: `${input.threadId}:${input.turnId}` });
    // This is derived from the native session's own work, not an unseen
    // teammate message. Record it alongside that turn's replies so normal
    // resumes stay delta-only. Other engines still receive it on replay.
    if (input.instanceId && !input.from) {
      const handed = host.store.taskByThread(input.botId, input.threadId)?.handedMessages?.[input.instanceId];
      if (handed) host.store.setHandedMessages(input.botId, input.threadId, input.instanceId,
        recordHanded(handed, host.store.activePath(input.threadId).filter(isContextMessage).map(row => row.id), [message.id]));
    }
    if (!checkpoint) return;
    // A folder-level diff: when a sibling thread of this bot works in the
    // same folder, its edits since this turn's snapshot are listed here too.
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const capture = async () => {
      return checkpoints.diffWorkingTree(input.botId, checkpoint.cwd, checkpoint.hash, controller.signal);
    };
    let files: Awaited<ReturnType<typeof capture>>;
    try {
      files = await Promise.race([
        capture(),
        new Promise<null>(resolve => { timer = setTimeout(() => { controller.abort(); resolve(null); }, 3_000); }),
      ]);
    } finally {
      clearTimeout(timer!);
    }
    if (!files || !input.isCurrent() || !host.store.activePath(input.threadId).some(row => row.id === message.id)) return;
    const withFiles = buildTurnDigest({ ...digest, activities, memory, files });
    host.store.patchMessage(input.threadId, message.id, { digest: withFiles, text: renderDigest(withFiles) }, { kind: "digest.files", key: `${input.threadId}:${input.turnId}` });
  } catch (error) {
    console.error(`digest: could not record turn ${input.turnId} on ${input.threadId}:`, error instanceof Error ? error.message : error);
  } finally {
    // The pre-turn commit has had its last reader (the diff above is queued
    // ahead of this in the shadow repo); the next snapshot may reclaim it.
    if (checkpoint) void checkpoints.release(checkpoint.botId, checkpoint.cwd, checkpoint.pin).catch(reportBackgroundError);
    void host.runLifecycleEvent(input.botId, input.threadId, "after_agent_response", { text: input.reply.slice(0, 2_000) }).catch(reportBackgroundError);
    void host.runLifecycleEvent(input.botId, input.threadId, "stop", {}).catch(reportBackgroundError);
  }
}
  return scheduleTurnDigest;
}
