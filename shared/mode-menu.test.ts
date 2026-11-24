// The mode menu's one definition (M-20261123-040, M-20261123-045,
// M-20261123-047). The console keeps the same cases in
// `console/scripts/mode-menu.test.mjs`: change both together.
import { describe, expect, it } from "vitest";

import {
  currentInCascade, menuRows, modeSetsEffort, openProvider, panelBack, providerOpens, reasoningRow, settlePanel, usableCascade,
  type CascadeProvider,
} from "./mode-menu.ts";

const model = (id: string, usable = true, current = false) => ({ id, label: id, usable, current, data: id });
const providers = (): CascadeProvider<string>[] => [
  {
    id: "anthropic", label: "Claude", accounts: [
      { id: "claude-a", label: "ada@example.com", usable: true, models: [model("opus", true, true), model("haiku", false)] },
      { id: "claude-b", label: "ada.admin@acme.test", usable: true, models: [model("opus"), model("mythos")] },
      { id: "claude-c", label: "old@example.com", usable: false, models: [model("opus")] },
    ],
  },
  { id: "xai", label: "Grok", accounts: [{ id: "grok", label: "Grok", usable: true, models: [model("grok-4")] }] },
  { id: "openai", label: "OpenAI", accounts: [{ id: "codex", label: "ChatGPT", usable: false, models: [model("gpt")] }] },
  { id: "gemini", label: "Gemini", accounts: [{ id: "gemini", label: "Gemini", usable: true, models: [model("pro", false)] }] },
  { id: "local", label: "Local", accounts: [{ id: "studio", label: "Studio", usable: true, models: [model("flash")] }] },
];

describe("the menu's rows", () => {
  it("Auto, Fast, Expert, Heavy, Build, then Reasoning, then All models, a separator before each", () => {
    expect(menuRows({ reasoning: true, all: true }).map((row) => (row.kind === "mode" ? row.id : row.kind))).toEqual([
      "auto", "fast", "expert", "heavy", "build", "separator", "reasoning", "separator", "all",
    ]);
  });

  it("a mode the server does not serve is not drawn; Auto always is", () => {
    expect(menuRows({ offered: ["fast", "build"], reasoning: false, all: true }).map((row) => (row.kind === "mode" ? row.id : row.kind))).toEqual([
      "auto", "fast", "build", "separator", "all",
    ]);
  });
});

describe("the Reasoning row", () => {
  it("keeps Auto available until a person explicitly chooses a reasoning level", () => {
    const input = { mode: "auto", levels: ["low", "high"], modelDefault: "high" };
    expect(reasoningRow(input)).toEqual({ shown: true, disabled: false, value: undefined, choices: [null, "low", "high"] });
    expect(reasoningRow({ ...input, value: "high" }).value).toBe("high");
  });

  it("offers the levels of the model in use, its default checked while none is chosen", () => {
    expect(reasoningRow({ mode: "build", levels: ["low", "medium", "high"], modelDefault: "medium" })).toEqual({
      shown: true, disabled: false, value: "medium", choices: ["low", "medium", "high"],
    });
    expect(reasoningRow({ mode: null, levels: ["low", "high"], value: "high" })).toEqual({
      shown: true, disabled: false, value: "high", choices: [null, "low", "high"],
    });
  });

  it("follows the model: a level the new model does not take is not shown as chosen", () => {
    expect(reasoningRow({ mode: "build", levels: ["low", "high"], value: "xhigh" }).value).toBeUndefined();
  });

  it("is greyed under a mode that sets its own level, and shows that level", () => {
    for (const mode of ["fast", "expert", "heavy"]) expect(modeSetsEffort(mode)).toBe(true);
    for (const mode of ["auto", "build", null]) expect(modeSetsEffort(mode)).toBe(false);
    expect(reasoningRow({ mode: "expert", levels: ["low", "high"], value: "low", imposed: "high" })).toEqual({
      shown: true, disabled: true, value: "high", choices: [],
    });
  });

  it("has no row when the model takes no level and the mode imposes none", () => {
    expect(reasoningRow({ mode: "auto", levels: [] }).shown).toBe(false);
    expect(reasoningRow({ mode: "fast", levels: ["low"] }).shown).toBe(false);
  });
});

describe("All models", () => {
  it("lists only what can run now: no signed-out account, no model turned off, no empty provider", () => {
    const listed = usableCascade(providers());
    expect(listed.map((provider) => provider.id)).toEqual(["anthropic", "xai", "local"]);
    expect(listed[0]!.accounts.map((account) => [account.id, account.models.map((one) => one.id)])).toEqual([
      ["claude-a", ["opus"]],
      ["claude-b", ["opus", "mythos"]],
    ]);
  });

  it("a provider with several accounts opens its accounts; one account goes straight to its models", () => {
    const [claude, grok, local] = usableCascade(providers());
    expect(providerOpens(claude!)).toBe("account");
    expect(openProvider(claude!)).toEqual({ panel: "accounts", provider: "anthropic" });
    expect(openProvider(grok!)).toEqual({ panel: "models", provider: "xai", account: "grok" });
    // Local is a provider, its servers where the accounts are
    expect(openProvider(local!)).toEqual({ panel: "models", provider: "local", account: "studio" });
  });

  it("the back row retraces the steps, skipping the account panel that was skipped", () => {
    const listed = usableCascade(providers());
    expect(panelBack({ panel: "models", provider: "anthropic", account: "claude-b" }, listed)).toEqual({ panel: "accounts", provider: "anthropic" });
    expect(panelBack({ panel: "models", provider: "xai", account: "grok" }, listed)).toEqual({ panel: "providers" });
    expect(panelBack({ panel: "accounts", provider: "anthropic" }, listed)).toEqual({ panel: "providers" });
    expect(panelBack({ panel: "providers" }, listed)).toEqual({ panel: "root" });
    expect(panelBack({ panel: "reasoning" }, listed)).toEqual({ panel: "root" });
  });

  it("a panel whose provider or account left the list falls back instead of drawing nothing", () => {
    const listed = usableCascade(providers());
    expect(settlePanel({ panel: "accounts", provider: "openai" }, listed)).toEqual({ panel: "providers" });
    expect(settlePanel({ panel: "models", provider: "anthropic", account: "claude-c" }, listed)).toEqual({ panel: "accounts", provider: "anthropic" });
    expect(settlePanel({ panel: "accounts", provider: "xai" }, listed)).toEqual({ panel: "models", provider: "xai", account: "grok" });
  });

  it("finds the model in use", () => {
    const found = currentInCascade(usableCascade(providers()));
    expect([found?.provider.id, found?.account.id, found?.model.id]).toEqual(["anthropic", "claude-a", "opus"]);
  });
});
