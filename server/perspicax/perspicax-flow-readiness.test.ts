import { afterEach, describe, expect, it, vi } from "vitest";
import { PerspicaxMcp } from "./perspicax-mcp.ts";
import { checkRoutineReadiness, ROUTINE_FLOW_READINESS_TIMEOUT_MS, type RoutineReadinessDeps } from "../routines/routine-readiness.ts";
import { routineFlowInput } from "../routines/routine-flow-input.ts";

interface Frame { id?: string; method: string; params?: { name?: string; clientInfo?: { name: string }; arguments?: { command?: string; args?: Record<string, unknown> } } }
interface Call { frame?: Frame; signal?: AbortSignal | null; session: string | null; method?: string }
function fixture(options: { call?(command: string, signal?: AbortSignal | null): unknown | Promise<unknown>; tools?: string[]; rpcError?: boolean; text?: boolean } = {}) {
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
        const value = await options.call?.(command!, init?.signal) ?? { status: "ok", run_id: "shadow-1" };
        if (options.rpcError && command === "plan") return new Response(JSON.stringify({ jsonrpc: "2.0", id: frame.id, error: value }));
        result = options.text ? { content: [{ type: "text", text: JSON.stringify(value) }] } : { structuredContent: value };
      }
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: frame?.id, result }), { headers: { "mcp-session-id": "fixture-session" } });
    }, log: () => {},
  });
  const routine = { id: "morning", botId: "osprey", runAs: "pr_osprey", prompt: 'Run Flow routine inbox-review. flow_run {"command":"plan","args":{"units":[{"id":42}],"since":"2026-11-04T10:00:00Z"}}' };
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
  it.each([false, true])("checks the real plan inputs and closes its own run (text content: %s)", async (text) => {
    const h = fixture({ text });
    expect(await h.check()).toMatchObject({ ok: true, checks: expect.arrayContaining([{ kind: "flow", ok: true, code: "ready", params: { kind: "flow" }, line: expect.any(String) }]) });
    expect(h.commands()).toEqual([
      { command: "run.init", args: { shadow: true, routine: "inbox-review" } },
      { command: "plan", args: { units: [{ id: 42 }], since: "2026-11-04T10:00:00Z", run_id: "shadow-1" } },
      { command: "run.finish", args: { run_id: "shadow-1" } },
    ]);
    expect(h.calls[0]?.frame?.params?.clientInfo?.name).toBe("Pulsa Bot (osprey)");
    expect(h.delegation).toHaveBeenCalledWith("pr_osprey");
    expect(h.subjectToken).not.toHaveBeenCalled();
    expect(h.exchange).toHaveBeenCalledWith("fixture-subject");
    expect(h.calls.some(call => call.frame?.params?.name === "identity_switch")).toBe(false);
    expect(h.calls.at(-1)).toMatchObject({ method: "DELETE", session: "fixture-session" });
    expect(h.revoke).toHaveBeenCalledOnce();
    expect(h.mcp.size()).toBe(0);
  });
  it.each(["run", "check"] as const)("blocks an actual plan error in %s mode and always finishes", async (mode) => {
    const h = fixture({ call: command => command === "plan" ? { status: "failed", output: { ok: false, error: "missing_reads", message: "Read the selected units first." } } : undefined });
    expect(await h.check(mode)).toMatchObject({ ok: false, checks: expect.arrayContaining([expect.objectContaining({ kind: "flow", code: "flow_plan", ok: false,
      line: "The Flow shadow check failed at plan: missing_reads Read the selected units first." })]) });
    expect(h.commands().at(-1)?.command).toBe("run.finish");
  });
  it("reports a refused finish instead of leaving the shadow check green", async () => {
    const h = fixture({ call: command => command === "run.finish" ? { status: "failed", output: { ok: false, error: "pass_missing", message: "A pass line is missing." } } : undefined });
    expect((await h.check()).checks.find(check => check.kind === "flow")).toMatchObject({ code: "flow_plan", ok: false, params: { step: "run.finish", error: "pass_missing A pass line is missing." } });
  });
  it("uses a bound routine when unnamed and the run's explicit person when supplied", async () => {
    const h = fixture();
    const routine = { ...h.routine, prompt: "Use flow_run." };
    expect((await checkRoutineReadiness(routine, { botId: routine.botId, runAs: "pr_wren" }, h.deps, "check")).ok).toBe(true);
    expect(h.commands()[0]).toEqual({ command: "run.init", args: { shadow: true } });
    expect(h.delegation).toHaveBeenCalledWith("pr_wren");
  });
  it("surfaces argument refusals returned as JSON-RPC errors", async () => {
    const h = fixture({ rpcError: true, call: command => command === "plan" ? { code: -32602, message: "unknown argument args.payload for plan" } : undefined });
    expect((await h.check()).checks.find(check => check.kind === "flow")).toMatchObject({ code: "flow_plan", line: "The Flow shadow check failed at plan: -32602 unknown argument args.payload for plan" });
    expect(h.commands().at(-1)?.command).toBe("run.finish");
  });
  it("reports an existing live lease without planning or finishing that run", async () => {
    const h = fixture({ call: command => command === "run.init" ? { status: "blocked", reason: "already_running", run: { run_id: "live-run" } } : undefined });
    expect((await h.check()).checks.find(check => check.kind === "flow")).toMatchObject({ ok: true, code: "ready", detail: "A run is live, plan not checked.", params: { live: "true" } });
    expect(h.commands().map(call => call.command)).toEqual(["run.init"]);
    expect(h.revoke).toHaveBeenCalledOnce();
  });
  it.each(["run", "check"] as const)("closes after a thrown plan transport error, using probe_error in %s mode", async (mode) => {
    const h = fixture({ call: command => { if (command === "plan") throw new Error("Connection lost"); } });
    expect((await h.check(mode)).checks.find(check => check.kind === "flow")).toMatchObject({ code: "probe_error", ok: mode === "run", detail: "Connection lost" });
    expect(h.commands().at(-1)).toEqual({ command: "run.finish", args: { run_id: "shadow-1" } });
  });
  it("keeps the plan's explicit failure when cleanup loses its connection", async () => {
    const h = fixture({ call: command => {
      if (command === "plan") return { status: "failed", output: { error: "internal_error", message: "Plan failed." } };
      if (command === "run.finish") throw new Error("Connection lost");
    } });
    expect((await h.check("run")).checks.find(check => check.kind === "flow")).toMatchObject({ code: "flow_plan", ok: false, params: { error: "internal_error Plan failed." } });
  });
  it("retains a known plan failure while its finally crosses the probe abort deadline", async () => {
    vi.useFakeTimers();
    const h = fixture({ call: command => {
      if (command === "plan") return new Promise(resolve => setTimeout(() => resolve({ status: "failed", output: { error: "missing_reads", message: "Read first." } }), 43_000));
      if (command === "run.finish") return new Promise(resolve => setTimeout(() => resolve({ status: "ok" }), 1_000));
    } });
    const pending = h.check("run");
    await vi.advanceTimersByTimeAsync(ROUTINE_FLOW_READINESS_TIMEOUT_MS);
    expect((await pending).checks.find(check => check.kind === "flow")).toMatchObject({ code: "flow_plan", ok: false });
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["run", "check"] as const)("times out independently, finishes with a fresh signal and returns probe_error in %s mode", async (mode) => {
    vi.useFakeTimers();
    const h = fixture({ call: (command, signal) => command === "plan" ? new Promise((_resolve, reject) => signal!.addEventListener("abort", () => reject(signal!.reason), { once: true })) : undefined });
    const pending = h.check(mode);
    await vi.advanceTimersByTimeAsync(ROUTINE_FLOW_READINESS_TIMEOUT_MS);
    expect((await pending).checks.find(check => check.kind === "flow")).toMatchObject({ code: "probe_error", ok: mode === "run", detail: expect.stringContaining("timed out") });
    expect(h.commands().at(-1)?.command).toBe("run.finish");
    expect(h.calls.find(call => call.frame?.params?.arguments?.command === "run.finish")?.signal?.aborted).toBe(false);
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
});
