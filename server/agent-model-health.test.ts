import { describe, expect, it } from "vitest";
import type { EngineRefusal } from "./engines/engine-refusals.ts";
import { modelHealth, refusalIsTheirs, type HealthSources } from "./agent-model-health.ts";

const NONE: HealthSources = { refusals: [], limit: null };
const claude = { instanceId: "claude", driverKind: "claudeAgent", snapshot: { state: "available", authenticated: true } };
const refusal = (cause: EngineRefusal["cause"], resetsAt?: number): EngineRefusal => ({ engine: "claude", cause, at: 1, ...(resetsAt ? { resetsAt } : {}) });

describe("modelHealth", () => {
  it("a healthy cloud model", () => {
    expect(modelHealth(claude, { id: "m" }, NONE)).toEqual({ signed_in: true, limit_reached: false, out_of_credits: false, kind: "cloud" });
  });

  it("signed_in follows the engine's sign-in snapshot and a held sign-out", () => {
    expect(modelHealth({ ...claude, snapshot: { state: "available", authenticated: false } }, { id: "m" }, NONE).signed_in).toBe(false);
    expect(modelHealth({ ...claude, snapshot: { state: "unavailable" } }, { id: "m" }, NONE).signed_in).toBe(false);
    expect(modelHealth(claude, { id: "m" }, { ...NONE, refusals: [refusal("signed_out")] }).signed_in).toBe(false);
  });

  it("limit_reached and resets_at come from the usage clock or a refusal", () => {
    const at = Date.UTC(2026, 10, 20, 12);
    const fromClock = modelHealth(claude, { id: "m" }, { refusals: [], limit: { resetsAt: at } });
    expect(fromClock).toMatchObject({ limit_reached: true, resets_at: "2026-11-20T12:00:00.000Z" });
    const later = modelHealth(claude, { id: "m" }, { refusals: [refusal("usage_limit", at + 3600_000)], limit: { resetsAt: at } });
    expect(later.resets_at).toBe("2026-11-20T13:00:00.000Z");
    const unsaid = modelHealth(claude, { id: "m" }, { refusals: [], limit: { resetsAt: null } });
    expect(unsaid.limit_reached).toBe(true);
    expect("resets_at" in unsaid).toBe(false);
  });

  it("out_of_credits comes from a credits refusal only", () => {
    expect(modelHealth(claude, { id: "m" }, { ...NONE, refusals: [refusal("credits")] })).toMatchObject({ out_of_credits: true, limit_reached: false });
    expect(modelHealth(claude, { id: "m" }, { ...NONE, refusals: [refusal("usage_limit")] }).out_of_credits).toBe(false);
  });

  it("kind is local for a computer model and a pi local host, with no account state", () => {
    const dead = { refusals: [refusal("credits"), refusal("signed_out")], limit: { resetsAt: 5 } };
    const signedOut = { ...claude, snapshot: { state: "available", authenticated: false } };
    expect(modelHealth(signedOut, { id: "desk::qwen" }, dead)).toEqual({ signed_in: true, limit_reached: false, out_of_credits: false, kind: "local" });
    expect(modelHealth(signedOut, { id: "x", local: true }, dead).kind).toBe("local");
    expect(modelHealth({ instanceId: "pi", driverKind: "piAgent" }, { id: "ollama/llama" }, NONE).kind).toBe("local");
    expect(modelHealth({ instanceId: "pi", driverKind: "piAgent" }, { id: "anthropic/claude" }, NONE).kind).toBe("cloud");
  });
});

describe("refusalIsTheirs", () => {
  const org = JSON.stringify(["subscription", "organization", "primary"]);
  const mine = JSON.stringify(["subscription", "pr_1", "primary"]);
  it("the organization's accounts count unless the person pays", () => {
    expect(refusalIsTheirs(org, "pr_1", false)).toBe(true);
    expect(refusalIsTheirs(mine, "pr_1", false)).toBe(false);
  });
  it("a person who pays meets only their own account, never another person's", () => {
    expect(refusalIsTheirs(mine, "PR_1", true)).toBe(true);
    expect(refusalIsTheirs(JSON.stringify(["subscription", "pr_2", "primary"]), "pr_1", true)).toBe(false);
    expect(refusalIsTheirs(org, "pr_1", true)).toBe(false);
  });
});
