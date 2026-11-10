// The warm host pool (#3357, connectors across engines L14).
//
// Proof: several calls of one person on one sign-in make one launch
// (FAKE_ACP_LAUNCH_COUNT_FILE, the Grok host on the fake ACP CLI); a warm
// process ends once idle; another person or another sign-in never shares
// it; sign-out and shutdown end it, so nothing is left running; the model
// round each call spends comes back as usage for the calling thread.
import type { ServerResponse } from "node:http";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CALL_CONNECTOR_INTERNAL_PATH, createCallConnectorInternalRoute, type CallConnectorRan } from "../routes/internal-connectors.ts";
import { claudePinnedUsage } from "./hosts/claude-host.ts";
import { createGrokConnectorHost, grokPromptUsage, type GrokConnectorLaunch } from "./hosts/grok-host.ts";
import { createConnectorHostPool, type WarmProcess } from "./host-pool.ts";
import type { ProviderAuthenticationStatus } from "../contracts.ts";
import { PrincipalEngineLogins, type LoginController } from "../engines/principal-engine-logins.ts";
import { createConnectorHub, retireConnectorHosts } from "./hub.ts";
import { ConnectorRegistry } from "./registry.ts";
import type { ConnectorAccount, ConnectorEntry } from "./types.ts";

const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const FAKE_ACP = join(SERVER_DIR, "testing", "fake-acp-cli.ts");
const FIXTURES = join(SERVER_DIR, "testing", "fixtures", "connectors");
const posixOnly = describe.skipIf(process.platform === "win32");

/** A process stand-in: alive until stopped. */
function fakeProcess(log: string[], id: string): WarmProcess & { id: string } {
  let up = true;
  return {
    id,
    alive: () => up,
    stop: async () => { if (up) log.push(`stop ${id}`); up = false; },
  };
}

/** Timers the test fires by hand. */
function manualTimers() {
  const pending = new Map<number, () => void>();
  let next = 0;
  return {
    setTimer: (run: () => void) => { const id = ++next; pending.set(id, run); return id; },
    clearTimer: (id: unknown) => { pending.delete(id as number); },
    fire: () => { const runs = [...pending.values()]; pending.clear(); for (const run of runs) run(); },
    count: () => pending.size,
  };
}

describe("connector host pool (#3357)", () => {
  it("serves several calls of one person and account with one launch, through the start limit once", async () => {
    const log: string[] = [];
    let gated = 0;
    const pool = createConnectorHostPool<WarmProcess & { id: string }>({ gate: (_label, run) => { gated += 1; return run(); } });
    const key = { principalId: "Ana@Example.com", accountKey: "grok-com:default:primary" };
    const seen: Array<{ id: string; warm: boolean }> = [];
    for (let call = 0; call < 3; call++) {
      await pool.use(key, "call", async () => { log.push("launch"); return fakeProcess(log, `p${log.length}`); }, async (proc, warm) => {
        seen.push({ id: proc.id, warm });
        return { value: call, keep: true };
      });
    }
    expect(log.filter((line) => line === "launch")).toHaveLength(1);
    expect(gated).toBe(1);
    expect(seen.map((entry) => entry.warm)).toEqual([false, true, true]);
    expect(new Set(seen.map((entry) => entry.id)).size).toBe(1);
    expect(pool.stats()).toMatchObject({ warm: 1, busy: 0, launches: 1, reuses: 2 });
    await pool.close();
    expect(pool.stats().warm).toBe(0);
  });

  it("runs overlapping calls of one key at once, each on its own process, and keeps one warm afterwards", async () => {
    const log: string[] = [];
    let gated = 0;
    const pool = createConnectorHostPool<WarmProcess & { id: string }>({ gate: (_label, run) => { gated += 1; return run(); } });
    const key = { principalId: "ana@example.com", accountKey: "k" };
    let n = 0;
    const start = async () => fakeProcess(log, `p${++n}`);
    // the first call holds its process until released: the second must not wait for it
    let release = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    const order: string[] = [];
    const first = pool.use(key, "call", start, async (proc) => {
      order.push(`first in ${proc.id}`);
      await held;
      order.push("first out");
      return { value: proc.id, keep: true };
    });
    const second = pool.use(key, "call", start, async (proc) => {
      order.push(`second in ${proc.id}`);
      return { value: proc.id, keep: true };
    });
    expect(await second).toBe("p2");
    // the second call ran and ended while the first was still in progress
    expect(order).toEqual(["first in p1", "second in p2"]);
    expect(pool.stats()).toMatchObject({ busy: 1, launches: 2 });
    release();
    expect(await first).toBe("p1");
    expect(order).toEqual(["first in p1", "second in p2", "first out"]);
    expect(gated).toBe(2);
    // one warm process kept (the first to finish), the extra one ended
    expect(log).toEqual(["stop p1"]);
    expect(pool.stats()).toMatchObject({ warm: 1, busy: 0, launches: 2, reuses: 0 });
    const third = await pool.use(key, "call", start, async (proc, warm) => ({ value: { id: proc.id, warm }, keep: true }));
    expect(third).toEqual({ id: "p2", warm: true });
    await pool.close();
    expect(pool.stats().warm).toBe(0);
    expect(log).toEqual(["stop p1", "stop p2"]);
  });

  it("lets a busy call finish at sign-out with its real result, then ends its process instead of keeping it", async () => {
    const log: string[] = [];
    const pool = createConnectorHostPool<WarmProcess & { id: string }>();
    const key = { principalId: "ana@example.com", accountKey: "k" };
    let release = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    let n = 0;
    const call = pool.use(key, "call", async () => fakeProcess(log, `p${++n}`), async (proc) => { await held; return { value: `ran on ${proc.id}`, keep: proc.alive() }; });
    await new Promise((resolve) => setImmediate(resolve));
    await pool.stopPrincipal("ana@example.com", "k");
    // the call in progress is not ended
    expect(log).toEqual([]);
    expect(pool.stats()).toMatchObject({ warm: 1, busy: 1 });
    // a call that starts now gets a fresh process, never the retired one
    const fresh = await pool.use(key, "call", async () => fakeProcess(log, `p${++n}`), async (proc, warm) => ({ value: { id: proc.id, warm }, keep: true }));
    expect(fresh).toEqual({ id: "p2", warm: false });
    release();
    expect(await call).toBe("ran on p1");
    // done: ended, not kept warm
    expect(log).toEqual(["stop p1"]);
    expect(pool.stats()).toMatchObject({ warm: 1, busy: 0 });
    await pool.close();
    expect(log).toEqual(["stop p1", "stop p2"]);
  });

  it("still ends a retired busy process at shutdown", async () => {
    const log: string[] = [];
    const pool = createConnectorHostPool<WarmProcess & { id: string }>();
    let release = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    const call = pool.use({ principalId: "ana@example.com", accountKey: "k" }, "call", async () => fakeProcess(log, "p1"), async () => { await held; return { value: 1, keep: true }; });
    await new Promise((resolve) => setImmediate(resolve));
    await pool.stopPrincipal("ana@example.com");
    await pool.close();
    expect(log).toEqual(["stop p1"]);
    release();
    await call;
    expect(pool.stats()).toMatchObject({ warm: 0, busy: 0 });
  });

  it("never shares a process between two people or two sign-ins", async () => {
    const log: string[] = [];
    const pool = createConnectorHostPool<WarmProcess & { id: string }>();
    const used: string[] = [];
    const run = (principalId: string, accountKey: string) => pool.use({ principalId, accountKey }, "call", async () => fakeProcess(log, `${principalId}/${accountKey}`), async (proc) => {
      used.push(proc.id);
      return { value: proc.id, keep: true };
    });
    await run("ana@example.com", "grok-com:default:primary");
    await run("ben@example.com", "grok-com:default:primary");
    await run("ana@example.com", "grok-com:default:second");
    await run("ana@example.com", "grok-com:default:primary");
    expect(used).toEqual([
      "ana@example.com/grok-com:default:primary",
      "ben@example.com/grok-com:default:primary",
      "ana@example.com/grok-com:default:second",
      "ana@example.com/grok-com:default:primary",
    ]);
    expect(pool.stats()).toMatchObject({ warm: 3, launches: 3, reuses: 1 });
    // a change of one account ends that account's process only
    await pool.stopPrincipal("ana@example.com", "grok-com:default:second");
    expect(log).toEqual(["stop ana@example.com/grok-com:default:second"]);
    expect(pool.stats().warm).toBe(2);
    log.length = 0;
    await run("ana@example.com", "grok-com:default:second");
    // a reset of one person ends that person's processes only
    await pool.stopPrincipal("ANA@example.com");
    expect(log.sort()).toEqual(["stop ana@example.com/grok-com:default:primary", "stop ana@example.com/grok-com:default:second"]);
    expect(pool.stats().warm).toBe(1);
    await pool.close();
    expect(pool.stats().warm).toBe(0);
  });

  it("ends a process once idle, and starts a fresh one for the next call", async () => {
    const log: string[] = [];
    const timers = manualTimers();
    const pool = createConnectorHostPool<WarmProcess & { id: string }>({ idleMs: 1_000, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
    const key = { principalId: "ana@example.com", accountKey: "k" };
    let n = 0;
    const start = async () => fakeProcess(log, `p${++n}`);
    await pool.use(key, "call", start, async () => ({ value: 1, keep: true }));
    expect(timers.count()).toBe(1);
    timers.fire();
    await new Promise((resolve) => setImmediate(resolve));
    expect(log).toEqual(["stop p1"]);
    expect(pool.stats().warm).toBe(0);
    await pool.use(key, "call", start, async (_proc, warm) => ({ value: warm, keep: true }));
    expect(pool.stats()).toMatchObject({ warm: 1, launches: 2 });
    await pool.close();
  });

  it("ends a process after its call when memory reads high, or when the call says it is unclear", async () => {
    const log: string[] = [];
    let memory = true;
    const pool = createConnectorHostPool<WarmProcess & { id: string }>({ memoryOk: () => memory });
    const key = { principalId: "ana@example.com", accountKey: "k" };
    const other = { principalId: "ben@example.com", accountKey: "k" };
    await pool.use(other, "call", async () => fakeProcess(log, "ben"), async () => ({ value: 1, keep: true }));
    memory = false;
    // a start under memory pressure ends the idle ones first, and its own after the call
    await pool.use(key, "call", async () => fakeProcess(log, "ana"), async () => ({ value: 1, keep: true }));
    expect(log).toEqual(["stop ben", "stop ana"]);
    memory = true;
    await pool.use(key, "call", async () => fakeProcess(log, "ana2"), async () => ({ value: 1, keep: false }));
    expect(log).toEqual(["stop ben", "stop ana", "stop ana2"]);
    expect(pool.stats().warm).toBe(0);
  });

  it("keeps nothing after close: a later call runs on a process of its own", async () => {
    const log: string[] = [];
    const pool = createConnectorHostPool<WarmProcess & { id: string }>();
    await pool.close();
    await pool.use({ principalId: "ana@example.com", accountKey: "k" }, "call", async () => fakeProcess(log, "late"), async () => ({ value: 1, keep: true }));
    expect(log).toEqual(["stop late"]);
  });

  it("reads the model round of a pinned call, on Grok and on Claude", () => {
    expect(grokPromptUsage({ stopReason: "cancelled", _meta: { modelId: "grok-fixture-fast", inputTokens: 30137, outputTokens: 187, totalTokens: 30331 } })).toEqual({ model: "grok-fixture-fast", input: 30137, output: 187, costUsd: null });
    expect(grokPromptUsage({ stopReason: "cancelled", _meta: {} })).toBeUndefined();
    const stream = readFileSync(join(FIXTURES, "claude-pinned-call.jsonl"), "utf8");
    // the measured result line: 6 fresh, 12053 cache reads, 10837 cache writes
    expect(claudePinnedUsage(stream, "haiku")).toEqual({ model: "claude-haiku-5-5", input: 6 + 12053 + 10837, output: 510, cachedInput: 12053, costUsd: 0.0025435300000000004 });
    expect(claudePinnedUsage("", "haiku")).toBeUndefined();
  });
});

const TOOL = "cursor__user-Mail-search_5fmessages___1";
const MAIL: ConnectorEntry = { id: "mail", name: "Mail", state: "connected", tools: [{ id: TOOL }] };

function grokAccount(slot: "primary" | "second"): ConnectorAccount {
  return { provider: "grok-com", driver: "grokAgent", instanceId: "default", slot, key: `grok-com:default:${slot}`, label: slot === "second" ? "Grok (personal account)" : "Grok", auth: "subscription", connectors: [MAIL], at: 1 };
}

const alive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};
const lines = <T>(file: string): T[] => (existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as T) : []);
const waitFor = async (check: () => boolean, ms = 5_000) => {
  const until = Date.now() + ms;
  while (!check() && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 25));
  return check();
};

posixOnly("Grok host on the warm pool (#3357)", () => {
  let root = "";
  let countFile = "";
  let callsFile = "";
  const homes: Record<string, string> = {};

  beforeAll(() => {
    chmodSync(FAKE_ACP, 0o755);
    root = realpathSync(mkdtempSync(join(tmpdir(), "sagax-host-pool-")));
    countFile = join(root, "launches.txt");
    callsFile = join(root, "calls.jsonl");
    for (const person of ["ana", "ben"]) {
      for (const slot of ["primary", "second"]) {
        const dir = join(root, person, slot);
        mkdirSync(join(dir, ".grok"), { recursive: true });
        writeFileSync(join(dir, ".grok", "auth.json"), "{}");
        homes[`${person}@example.com/${slot}`] = dir;
      }
    }
  });
  afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

  const launch = (principalId: string, account: ConnectorAccount): GrokConnectorLaunch | undefined => {
    const dir = homes[`${principalId}/${account.slot}`];
    if (!dir) return undefined;
    return {
      cli: FAKE_ACP,
      env: {
        ...process.env,
        HOME: dir,
        GROK_HOME: join(dir, ".grok"),
        FAKE_ACP_MODE: "pinned",
        FAKE_ACP_PINNED: "obey",
        FAKE_ACP_PINNED_CALLS: callsFile,
        FAKE_ACP_LAUNCH_COUNT_FILE: countFile,
        FAKE_ACP_COUNT_CONNECTOR_CALLS: "1",
      },
    };
  };
  const reset = () => { rmSync(countFile, { force: true }); rmSync(callsFile, { force: true }); };
  const launches = () => (existsSync(countFile) ? Number.parseInt(readFileSync(countFile, "utf8"), 10) || 0 : 0);
  const call = (host: ReturnType<typeof createGrokConnectorHost>, principalId: string, slot: "primary" | "second" = "primary", args: Record<string, unknown> = { query: "weekly report" }) =>
    host.call({ principalId, account: grokAccount(slot), connector: MAIL, tool: TOOL, arguments: args, engine: "claudeAgent" });

  it("makes several calls with one launch, each exactly as approved, with its usage", async () => {
    reset();
    const host = createGrokConnectorHost({ launch, gate: (_label, run) => run(), timeoutMs: 30_000 });
    try {
      const results = [];
      for (const query of ["one", "two", "three"]) results.push(await call(host, "ana@example.com", "primary", { query }));
      for (const result of results) {
        expect(result.isError).toBeFalsy();
        expect(result.usage).toEqual({ model: "grok-fixture-fast", input: 120, output: 12, costUsd: null });
      }
      expect(results.map((result) => result.warm === true)).toEqual([false, true, true]);
      expect(launches()).toBe(1);
      const calls = lines<{ input: Record<string, unknown>; pid: number }>(callsFile);
      expect(calls.map((entry) => entry.input)).toEqual([{ query: "one" }, { query: "two" }, { query: "three" }]);
      expect(new Set(calls.map((entry) => entry.pid)).size).toBe(1);
      expect(alive(calls[0]!.pid)).toBe(true);
      expect(host.poolStats?.()).toMatchObject({ warm: 1, launches: 1, reuses: 2 });
    } finally {
      await host.close?.();
    }
    // nothing left running after shutdown
    const [first] = lines<{ pid: number }>(callsFile);
    expect(await waitFor(() => !alive(first!.pid))).toBe(true);
  }, 60_000);

  it("ends the warm process once idle", async () => {
    reset();
    const host = createGrokConnectorHost({ launch, gate: (_label, run) => run(), timeoutMs: 30_000, pool: { idleMs: 200 } });
    try {
      expect((await call(host, "ana@example.com")).isError).toBeFalsy();
      const [first] = lines<{ pid: number }>(callsFile);
      expect(alive(first!.pid)).toBe(true);
      expect(await waitFor(() => !alive(first!.pid))).toBe(true);
      expect(host.poolStats?.().warm).toBe(0);
      // the next call starts a fresh one
      expect((await call(host, "ana@example.com")).warm).toBeFalsy();
      expect(launches()).toBe(2);
    } finally {
      await host.close?.();
    }
    for (const entry of lines<{ pid: number }>(callsFile)) expect(await waitFor(() => !alive(entry.pid))).toBe(true);
  }, 60_000);

  it("keeps one process per person and sign-in, each in its own folder, and ends a person's at sign-out", async () => {
    reset();
    const host = createGrokConnectorHost({ launch, gate: (_label, run) => run(), timeoutMs: 30_000 });
    try {
      await call(host, "ana@example.com");
      await call(host, "ben@example.com");
      await call(host, "ana@example.com", "second");
      await call(host, "ana@example.com");
      expect(launches()).toBe(3);
      const calls = lines<{ pid: number; grokHome: string }>(callsFile);
      const pidOf = (home: string) => new Set(calls.filter((entry) => entry.grokHome === join(home, ".grok")).map((entry) => entry.pid));
      expect(pidOf(homes["ana@example.com/primary"]!).size).toBe(1);
      expect(pidOf(homes["ben@example.com/primary"]!).size).toBe(1);
      expect(pidOf(homes["ana@example.com/second"]!).size).toBe(1);
      const ana = [...pidOf(homes["ana@example.com/primary"]!), ...pidOf(homes["ana@example.com/second"]!)];
      const [ben] = [...pidOf(homes["ben@example.com/primary"]!)];
      await host.stopPrincipal?.("ana@example.com");
      for (const pid of ana) expect(await waitFor(() => !alive(pid))).toBe(true);
      expect(alive(ben!)).toBe(true);
    } finally {
      await host.close?.();
    }
    for (const entry of lines<{ pid: number }>(callsFile)) expect(await waitFor(() => !alive(entry.pid))).toBe(true);
  }, 60_000);

  it("a call still running when a reach probe notice arrives completes with its real result; a sign-in change retires only its account", async () => {
    reset();
    const person = "pr_00000000-0000-4000-8000-00000000000a";
    homes[`${person}/primary`] = homes["ana@example.com/primary"]!;
    homes[`${person}/second`] = homes["ana@example.com/second"]!;
    const hold = join(root, "hold");
    rmSync(hold, { force: true });
    const held = (principalId: string, account: ConnectorAccount) => {
      const base = launch(principalId, account);
      return base ? { ...base, env: { ...base.env, FAKE_ACP_PINNED_HOLD_FILE: hold } } : undefined;
    };
    const host = createGrokConnectorHost({ launch: held, gate: (_label, run) => run(), timeoutMs: 30_000 });
    const hub = createConnectorHub([host]);
    const registry = new ConnectorRegistry({ dataDir: join(root, "registry"), providers: [], accountInstance: (_provider, instanceId) => (instanceId === "grok" ? "default" : instanceId) });
    const reachNotices: unknown[] = [];
    const signInChanges: unknown[] = [];
    const retiring: Array<Promise<void>> = [];
    const made: Array<{ finish: () => Promise<void> }> = [];
    // wired as server/index.ts wires them
    const logins = new PrincipalEngineLogins({
      dataDir: join(root, "logins"),
      instance: (id) => (id === "grok" ? { driver: "grokAgent", cli: FAKE_ACP } : null),
      controller: ({ onAuthenticated }) => {
        let phase: ProviderAuthenticationStatus["phase"] = "waiting";
        made.push({ finish: async () => { phase = "succeeded"; await onAuthenticated(); } });
        const controller: LoginController = {
          start: async () => ({ flowId: `flow-${made.length}`, phase: "waiting", kind: "device", url: "https://example.test/device", code: "TEST-1" }) as never,
          get: async (flowId) => ({ flowId, phase }) as never,
          cancel: async () => {},
          signOut: async () => {},
        };
        return controller;
      },
      probeReach: async () => ({ sessionMcpResolved: true, servers: [] }),
      onConnectorAccountChanged: (_principal, change) => { reachNotices.push(change); },
      onSignInChanged: (principal, change) => { signInChanges.push(change); retiring.push(retireConnectorHosts(hub, registry, principal, change)); },
    });
    const pending = () => lines<{ pid: number; grokHome: string }>(callsFile);
    try {
      await logins.start(person, "grok", "session-1");
      await made[0]!.finish();
      await Promise.all(retiring);
      expect(signInChanges).toHaveLength(1);
      // a call in flight: allowed, sent, its answer not back yet
      const first = call(host, person);
      expect(await waitFor(() => pending().length === 1, 15_000)).toBe(true);
      const before = reachNotices.length;
      await logins.readReach(person, "grok", "primary", true);
      expect(reachNotices.length).toBe(before + 1);
      // the reach probe is no sign-in change: nothing retired
      expect(signInChanges).toHaveLength(1);
      writeFileSync(hold, "");
      const result = await first;
      expect(result.isError).toBeFalsy();
      expect(result.text).toContain(`pinned result of ${TOOL}`);
      // still the same sign-in: kept warm for the next call
      expect(host.poolStats?.()).toMatchObject({ warm: 1, busy: 0 });
      const pid = pending()[0]!.pid;
      expect(alive(pid)).toBe(true);

      // a new sign-in on the second slot retires that account only
      rmSync(hold, { force: true });
      const second = call(host, person);
      expect(await waitFor(() => pending().length === 2, 15_000)).toBe(true);
      await logins.start(person, "grok", "session-2", "second");
      await made[1]!.finish();
      await Promise.all(retiring);
      expect(alive(pid)).toBe(true);
      // the account's own sign-out lets its busy call finish with its real result, then ends it
      await logins.signOut(person, "grok", "session-1");
      await Promise.all(retiring);
      expect(alive(pid)).toBe(true);
      writeFileSync(hold, "");
      const after = await second;
      expect(after.isError).toBeFalsy();
      expect(after.text).toContain(`pinned result of ${TOOL}`);
      expect(await waitFor(() => !alive(pid))).toBe(true);
      expect(host.poolStats?.()).toMatchObject({ warm: 0, busy: 0 });
    } finally {
      rmSync(hold, { force: true });
      await hub.close();
    }
    for (const entry of pending()) expect(await waitFor(() => !alive(entry.pid))).toBe(true);
  }, 60_000);

  it("a call ended by the shutdown after it was allowed answers that its result is unknown, never that nothing ran", async () => {
    reset();
    const hold = join(root, "hold-shutdown");
    rmSync(hold, { force: true });
    const held = (principalId: string, account: ConnectorAccount) => {
      const base = launch(principalId, account);
      return base ? { ...base, env: { ...base.env, FAKE_ACP_PINNED_HOLD_FILE: hold } } : undefined;
    };
    const host = createGrokConnectorHost({ launch: held, gate: (_label, run) => run(), timeoutMs: 30_000 });
    const running = call(host, "ana@example.com");
    expect(await waitFor(() => lines(callsFile).length === 1, 15_000)).toBe(true);
    await host.close?.();
    const result = await running;
    expect(result.isError).toBe(true);
    expect(result.text).toContain("its result is unknown");
    expect(result.text).not.toContain("did not complete");
    for (const entry of lines<{ pid: number }>(callsFile)) expect(await waitFor(() => !alive(entry.pid))).toBe(true);
  }, 60_000);

  it("hands the call's usage to the route's ran hook, for the calling thread", async () => {
    reset();
    const host = createGrokConnectorHost({ launch, gate: (_label, run) => run(), timeoutMs: 30_000 });
    const hub = createConnectorHub([host]);
    const ran: CallConnectorRan[] = [];
    try {
      const handler = createCallConnectorInternalRoute({
        ownsThread: (botId, threadId) => botId === "b1" && threadId === "t1",
        principal: () => "ana@example.com",
        confined: () => false,
        accounts: (principalId) => (principalId === "ana@example.com" ? [grokAccount("primary")] : []),
        hub: () => hub,
        hold: () => ({ engine: "codex", decision: Promise.resolve({ behavior: "allow" as const }) }),
        ran: (entry) => { ran.push(entry); },
      });
      let payload: Record<string, unknown> = {};
      for (let n = 0; n < 2; n++) {
        await handler({
          res: {} as ServerResponse,
          path: CALL_CONNECTOR_INTERNAL_PATH,
          method: "POST",
          json: ((_res: ServerResponse, _code: number, body: Record<string, unknown>) => { payload = body; }) as never,
          capability: { botId: "b1", threadId: "t1", generation: "g" },
          readBody: async () => ({ connector: "Mail", tool: TOOL, arguments: { query: "weekly report" } }),
        });
        expect(payload.ok).toBe(true);
        // the bot gets the tool's own result, never the bookkeeping
        expect(payload).not.toHaveProperty("usage");
      }
      expect(ran.map((entry) => ({ botId: entry.botId, threadId: entry.threadId, principalId: entry.principalId, engine: entry.engine, usage: entry.result.usage, warm: entry.result.warm === true }))).toEqual([
        { botId: "b1", threadId: "t1", principalId: "ana@example.com", engine: "codex", usage: { model: "grok-fixture-fast", input: 120, output: 12, costUsd: null }, warm: false },
        { botId: "b1", threadId: "t1", principalId: "ana@example.com", engine: "codex", usage: { model: "grok-fixture-fast", input: 120, output: 12, costUsd: null }, warm: true },
      ]);
      expect(hub.stats()).toEqual([expect.objectContaining({ engine: "codex", provider: "grok-com", calls: 2, ok: 2, warm: 1, input: 240, output: 24 })]);
      expect(hub.pools()).toEqual([expect.objectContaining({ provider: "grok-com", warm: 1, launches: 1, reuses: 1 })]);
    } finally {
      await hub.close();
    }
  }, 60_000);
});
