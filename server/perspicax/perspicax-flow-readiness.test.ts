import { afterEach, describe, expect, it, vi } from "vitest";
import { PerspicaxMcp } from "./perspicax-mcp.ts";
import { checkRoutineReadiness, ROUTINE_FLOW_READINESS_TIMEOUT_MS, type RoutineReadinessDeps } from "../routines/routine-readiness.ts";
import { routineFlowInput } from "../routines/routine-flow-input.ts";

interface Frame { id?: string; method: string; params?: { name?: string; clientInfo?: { name: string }; arguments?: { command?: string; args?: Record<string, unknown> } } }
interface Call { frame?: Frame; signal?: AbortSignal | null; session: string | null; method?: string }
function fixture(options: { call?(command: string, signal?: AbortSignal | null, args?: Record<string, unknown>): unknown | Promise<unknown>; tools?: string[]; rpcError?: boolean; text?: boolean } = {}) {
  const calls: Call[] = [];
  const revoke = vi.fn(async () => true);
  const subjectToken = vi.fn(async () => ({ ok: false, error: "no_session" } as const));
  const delegation = vi.fn(async () => ({ ok: true, token: "fixture-subject", expiresAt: Date.now() + 60_000 } as const));
  const exchange = vi.fn(async () => ({ ok: true, token: "fixture-mcp", expiresAt: Date.now() + 60_000 } as const));
  const mcp = new PerspicaxMcp({
    issuer: "https://id.example.test", version: "0.0.0",
    subjectOf: () => ({ iss: "https://id.example.test", sub: "osprey", disabled: false }),
    subjectToken, routineSubjectToken: delegation,
    link: () => ({ exchangeToken: exchange, revokeExchanged: revoke, mcpEndpoint: () => "https://mcp.example.test/mcp" }),
    fetch: async (_url, init) => {
      const frame: Frame | undefined = init?.body ? JSON.parse(String(init.body)) : undefined;
      const headers = new Headers(init?.headers);
      calls.push({ frame, signal: init?.signal, session: headers.get("mcp-session-id"), method: init?.method });
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      if (frame?.method === "notifications/initialized") return new Response(null, { status: 202 });
      let result: unknown = {};
      if (frame?.method === "tools/list") result = { tools: (options.tools ?? ["flow_run"]).map(name => ({ name })) };
      if (frame?.method === "tools/call") {
        const command = frame.params!.arguments!.command;
        const value = await options.call?.(command!, init?.signal, frame.params!.arguments!.args) ?? { status: "ok", run_id: "shadow-1" };
        if (options.rpcError && command === "plan") return new Response(JSON.stringify({ jsonrpc: "2.0", id: frame.id, error: value }));
        result = options.text ? { content: [{ type: "text", text: JSON.stringify(value) }] } : { structuredContent: value };
      }
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: frame?.id, result }), { headers: { "mcp-session-id": "fixture-session" } });
    }, log: () => {},
  });
  const routine = { id: "morning", botId: "osprey", runAs: "pr_osprey", prompt: 'Run Flow routine `inbox-review`. flow_run {"command":"plan","args":{"units":[{"id":42}],"since":"2026-11-04T10:00:00Z"}}' };
  const deps: RoutineReadinessDeps = {
    engine: () => undefined, skills: () => undefined, mcp: () => undefined,
    flow: (routine, run, signal) => mcp.probeFlowReadiness(run.runAs ?? routine.runAs!, run.botId, routineFlowInput(run.prompt ?? routine.prompt), signal),
  };
  const check = (mode: "run" | "check" = "check") => checkRoutineReadiness(routine, { botId: routine.botId }, deps, mode);
  const commands = () => calls.flatMap(call => call.frame?.params?.arguments?.command ? [call.frame.params.arguments] : []);
  return { mcp, routine, deps, check, calls, commands, revoke, delegation, exchange, subjectToken };
}
afterEach(() => vi.useRealTimers());

describe("Flow shadow readiness through the bot's routine MCP connection (#1991)", () => {
  it.each([false, true])("checks the real plan inputs and releases its exact shadow lease (text content: %s)", async (text) => {
    const h = fixture({ text });
    expect(await h.check()).toMatchObject({ ok: true, checks: expect.arrayContaining([{ kind: "flow", ok: true, code: "ready", params: { kind: "flow" }, line: expect.any(String) }]) });
    expect(h.commands()).toEqual([
      { command: "run.init", args: { shadow: true, routine: "inbox-review" } },
      { command: "plan", args: { units: [{ id: 42 }], since: "2026-11-04T10:00:00Z", routine: "inbox-review", run_id: "shadow-1" } },
      { command: "release", args: { routine: "inbox-review", run_id: "shadow-1" } },
    ]);
    expect(h.calls[0]?.frame?.params?.clientInfo?.name).toMatch(/^Sagax Flow check \(osprey; inbox-review; [a-f0-9-]{36}\)$/);
    expect(h.delegation).toHaveBeenCalledWith("pr_osprey");
    expect(h.subjectToken).not.toHaveBeenCalled();
    expect(h.exchange).toHaveBeenCalledWith("fixture-subject");
    expect(h.calls.some(call => call.frame?.params?.name === "identity_switch")).toBe(false);
    expect(h.calls.at(-1)).toMatchObject({ method: "DELETE", session: "fixture-session" });
    expect(h.revoke).toHaveBeenCalledOnce();
    expect(h.mcp.size()).toBe(0);
  });
  it.each(["check"] as const)("blocks an actual plan error in %s mode and always releases its lease", async (mode) => {
    const h = fixture({ call: command => command === "plan" ? { status: "failed", output: { ok: false, error: "missing_reads", message: "Read the selected units first." } } : undefined });
    expect(await h.check(mode)).toMatchObject({ ok: false, checks: expect.arrayContaining([expect.objectContaining({ kind: "flow", code: "flow_plan", ok: false,
      line: "The Flow shadow check failed at plan: missing_reads Read the selected units first." })]) });
    expect(h.commands().at(-1)).toEqual({ command: "release", args: { routine: "inbox-review", run_id: "shadow-1" } });
  });
  it("reports a refused exact release instead of leaving the shadow check green", async () => {
    const h = fixture({ call: command => command === "release" ? { status: "failed", reason: "run_not_yours", detail: "Nothing was released." } : undefined });
    expect((await h.check()).checks.find(check => check.kind === "flow")).toMatchObject({ code: "flow_plan", ok: false, params: { step: "release", error: "run_not_yours Nothing was released." } });
  });
  it("never invokes business finish for a readiness plan with no journal.pass", async () => {
    const h = fixture({ call: command => command === "run.finish" ? { status: "failed", output: { ok: false, error: "boards_without_pass" } } : undefined });
    expect((await h.check()).ok).toBe(true);
    expect(h.commands().map(call => call.command)).toEqual(["run.init", "plan", "release"]);
  });
  it("checks only the account catalogue when no recipe is named and uses the run's explicit person", async () => {
    const h = fixture();
    const routine = { ...h.routine, prompt: "Use flow_run." };
    expect((await checkRoutineReadiness(routine, { botId: routine.botId, runAs: "pr_wren" }, h.deps, "check")).ok).toBe(true);
    expect(h.commands()).toEqual([]);
    expect(h.calls.some(call => call.frame?.method === "tools/list")).toBe(true);
    expect(h.delegation).toHaveBeenCalledWith("pr_wren");
  });
  it.each(["check"] as const)("checks named recipe init without planning undiscovered units in %s mode", async mode => {
    const h = fixture({ call: command => command === "plan" ? { status: "failed", output: { error: "missing_reads" } } : undefined });
    h.routine.prompt = "Passe Pulsatrix Flow `inbox-review`. Suis la routine Flow jusqu'à `run close` avec running-px-flow.";
    expect((await h.check(mode)).ok).toBe(true);
    expect(h.commands()).toEqual([
      { command: "run.init", args: { shadow: true, routine: "inbox-review" } },
      { command: "release", args: { routine: "inbox-review", run_id: "shadow-1" } },
    ]);
  });
  it("uses a fresh client for repeated unnamed probes of the same person's bot", async () => {
    const h = fixture();
    await Promise.all([0, 1].map(() => h.mcp.probeFlowReadiness("pr_osprey", "osprey", {}, AbortSignal.timeout(5_000))));
    const clients = h.calls.filter(call => call.frame?.method === "initialize").map(call => call.frame!.params!.clientInfo!.name);
    expect(clients).toHaveLength(2);
    expect(new Set(clients).size).toBe(2);
    for (const name of clients) expect(name).toMatch(/^Sagax Flow check \(osprey; catalogue; [a-f0-9-]{36}\)$/);
    expect(h.commands()).toEqual([]);
  });
  it("keeps an explicit empty plan subject to the real missing-input refusal", async () => {
    const h = fixture({ call: command => command === "plan" ? { status: "failed", output: { error: "missing_reads" } } : undefined });
    h.routine.prompt = 'Passe Pulsatrix Flow `inbox-review`. flow_run {"command":"plan","args":{}}';
    expect((await h.check()).ok).toBe(false);
    expect(h.commands().find(call => call.command === "plan")).toEqual({ command: "plan", args: { routine: "inbox-review", run_id: "shadow-1" } });
  });
  it("pins concurrent probes of the same bot to their named recipe and run", async () => {
    const runs = new Map<string, string>();
    let lastRoutine: string | undefined;
    let bothOpened!: () => void;
    const opened = new Promise<void>(resolve => { bothOpened = resolve; });
    const h = fixture({ call: async (command, _signal, args) => {
      if (command === "run.init") {
        const routine = String(args!.routine);
        runs.set(routine, `shadow-${routine}`);
        lastRoutine = routine;
        if (runs.size === 2) bothOpened();
        await opened;
        return { status: "ok", run_id: runs.get(routine) };
      }
      if (command === "plan") {
        const routine = String(args!.routine ?? lastRoutine);
        return runs.get(routine) === args!.run_id ? { status: "ok" } : { status: "blocked", reason: "run_not_yours" };
      }
      return { status: "ok" };
    } });
    const names = ["morning-review", "hourly-review"];
    const results = await Promise.all(names.map(routine => h.mcp.probeFlowReadiness("pr_osprey", "osprey",
      routineFlowInput(h.routine.prompt.replace("inbox-review", routine)), AbortSignal.timeout(5_000))));
    expect(results).toEqual([{}, {}]);
    const clients = h.calls.filter(call => call.frame?.method === "initialize").map(call => call.frame!.params!.clientInfo!.name);
    expect(new Set(clients).size).toBe(2);
    for (const routine of names) {
      expect(clients).toContainEqual(expect.stringMatching(new RegExp(`^Sagax Flow check \\(osprey; ${routine}; [a-f0-9-]{36}\\)$`)));
      expect(h.commands()).toContainEqual({ command: "plan", args: { units: [{ id: 42 }], since: "2026-11-04T10:00:00Z", routine, run_id: `shadow-${routine}` } });
      expect(h.commands()).toContainEqual({ command: "release", args: { routine, run_id: `shadow-${routine}` } });
    }
  });
  it.each(["check"] as const)("never releases another run when the run.init response is lost in %s mode", async (mode) => {
    const h = fixture({ call: command => { if (command === "run.init") throw new Error("init response lost"); } });
    expect((await h.check(mode)).checks.find(check => check.kind === "flow")).toMatchObject({ code: "probe_error", ok: false, detail: "init response lost" });
    expect(h.commands().map(call => call.command)).toEqual(["run.init"]);
  });
  it("never releases when a successful init has no owned run id", async () => {
    const h = fixture({ call: command => command === "run.init" ? { status: "ok" } : undefined });
    expect((await h.check()).checks.find(check => check.kind === "flow")).toMatchObject({ code: "probe_error", ok: false, detail: "Perspicax Flow check opened no identifiable shadow run." });
    expect(h.commands().map(call => call.command)).toEqual(["run.init"]);
  });
  it("surfaces argument refusals returned as JSON-RPC errors", async () => {
    const h = fixture({ rpcError: true, call: command => command === "plan" ? { code: -32602, message: "unknown argument args.payload for plan" } : undefined });
    expect((await h.check()).checks.find(check => check.kind === "flow")).toMatchObject({ code: "flow_plan", line: "The Flow shadow check failed at plan: -32602 unknown argument args.payload for plan" });
    expect(h.commands().at(-1)).toEqual({ command: "release", args: { routine: "inbox-review", run_id: "shadow-1" } });
  });
  it("reports an existing live lease without planning or releasing that run", async () => {
    const h = fixture({ call: command => command === "run.init" ? { status: "blocked", reason: "already_running", run: { run_id: "live-run" } } : undefined });
    expect((await h.check()).checks.find(check => check.kind === "flow")).toMatchObject({ ok: true, code: "ready", detail: "A run is live, plan not checked.", params: { live: "true" } });
    expect(h.commands().map(call => call.command)).toEqual(["run.init"]);
    expect(h.revoke).toHaveBeenCalledOnce();
  });
  it.each(["check"] as const)("releases after a thrown plan transport error, using probe_error in %s mode", async (mode) => {
    const h = fixture({ call: command => { if (command === "plan") throw new Error("Connection lost"); } });
    expect((await h.check(mode)).checks.find(check => check.kind === "flow")).toMatchObject({ code: "probe_error", ok: false, detail: "Connection lost" });
    expect(h.commands().at(-1)).toEqual({ command: "release", args: { routine: "inbox-review", run_id: "shadow-1" } });
  });
  it("keeps the plan's explicit failure when cleanup loses its connection", async () => {
    const h = fixture({ call: command => {
      if (command === "plan") return { status: "failed", output: { error: "internal_error", message: "Plan failed." } };
      if (command === "release") throw new Error("Connection lost");
    } });
    expect((await h.check("check")).checks.find(check => check.kind === "flow")).toMatchObject({ code: "flow_plan", ok: false, params: { error: "internal_error Plan failed." } });
  });
  it("retains a known plan failure while its finally crosses the probe abort deadline", async () => {
    vi.useFakeTimers();
    const h = fixture({ call: command => {
      if (command === "plan") return new Promise(resolve => setTimeout(() => resolve({ status: "failed", output: { error: "missing_reads", message: "Read first." } }), 43_000));
      if (command === "release") return new Promise(resolve => setTimeout(() => resolve({ status: "ok" }), 1_000));
    } });
    const pending = h.check("check");
    await vi.advanceTimersByTimeAsync(ROUTINE_FLOW_READINESS_TIMEOUT_MS);
    expect((await pending).checks.find(check => check.kind === "flow")).toMatchObject({ code: "flow_plan", ok: false });
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["check"] as const)("times out independently, releases with a fresh signal and returns probe_error in %s mode", async (mode) => {
    vi.useFakeTimers();
    const h = fixture({ call: (command, signal) => command === "plan" ? new Promise((_resolve, reject) => signal!.addEventListener("abort", () => reject(signal!.reason), { once: true })) : undefined });
    const pending = h.check(mode);
    await vi.advanceTimersByTimeAsync(ROUTINE_FLOW_READINESS_TIMEOUT_MS);
    expect((await pending).checks.find(check => check.kind === "flow")).toMatchObject({ code: "probe_error", ok: false, detail: expect.stringContaining("timed out") });
    expect(h.commands().at(-1)?.command).toBe("release");
    expect(h.calls.find(call => call.frame?.params?.arguments?.command === "release")?.signal?.aborted).toBe(false);
    expect(h.revoke).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("redacts and bounds the engine error on the line, params and persisted check", async () => {
    const h = fixture({ call: command => command === "plan" ? { status: "failed", output: { error: "internal_error", message: 'Authorization: Bearer fixture-credential ' + "x".repeat(900) } } : undefined });
    const check = (await h.check()).checks.find(check => check.kind === "flow")!;
    expect(JSON.stringify(check)).not.toContain("fixture-credential");
    expect(check.line.length).toBeLessThanOrEqual(500);
    expect(check.params!.error!.length).toBeLessThanOrEqual(350);
  });
  it("reports a missing Flow tool rather than a green shadow check", async () => {
    const h = fixture({ tools: ["api_list"] });
    expect((await h.check()).checks.find(check => check.kind === "flow")).toMatchObject({ code: "flow_plan", ok: false, params: { step: "tools/list" } });
    expect(h.commands()).toEqual([]);
    expect(h.revoke).toHaveBeenCalledOnce();
  });
  it("uses the fixed account connection without a configured bot profile", async () => {
    const h = fixture();
    expect((await h.check()).ok).toBe(true);
    expect(h.exchange).toHaveBeenCalledWith("fixture-subject");
    expect(h.calls.some(call => call.frame?.params?.name === "identity_switch")).toBe(false);
  });
  it("never probes Flow before a routine run: a routine called by name runs (2026-11-04)", async () => {
    const h = fixture({ call: () => { throw new Error("no Flow call in run mode"); } });
    const answer = await h.check("run");
    expect(answer.checks.find(check => check.kind === "flow")).toBeUndefined();
    expect(h.commands()).toEqual([]);
  });
});
