// Sagax routine smoke suite (#2006): production routine paths against a
// fake Perspicax MCP, a scripted engine, and the real RoutineManager
// pipeline. Release gate: `pnpm test:routine-smoke`.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { engineWorksInFiles } from "../../../shared/capabilities.ts";
import { lightenColdPrompt } from "../../context/cold-prompt-budget.ts";
import { buildSystemPrompt, ROUTINE_EXECUTION_PROMPT, ROUTINE_PROMPT, type PromptPart } from "../../system-prompt.ts";
import { capabilityPrompt } from "../../capabilities/capability-prompt.ts";
import { approvalLevelPrompt } from "../../approvals/approval-level-prompt.ts";
import { onDemandPromptParts } from "../../context/prompt-references.ts";
import { compactVolatileOrder } from "../../context/compact-prompt.ts";
import { bookRoutineUsage, noteCreditsRefusal, startRoutineSmokeHarness, type SmokeHarness } from "./harness.ts";
import { runDispatchPass, runScriptedRoutine } from "./scripted-engine.ts";
import { RoutineManager } from "../routines.ts";
import { checkRoutineReadiness } from "../routine-readiness.ts";
import { callFakePerspicax } from "../../testing/fake-perspicax-mcp-server.ts";

const harnesses: SmokeHarness[] = [];
const tempDirs: string[] = [];
afterEach(async () => {
  while (harnesses.length) await harnesses.pop()!.close();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function open(options?: Parameters<typeof startRoutineSmokeHarness>[0]) {
  const harness = await startRoutineSmokeHarness(options);
  harnesses.push(harness);
  return harness;
}

/** The unanswered options-card shape desktop Approvals and iOS Needs-you share. */
function isFeedVisibleApproval(message: {
  kind?: string;
  card?: { requestId?: string; tool?: string; answered?: boolean; dismissed?: boolean; expired?: boolean; meetingRequest?: unknown; phoneCallConsent?: unknown };
}): boolean {
  const card = message.card;
  return message.kind === "options"
    && Boolean(card?.requestId)
    && Boolean(card?.tool)
    && !card?.meetingRequest
    && !card?.phoneCallConsent
    && !card?.answered
    && !card?.dismissed
    && !card?.expired;
}

describe("routine smoke suite (#2006)", () => {
  it("a routine called by name runs: a failing Flow shadow plan never blocks the run (#2012)", async () => {
    const h = await open({
      planError: { code: "missing_reads", message: "Read the selection first." },
    });
    const routine = h.manager.create({
      name: "Morning dispatch",
      // Backticks name the recipe for routineFlowInput (#1991): bare prose is not a name.
      prompt: 'Run Flow routine `morning-dispatch`. flow_run {"command":"plan","args":{"units":[{"id":42}],"since":"2026-11-04T10:00:00Z"}}',
      botId: "osprey",
      schedule: { type: "interval", everyMinutes: 60, anchorAt: h.now() },
      requires: { skills: ["running-px-flow"] },
      autoPauseAfter: 1,
    }, undefined, { runAs: "pr_osprey" });
    h.manager.runNow(routine.id);
    await h.flush();
    const run = h.manager.listRuns()[0]!;
    // The shadow check stays on the explicit Check routine button only.
    expect(run.status).not.toBe("blocked");
    expect(run.readiness ?? []).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "flow", code: "flow_plan" }),
    ]));
    expect(h.onRunFailed).not.toHaveBeenCalled();
    expect(h.mcp.leases()).toHaveLength(0);
  });

  it("never double-inits: a live lease answers already_running and finish frees it", async () => {
    const h = await open();
    const first = await runDispatchPass(h.mcp, "osprey");
    expect(first.ok).toBe(true);
    expect(h.mcp.leases()).toHaveLength(0);

    // Hold a lease, then a second init must block without creating a second lease.
    const init = await callFakePerspicax(h.mcp.url, "initialize", {}, { profileId: "pf-dispatch", botId: "osprey" });
    const initSession = init.sessionId!;
    await callFakePerspicax(h.mcp.url, "notifications/initialized", {}, { id: initSession, profileId: "pf-dispatch", botId: "osprey" });
    await callFakePerspicax(
      h.mcp.url,
      "tools/call",
      { name: "flow_run", arguments: { command: "run.init", args: { routine: "morning-dispatch" } } },
      { id: initSession, profileId: "pf-dispatch", botId: "osprey" },
    );
    expect(h.mcp.leases()).toHaveLength(1);

    const second = await runDispatchPass(h.mcp, "wren");
    expect(second.ok).toBe(false);
    expect(second.error).toBe("already_running");
    expect(h.mcp.leases()).toHaveLength(1);

    const runId = h.mcp.leases()[0]!.runId;
    await callFakePerspicax(
      h.mcp.url,
      "tools/call",
      { name: "flow_run", arguments: { command: "run.finish", args: { run_id: runId } } },
      { id: initSession, profileId: "pf-dispatch", botId: "osprey" },
    );
    expect(h.mcp.leases()).toHaveLength(0);
  });

  it("runs the scripted production passes and surfaces the meetings 403 as one line", async () => {
    const h = await open();
    const result = await runScriptedRoutine(h.mcp, "osprey");
    expect(result.passes.map((pass) => pass.name)).toEqual(["dispatch", "invoices", "meetings-close"]);
    expect(result.passes[0]?.ok).toBe(true);
    expect(result.passes[1]?.ok).toBe(true);
    expect(result.passes[2]?.ok).toBe(false);
    expect(result.blockLine).toMatch(/403/);
    expect(result.ok).toBe(true); // expected 403 path is the smoke success
    expect(h.mcp.leases()).toHaveLength(0);
    expect(h.mcp.calls.some((call) => call.command === "run.init")).toBe(true);
    expect(h.mcp.toolCalls.some((call) => call.name === "cw_psa_finance_invoices_write")).toBe(true);
    expect(h.mcp.toolCalls.filter((call) => call.name === "calendar_events_write").length).toBeGreaterThanOrEqual(1);
  });

  it("fails over on a credits refusal onto the backup engine", async () => {
    const h = await open({ withFailover: true });
    noteCreditsRefusal("primary");
    h.probes.flow = undefined;
    h.probes.skills = () => [];
    const routine = h.manager.create({
      name: "Inbox review",
      prompt: "Read the inbox.",
      botId: "osprey",
      schedule: { type: "interval", everyMinutes: 60, anchorAt: h.now() },
    });
    h.manager.runNow(routine.id);
    await h.flush();
    const run = h.manager.listRuns()[0]!;
    expect(run.status).toBe("running");
    expect(h.createTask).toHaveBeenCalled();
    expect(h.startTurn).toHaveBeenCalled();
    // The turn must land on the backup, not the refused primary (#1986).
    expect(h.dispatched).toEqual([{ instanceId: "backup", model: "backup-model" }]);
    expect(run.readiness).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "engine",
        ok: true,
        detail: expect.stringMatching(/Backup/i),
      }),
    ]));
  });

  it("books token usage for a routine turn into the usage ledger", async () => {
    const h = await open();
    const scripted = await h.runScripted();
    await bookRoutineUsage(h.dataDir, {
      botId: "osprey",
      threadId: "t-smoke",
      input: scripted.usage.input,
      output: scripted.usage.output,
      routineId: "routine-smoke",
    });
    const rows = await h.usageRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      botId: "osprey",
      input: scripted.usage.input,
      output: scripted.usage.output,
      trigger: expect.objectContaining({ kind: "routine", routineId: "routine-smoke" }),
    });
  });

  it("puts an approval card where desktop Approvals and iOS Needs-you both read it", async () => {
    const card = {
      kind: "options",
      card: {
        requestId: "req-smoke-1",
        tool: "cw_psa_finance_invoices_write",
        subtitle: "Mark invoice 7 reviewed",
        routineRequest: { routineId: "routine-smoke", runId: "run-smoke" },
      },
    };
    expect(isFeedVisibleApproval(card)).toBe(true);
    expect(isFeedVisibleApproval({ ...card, card: { ...card.card, answered: true } })).toBe(false);

    const dir = mkdtempSync(join(tmpdir(), "smoke-cards-"));
    tempDirs.push(dir);
    const waiting = new Set<string>();
    const probes = {
      now: () => Date.UTC(2026, 10, 4, 15),
      engine: () => ({ engine: "primary", name: "Primary", signedIn: true }),
      skills: () => [] as string[],
      mcp: () => undefined,
    };
    const manager = new RoutineManager({
      file: join(dir, "routines.json"),
      now: () => Date.UTC(2026, 10, 4, 15),
      botState: () => "ready",
      createTask: () => ({ threadId: "t-card" }),
      startTurn: async () => {},
      awaitsPerson: (threadId) => (waiting.has(threadId) ? "Waiting for your answer: Approve the invoice write?" : null),
      cardRaisedSince: () => true,
      readiness: (routineDef, run, mode) => checkRoutineReadiness(routineDef, run, probes, mode),
    });
    const cardRoutine = manager.create({
      name: "Invoice card",
      prompt: "Ask before writing.",
      botId: "osprey",
      schedule: { type: "interval", everyMinutes: 60, anchorAt: Date.UTC(2026, 10, 4, 15) },
    });
    manager.runNow(cardRoutine.id);
    for (let i = 0; i < 12; i++) {
      await manager.tick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const run = manager.listRuns()[0]!;
    expect(run.status).toBe("running");
    waiting.add(run.threadId!);
    manager.handleRuntimeEvent({
      eventId: "e1",
      provider: "fake",
      threadId: run.threadId!,
      createdAt: new Date(Date.UTC(2026, 10, 4, 15)).toISOString(),
      type: "request.opened",
      requestType: "question",
      requestId: "req-smoke-1",
      tool: "ask_choice",
      summary: "Approve the invoice write?",
      harnessAsk: true,
    } as never);
    manager.handleRuntimeEvent({
      eventId: "e2",
      provider: "fake",
      threadId: run.threadId!,
      createdAt: new Date(Date.UTC(2026, 10, 4, 15)).toISOString(),
      type: "turn.completed",
      ok: true,
    } as never);
    expect(manager.listRuns()[0]).toMatchObject({
      status: "waiting",
      attention: "Waiting for your answer: Approve the invoice write?",
    });
  });

  it("keeps the per-turn routine prompt under the release budget", () => {
    // Same production builders as prompt-budget.test.ts; routine kind only.
    const groups = Array.from({ length: 4 }, (_, g) => ({
      key: `plugin-${g}`,
      name: `Osprey reference ${g}`,
      files: Array.from({ length: 6 }, (_, f) => ({
        kind: "skill" as const,
        name: `procedure-${g}-${f}`,
        description: "Verify the package before delivery.",
        path: `plugins/osprey-${g}/skills/procedure-${g}-${f}/SKILL.md`,
        read: () => "# Package\nVerify.\n",
      })),
    }));
    const skills = capabilityPrompt("claudeAgent", groups, { managedTools: true, indexOnly: true });
    const parts: PromptPart[] = [
      { id: "approval-level", label: "Approval", text: approvalLevelPrompt("auto") },
      { id: "routine", label: "Routines", text: ROUTINE_PROMPT },
      { id: "routine-execution", label: "Routine execution", text: ROUTINE_EXECUTION_PROMPT },
      { id: "skills", label: "Skills", text: skills.text },
      { id: "memory", label: "Memory", text: "\nMemory: package review." },
    ];
    const built = compactVolatileOrder(
      buildSystemPrompt("You are Osprey, a Sagax bot.", "Verify packages.", lightenColdPrompt(onDemandPromptParts(parts, true))),
    );
    const bytes = Buffer.byteLength(built.stable + built.volatile);
    const before = engineWorksInFiles("claudeAgent") ? 19007 : 18407;
    expect(bytes).toBeLessThanOrEqual(before * 0.6);
    expect(Math.ceil(bytes / 4)).toBeLessThan(5000);
  });
});
