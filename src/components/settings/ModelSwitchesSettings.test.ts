import { describe, expect, it } from "vitest";

import type { InstanceInfo } from "@/state/store";
import { activeModelProviders, onCount, switchableModels, toggledList } from "./ModelSwitchesSettings";

type Row = { id: string; label?: string; local?: boolean; custom?: boolean; server?: string };
const instance = (instanceId: string, driverKind: string, displayName: string, rows: Row[], extra: Partial<InstanceInfo> = {}): InstanceInfo => ({
  instanceId, driverKind, displayName,
  snapshot: { state: "available", authenticated: true },
  models: { default: rows[0]?.id ?? "", options: rows.map((row) => ({ label: row.label ?? row.id, ...row })) },
  ...extra,
}) as InstanceInfo;

describe("Settings > Models > Active models", () => {
  it("lists an engine's own models, never a model of this computer grafted on it", () => {
    expect(switchableModels({ models: { default: "a", options: [{ id: "a", label: "A" }, { id: "b", label: "" }, { id: "x", label: "X", local: true }, { id: "srv::m", label: "M" }] } })).toEqual([
      { id: "a", label: "A" },
      { id: "b", label: "b" },
    ]);
  });

  it("counts the models on and switches one in the person's list", () => {
    const models = [{ id: "opus" }, { id: "sonnet" }, { id: "haiku" }];
    expect(onCount("claude", models, { org: ["claude/opus"], mine: ["claude/haiku"] })).toBe(1);
    expect(toggledList(["claude/haiku"], "claude/sonnet", false)).toEqual(["claude/haiku", "claude/sonnet"]);
    expect(toggledList(["claude/haiku", "claude/sonnet"], "claude/haiku", true)).toEqual(["claude/sonnet"]);
  });

  // #4329 lot 4: the folds are the providers of the shared catalog, never the engines
  it("folds by provider, with the providers' names and order, each model once with every engine that runs it", () => {
    const groups = activeModelProviders([
      instance("pi", "piAgent", "pi", [
        { id: "anthropic/claude-opus-5" }, { id: "openai/gpt-6" }, { id: "xai/grok-5" }, { id: "mistral/large-3" },
        { id: "px-own-lab/qwen3", label: "qwen3", custom: true, server: "Home server" },
      ]),
      instance("opencodeGo", "opencodeGo", "OpenCode", [{ id: "opencode/big-pickle", label: "Big Pickle" }, { id: "openai/gpt-6" }]),
      instance("codex", "codex", "Codex", [{ id: "gpt-6", label: "GPT-6" }], { access: "subscription" }),
      instance("chatgpt", "codex", "ChatGPT plan", [{ id: "gpt-6", label: "GPT-6" }], { access: "subscription" }),
      instance("grok", "grokAgent", "Grok", [{ id: "grok-5", label: "Grok 5" }], { access: "subscription" }),
      instance("claude", "claudeAgent", "Claude", [{ id: "claude-opus-5", label: "Opus 5" }, { id: "desk::qwen3", local: true }], { access: "subscription" }),
    ], "solo");
    const labels = groups.map((group) => group.label);
    // the signed-in accounts first, Claude, OpenAI and the xAI group heading them
    expect(labels.slice(0, 3)).toEqual(["Claude", "OpenAI", "SpaceXAI"]);
    expect(labels).toContain("Home server");
    expect(labels).toContain("OpenCode");
    // never a fold named after a tool or an engine, never this computer
    for (const word of ["Codex", "ChatGPT plan", "Grok", "pi", "Other (OpenAI-compatible)", "This computer"]) expect(labels).not.toContain(word);
    const openai = groups.find((group) => group.label === "OpenAI")!;
    expect(openai.models).toHaveLength(1);
    expect(openai.models[0]).toMatchObject({ label: "GPT-6", keys: ["codex/gpt-6", "chatgpt/gpt-6", "pi/openai/gpt-6", "opencodeGo/openai/gpt-6"] });
    const claude = groups.find((group) => group.label === "Claude")!;
    expect(claude.models.map((model) => model.keys)).toEqual([["claude/claude-opus-5", "pi/anthropic/claude-opus-5"]]);
    // a server added by address is a provider of its own name
    expect(groups.find((group) => group.label === "Home server")!.models.map((model) => model.keys)).toEqual([["pi/px-own-lab/qwen3"]]);
    // only OpenCode's own subscription models stay under OpenCode
    expect(groups.find((group) => group.label === "OpenCode")!.models.map((model) => model.label)).toEqual(["Big Pickle"]);
  });

  it("keeps out the models of an engine that cannot run them now, and a provider left with none", () => {
    const groups = activeModelProviders([
      instance("claude", "claudeAgent", "Claude", [{ id: "claude-opus-5" }], { access: "subscription", snapshot: { state: "available", authenticated: false } }),
      instance("pi", "piAgent", "pi", [{ id: "anthropic/claude-opus-5" }, { id: "openai/gpt-6" }], { snapshot: { state: "unavailable" } }),
      instance("codex", "codex", "Codex", [{ id: "gpt-6" }], { access: "subscription" }),
    ], "solo");
    expect(groups.map((group) => group.label)).toEqual(["OpenAI"]);
    expect(groups[0]!.models[0]!.keys).toEqual(["codex/gpt-6"]);
  });

  it("switches every key of a model at once", () => {
    expect(toggledList(["a/x"], ["claude/opus", "pi/anthropic/opus"], false)).toEqual(["a/x", "claude/opus", "pi/anthropic/opus"]);
    expect(toggledList(["a/x", "claude/opus", "pi/anthropic/opus"], ["claude/opus", "pi/anthropic/opus"], true)).toEqual(["a/x"]);
  });
});
