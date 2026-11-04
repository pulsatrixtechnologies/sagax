import { afterEach, describe, expect, it, vi } from "vitest";
import { checkRoutineReadiness, ROUTINE_READINESS_PROBE_TIMEOUT_MS, loadRoutineReadiness, routineNeededSkills, type RoutineReadinessDeps } from "./routine-readiness.ts";
import { clearEngineRefusal, noteEngineRefusal } from "../engines/engine-refusals.ts";

const routine = { botId: "osprey", prompt: "Check the inbox." };
const run = { botId: routine.botId };
function deps(over: Partial<RoutineReadinessDeps> = {}): RoutineReadinessDeps {
  return { engine: () => undefined, skills: () => undefined, mcp: () => undefined, ...over };
}
afterEach(() => vi.useRealTimers());
describe("routine readiness", () => {
  it("passes unknown facts, checks every category and never infers a successful run", async () => {
    expect(await checkRoutineReadiness(routine, run, deps())).toMatchObject({ ok: true, checks: expect.arrayContaining([
      { kind: "engine", ok: true, code: "ready", params: { kind: "engine" }, line: expect.any(String) },
    ]) });
    expect((await checkRoutineReadiness(routine, run, deps())).checks).toHaveLength(5);
  });
  it("infers Flow and backticked skill ids only near a skill reference", () => {
    for (const prompt of ["Pulsatrix Flow", "px_flow", "flow_run", "using-px-flow", "running-px-flow", "routine Flow"]) {
      expect(routineNeededSkills(prompt)).toEqual(["using-px-flow", "running-px-flow"]);
    }
    expect(routineNeededSkills("Use skill `inbox-review` and open `report-file`." , { skills: ["explicit"] })).toContain("inbox-review");
    expect(routineNeededSkills("Open `report-file`. ")).toEqual([]);
  });
  it("blocks missing enabled skills and MCP servers using known tool prefixes", async () => {
    const answer = await checkRoutineReadiness({ ...routine, prompt: "Use Pulsatrix Flow and outlook_read and cw_psa_ticket.", requires: { skills: ["explicit"], mcpServers: ["calendar"] } }, run,
      deps({ skills: () => ["explicit"], mcp: () => ({ known: ["outlook", "calendar", "perspicax_dispatch"], enabled: ["calendar"], profileServer: "perspicax_dispatch", toolPrefixes: { cw_psa: "perspicax_dispatch" } }) }));
    expect(answer.ok).toBe(false);
    expect(answer.checks.filter(check => !check.ok).map(check => check.params)).toEqual([
      { skill: "using-px-flow" }, { skill: "running-px-flow" }, { server: "outlook" }, { server: "perspicax_dispatch" },
    ]);
  });
  it("uses account-scoped 402 memory for 30 minutes and a completed turn clears it immediately", async () => {
    let now = Date.UTC(2026, 10, 4, 23, 30);
    const engine = "grok-readiness-credits";
    noteEngineRefusal({ engine, account: "wren", cause: "credits", at: now });
    const check = deps({ now: () => now, engine: () => ({ engine, name: "Grok", account: "wren", signedIn: true }) });
    now += 5 * 60_000;
    const blocked = await checkRoutineReadiness(routine, run, check);
    expect(blocked.checks[0]).toMatchObject({ code: "engine_credits", ok: false, line: expect.stringContaining("23:30 UTC") });
    expect((await checkRoutineReadiness(routine, run, deps({ engine: () => ({ engine, name: "Grok", account: "osprey" }) }))).ok).toBe(true);
    now += 26 * 60_000;
    expect((await checkRoutineReadiness(routine, run, check)).ok).toBe(true);
    noteEngineRefusal({ engine, account: "wren", cause: "credits", at: now });
    clearEngineRefusal(engine, "wren", now + 1);
    expect((await checkRoutineReadiness(routine, run, check)).ok).toBe(true);
  });
  it("waits for a known limit reset and a verified new sign-in releases a sign-out", async () => {
    const now = Date.UTC(2026, 10, 4);
    const engine = "claude-readiness-limit";
    noteEngineRefusal({ engine, cause: "usage_limit", at: now, resetsAt: now + 6 * 60 * 60_000 });
    expect((await checkRoutineReadiness(routine, run, deps({ now: () => now + 60_000, engine: () => ({ engine, name: "Claude" }) }))).checks[0]).toMatchObject({ code: "engine_limit", params: { until: "06:00 UTC" } });
    expect((await checkRoutineReadiness(routine, run, deps({ now: () => now + 6 * 60 * 60_000, engine: () => ({ engine, name: "Claude" }) }))).ok).toBe(true);
    noteEngineRefusal({ engine, cause: "signed_out", at: now });
    expect((await checkRoutineReadiness(routine, run, deps({ now: () => now + 99_999_999, engine: () => ({ engine, name: "Claude" }) }))).ok).toBe(false);
    expect((await checkRoutineReadiness(routine, run, deps({ now: () => now + 99_999_999, engine: () => ({ engine, name: "Claude", signedIn: true }) }))).ok).toBe(true);
  });
  it("bounds persisted checks and rejects malformed entries", () => {
    const entry = { kind: "skills", ok: false, code: "skill_missing", line: "x".repeat(800), params: { skill: "s".repeat(150) }, detail: "d".repeat(800) };
    const checks = loadRoutineReadiness([{}, ...Array(120).fill(entry)])!;
    expect(checks).toHaveLength(99);
    expect(checks[0]?.line).toHaveLength(500);
    expect(checks[0]?.detail).toHaveLength(500);
    expect(checks[0]?.params?.skill).toHaveLength(100);
    expect(loadRoutineReadiness(null)).toBeUndefined();
  });
  it("never lets an older cached sign-in clear a newer sign-out", async () => {
    const engine = "cached-sign-in";
    noteEngineRefusal({ engine, cause: "signed_out", at: 200 });
    expect((await checkRoutineReadiness(routine, run, deps({ now: () => 300, engine: () => ({ engine, name: "Grok", signedIn: true, signedInAt: 100 }) }))).ok).toBe(false);
    expect((await checkRoutineReadiness(routine, run, deps({ now: () => 400, engine: () => ({ engine, name: "Grok", signedIn: true, signedInAt: 301 }) }))).ok).toBe(true);
  });
  it("blocks known sign-out before any provider turn", async () => {
    expect((await checkRoutineReadiness(routine, run, deps({ engine: () => ({ engine: "codex", name: "Codex", signedIn: false }) }))).checks[0]).toMatchObject({ code: "engine_signed_out", ok: false });
  });
  it("blocks a refused profile, while unreachable Perspicax stays a passing detail", async () => {
    expect((await checkRoutineReadiness(routine, run, deps({ perspicax: async () => ({ refused: true, profile: "dispatch", detail: "401 invalid_token" }) }))).ok).toBe(false);
    const offline = await checkRoutineReadiness(routine, run, deps({ perspicax: async () => ({ detail: "unreachable" }) }));
    expect(offline.ok).toBe(true);
    expect(offline.checks.find(check => check.kind === "perspicax")).toMatchObject({ detail: "unreachable" });
  });
  it("requires an offline host only when named, explicitly required or selected", async () => {
    const check = deps({ computers: () => [{ name: "Wren computer", online: false }] });
    expect((await checkRoutineReadiness(routine, run, check)).ok).toBe(true);
    expect((await checkRoutineReadiness({ ...routine, prompt: "Read the file on Wren computer." }, run, check)).checks[0]).toMatchObject({ code: "computer_offline" });
    expect((await checkRoutineReadiness({ ...routine, requires: { computer: true } }, run, check)).ok).toBe(false);
    expect((await checkRoutineReadiness(routine, run, deps({ computers: () => [{ name: "Cloud computer", online: false, needed: true }] }))).ok).toBe(false);
  });
  it("caches facts for 60 seconds per bot, engine and person, while each prompt's requirements stay live", async () => {
    let now = 0;
    let selection = "engine-a";
    const skills = vi.fn(() => ["inbox-review"]);
    const check = deps({ now: () => now, cacheKey: () => selection, skills });
    await checkRoutineReadiness(routine, run, check);
    expect((await checkRoutineReadiness({ ...routine, requires: { skills: ["new-skill"] } }, run, check)).ok).toBe(false);
    expect(skills).toHaveBeenCalledTimes(1);
    now = 60_000;
    await checkRoutineReadiness(routine, run, check);
    selection = "engine-b";
    await checkRoutineReadiness(routine, run, check);
    await checkRoutineReadiness(routine, { ...run, runAs: "wren" }, check);
    expect(skills).toHaveBeenCalledTimes(4);
  });
  it("bounds independent probes together below 5 seconds and reports failures without throwing", async () => {
    vi.useFakeTimers();
    const answer = checkRoutineReadiness(routine, run, deps({ engine: () => new Promise(() => {}), skills: () => { throw new Error("inventory unreadable"); }, perspicax: () => new Promise(() => {}) }));
    await vi.advanceTimersByTimeAsync(ROUTINE_READINESS_PROBE_TIMEOUT_MS);
    const result = await answer;
    expect(result.ok).toBe(false);
    expect(result.checks.find(check => check.kind === "engine")).toMatchObject({ code: "probe_error", detail: expect.stringContaining("timed out") });
    expect(result.checks.find(check => check.kind === "skills")).toMatchObject({ code: "probe_error", detail: "inventory unreadable" });
    expect(result.checks.find(check => check.kind === "perspicax")?.ok).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
