// @ts-nocheck
/** writeWorkerTurn (#1388). Pure move from server/index.ts. */
import { parseTurnWrite, workerOwns } from "../workers.ts";

export type Host = Record<string, any>;

export function createWriteWorkerTurn(getHost: () => Host): any {
function writeWorkerTurn(input: { deviceId: string; userId: string; messageId: string; body: unknown }): { status: number; body: Record<string, unknown> } {
  const host = getHost();

  if (!workerOwns(host.registeredWorkers, input.deviceId, input.userId)) return { status: 403, body: { error: "forbidden" } };
  const parsed = parseTurnWrite(input.body);
  if ("error" in parsed) return { status: 400, body: { error: parsed.error } };
  if (parsed.kind === "done") {
    host.finishMachineTurn(input.messageId, { ok: true, text: "" });
    return { status: 200, body: { ok: true } };
  }
  const view = host.readWorkerTurn(input);
  if (!view) return { status: 404, body: { error: "no such turn" } };
  if ("error" in view) return { status: view.status, body: { error: view.error } };
  const bot = host.store.bot(view.botId);
  if (!bot) return { status: 404, body: { error: "no such turn" } };
  const from = { botId: bot.id, name: bot.name, color: bot.color };
  if (parsed.kind === "progress") {
    const existing = host.machineProgressIds.get(input.messageId);
    if (existing) host.store.patchMessage(view.threadId, existing, { text: parsed.text });
    else {
      const row = host.store.appendMessage(view.threadId, { role: "bot", kind: "text", text: parsed.text, from });
      host.machineProgressIds.set(input.messageId, row.id);
    }
    host.store.setTaskActivity(bot.id, view.threadId, "working");
    return { status: 200, body: { ok: true } };
  }
  if (parsed.kind === "approval") {
    host.machineApprovals.set(parsed.requestId, { threadId: view.threadId, requestId: parsed.requestId, tool: parsed.tool, summary: parsed.summary });
    // #2091 (decided 2026-11-05): Always allow keeps this tool on the person's
    // own computer for this bot; kept, the worker's ask is answered at once
    const machineRule = { tool: `machine:${parsed.tool}`, scope: {}, description: `Run "${parsed.tool}" on your computer` };
    const keptMachine = host.keptCardRule(bot, view.threadId, machineRule);
    if (keptMachine) {
      host.machineApprovals.get(parsed.requestId)!.behavior = "allow";
      // the answered receipt of a rule-settled ask; full-access: exempt
      host.store.appendMessage(view.threadId, {
        role: "bot",
        kind: "options",
        from,
        card: {
          title: "Approval needed", subtitle: parsed.summary || parsed.tool, options: ["Allow", "Deny"], requestId: parsed.requestId,
          // full-access: exempt
          requestType: "permission",
          tool: parsed.tool, answered: "allow", ownerRule: machineRule,
          ruleSaved: { id: keptMachine.id, behavior: keptMachine.behavior, description: keptMachine.description }
        }
      });
      host.appendDecision(host.DATA_DIR, { threadId: view.threadId, requestId: parsed.requestId, botId: bot.id, botName: bot.name, tool: parsed.tool, summary: parsed.summary || parsed.tool, decision: "auto-approved", source: "owner-rule", rule: keptMachine.id });
      return { status: 200, body: { ok: true } };
    }
    // a worker on the person's own computer asks; its level is that
    // computer's (server/machine-run.ts); full-access: engine-bridge
    host.store.appendMessage(view.threadId, {
      role: "bot",
      kind: "options",
      from,
      card: {
        title: "Approval needed",
        subtitle: parsed.summary || parsed.tool,
        options: ["Allow", "Deny"],
        requestId: parsed.requestId,
        // full-access: engine-bridge
        requestType: "permission",
        tool: parsed.tool,
        ownerRule: machineRule
      }
    });
    host.store.setTaskActivity(bot.id, view.threadId, "waiting-on-you");
    return { status: 200, body: { ok: true } };
  }
  if (parsed.kind === "reply") {
    const existing = host.machineProgressIds.get(input.messageId);
    if (existing) host.store.patchMessage(view.threadId, existing, { text: parsed.text });
    else host.store.appendMessage(view.threadId, { role: "bot", kind: "text", text: parsed.text, from });
    host.finishMachineTurn(input.messageId, { ok: true, text: parsed.text });
    return { status: 200, body: { ok: true } };
  }
  if (parsed.kind === "failed") {
    host.store.appendMessage(view.threadId, { role: "bot", kind: "activity", from, tool: { name: parsed.text || "The turn failed.", ok: false } });
    host.finishMachineTurn(input.messageId, { ok: false, text: parsed.text || "The turn failed." });
    return { status: 200, body: { ok: true } };
  }
  host.finishMachineTurn(input.messageId, { ok: true, text: "" });
  return { status: 200, body: { ok: true } };

}
  return writeWorkerTurn;
}
