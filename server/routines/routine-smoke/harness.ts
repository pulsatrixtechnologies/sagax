// Smoke harness (#2006): fake Perspicax MCP + real RoutineManager pipeline
// (readiness, run start, approvals, failover, error reporting, usage).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";

import { activeEngineRefusal, clearEngineRefusal, noteEngineRefusal } from "../../engines/engine-refusals.ts";
import { PerspicaxMcp } from "../../perspicax/perspicax-mcp.ts";
import { startFakePerspicaxMcp, type FakePerspicaxMcp } from "../../testing/fake-perspicax-mcp-server.ts";
import { createLimitFailoverHost } from "../../usage/limit-failover-host.ts";
import { LimitFailoverStore } from "../../usage/limit-failover.ts";
import { appendUsage, flushUsageLedger, readUsage, type UsageRow } from "../../usage/usage-ledger.ts";
import { checkRoutineReadiness, type RoutineReadinessDeps } from "../routine-readiness.ts";
import { routineFlowInput } from "../routine-flow-input.ts";
import { RoutineManager, type RoutineManagerOptions } from "../routines.ts";
import type { ModelSelection } from "../../../shared/wire.ts";
import { runScriptedRoutine, type ScriptedRoutineResult } from "./scripted-engine.ts";

export interface SmokeHarness {
  mcp: FakePerspicaxMcp;
  perspicax: PerspicaxMcp;
  manager: RoutineManager;
  dataDir: string;
  probes: RoutineReadinessDeps;
  createTask: ReturnType<typeof vi.fn>;
  startTurn: ReturnType<typeof vi.fn>;
  onRunFailed: ReturnType<typeof vi.fn>;
  alerts: Array<{ detail?: string } | null>;
  /** Engine selections startTurn saw (failover smoke). */
  dispatched: ModelSelection[];
  usageRows: () => Promise<UsageRow[]>;
  flush: () => Promise<void>;
  advance: (ms: number) => void;
  now: () => number;
  runScripted: (botId?: string) => Promise<ScriptedRoutineResult>;
  close: () => Promise<void>;
}

export async function startRoutineSmokeHarness(options: {
  planError?: { code: string; message: string } | null;
  withFailover?: boolean;
} = {}): Promise<SmokeHarness> {
  const dataDir = mkdtempSync(join(tmpdir(), "sagax-routine-smoke-"));
  const mcp = await startFakePerspicaxMcp({
    planError: options.planError ?? null,
  });
  let now = Date.UTC(2026, 10, 4, 15, 0, 0);
  let serial = 0;
  const createTask = vi.fn(() => ({ threadId: `t-${++serial}` }));
  const startTurn = vi.fn(async () => {});
  const dispatched: ModelSelection[] = [];
  const alerts: Array<{ detail?: string } | null> = [];
  const onRunFailed = vi.fn((_run: unknown, alert?: { detail?: string } | null) => {
    alerts.push(alert ?? null);
  });
  let stopFailover: (() => void) | undefined;

  const revoke = vi.fn(async () => true);
  const delegation = vi.fn(async () => ({ ok: true as const, token: "fixture-subject", expiresAt: Date.now() + 60_000 }));
  // Account MCP exchange (no bot profile): readiness uses the person's main
  // Perspicax connection (#1991), never a selected bot profile.
  const exchange = vi.fn(async (_subject: string) => ({
    ok: true as const,
    token: "fixture-mcp-account",
    expiresAt: Date.now() + 60_000,
  }));

  const perspicax = new PerspicaxMcp({
    issuer: "https://id.example.test",
    version: "0.0.0-smoke",
    subjectOf: () => ({ iss: "https://id.example.test", sub: "pr_osprey", disabled: false }),
    subjectToken: vi.fn(async (): Promise<{ ok: false; error: "no_session" }> => ({ ok: false, error: "no_session" })),
    routineSubjectToken: delegation,
    link: () => ({
      exchangeToken: exchange,
      revokeExchanged: revoke,
      mcpEndpoint: () => mcp.url,
    }),
    fetch: async (url, init) => {
      const headers = new Headers(init?.headers);
      // Account connection: the fake treats missing x-perspicax-profile as
      // the account session (shadow inits skip server_profiles).
      if (!headers.has("x-perspicax-profile")) headers.set("x-perspicax-profile", "account");
      return fetch(url, { ...init, headers });
    },
    log: () => {},
  });

  const probes: RoutineReadinessDeps = {
    now: () => now,
    engine: () => ({ engine: "primary", name: "Primary", signedIn: true }),
    skills: () => ["using-px-flow", "running-px-flow"],
    mcp: () => undefined,
    flow: (routine, run, signal) =>
      perspicax.probeFlowReadiness(
        run.runAs ?? routine.runAs ?? "pr_osprey",
        run.botId,
        routineFlowInput(run.prompt ?? routine.prompt),
        signal,
      ),
  };

  const managerOptions: RoutineManagerOptions = {
    file: join(dataDir, "routines.json"),
    now: () => now,
    botState: () => "ready",
    createTask,
    startTurn,
    onRunFailed,
    readiness: (routine, run, mode) => checkRoutineReadiness(routine, run, probes, mode),
    engineForRun: () => ({ engine: "primary" }),
  };

  if (options.withFailover) {
    const primary: ModelSelection = { instanceId: "primary", model: "primary-model" };
    const backup: ModelSelection = { instanceId: "backup", model: "backup-model" };
    const selections = new Map<string, ModelSelection>();
    const selection = (threadId?: string) => selections.get(threadId ?? "") ?? primary;
    const store = new LimitFailoverStore({ file: null, now: () => now });
    const failover = createLimitFailoverHost({
      store,
      now: () => now,
      enabled: () => true,
      engineName: (id) => id,
      engine: (instanceId) => ({
        instanceId,
        driverKind: instanceId === primary.instanceId ? "grokAgent" : "codex",
      }),
      candidates: async () => [{ instanceId: backup.instanceId, driverKind: "codex", models: [backup.model] }],
      preferred: () => [backup],
      config: () => undefined,
      payer: () => "server",
      refusal: (_bot, _thread, _speaker, id) => activeEngineRefusal(id, undefined, now),
      threadSelection: (_bot, threadId) => selection(threadId),
      busy: () => false,
      switchThread: (_bot, threadId, to) => {
        selections.set(threadId, to);
        return null;
      },
      note: vi.fn(),
      replaceFailure: vi.fn(),
      request: () => undefined,
      resend: async () => false,
      rerunRoutine: () => false,
    });
    // No signedIn: a recorded credits refusal must stick (#1986).
    probes.engine = (_routine, run) => ({ engine: selection(run.threadId).instanceId, name: "Primary" });
    probes.backup = async (_routine, run, from) => {
      const picked = await failover.backupFor(run.botId, run.threadId ?? "", undefined, from.engine);
      return picked ? { engine: picked.instanceId, name: "Backup" } : undefined;
    };
    managerOptions.prepareTurn = async (run) => {
      await failover.beforeTurn(run.botId, run.threadId!, undefined);
    };
    managerOptions.engineForRun = (run) => ({ engine: selection(run.threadId).instanceId });
    managerOptions.startTurn = async (_botId, threadId) => {
      dispatched.push(selection(threadId));
      await startTurn();
    };
    stopFailover = () => failover.stop();
  }

  const manager = new RoutineManager(managerOptions);

  return {
    mcp,
    perspicax,
    manager,
    dataDir,
    probes,
    createTask,
    startTurn,
    onRunFailed,
    alerts,
    dispatched,
    usageRows: async () => {
      await flushUsageLedger(dataDir);
      return readUsage(dataDir, { from: new Date("2026-11-01T00:00:00Z"), to: new Date("2026-11-30T23:59:59Z") });
    },
    flush: async () => {
      for (let i = 0; i < 40; i++) {
        await manager.tick();
        await new Promise((resolve) => setTimeout(resolve, 0));
        const run = manager.listRuns()[0];
        if (run && !["queued", "running"].includes(run.status) && run.status !== "waiting") break;
        // Readiness probes the fake MCP over HTTP; give the promise a turn.
        if (run?.status === "queued") await new Promise((resolve) => setTimeout(resolve, 20));
      }
    },
    advance: (ms) => {
      now += ms;
    },
    now: () => now,
    runScripted: (botId) => runScriptedRoutine(mcp, botId),
    close: async () => {
      stopFailover?.();
      clearEngineRefusal("primary");
      clearEngineRefusal("backup");
      await mcp.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

export async function bookRoutineUsage(
  dataDir: string,
  input: { botId: string; threadId: string; input: number; output: number; routineId: string },
): Promise<void> {
  appendUsage(dataDir, {
    botId: input.botId,
    botName: "Osprey",
    threadId: input.threadId,
    instanceId: "primary",
    driverKind: "claudeAgent",
    model: "fixture-model",
    input: input.input,
    output: input.output,
    costUsd: 0.01,
    costSource: "estimated",
    trigger: { kind: "routine", routineId: input.routineId, label: "smoke", runAsPrincipalId: "pr_osprey" },
    at: "2026-11-04T15:00:00.000Z",
  });
  await flushUsageLedger(dataDir);
}

export function noteCreditsRefusal(engine = "primary"): void {
  noteEngineRefusal({ engine, cause: "credits", at: Date.UTC(2026, 10, 4, 15, 0, 0) });
}
