import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MyEngine } from "@/lib/perspicax-org";
import type { InstanceInfo } from "@/state/store";
import { HEALTH_TTL_MS, engineRuns, modelUsable, refreshModelHealth, resetModelHealthClock, startingModel, usableModels } from "./model-health";

const solo = { orgMode: false };
const engine = (instanceId: string, extra: Partial<InstanceInfo> = {}, snapshot: Partial<InstanceInfo["snapshot"]> = {}): InstanceInfo => ({
  instanceId, driverKind: "openaiCompat", displayName: instanceId, access: "api",
  snapshot: { state: "available", authenticated: true, ...snapshot },
  models: { default: `${instanceId}-big`, options: [{ id: `${instanceId}-big`, label: "Big" }, { id: `${instanceId}-small`, label: "Small" }] },
  ...extra,
});

describe("which models can run a turn", () => {
  it("needs the engine installed, allowed and paid for", () => {
    expect(modelUsable(engine("claude"), "claude-big", solo)).toBe(true);
    // no saved API key, no sign-in
    expect(modelUsable(engine("claude", {}, { authenticated: false }), "claude-big", solo)).toBe(false);
    // not installed
    expect(modelUsable(engine("claude", {}, { state: "unavailable" }), "claude-big", solo)).toBe(false);
    // blocked by the organization's desktop policy
    expect(engineRuns(engine("claude", { policy: { organizationName: "Acme", reason: "no" } }), solo)).toBe(false);
    // a model the engine does not offer
    expect(modelUsable(engine("claude"), "gone", solo)).toBe(false);
  });

  it("keeps a signed-out engine's local models and drops the ones it cannot run", () => {
    const grok = engine("grok", {
      driverKind: "grokAgent",
      models: { default: "grok-4.7", options: [
        { id: "grok-4.7", label: "Grok 4.7" },
        { id: "dwarfstar::qwen", label: "DwarfStar: Qwen", custom: true, local: true },
      ] },
    }, { authenticated: false });
    expect(modelUsable(grok, "grok-4.7", solo)).toBe(false);
    expect(modelUsable(grok, "dwarfstar::qwen", solo)).toBe(true);
    const gemini = engine("gemini", { driverKind: "geminiAgent", models: { default: "gemini-pro", options: [
      { id: "gemini-pro", label: "Gemini Pro" },
      { id: "dwarfstar::qwen", label: "DwarfStar: Qwen", custom: true, local: true },
    ] } });
    // Gemini keeps its own endpoint: it cannot run a local model
    expect(modelUsable(gemini, "dwarfstar::qwen", solo)).toBe(false);
  });

  it("asks the person's engines on an organization server", () => {
    const facts = (instanceId: string, myTurns: MyEngine["myTurns"]) => ({ instanceId, driver: "x", displayName: instanceId, installed: true,
      subscription: { supported: true, signedIn: false }, myKey: false, orgKey: false, myTurns }) as unknown as MyEngine;
    const org = { orgMode: true, myEngines: [facts("claude", "org-key"), facts("codex", "none")] };
    expect(modelUsable(engine("claude", {}, { authenticated: false }), "claude-big", org)).toBe(true);
    expect(modelUsable(engine("codex"), "codex-big", org)).toBe(false);
    expect(usableModels([engine("claude"), engine("codex")], org).map((entry) => entry.modelId)).toEqual(["claude-big", "claude-small"]);
  });
});

describe("the model a new bot starts on", () => {
  const configured = { instanceId: "claude", model: "claude-big" };

  it("keeps the configured default when it works", () => {
    expect(startingModel(configured, [engine("claude"), engine("grok")], solo)).toEqual({ kind: "default", selection: configured });
  });

  it("starts on Auto, on a model that works, when the default does not", () => {
    const instances = [engine("claude", {}, { authenticated: false }), engine("grok")];
    expect(startingModel(configured, instances, solo)).toEqual({ kind: "auto", selection: { instanceId: "grok", model: "grok-big", auto: true } });
    expect(startingModel(configured, instances, { ...solo, autoOffered: false })).toEqual({ kind: "first", selection: { instanceId: "grok", model: "grok-big" } });
  });

  it("keeps Auto when the resolved default is Auto and its engine works (the new-bot default)", () => {
    // The server hands a new bot its default on Auto (autoNewBotSelection); the
    // engine works, so the bot opens on Auto rather than pinned to one model.
    const auto = { instanceId: "claude", model: "claude-big", auto: true as const };
    expect(startingModel(auto, [engine("claude"), engine("grok")], solo)).toEqual({ kind: "default", selection: auto });
  });

  it("leaves an explicit pin pinned: an advanced default is never forced to Auto", () => {
    // A template that pins a model carries no auto flag; it stays pinned.
    expect(startingModel(configured, [engine("claude"), engine("grok")], solo)).toEqual({ kind: "default", selection: configured });
  });

  it("says none works and keeps the default", () => {
    const instances = [engine("claude", {}, { authenticated: false }), engine("grok", {}, { state: "unavailable" })];
    expect(startingModel(configured, instances, solo)).toEqual({ kind: "none", selection: configured });
  });
});

describe("the background check", () => {
  beforeEach(() => resetModelHealthClock());

  it("asks the server at most once per TTL, however many forms open", async () => {
    const refresh = vi.fn(() => Promise.resolve());
    const start = 1_000_000;
    for (let at = 0; at < 10; at++) refreshModelHealth(refresh, start + at * 1_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    await refreshModelHealth(refresh, start + HEALTH_TTL_MS + 1);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("swallows a failed check: the list on hand stays", async () => {
    await expect(refreshModelHealth(() => Promise.reject(new Error("offline")), 10 * HEALTH_TTL_MS)).resolves.toBeUndefined();
  });
});
