// @ts-nocheck
/** compactConversation (#1388). Pure move from server/index.ts.
 * #3679: when it folds nothing and writes nothing, it returns the
 * conversation it read and its context entries, so the turn's context
 * selection does not read and turn every message into text a second time. */
import { foldPoint, deterministicSummary, draftSummary } from "../context/compaction-summary.ts";
import { contextWindowFor, nativeCompactionPoint, shouldCompact, compactBudget, defaultCompactAt } from "../context/context-budget.ts";
import { selectReplay, MAX_SUMMARY_BYTES, DEFAULT_REBUILD_BYTES } from "../context/context-rebuild.ts";
import { autoCompactWindow } from "../drivers/claude.ts";
import { remindAfterCompaction } from "../finish-until.ts";
import { redactSecretsInText } from "../redact.ts";
import { replaysNatively } from "../turns/turn-context.ts";
import { createHash } from "node:crypto";
export type Host = Record<string, any>;

export function createCompactConversation(getHost: () => Host): any {
async function compactConversation(input: {
  bot: BotRecord; threadId: string; generation: string;
  instance: NonNullable<ReturnType<typeof registry.get>>; model: string;
  excludedIds: ReadonlySet<string>; manual: boolean;
}): Promise<{ messages: Message[]; context: ReturnType<Host["directContext"]> } | undefined> {
  const host = getHost();
  const { bot, threadId, generation, instance, model, excludedIds, manual } = input;
  const task = host.store.taskByThread(bot.id, threadId);
  if (!task || (!manual && !host.sagaxCompactionOn(bot.id))) return;
  const messages = host.store.activePath(threadId);
  const context = host.directContext(bot, threadId, messages);
  const record = host.latestCompaction(messages, task);
  const unchanged = { messages, context };
  // A retry must apply the existing record before considering another fold.
  if (!manual && record && record.id !== task.appliedCompactionId) return unchanged;
  if (manual && record?.id === messages.at(-1)?.id && !record?.firstKeptId) return;
  const selected = selectReplay(context, {
    budgetBytes: Math.max(1_024, context.reduce((n, entry) => n + Buffer.byteLength(entry.text) + 16, 0) + 4 * MAX_SUMMARY_BYTES + 1_024),
    maxMessages: Number.MAX_SAFE_INTEGER, excludedIds, compaction: record
  });
  const history = selected.transcript.filter(entry => entry.id);
  if (!history.length) return unchanged;
  // A stale engine session (2026-10-20) is not resumed: fold now so the
  // turn starts a new one from the summary and the latest turns. The
  // summary is the deterministic one: no model call on the person's wait.
  const stale = manual ? null : host.staleEngineSession(threadId, task, instance, messages, excludedIds);
  if (stale) {
    const fresh = history.some(entry => entry.id !== record?.id);
    const fold = foldPoint(history) ?? foldPoint(history, 1) ?? { folded: history, firstKeptId: "" };
    const foldedThroughId = fold.folded.at(-1)?.id;
    const anchorId = context.at(-1)?.id;
    if (fresh && foldedThroughId && foldedThroughId !== record?.id && anchorId) {
      const id = `ctx-${createHash("sha256").update(`${threadId}:${anchorId}:${fold.firstKeptId}`).digest("hex").slice(0, 24)}`;
      const current = host.store.taskByThread(bot.id, threadId);
      if (!current) return;
      if (!current.contextSummaries?.some(entry => entry.id === id)) {
        const bytes = history.reduce((n, entry) => n + Buffer.byteLength(entry.text), 0);
        const entry = { id, at: Date.now(), summary: redactSecretsInText(remindAfterCompaction(deterministicSummary(fold.folded), bot.finishUntil)), firstKeptId: fold.firstKeptId,
          foldedThroughId, anchorId, tokensBefore: Math.ceil(bytes / 4), stale: true as const };
        host.store.patchTask(bot.id, threadId, { contextSummaries: [...(current.contextSummaries ?? []), entry].slice(-host.CONTEXT_SUMMARIES_KEPT) });
      }
    } else if (record) {
      // Nothing new since the last fold: start from that fold again, read as a pause.
      const current = host.store.taskByThread(bot.id, threadId);
      host.store.patchTask(bot.id, threadId, {
        appliedCompactionId: undefined,
        ...(current?.contextSummaries?.some(entry => entry.id === record.id)
          ? { contextSummaries: current.contextSummaries.map(entry => entry.id === record.id ? { ...entry, stale: true as const } : entry) } : {})
      });
    } else return;
    console.info(`[context] ${bot.id} ${threadId}: engine session not resumed (${stale === "idle" ? "thread quiet for hours" : "session too large"}); new session from the summary`);
    return;
  }
  const measurement = task.lastContextModel === `${instance.instanceId}:${model}` && !task.rewound ? task.usage?.context : undefined;
  const window = contextWindowFor(model, instance.models, measurement?.window);
  const bytes = history.reduce((n, entry) => n + Buffer.byteLength(entry.text), 0);
  let floor = task.contextFloor;
  if (record && record.id === task.appliedCompactionId && floor === undefined && measurement?.tokens) {
    floor = measurement.tokens;
    host.store.patchTask(bot.id, threadId, { contextFloor: floor });
  }
  // Fold before the engine would: each engine's own compaction point
  // (context-budget.ts nativeCompactionPoint). For Claude it is the
  // selected account's launch setting; "auto" and "off" supply no number.
  const claudeWindow = instance.driverKind === "claudeAgent"
    ? Number(autoCompactWindow({ ...process.env, ...host.cfg.instances?.[instance.instanceId]?.environment })) : undefined;
  const nativeCompactAt = nativeCompactionPoint(instance.driverKind, window, claudeWindow);
  // An engine that is handed the stored transcript every turn only ever
  // sees the newest rebuildBytes of it: past that, older turns would fall
  // off unsummarized. Fold once anything would be left out, provided the
  // fold helps: something new to fold, and the turns kept word for word fit
  // beside the summary (otherwise two huge latest exchanges would cause a
  // fold on every turn and still not fit).
  const rebuildBytes = host.cfg.context?.rebuildBytes ?? DEFAULT_REBUILD_BYTES;
  const replayFold = !manual && replaysNatively(instance.driverKind)
    && selectReplay(context, { budgetBytes: rebuildBytes, excludedIds, compaction: record }).dropped > 0
    ? foldPoint(history) : null;
  const keptStart = replayFold ? history.findIndex(entry => entry.id === replayFold.firstKeptId) : -1;
  const replayWouldDrop = Boolean(replayFold && replayFold.folded.some(entry => entry.id !== record?.id) && keptStart >= 0
    && history.slice(keptStart).reduce((n, entry) => n + Buffer.byteLength(entry.text) + 16, 0) <= rebuildBytes / 2 - 128);
  if (!manual && !replayWouldDrop && !shouldCompact({ contextTokens: measurement?.tokens, estimatedBytes: bytes,
    budget: compactBudget(window, host.cfg.context?.compactAt ?? defaultCompactAt(instance.driverKind), nativeCompactAt), floor, window, nativeCompactAt })) return unchanged;
  const fold = manual ? { folded: history, firstKeptId: "" } : foldPoint(history);
  if (!fold) return;
  const foldedThroughId = manual
    ? context.findLast(entry => !excludedIds.has(entry.id))?.id
    : fold.folded.at(-1)?.id;
  if (!foldedThroughId) return;
  const prefix = JSON.stringify(messages);
  const controller = new AbortController();
  host.compactionControllers.set(threadId, { generation, controller });
  try {
    const summary = await draftSummary(fold.folded, { signal: controller.signal, generateText: host.sideJobs.text("compaction", bot.id, { instance })?.generateText });
    if (!host.directTurnClaimIsCurrent(bot.id, generation, threadId)) throw new host.DirectTurnSetupCancelled("context summarization stopped");
    controller.signal.throwIfAborted();
    // Appended teammate results remain after the fold. A changed prefix is
    // never summarized using stale input, even if the branch tip still exists.
    if (prefix !== JSON.stringify(host.store.activePath(threadId).slice(0, messages.length))) {
      if (manual) throw new Error("the conversation changed during summarization — please retry");
      return;
    }
    const tokensBefore = measurement?.tokens ?? Math.ceil(bytes / 4);
    if (manual) {
      // The person asked for it: their chat shows the receipt.
      host.store.appendMessage(threadId, {
        role: "bot", kind: "compaction",
        compaction: { summary, firstKeptId: fold.firstKeptId, foldedThroughId, tokensBefore, by: "person" }
      }, { kind: "compaction.append", key: `${threadId}:${messages.at(-1)?.id}:${fold.firstKeptId}` });
      return;
    }
    // Sagax's own fold is invisible: no chat row, no unread, no toast. It is
    // the thread's private memory of its older turns, read by the next
    // session only. The id is derived from what it folded, so a retry of
    // the same fold never writes a second one.
    const anchorId = context.at(-1)?.id;
    if (!anchorId) return;
    const id = `ctx-${createHash("sha256").update(`${threadId}:${anchorId}:${fold.firstKeptId}`).digest("hex").slice(0, 24)}`;
    const current = host.store.taskByThread(bot.id, threadId);
    if (!current || current.contextSummaries?.some(entry => entry.id === id)) return;
    const entry = { id, at: Date.now(), summary: redactSecretsInText(remindAfterCompaction(summary, bot.finishUntil)), firstKeptId: fold.firstKeptId,
      foldedThroughId, anchorId, tokensBefore };
    host.store.patchTask(bot.id, threadId, { contextSummaries: [...(current.contextSummaries ?? []), entry].slice(-host.CONTEXT_SUMMARIES_KEPT) });
    console.info(`[context] ${bot.id} ${threadId}: folded ${fold.folded.length} message(s) at about ${tokensBefore} tokens (window ${window}${nativeCompactAt ? `, engine compacts at ${nativeCompactAt}` : ""})`);
  } finally {
    if (host.compactionControllers.get(threadId)?.generation === generation) host.compactionControllers.delete(threadId);
  }
}
  return compactConversation;
}
