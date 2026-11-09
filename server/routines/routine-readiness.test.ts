import { afterEach, describe, expect, it, vi } from "vitest";
import { checkRoutineReadiness, routineFlowSkills, ROUTINE_READINESS_PROBE_TIMEOUT_MS, loadRoutineReadiness, routineNeededSkills, type RoutineReadinessDeps } from "./routine-readiness.ts";
import type { FlowPluginsDeclaration } from "../perspicax/perspicax-link.ts";
import { clearEngineRefusal, noteEngineRefusal } from "../engines/engine-refusals.ts";

const routine = { botId: "osprey", prompt: "Check the inbox." };
const run = { botId: routine.botId };
const declaration: FlowPluginsDeclaration = { enabled: false, reason: "flow_guard_uncovered", name: "flow", url: "http://127.0.0.1/market", resource: "http://127.0.0.1", plugins: [] };
function deps(over: Partial<RoutineReadinessDeps> = {}): RoutineReadinessDeps {
  return { engine: () => undefined, skills: () => undefined, mcp: () => undefined, ...over };
}
afterEach(() => vi.useRealTimers());
describe("routine readiness", () => {
  it.each([
    { driver: "codex", accessVia: "subscription" },
    { driver: "grokAgent", accessVia: "subscription" },
    { driver: "claudeAgent", accessVia: "org-key" },
    { driver: "claudeAgent", accessVia: "owner-key" },
    { driver: "claudeAgent", accessVia: "speaker-key" },
    { driver: "claudeAgent", accessVia: "server", keyBacked: true },
  ])("explains an unavailable native artifact tool before running on %j (#1990)", async (selection) => {
    const check = deps({ engine: () => ({ engine: "fixture-engine", name: "Selected engine", signedIn: true, ...selection }) });
    for (const tool of ["ArtifactData", "ArtifactComments", "Artifact"]) {
      const answer = await checkRoutineReadiness({ ...routine, prompt: `Use ${tool} on https://claude.ai/code/artifact/00000000-0000-4000-8000-000000000000.` }, run, check);
      expect(answer.ok).toBe(false);
      const blocker = answer.checks.find(row => !row.ok)!;
      expect(blocker).toMatchObject({ kind: "engine", code: "engine_artifacts", params: { engine: "Selected engine", tool } });
      expect(blocker.line).toContain("claude.ai subscription sign-in");
      expect(loadRoutineReadiness([blocker])).toEqual([blocker]);
    }
    expect((await checkRoutineReadiness(routine, run, check)).ok).toBe(true);
  });
  it.each([
    { driver: "claudeAgent", accessVia: "subscription", keyBacked: true },
    { driver: "claudeAgent", accessVia: "server", keyBacked: false },
    {},
  ])("keeps supported or unknown artifact accounts runnable: %j (#1990)", async (selection) => {
    const check = deps({ engine: () => ({ engine: "fixture-engine", name: "Selected engine", signedIn: true, ...selection }) });
    expect((await checkRoutineReadiness({ ...routine, prompt: "Use ArtifactData to read last-pass." }, run, check)).ok).toBe(true);
  });
  it("uses the run's effective prompt for artifact readiness (#1990)", async () => {
    const check = deps({ engine: () => ({ engine: "fixture-engine", name: "Selected engine", driver: "codex" }) });
    expect((await checkRoutineReadiness(routine, { ...run, prompt: "Use ArtifactData." }, check)).ok).toBe(false);
    expect((await checkRoutineReadiness({ ...routine, prompt: "Use ArtifactData." }, { ...run, prompt: "Check the inbox." }, check)).ok).toBe(true);
  });
  it("blocks a failed Flow shadow plan instead of passing only its access checks (#1991)", async () => {
    const answer = await checkRoutineReadiness({ ...routine, prompt: "Use flow_run." }, run,
      deps({ flow: async () => ({ step: "plan", error: "internal_error Plan failed." }) }), "check");
    expect(answer.ok).toBe(false);
    expect(loadRoutineReadiness(answer.checks)?.find(check => check.kind === "flow")).toMatchObject({ code: "flow_plan", ok: false, params: { step: "plan", error: "internal_error Plan failed." } });
  });
  it.each([false, true])("checks artifact support on the backup beside a failed Flow plan (supported: %s)", async (supported) => {
    const now = 60_000;
    const engine = `flow-artifact-primary-${supported}`;
    noteEngineRefusal({ engine, cause: "credits", at: now });
    try {
      const answer = await checkRoutineReadiness({ ...routine, prompt: "Use flow_run and ArtifactData." }, run, deps({
        now: () => now,
        engine: () => ({ engine, name: "Primary", driver: supported ? "codex" : "claudeAgent", accessVia: "subscription" }),
        backup: () => ({ engine: "backup", name: "Backup", driver: supported ? "claudeAgent" : "codex", accessVia: "subscription" }),
        flow: async () => ({ step: "plan", error: "missing_reads Read first." }),
      }), "check");
      expect(answer.ok).toBe(false);
      expect(answer.checks.filter(check => !check.ok).map(check => check.code)).toEqual(supported ? ["flow_plan"] : ["engine_artifacts", "flow_plan"]);
      expect(loadRoutineReadiness(answer.checks)).toEqual(answer.checks);
      if (!supported) expect(answer.checks.find(check => check.code === "engine_artifacts")?.params?.engine).toBe("Backup");
    } finally { clearEngineRefusal(engine, undefined, now); }
  });
  it("caches shadow plans per routine and inputs without reusing another routine's result (#1991)", async () => {
    let now = 0;
    const flow = vi.fn(async () => ({}));
    const check = deps({ now: () => now, flow });
    const first = { ...routine, id: "morning", prompt: "Use flow_run.", requires: { skills: ["running-px-flow"] } };
    await checkRoutineReadiness(first, run, check);
    expect(flow).not.toHaveBeenCalled();  // a routine run never probes Flow (2026-11-04)
    await checkRoutineReadiness(first, run, check, "check");
    await checkRoutineReadiness(first, run, check, "check");
    expect(flow).toHaveBeenCalledOnce();
    await checkRoutineReadiness({ ...first, id: "evening" }, run, check, "check");
    await checkRoutineReadiness({ ...first, prompt: "Use flow_run with different inputs." }, run, check, "check");
    await checkRoutineReadiness(first, { ...run, runAs: "wren" }, check, "check");
    now = 60_000;
    await checkRoutineReadiness(first, run, check, "check");
    expect(flow).toHaveBeenCalledTimes(5);
    await checkRoutineReadiness(routine, run, check, "check");
    expect(flow).toHaveBeenCalledTimes(5);
  });
  it("passes unknown facts, checks every category and never infers a successful run", async () => {
    expect(await checkRoutineReadiness(routine, run, deps())).toMatchObject({ ok: true, checks: expect.arrayContaining([
      { kind: "engine", ok: true, code: "ready", params: { kind: "engine" }, line: expect.any(String) },
    ]) });
    expect((await checkRoutineReadiness(routine, run, deps())).checks).toHaveLength(5);
  });
  it("infers Flow and backticked skill ids only near a skill reference", () => {
    for (const prompt of ["Pulsatrix Flow", "pulsatrix-flow", "px_flow", "flow_run", "using-px-flow", "running-px-flow", "routine Flow"]) {
      expect(routineNeededSkills(prompt)).toEqual(["using-px-flow", "running-px-flow"]);
    }
    expect(routineNeededSkills("Use skill `inbox-review` and open `report-file`." , { skills: ["explicit"] })).toContain("inbox-review");
    expect(routineNeededSkills("Open `report-file`. ")).toEqual([]);
  });
  it("blocks missing enabled skills and MCP servers using known tool prefixes", async () => {
    const answer = await checkRoutineReadiness({ ...routine, prompt: "Use Pulsatrix Flow and outlook_read and cw_psa_ticket.", requires: { skills: ["explicit"], mcpServers: ["calendar"] } }, run,
      deps({ skills: () => ["explicit"], mcp: () => ({ known: ["outlook", "calendar", "perspicax"], enabled: ["calendar"], toolPrefixes: { cw_psa: "perspicax" } }) }));
    expect(answer.ok).toBe(false);
    expect(answer.checks.filter(check => !check.ok).map(check => check.params)).toEqual([
      { skill: "using-px-flow" }, { skill: "running-px-flow" }, { server: "outlook" }, { server: "perspicax" },
    ]);
  });
  it.each(["off/flow_guard_uncovered", "off/flow_guard_not_enforced", "on/installed"])("reads Flow product skills through the pack with organization install %s (#1945)", async (installation) => {
    const flow = { ...routine, prompt: "Use Pulsatrix Flow and skill `testing-px-flow-skills`.", requires: { skills: ["remote-pack-review"] } };
    const check = deps({ skills: () => [], flowSkills: () => routineFlowSkills(true,
      installation === "on/installed" ? { ...declaration, enabled: true, guard: "enforce" } : declaration,
      installation === "on/installed" ? { mode: "on", plugins: [{ id: "flow@pack", tenant: false, state: "installed" }] }
        : { mode: "off", plugins: [], reason: installation.split("/")[1] }) });
    for (const mode of ["run", "check"] as const) {
      const answer = await checkRoutineReadiness(flow, run, check, mode);
      expect(answer.ok).toBe(true);
      expect(answer.checks.find(row => row.kind === "skills")).toMatchObject({ ok: true, code: "ready",
        detail: `Flow skills are served by the active Flow pack through Perspicax (organization install: ${installation})` });
    }
    expect((await checkRoutineReadiness({ ...routine, requires: { skills: ["inbox-review"] } }, run, check)).ok).toBe(false);
  });
  it("serves Flow from the active pack without any bot profile eligibility (#1945)", async () => {
    const answer = await checkRoutineReadiness({ ...routine, prompt: "Use flow_run." }, run,
      deps({ skills: () => [], flowSkills: () => routineFlowSkills(true, declaration, { mode: "off", plugins: [], reason: "flow_guard_uncovered" }) }));
    expect(answer.ok).toBe(true);
    expect(answer.checks.find(row => row.kind === "skills")).toMatchObject({ ok: true, code: "ready" });
    expect((await checkRoutineReadiness({ ...routine, prompt: "Use flow_run." }, run, deps({ skills: () => [] }))).ok).toBe(false);
    expect(routineFlowSkills(false, declaration, { mode: "off", plugins: [] })).toBeUndefined();
    expect(routineFlowSkills(true, undefined, { mode: "unknown", plugins: [] })).toBeUndefined();
  });
  it("uses account-scoped 402 memory for 30 minutes and a completed turn clears it immediately", async () => {
    let now = Date.UTC(2026, 10, 4, 23, 30);
    const engine = "grok-readiness-credits";
    noteEngineRefusal({ engine, account: "wren", cause: "credits", at: now });
    const check = deps({ now: () => now, engine: () => ({ engine, name: "Grok", account: "wren", signedIn: true }) });
    now += 5 * 60_000;
    const blocked = await checkRoutineReadiness(routine, run, check);
    expect(blocked.checks[0]).toMatchObject({ code: "engine_credits", ok: false, params: { at: "2026-11-04T23:30:00.000Z" }, line: expect.stringContaining("23:30 UTC") });
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
    expect((await checkRoutineReadiness(routine, run, deps({ now: () => now + 60_000, engine: () => ({ engine, name: "Claude" }) }))).checks[0]).toMatchObject({ code: "engine_limit", params: { until: "2026-11-04T06:00:00.000Z" }, line: expect.stringContaining("06:00 UTC") });
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
  it("does not call an engine whose sign-ins are still loading signed out, and never caches that probe (#3125)", async () => {
    const engine = vi.fn(() => ({ engine: "starting-engine", name: "Claude", signedIn: false, starting: true }));
    const shared = deps({ engine });
    const first = (await checkRoutineReadiness(routine, run, shared)).checks[0];
    expect(first).toMatchObject({ code: "engine_signed_out", ok: false, params: { starting: "true" } });
    expect(first?.line).not.toMatch(/Reconnect/);
    await checkRoutineReadiness(routine, run, shared);
    expect(engine).toHaveBeenCalledTimes(2);
  });
  it("blocks known sign-out before any provider turn", async () => {
    expect((await checkRoutineReadiness(routine, run, deps({ engine: () => ({ engine: "codex", name: "Codex", signedIn: false }) }))).checks[0]).toMatchObject({ code: "engine_signed_out", ok: false });
  });
  it.each(["credits", "usage_limit", "signed_out"] as const)("passes a primary %s refusal when a backup is ready (#1986)", async (cause) => {
    const now = Date.UTC(2026, 10, 4);
    const engine = `primary-with-backup-${cause}`;
    noteEngineRefusal({ engine, cause, at: now });
    const backup = vi.fn(() => ({ engine: "backup", name: "Backup", signedIn: true }));
    const answer = await checkRoutineReadiness(routine, run, deps({ now: () => now,
      engine: () => ({ engine, name: "Primary" }), backup }));
    expect(answer.ok).toBe(true);
    expect(answer.checks.find(check => check.kind === "engine")).toMatchObject({
      ok: true, code: "ready",
      detail: "Primary cannot run this turn; Backup is ready and will run it.",
    });
    expect(backup).toHaveBeenCalledOnce();
  });
  it.each(["missing", "credits", "usage_limit", "signed_out"] as const)("keeps the primary reason when its backup is %s (#1986)", async (cause) => {
    const now = Date.UTC(2026, 10, 4);
    const engine = `primary-without-backup-${cause}`;
    const backupEngine = `unavailable-backup-${cause}`;
    noteEngineRefusal({ engine, cause: "credits", at: now });
    if (cause !== "missing") noteEngineRefusal({ engine: backupEngine, cause, at: now });
    const answer = await checkRoutineReadiness(routine, run, deps({ now: () => now,
      engine: () => ({ engine, name: "Primary" }),
      backup: () => cause === "missing" ? undefined : { engine: backupEngine, name: "Backup" } }));
    expect(answer.ok).toBe(false);
    expect(answer.checks[0]).toMatchObject({ ok: false, code: "engine_credits", params: { engine: "Primary" } });
  });
  it("rechecks backup refusals while primary probe facts are cached (#1986)", async () => {
    const now = Date.UTC(2026, 10, 4);
    const engine = "cached-primary-with-backup";
    const backupEngine = "fresh-backup-refusal";
    noteEngineRefusal({ engine, cause: "credits", at: now });
    const primary = vi.fn(() => ({ engine, name: "Primary" }));
    const check = deps({ now: () => now, engine: primary,
      backup: () => ({ engine: backupEngine, name: "Backup" }) });
    expect((await checkRoutineReadiness(routine, run, check)).ok).toBe(true);
    noteEngineRefusal({ engine: backupEngine, cause: "credits", at: now });
    expect((await checkRoutineReadiness(routine, run, check)).ok).toBe(false);
    expect(primary).toHaveBeenCalledOnce();
  });
  it("keeps backup discovery inside the readiness probe deadline (#1986)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const now = Date.UTC(2026, 10, 4);
    const engine = "slow-primary-with-backup";
    noteEngineRefusal({ engine, cause: "credits", at: now });
    const answer = checkRoutineReadiness(routine, run, deps({ now: () => now,
      engine: () => new Promise(resolve => setTimeout(() => resolve({ engine, name: "Primary" }), 4_000)),
      backup: () => new Promise(() => {}) }));
    await vi.advanceTimersByTimeAsync(ROUTINE_READINESS_PROBE_TIMEOUT_MS);
    expect((await answer).checks[0]).toMatchObject({ code: "engine_credits", ok: false });
    expect(vi.getTimerCount()).toBe(0);
  });
  it("blocks a refused account connection, while unreachable Perspicax stays a passing detail", async () => {
    expect((await checkRoutineReadiness(routine, run, deps({ perspicax: async () => ({ refused: true, detail: "401 invalid_token" }) }))).ok).toBe(false);
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
  it("keeps the selected computer's specific refusal instead of calling an unsupported model offline", async () => {
    const detail = "Wren model can't use a computer. Choose a model that can.";
    const answer = await checkRoutineReadiness(routine, run, deps({ computers: () => [{ name: "Cloud computer", online: false, needed: true, detail }] }));
    expect(answer.ok).toBe(false);
    expect(answer.checks[0]).toMatchObject({ kind: "computer", ok: false, code: "computer_offline", line: detail });
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
  it.each(["run", "check"] as const)("bounds probes below 5 seconds and reports errors in %s mode (#1945)", async (mode) => {
    vi.useFakeTimers();
    const answer = checkRoutineReadiness(routine, run, deps({ engine: () => new Promise(() => {}), skills: () => { throw new Error("inventory unreadable"); }, perspicax: () => new Promise(() => {}) }), mode);
    await vi.advanceTimersByTimeAsync(ROUTINE_READINESS_PROBE_TIMEOUT_MS);
    const result = await answer;
    expect(result.ok).toBe(mode === "run");
    expect(result.checks.find(check => check.kind === "engine")).toMatchObject({ code: "probe_error", detail: expect.stringContaining("timed out") });
    expect(result.checks.find(check => check.kind === "skills")).toMatchObject({ code: "probe_error", detail: "inventory unreadable" });
    expect(result.checks.find(check => check.kind === "perspicax")?.ok).toBe(mode === "run");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("keeps explicit blockers when another probe fails, and reports cached errors on demand", async () => {
    const check = deps({ engine: () => { throw new Error("probe unavailable"); }, skills: () => [] });
    const needed = { ...routine, requires: { skills: ["inbox-review"] } };
    const answer = await checkRoutineReadiness(needed, run, check);
    expect(answer.ok).toBe(false);
    expect(answer.checks.filter(row => !row.ok).map(row => row.code)).toEqual(["skill_missing"]);
    expect((await checkRoutineReadiness(routine, run, check, "check")).checks.find(row => row.kind === "engine")).toMatchObject({ ok: false, code: "probe_error" });
    const broken = deps({ cacheKey: () => { throw new Error("bad configuration"); } });
    expect((await checkRoutineReadiness(routine, run, broken)).ok).toBe(true);
    expect((await checkRoutineReadiness(routine, run, broken, "check")).ok).toBe(false);
  });
});
