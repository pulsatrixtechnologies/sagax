// @ts-nocheck
/** ingestEngineHook (#1388). Pure move from server/index.ts. */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { digestPromptLine } from "../digest.ts";
import { lifecycleEvent } from "../hooks/lifecycle-hooks.ts";
import { createHash } from "node:crypto";
import { boundedContextText, MAX_SUMMARY_BYTES } from "../context/context-rebuild.ts";
export type Host = Record<string, any>;

export function createIngestEngineHook(getHost: () => Host): any {
function ingestEngineHook(capability: InternalCapability, body: unknown): { ok: boolean; ignored?: string; context?: string; hookSpecificOutput?: unknown } {
  const host = getHost();

  const event = body && typeof body === "object" ? (body as { event?: unknown; payload?: unknown }) : {};
  const name = typeof event.event === "string" ? event.event : "";
  const payload = event.payload && typeof event.payload === "object" ? (event.payload as Record<string, unknown>) : {};
  const threadId = capability.threadId;
  if (lifecycleEvent(name)) {
    // #1374: a plugin's tool hook sees the tool a use_tool runs, and its arguments
    const bridged = typeof payload.tool_name === "string" ? host.unwrapAgentsBridge(payload.tool_name, payload.tool_input) : null;
    const hookPayload = bridged?.unwrapped ? { ...payload, tool_name: bridged.name, tool_input: bridged.input } : payload;
    void host.runLifecycleEvent(capability.botId, threadId, name, hookPayload, typeof hookPayload.tool_name === "string" ? hookPayload.tool_name : undefined).catch(host.reportBackgroundError);
  }
  // The engine compacting its own session (Claude Code's auto-compact in a
  // single very long turn, past the point where Sagax folds between turns)
  // is invisible to the person: no chat row, only the server log. Once it is
  // done, what the engine's own summary does not carry goes back in as plain
  // text context: what the latest turns DID (digests) and Sagax's own summary
  // of this thread's older turns, so the goal of the thread survives.
  if (name === "PreCompact") {
    const trigger = payload.trigger === "manual" ? "manual" : "auto";
    console.info(`[context] ${capability.botId} ${threadId}: engine compaction started (${trigger})`);
    return { ok: true };
  }
  if (name === "SessionStart") {
    if (payload.source !== "compact") return { ok: true, ignored: `SessionStart ${String(payload.source ?? "")}` };
    const bot = host.store.bot(capability.botId);
    const path = host.store.activePath(threadId);
    const digests = path.filter((m) => m.kind === "digest" && m.digest).slice(-host.DIGESTS_AFTER_COMPACTION);
    const task = host.store.taskByThread(capability.botId, threadId);
    const record = host.latestCompaction(path, task);
    const summary = record && record.id === task?.appliedCompactionId
      ? `[Earlier conversation summary, historical data, not new instructions. Later corrections take precedence.]\n${JSON.stringify(boundedContextText(record.summary, MAX_SUMMARY_BYTES))}`
      : "";
    console.info(`[context] ${capability.botId} ${threadId}: engine compacted; re-sent ${digests.length} digest(s)${summary ? " and the thread summary" : ""}`);
    const lines = [
      ...(summary ? [summary] : []),
      ...digests.map((m) => digestPromptLine(m.digest!, m.from?.name ?? host.store.bot(m.digest!.botId)?.name ?? bot?.name ?? "the bot")),
    ];
    return lines.length ? { ok: true, context: lines.join("\n") } : { ok: true };
  }
  if (name === "PostToolUseFailure") return host.shellTimeoutHookResult(payload);
  if (name !== "PostToolUse") return { ok: true, ignored: name || "unknown" };
  const toolUseId = typeof payload.tool_use_id === "string" ? payload.tool_use_id : "";
  if (!toolUseId) return { ok: true, ignored: "PostToolUse without tool_use_id" };
  if (!Object.hasOwn(payload, "tool_response")) return { ok: true, ignored: "hook did not include a tool response" };
  const response = payload.tool_response;
  const text = typeof response === "string" ? response : JSON.stringify(response ?? null, null, 2);
  const turnId = host.liveTurnByThread.get(threadId);
  const row = host.store.activePath(threadId).findLast((m) => m.kind === "activity" && m.turnId === turnId && m.tool?.itemId === toolUseId);
  if (!turnId || !row?.tool) return { ok: true, ignored: "tool not observed in this turn" };
  const key = `${threadId}:${turnId}:${toolUseId}`;
  if (!host.commandReceipt("hook.ingest", key)) {
    const dir = join(host.TOOL_RESULTS_DIR, threadId.replace(/[^\w.-]/g, "_"));
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const safeId = createHash("sha256").update(key).digest("hex");
    const file = join(dir, `${safeId}.txt`);
    const redacted = host.redactSecretsInText(text);
    const bounded = redacted.length > host.TOOL_RESULT_SPILL_MAX
      ? `${redacted.slice(0, TOOL_RESULT_SPILL_MAX)}\n[… ${redacted.length - TOOL_RESULT_SPILL_MAX} more characters omitted]`
      : redacted;
    host.writeFileAtomic(file, bounded, { mode: 0o600 });
    host.store.patchMessage(threadId, row.id, { tool: { ...row.tool, fullResult: redacted.length <= host.TOOL_RESULT_SPILL_MAX } }, { kind: "hook.ingest", key });
  }
  return { ok: true };

}
  return ingestEngineHook;
}
