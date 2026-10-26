// Bot quality bench, cause C (orchestration that loses or doubles work), the
// scenarios of the 2026-10-19 bot quality diagnostic (section 7) it covers:
//   S10 run_routine while the routine's conversation is working
//   S11 two dispatch passes at once: one write, the other waits
//   S12 a delegated bot consults the bot that sent it the work
//   S13 a server restart in the middle of a turn
//   S15 two coordinators broadcast the same request to 8 bots
// Each scenario runs 3 times on the real modules (no server, no engine, no
// network: fakes for the host, the engines and Perspicax). The summary line
// per scenario is the before/after measure; the last test requires 3/3.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import type { CoordinatorHost, HandoffView, RoomAddress } from "./coordinator.ts";
import { createGracefulShutdown } from "./graceful-shutdown.ts";
import { PerspicaxMcp, type PerspicaxMcpLink } from "./perspicax-mcp.ts";
import { RoutineManager, type RoutineManagerOptions } from "./routines.ts";
import { createRoutineRunInternalRoutes } from "./routes/routine-run-internal.ts";
import { RuntimeCoordinator } from "./runtime-coordinator.ts";

const RUNS = 3;
const dirs: string[] = [];
const tempDir = () => { const dir = mkdtempSync(join(tmpdir(), "sagax-bench-")); dirs.push(dir); return dir; };
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const results = new Map<string, boolean[]>();

async function scenario(name: string, attempt: () => Promise<boolean>): Promise<void> {
  const outcomes: boolean[] = [];
  for (let i = 0; i < RUNS; i += 1) {
    try { outcomes.push(await attempt()); } catch (error) { if (process.env.BENCH_DEBUG) console.log(name, error); outcomes.push(false); }
  }
  results.set(name, outcomes);
}

afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  const lines = [...results].map(([name, o]) => `${name}: ${o.filter(Boolean).length}/${o.length}`);
  console.log(`[orchestration-bench]\n${lines.join("\n")}`);
});

// ── routines ───────────────────────────────────────────────────────────

function routines(opts: { busy: () => boolean; file?: string; joined?: string }) {
  const started: Array<{ threadId: string; prompt: string }> = [];
  let task = 0;
  const options: RoutineManagerOptions = {
    file: opts.file ?? join(tempDir(), "routines.json"),
    emit: () => {},
    botState: () => "ready",
    createTask: () => ({ threadId: `run-thread-${++task}` }),
    ...(opts.joined ? { joinConversation: () => opts.joined! } : {}),
    threadBusy: (_botId: string, threadId: string) => threadId === opts.joined && opts.busy(),
    startTurn: async (_botId, threadId, prompt) => {
      if (threadId === opts.joined && opts.busy()) throw Object.assign(new Error("this thread is already working — interrupt it first"), { status: 409, code: "thread_busy" });
      started.push({ threadId, prompt });
    },
  } as RoutineManagerOptions;
  return { manager: new RoutineManager(options), started, options };
}
const input = { name: "Dispatch pass", prompt: "Book the schedule entries", botId: "dispatcher",
  schedule: { type: "once" as const, at: Date.parse("2099-01-01T00:00:00Z") } };
const finish = (manager: RoutineManager, threadId: string) => manager.handleRuntimeEvent({
  eventId: `done-${threadId}`, provider: "fake", threadId, createdAt: new Date().toISOString(), type: "turn.completed", ok: true,
});

// ── coordinator ────────────────────────────────────────────────────────

type Outcome = { ok: boolean; text: string };
function coordination(dataDir = ":memory:", holdBots: string[] = []) {
  const runs: HandoffView[] = [];
  const reports: Array<{ child: HandoffView; parent?: HandoffView }> = [];
  const held = new Map<string, (o: Outcome) => void>();
  const host: CoordinatorHost = {
    validate: () => undefined,
    busy: () => false,
    run(node, _resumed, signal) {
      runs.push(node);
      if (!holdBots.includes(node.botId)) return Promise.resolve({ ok: true, text: `${node.botId} answered` });
      return new Promise<Outcome>(resolve => {
        signal.addEventListener("abort", () => resolve({ ok: false, text: "stopped" }), { once: true });
        held.set(node.id, resolve);
      });
    },
    park: () => {},
    report: (child, parent) => { reports.push({ child, ...(parent ? { parent } : {}) }); },
    changed: () => {},
    names: (node, parent) => ({ requester: parent?.botId ?? "Alex", assignee: node.botId, person: "Alex" }),
    levelOf: () => ({ level: "ask" }),
    chiefOf: () => false,
  } as CoordinatorHost;
  const coordinator = new RuntimeCoordinator({ dataDir, host, log: () => {} });
  return { coordinator, runs, reports, held };
}
const origin = { kind: "user" as const, request: "Who is free tomorrow?" };
type Origin = typeof origin;
type Enqueue = (source: RoomAddress, generation: string, parentId: string | undefined, target: RoomAddress, key: string, text: string,
  approvalGranted?: boolean, rework?: boolean, sourceText?: string, requestBatchKey?: string, workOrigin?: Origin, mode?: string, person?: string) => { node: HandoffView; duplicate: boolean };

// ── Perspicax ──────────────────────────────────────────────────────────

function perspicax() {
  const writes: unknown[] = [];
  const link: PerspicaxMcpLink = {
    exchangeToken: async (_subject, profileId) => ({ ok: true, token: `pxlo1.B.mcp-${profileId}`, expiresAt: Date.now() + 900_000 }),
    revokeExchanged: async () => true,
    mcpEndpoint: () => "http://perspicax.test/mcp",
    profileCatalog: () => [{ id: "P1", slug: "dispatch", name: "Dispatch", description: "" }],
  };
  const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (String(init?.method) === "DELETE" || body?.id === undefined) return new Response(null, { status: 202 });
    if (body.method === "tools/call") { writes.push(body.params); await sleep(30); }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: `entry ${writes.length}` }] } }), {
      status: 200, headers: { "content-type": "application/json", "mcp-session-id": "s1" },
    });
  }) as typeof fetch;
  const mcp = new PerspicaxMcp({
    issuer: "https://px.test", link: () => link,
    subjectOf: () => ({ iss: "https://px.test", sub: "B", disabled: false }),
    subjectToken: async () => ({ ok: true, token: "pxlo1.B.signin", expiresAt: Date.now() + 3_600_000 }),
    routineSubjectToken: async () => ({ ok: true, token: "pxlo1.B.delegation", expiresAt: Date.now() + 3_600_000 }),
    botProfiles: () => ["P1"], version: "1", fetch: fetcher, log: () => {},
    // Both passes are routine runs: unattended writes go through write-once.
    writeOnceScope: () => "routine",
  } as ConstructorParameters<typeof PerspicaxMcp>[0]);
  return { mcp, writes };
}

describe("orchestration bench (cause C)", () => {
  it("S10: run_routine while the conversation it reports into is working", async () => {
    await scenario("S10 run_routine in a busy thread", async () => {
      let busy = true;
      const r = routines({ busy: () => busy, joined: "chat-1" });
      const routine = r.manager.create(input);
      const run = r.manager.runNow(routine.id)!;
      await r.manager.tick();
      const held = r.manager.listRuns().find(x => x.id === run.id)!;
      if (held.status === "failed") return false;
      busy = false;
      await r.manager.tick();
      const after = r.manager.listRuns().find(x => x.id === run.id)!;
      return after.status === "running" && r.started.length === 1 && r.started[0]!.threadId === "chat-1";
    });
    await scenario("S10b run_routine while a run is in flight", async () => {
      const route = createRoutineRunInternalRoutes({
        ownsThread: () => true, routines: () => [{ id: "r1", botId: "dispatcher" }], speaker: () => undefined, mayRunNow: () => true,
        inFlight: () => true, inFlightRun: () => ({ id: "run-1" }), runNow: () => ({ id: "run-2" }), audit: () => {},
      } as Parameters<typeof createRoutineRunInternalRoutes>[0]);
      let status = 0; let body: Record<string, unknown> = {};
      await route({ res: {} as never, path: "/api/internal/routine-run", method: "POST", capability: { botId: "dispatcher", threadId: "t" } as never,
        readBody: async () => ({ routineId: "r1" }), json: (_res: unknown, s: number, b: Record<string, unknown>) => { status = s; body = b; return true; } } as never);
      return status < 400 && body.runId === "run-1";
    });
    expect(results.has("S10 run_routine in a busy thread")).toBe(true);
  });

  it("S11: two dispatch passes at once write once", async () => {
    await scenario("S11 same routine, two passes", async () => {
      const r = routines({ busy: () => false });
      const routine = r.manager.create(input);
      r.manager.runNow(routine.id);
      await r.manager.tick();
      r.manager.runNow(routine.id);
      await r.manager.tick();
      const startedWhileFirstRuns = r.started.length;
      finish(r.manager, r.started[0]!.threadId);
      await r.manager.tick();
      return startedWhileFirstRuns === 1 && r.started.length === 2;
    });
    await scenario("S11b same write from two runs at once", async () => {
      const p = perspicax();
      const bot = { id: "dispatcher", perspicax: { profiles: ["P1"] } };
      for (const t of ["t1", "t2"]) await p.mcp.prepareTurn({ threadId: t, generation: "g", bot, speakerPrincipalId: "pr_bob", speakerOrigin: "person" });
      const frame = (id: number) => ({ jsonrpc: "2.0", id, method: "tools/call",
        params: { name: "psa__book_schedule_entry", arguments: { ticket: 4242, member: "tech-1", start: "2026-10-20T09:00" } } });
      const [a, b] = await Promise.all([
        p.mcp.relay({ threadId: "t1", generation: "g", botId: "dispatcher", profileId: "P1", frame: frame(1) }),
        p.mcp.relay({ threadId: "t2", generation: "g", botId: "dispatcher", profileId: "P1", frame: frame(2) }),
      ]);
      const okBody = (x: { status: number; body?: unknown }, id: number) => x.status === 200 && (x.body as { id?: number; result?: unknown }).id === id &&
        Boolean((x.body as { result?: unknown }).result);
      return p.writes.length === 1 && okBody(a, 1) && okBody(b, 2);
    });
  });

  it("S12: a delegated bot consults the bot that sent it the work", async () => {
    await scenario("S12 consult the requester", async () => {
      const w = coordination(":memory:", ["builder"]);
      const chief: RoomAddress = { botId: "chief", threadId: "chief-chat" };
      const builder: RoomAddress = { botId: "builder", threadId: "builder-work" };
      const enqueue = w.coordinator.enqueue.bind(w.coordinator) as Enqueue;
      const { node } = enqueue(chief, "gen-1", undefined, builder, "builder", "Build the export", false, false, "Ship it", undefined, origin);
      w.coordinator.tick(); await flush();
      const asked = enqueue(builder, "gen-b", node.id, { botId: "chief", threadId: "chief-consult" }, "chief", "Which column order do you want?",
        false, false, "", undefined, origin, "consult");
      w.coordinator.tick(); await flush(); await flush();
      const consulted = w.runs.some(r => r.id === asked.node.id && r.botId === "chief");
      const answered = w.reports.some(r => r.child.id === asked.node.id && r.child.status === "completed");
      // Work still never goes back up the tree.
      let workRefused = false;
      try { enqueue(builder, "gen-b", node.id, chief, "chief", "Do the export yourself", false, false, "", undefined, origin, "work"); } catch { workRefused = true; }
      return consulted && answered && workRefused;
    });
  });

  it("S13: a restart in the middle of a turn", async () => {
    await scenario("S13 delegated turn cut by a restart", async () => {
      const dir = tempDir();
      const first = coordination(dir, ["builder"]);
      const chief: RoomAddress = { botId: "chief", threadId: "chief-chat" };
      const { node } = (first.coordinator.enqueue.bind(first.coordinator) as Enqueue)(chief, "gen-1", undefined,
        { botId: "builder", threadId: "builder-work" }, "builder", "Build it", false, false, "Ship it", undefined, origin);
      first.coordinator.tick(); await flush();
      first.coordinator.close();
      const second = coordination(dir);
      second.coordinator.tick(); await flush(); await flush();
      return second.runs.some(r => r.id === node.id) && second.coordinator.node(node.id)?.status === "completed";
    });
    await scenario("S13b routine run cut by a restart resumes", async () => {
      const file = join(tempDir(), "routines.json");
      const r = routines({ busy: () => false, file });
      const routine = r.manager.create(input);
      const run = r.manager.runNow(routine.id)!;
      await r.manager.tick();
      const again = new RoutineManager({ ...r.options });
      const resumes = (again as unknown as { takeRestartResumes?: () => Array<{ id: string }> }).takeRestartResumes?.() ?? [];
      const status = again.listRuns().find(x => x.id === run.id)?.status;
      return status === "running" && resumes.some(x => x.id === run.id);
    });
    await scenario("S13c shutdown lets a running turn finish", async () => {
      let turnDone = false;
      let cleanedAfterTurn = false;
      void sleep(150).then(() => { turnDone = true; });
      await new Promise<void>(resolve => {
        const shutdown = createGracefulShutdown({
          drain: async () => { while (!turnDone) await sleep(10); },
          drainTimeoutMs: 2_000,
          cleanup: [() => { cleanedAfterTurn = turnDone; }],
          exit: () => resolve(),
        } as Parameters<typeof createGracefulShutdown>[0]);
        shutdown();
      });
      return cleanedAfterTurn;
    });
  });

  it("S15: two coordinators broadcast the same request to 8 bots", async () => {
    await scenario("S15 one request per bot", async () => {
      const w = coordination();
      const enqueue = w.coordinator.enqueue.bind(w.coordinator) as Enqueue;
      const bots = Array.from({ length: 8 }, (_, i) => `bot-${i + 1}`);
      for (const coordinator of ["coordinator-a", "coordinator-b"]) {
        const source: RoomAddress = { botId: coordinator, threadId: `${coordinator}-chat` };
        for (const botId of bots) {
          enqueue(source, `gen-${coordinator}`, undefined, { botId, threadId: `${botId}-from-${coordinator}` }, botId,
            "Poll: are you free tomorrow 9-12? Answer yes or no.", false, false, "Who is free tomorrow?", undefined, origin, "work", "pr_alex");
        }
      }
      w.coordinator.tick(); await flush(); await flush();
      w.coordinator.tick(); await flush(); await flush();
      const turns = new Map<string, number>();
      for (const run of w.runs) turns.set(run.botId, (turns.get(run.botId) ?? 0) + 1);
      const onePerBot = bots.every(b => turns.get(b) === 1);
      const answeredBoth = ["coordinator-a", "coordinator-b"].every(c => w.reports.filter(r => r.parent?.botId === c && r.child.status === "completed").length === 8);
      return onePerBot && answeredBoth;
    });
  });

  it("every scenario passes 3 times out of 3", () => {
    const failing = [...results].filter(([, o]) => o.some(x => !x)).map(([name, o]) => `${name} ${o.filter(Boolean).length}/${o.length}`);
    expect(failing).toEqual([]);
  });
});
