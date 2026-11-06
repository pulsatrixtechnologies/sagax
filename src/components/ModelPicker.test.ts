import { Children, createElement, isValidElement, type ChangeEvent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppState, Bot, InstanceInfo } from "@/state/store";
import type { EffortLevel } from "../../shared/wire";

// The picker reads the engine catalog off the store, and the store module
// touches window/localStorage at import time — the same shape
// ComputerPanel.browser.test.ts uses to render a store-backed component
// under vitest's "node" environment.
const fixture = vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  return { instances: [] as InstanceInfo[], modelVariantSessions: {} as AppState["modelVariantSessions"], dispatch: vi.fn() };
});
vi.mock("@/state/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/state/store")>()),
  useStore: () => ({
    state: { instances: fixture.instances, bots: [], modelVariantSessions: fixture.modelVariantSessions },
    dispatch: fixture.dispatch,
    refreshInstances: vi.fn(),
    refreshModels: vi.fn(),
  }),
}));

// These cases cover the full picker; Simple mode has its own file.
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: () => {} }));

const { ClaudeAccountSelect, EffortRow, ModelEngineRail, ModelPicker, ModelVariantRow, modelSelectionForPick, providerRailUnready } = await import("./ModelPicker");

afterAll(() => vi.unstubAllGlobals());

function engine(effortLevels?: readonly EffortLevel[]): InstanceInfo {
  return {
    instanceId: "codex",
    driverKind: "codex",
    displayName: "Codex",
    snapshot: { state: "available", version: "1.0.0" },
    models: { default: "gpt-5.6", options: [{ id: "gpt-5.6", label: "GPT-5.6" }] },
    ...(effortLevels ? { capabilities: { effortLevels } } : {}),
  };
}

function bot(effort?: EffortLevel): Bot {
  return {
    id: "atlas",
    threadId: "thread-atlas",
    name: "Atlas",
    title: "",
    description: "",
    notifications: true,
    color: "green",
    unread: false,
    modelSelection: { instanceId: "codex", model: "gpt-5.6", ...(effort ? { effort } : {}) },
    messages: [],
  };
}

/** Every effort button as rendered, with the state a screen reader announces. */
function levelButtons(markup: string): Array<{ label: string; pressed: boolean }> {
  return [...markup.matchAll(/<button[^>]*aria-pressed="(true|false)"[^>]*>([^<]+)</g)].map((match) => ({
    label: match[2],
    pressed: match[1] === "true",
  }));
}

function renderEffort(instances: InstanceInfo[], effort?: EffortLevel): string {
  fixture.instances = instances;
  return renderToStaticMarkup(createElement(EffortRow, { bot: bot(effort) }));
}

function railButtons(rail: ReactElement<{ children?: ReactNode }>): Array<ReactElement<Record<string, unknown> & { children?: ReactNode }>> {
  const walk = (node: ReactNode): Array<ReactElement<Record<string, unknown> & { children?: ReactNode }>> =>
    Children.toArray(node).flatMap((child) => {
      if (!isValidElement(child)) return [];
      const element = child as ReactElement<Record<string, unknown> & { children?: ReactNode }>;
      if (element.type === "button") return [element];
      return walk(element.props.children);
    });
  return walk(rail.props.children);
}

describe("EffortRow", () => {
  it("uses a compact dropdown without changing scope or conflating None with Default", () => {
    fixture.instances = [engine(["none", "low", "high"])];
    const row = EffortRow({ bot: bot("high"), threadId: "independent-thread", updateBotDefault: true, compact: true })!;
    const select = Children.toArray(row.props.children).at(-1) as ReactElement<{ value: string; onChange: (event: ChangeEvent<HTMLSelectElement>) => void }>;
    expect(select.type).toBe("select");
    expect(select.props.value).toBe("high");
    for (const value of ["none", ""]) {
      select.props.onChange({ target: { value } } as ChangeEvent<HTMLSelectElement>);
      expect(fixture.dispatch).toHaveBeenLastCalledWith({ type: "setModel", botId: "atlas", threadId: "independent-thread", updateBotDefault: true,
        selection: { instanceId: "codex", model: "gpt-5.6", effort: value || undefined } });
    }
    const markup = renderToStaticMarkup(createElement(EffortRow, { bot: bot(), compact: true }));
    expect(markup).toContain('aria-label="Reasoning effort"');
    expect(markup).not.toContain("<button");
    expect([...markup.matchAll(/<option[^>]*>([^<]+)</g)].map((match) => match[1])).toEqual(["Default", "None", "Low", "High", "Ultracode"]);
  });
  it("can apply effort to the pinned thread and bot default together", () => {
    fixture.instances = [engine(["high"])];
    const row = EffortRow({ bot: bot(), threadId: "thread-atlas", updateBotDefault: true })!;
    const levels = Children.toArray(row.props.children).at(-1) as ReactElement<{ children: ReactNode }>;
    const high = Children.toArray(levels.props.children)[1] as ReactElement<{ onClick: () => void }>;
    high.props.onClick();
    expect(fixture.dispatch).toHaveBeenLastCalledWith({ type: "setModel", botId: "atlas", threadId: "thread-atlas", updateBotDefault: true, selection: { instanceId: "codex", model: "gpt-5.6", effort: "high" } });
  });
  it("pins thread effort changes without changing profile defaults", () => {
    fixture.instances = [engine(["high"])];
    const row = EffortRow({ bot: bot(), threadId: "independent-thread" })!;
    const levels = Children.toArray(row.props.children).at(-1) as ReactElement<{ children: ReactNode }>;
    const high = Children.toArray(levels.props.children)[1] as ReactElement<{ onClick: () => void }>;
    high.props.onClick();
    expect(fixture.dispatch).toHaveBeenLastCalledWith({ type: "setModel", botId: "atlas", threadId: "independent-thread", selection: { instanceId: "codex", model: "gpt-5.6", effort: "high" } });
  });
  it("lists ultracode after native effort levels", () => {
    fixture.instances = [engine(["low", "high", "max"])];
    const row = EffortRow({ bot: bot() })!;
    const levels = Children.toArray(row.props.children).at(-1) as ReactElement<{ children: ReactNode }>;
    const labels = Children.toArray(levels.props.children).map(
      (child) => (child as ReactElement<{ children: ReactNode }>).props.children,
    );
    expect(labels).toContain("Ultracode");
  });
  it("lists only the levels the bot's model takes, Default naming its own (2026-10-13)", () => {
    const perModel = (options: InstanceInfo["models"]["options"]): InstanceInfo => ({ ...engine(["low", "medium", "high", "xhigh", "max"]), models: { default: "gpt-5.6", options } });
    fixture.instances = [perModel([{ id: "gpt-5.6", label: "GPT-5.6", effortLevels: ["low", "medium", "high"], defaultEffort: "medium" }])];
    const markup = renderToStaticMarkup(createElement(EffortRow, { bot: bot(), compact: true }));
    expect([...markup.matchAll(/<option[^>]*>([^<]+)</g)].map((match) => match[1])).toEqual(["Default (Medium)", "Low", "Medium", "High", "Ultracode"]);
    // a level kept from another model reads as Default, which is what runs
    expect(levelButtons(renderToStaticMarkup(createElement(EffortRow, { bot: bot("max") }))).find((button) => button.pressed)?.label).toBe("Default (Medium)");
    // a model with no effort control gets no row
    fixture.instances = [perModel([{ id: "gpt-5.6", label: "GPT-5.6", effortLevels: [] }])];
    expect(renderToStaticMarkup(createElement(EffortRow, { bot: bot() }))).toBe("");
  });
  it("keeps a level across a pick when the new model takes it, else lets its default run", () => {
    const instance: InstanceInfo = { ...engine(["low", "medium", "high", "xhigh"]), models: { default: "gpt-5.6", options: [
      { id: "gpt-5.6", label: "GPT-5.6", effortLevels: ["low", "medium", "high", "xhigh"] },
      { id: "gpt-5.5", label: "GPT-5.5", effortLevels: ["low", "medium", "high"], defaultEffort: "medium" },
    ] } };
    expect(modelSelectionForPick({ instanceId: "codex", model: "gpt-5.6", effort: "xhigh" }, instance, "gpt-5.5")).toEqual({ instanceId: "codex", model: "gpt-5.5" });
    expect(modelSelectionForPick({ instanceId: "codex", model: "gpt-5.6", effort: "high" }, instance, "gpt-5.5")).toEqual({ instanceId: "codex", model: "gpt-5.5", effort: "high" });
  });
  it("renders nothing for an engine that declares no effort levels", () => {
    expect(renderEffort([engine()])).toBe("");
    // an engine that declares an empty list is the same promise as none
    expect(renderEffort([engine([])])).toBe("");
    // and so is a bot whose engine is not in the catalog at all
    expect(renderEffort([])).toBe("");
  });

  it("offers only the levels the selected engine accepts, plus Default", () => {
    const markup = renderEffort([engine(["low", "medium", "high"])]);

    expect(levelButtons(markup).map((button) => button.label)).toEqual(["Default", "Low", "Medium", "High", "Ultracode"]);
    // the server rejects a level its engine does not offer, so one that is
    // never shown is one that can never be persisted
    expect(markup).not.toContain(">X-High<");
    expect(markup).not.toContain(">Max<");
  });

  it("keeps Default and None apart — Default sends no level, None sends one", () => {
    const markup = renderEffort([engine(["none", "low"])]);

    expect(levelButtons(markup).map((button) => button.label)).toEqual(["Default", "None", "Low", "Ultracode"]);
  });

  it("marks the active level, and Default when the bot carries no level", () => {
    const pressed = (markup: string) => levelButtons(markup).find((button) => button.pressed)?.label;

    expect(pressed(renderEffort([engine(["low", "high"])], "high"))).toBe("High");
    expect(pressed(renderEffort([engine(["low", "high"])]))).toBe("Default");
  });

  it("renames xhigh, the one level that does not capitalize cleanly", () => {
    expect(renderEffort([engine(["xhigh"])])).toContain(">X-High<");
  });
});


describe("OpenCode model variants", () => {
  const variants = [
    { id: "none", label: "None" }, { id: "minimal", label: "Minimal" },
    { id: "default", label: "Default" }, { id: "deep/custom", label: "Deep custom" },
  ];
  const opencode = (): InstanceInfo => ({ ...engine(), instanceId: "opencode", driverKind: "opencodeGo",
    capabilities: { modelVariants: true }, models: { default: "provider/model", options: [{ id: "provider/model", label: "Model", variants }] } });
  const selected = (variant?: string): Bot => ({ ...bot(), modelSelection: { instanceId: "opencode", model: "provider/model", ...(variant !== undefined ? { variant } : {}) } });
  beforeEach(() => { fixture.instances = [opencode()]; fixture.modelVariantSessions = {}; fixture.dispatch.mockClear(); });
  const render = (variant?: string) => renderToStaticMarkup(createElement(ModelVariantRow, { bot: selected(variant), threadId: "thread-atlas" }));

  it("keeps opaque variant ids and omission distinct in the compact dropdown", () => {
    const row = ModelVariantRow({ bot: selected("default"), threadId: "thread-atlas", compact: true })!;
    const label = Children.toArray(row.props.children)[0] as ReactElement<{ children: ReactNode }>;
    const select = Children.toArray(label.props.children).at(-1) as ReactElement<{ value: string; onChange: (event: ChangeEvent<HTMLSelectElement>) => void }>;
    expect(select.props.value).toBe("2");
    for (const [value, variant] of [["3", "deep/custom"], ["unset", undefined]]) {
      select.props.onChange({ target: { value } } as ChangeEvent<HTMLSelectElement>);
      expect(fixture.dispatch).toHaveBeenLastCalledWith({ type: "setModel", botId: "atlas", threadId: "thread-atlas",
        selection: { instanceId: "opencode", model: "provider/model", ...(variant !== undefined ? { variant } : {}) } });
    }
    const markup = renderToStaticMarkup(createElement(ModelVariantRow, { bot: { ...selected("removed"), busy: true }, compact: true }));
    expect(markup).toContain('disabled=""');
    expect(markup).toContain("removed (unverified)");
    expect(markup).toContain("Use session setting");
  });

  it("offers exact advertised ids without assuming that omission means none or default", () => {
    const markup = render();
    expect(levelButtons(markup)).toEqual([
      { label: "None", pressed: false }, { label: "Minimal", pressed: false },
      { label: "OpenCode default", pressed: false }, { label: "Deep custom", pressed: false },
    ]);
    expect(markup).toContain("No variant selected.");
    expect(fixture.dispatch).not.toHaveBeenCalled();
    expect(levelButtons(render("none")).find((button) => button.pressed)?.label).toBe("None");
  });

  it.each(variants)("persists $id only to the pinned conversation and clears legacy effort", (option) => {
    const configured = selected();
    configured.modelSelection.effort = "high";
    const row = ModelVariantRow({ bot: configured, threadId: "independent-thread" })!;
    const group = Children.toArray(row.props.children).at(-1) as ReactElement<{ children: ReactNode }>;
    const button = Children.toArray(group.props.children)[variants.findIndex((candidate) => candidate.id === option.id)] as ReactElement<{ onClick: () => void }>;
    button.props.onClick();
    expect(fixture.dispatch).toHaveBeenLastCalledWith({ type: "setModel", botId: "atlas", threadId: "independent-thread",
      selection: { instanceId: "opencode", model: "provider/model", variant: option.id } });
  });

  it.each(["none", "default", "minimal", "removed"])("can clear %s to omission without asking for a default or none", (variant) => {
    const row = ModelVariantRow({ bot: selected(variant), threadId: "thread-atlas" })!;
    const clear = Children.toArray(row.props.children).find((child) =>
      typeof child === "object" && "type" in child && child.type === "button") as ReactElement<{ onClick: () => void; title: string }>;
    expect(clear.props.title).toContain("keeps its session or configured setting");
    clear.props.onClick();
    expect(fixture.dispatch).toHaveBeenLastCalledWith({ type: "setModel", botId: "atlas", threadId: "thread-atlas",
      selection: { instanceId: "opencode", model: "provider/model" } });
  });

  it("uses matching session choices, including an empty list, without changing the instance catalog", () => {
    fixture.modelVariantSessions["thread-atlas"] = { instanceId: "opencode", model: "provider/model", turnId: "turn", startedAt: "2026-09-15T00:00:00Z", acceptingUpdates: false,
      variants: { options: [{ id: "minimal", label: "Session minimal" }], currentValue: "minimal" } };
    expect(levelButtons(render()).map((button) => button.label)).toEqual(["Session minimal"]);
    expect(render()).toContain("No variant selected. Session: Session minimal.");
    expect(levelButtons(render()).some((button) => button.pressed)).toBe(false);
    expect(fixture.instances[0].models.options[0].variants).toEqual(variants);
    fixture.modelVariantSessions["thread-atlas"].variants = { options: [] };
    expect(render()).toBe("");
    expect(render("none")).toContain("is unavailable");
    expect(render("none")).not.toContain('aria-label="Reasoning variant"');
  });

  it("ignores another conversation, account, or model's session choices and preserves unavailable saved ids", () => {
    const session = { instanceId: "opencode", model: "provider/model", turnId: "turn", startedAt: "2026-09-15T00:00:00Z", acceptingUpdates: false, variants: { options: [] } };
    fixture.modelVariantSessions["other-thread"] = session;
    expect(levelButtons(render())).toHaveLength(4);
    fixture.modelVariantSessions["thread-atlas"] = { ...session, instanceId: "other-account" };
    expect(levelButtons(render())).toHaveLength(4);
    fixture.modelVariantSessions["thread-atlas"] = { ...session, model: "other-model" };
    expect(levelButtons(render())).toHaveLength(4);
    expect(render("removed")).toContain("Saved variant “removed” has not been checked in this session.");
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it("does not invent default or expose a control on a model without variants", () => {
    fixture.instances[0].models.options[0].variants = [{ id: "minimal", label: "Minimal" }];
    expect(levelButtons(render()).map((button) => button.label)).toEqual(["Minimal"]);
    fixture.instances[0].models.options[0].variants = [];
    expect(render()).toBe("");
    fixture.instances[0].capabilities = {};
    expect(render("none")).toBe("");
  });

  it("does not declare a saved default invalid on reload before ACP announces its choices", () => {
    fixture.instances[0].models.options[0].variants = [{ id: "minimal", label: "Minimal" }];
    const markup = render("default");
    expect(markup).toContain("has not been checked in this session");
    expect(markup).not.toContain("is unavailable");
    expect(levelButtons(markup).map((button) => button.label)).toEqual(["Minimal"]);
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it("keeps the saved choice after reload while allowing profile choices to update the profile", () => {
    expect(levelButtons(render("minimal")).find((button) => button.pressed)?.label).toBe("Minimal");
    const row = ModelVariantRow({ bot: selected(), updateBotDefault: true })!;
    const group = Children.toArray(row.props.children).at(-1) as ReactElement<{ children: ReactNode }>;
    (Children.toArray(group.props.children)[1] as ReactElement<{ onClick: () => void }>).props.onClick();
    expect(fixture.dispatch).toHaveBeenLastCalledWith({ type: "setModel", botId: "atlas", threadId: undefined, updateBotDefault: true,
      selection: { instanceId: "opencode", model: "provider/model", variant: "minimal" } });
  });

  it("drops an opaque variant when switching models/accounts but keeps it when reselecting the same model", () => {
    const selection = selected("minimal").modelSelection;
    expect(modelSelectionForPick(selection, opencode(), "provider/other")).toEqual({ instanceId: "opencode", model: "provider/other" });
    expect(modelSelectionForPick(selection, { ...opencode(), instanceId: "other" }, "provider/model")).toEqual({ instanceId: "other", model: "provider/model" });
    expect(modelSelectionForPick(selection, opencode(), "provider/model")).toEqual(selection);
    expect(modelSelectionForPick({ ...selection, effort: "high" }, opencode(), "provider/other")).not.toHaveProperty("effort");
    expect(modelSelectionForPick(bot("high").modelSelection, engine(["high"]), "other")).toEqual({ instanceId: "codex", model: "other", effort: "high" });
  });
});

describe("ModelPicker trigger", () => {
  const renderTrigger = (effort?: EffortLevel) => {
    fixture.instances = [engine(["low", "high"])];
    return renderToStaticMarkup(createElement(ModelPicker, { bot: bot(effort) }));
  };

  /** The visible effort suffix, not the tooltip that also names the level. */
  const effortChip = (markup: string) =>
    withoutComments(markup.match(/<span data-model-effort[^>]*>(.*?)<\/span>/s)?.[1])?.trim();

  /** React's text separators (`<!-- -->`) removed until none is left. */
  const withoutComments = (text: string | undefined) => {
    if (text === undefined) return undefined;
    let previous;
    do {
      previous = text;
      text = text.replace(/<!--[\s\S]*?-->/g, "");
    } while (text !== previous);
    return text.replaceAll("<!--", "");
  };

  /** The trigger's native tooltip as plain text, split into its lines. React
   * HTML-escapes the apostrophe and may encode the newline numerically; both
   * are undone here so the assertions read as the user sees them. */
  const tooltipLines = (markup: string): string[] => {
    const encoded = markup.match(/<button[^>]*\stitle="([^"]*)"/s)?.[1];
    if (encoded === undefined) return [];
    const amp = String.fromCharCode(38);
    const newline = String.fromCharCode(10);
    return encoded
      .replaceAll(amp + "#x27;", "'")
      .replaceAll(amp + "#10;", newline)
      .split(newline);
  };

  it("names the thread in busy header help and the bot in profile settings", () => {
    fixture.instances = [engine()];
    for (const threadId of ["independent-thread", undefined]) {
      const markup = renderToStaticMarkup(createElement(ModelPicker, { bot: { ...bot(), busy: true }, threadId }));
      expect(tooltipLines(markup)).toEqual([
        "Codex · GPT-5.6",
        `Stop this ${threadId ? "thread" : "bot"}'s turn before changing its model`,
      ]);
    }
  });

  it("puts the current model and effort above the busy advisory", () => {
    fixture.instances = [engine(["low", "high"])];
    const markup = renderToStaticMarkup(createElement(ModelPicker, { bot: { ...bot("high"), busy: true }, threadId: "independent-thread" }));
    expect(tooltipLines(markup)).toEqual([
      "Codex · GPT-5.6 · High effort",
      "Stop this thread's turn before changing its model",
    ]);
  });

  it("keeps effort out of the header-style chip; the tooltip still names it", () => {
    // Chat header is the bot pill alone: a stray "High" under that pill is a
    // bug. Effort stays in the picker menu and in the chip's tooltip.
    const markup = renderTrigger("high");

    expect(markup).toContain("GPT-5.6");
    expect(effortChip(markup)).toBeUndefined();
    expect(markup).not.toContain("data-model-effort");
    expect(markup).toContain("Codex · GPT-5.6 · High effort");
    expect(markup).toContain("flex-nowrap");
  });

  it("still shows effort on the contained settings chip", () => {
    fixture.instances = [engine(["low", "high"])];
    const markup = renderToStaticMarkup(createElement(ModelPicker, { bot: bot("high"), contained: true }));
    expect(effortChip(markup)).toBe("· High");
  });

  it("says nothing about effort when the bot sends no level", () => {
    const markup = renderTrigger();

    expect(markup).toContain("GPT-5.6");
    expect(effortChip(markup)).toBeUndefined();
    expect(markup).not.toContain("effort");
    expect(markup).toContain("@max-4xl/chathead:size-[30px]");
    expect(markup).not.toContain("data-model-account-compact");
  });

  it("visibly identifies the selected account when Claude has multiple instances", () => {
    fixture.instances = [
      { ...engine(), instanceId: "claude-personal", driverKind: "claudeAgent", displayName: "Personal" },
      { ...engine(), instanceId: "claude-work", driverKind: "claudeAgent", displayName: "Work" },
    ];
    const markup = renderToStaticMarkup(createElement(ModelPicker, {
      bot: { ...bot(), modelSelection: { instanceId: "claude-work", model: "gpt-5.6" } },
    }));
    expect(markup).toMatch(/<span data-model-account[^>]*>Work · <\/span>/);
    expect(markup).not.toMatch(/<span data-model-account[^>]*>Personal/);
    // The account remains a compact-only sibling of the hidden model label,
    // and its button no longer squeezes into the icon-only 30px square.
    expect(markup).toMatch(/<span data-model-account-compact="true" class="hidden max-w-20 truncate @max-4xl\/chathead:inline">Work<\/span><span class="[^"]*@max-4xl\/chathead:hidden"/);
    expect(markup).not.toContain("@max-4xl/chathead:size-[30px]");
  });
});

describe("OpenAI sign-ins in the rail", () => {
  const codex: InstanceInfo = { ...engine(), instanceId: "codex", driverKind: "codex", displayName: "Codex" };
  const plan: InstanceInfo = { ...engine(), instanceId: "chatgpt", driverKind: "codex", displayName: "ChatGPT plan" };
  const apiKey: InstanceInfo = { ...engine(), instanceId: "openai", driverKind: "openai-compat", displayName: "OpenAI", access: "api" };

  it("folds Codex and the ChatGPT plan into one OpenAI button, apart from the API-key OpenAI", () => {
    const markup = renderToStaticMarkup(createElement(ModelEngineRail, {
      instances: [codex, plan, apiKey], selectedInstance: plan, onSelect: () => {},
    }));
    // one folded sign-in button, pressed for either of its engines, plus the key engine
    expect(markup.match(/aria-label="OpenAI"/g)).toHaveLength(2);
    expect(markup).toContain('aria-label="OpenAI" aria-pressed="true"');
    expect(markup).not.toContain('aria-label="Codex"');
    expect(markup).not.toContain('aria-label="ChatGPT plan"');
    // only the key engine carries the key badge
    expect(markup.match(/data-rail-key-badge/g)).toHaveLength(1);
  });

  it("opens the remembered OpenAI sign-in", () => {
    const onSelect = vi.fn();
    const rail = ModelEngineRail({ instances: [codex, plan], openaiInstance: plan, onSelect });
    const button = railButtons(rail)[0] as ReactElement<{ onClick: () => void }>;
    button.props.onClick();
    expect(onSelect).toHaveBeenLastCalledWith(plan);
  });
});

describe("Claude provider and account selection", () => {
  const personal: InstanceInfo = { ...engine(), instanceId: "claude-personal", driverKind: "claudeAgent", displayName: "Personal" };
  const work: InstanceInfo = { ...engine(), instanceId: "claude-work", driverKind: "claudeAgent", displayName: "Work", access: "custom" };

  it("renders one Claude provider across Cloud and Local, pressed for either account", () => {
    for (const selectedInstance of [personal, work]) {
      const markup = renderToStaticMarkup(createElement(ModelEngineRail, {
        instances: [engine(), personal, work], selectedInstance, claudeInstance: work, onSelect: () => {},
      }));
      expect(markup.match(/aria-label="Claude"/g)).toHaveLength(1);
      expect(markup).toContain('aria-label="Claude" aria-pressed="true"');
      expect(markup).toContain('aria-label="OpenAI" aria-pressed="false"');
      expect(markup).not.toContain('aria-label="Personal"');
      expect(markup).not.toContain('aria-label="Work"');
      expect(markup).toContain("w-14");
    }
  });

  it("opens the remembered concrete Claude account, falling back to the first account", () => {
    const onSelect = vi.fn();
    for (const claudeInstance of [work, undefined]) {
      const rail = ModelEngineRail({ instances: [personal, work], claudeInstance, onSelect });
      const button = railButtons(rail)[0] as ReactElement<{ onClick: () => void }>;
      button.props.onClick();
      expect(onSelect).toHaveBeenLastCalledWith(claudeInstance ?? personal);
    }
  });

  it("shows the icon of the concrete Claude account the rail selects", () => {
    const personalIcon: InstanceInfo = { ...personal, icon: { kind: "preset", preset: "anthropic" } };
    const workIcon: InstanceInfo = { ...work, icon: { kind: "preset", preset: "azure" } };
    for (const claudeInstance of [workIcon, undefined]) {
      const target = claudeInstance ?? personalIcon;
      const rail = ModelEngineRail({ instances: [personalIcon, workIcon], claudeInstance, onSelect: () => {} });
      const button = railButtons(rail)[0];
      const mark = Children.toArray(button.props.children)[0] as ReactElement<{ instance: InstanceInfo }>;
      expect(mark.props.instance).toBe(target);
    }
  });

  it("maps named native options to concrete instances without committing a model", () => {
    const onSelect = vi.fn();
    const dropdown = ClaudeAccountSelect({ accounts: [personal, work], selectedId: work.instanceId, onSelect });
    const markup = renderToStaticMarkup(dropdown);
    expect(markup).toContain('aria-label="Account"');
    expect(markup).toContain('<option value="claude-personal">Personal</option>');
    expect(markup).toContain('<option value="claude-work" selected="">Work</option>');
    const select = Children.toArray(dropdown.props.children)[1] as ReactElement<{ onChange: (event: ChangeEvent<HTMLSelectElement>) => void }>;
    select.props.onChange({ target: { value: personal.instanceId } } as ChangeEvent<HTMLSelectElement>);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(personal);
  });
});

describe("unready providers in the rail", () => {
  const grok: InstanceInfo = {
    ...engine(), instanceId: "grok", driverKind: "grokAgent", displayName: "Grok",
    snapshot: { state: "available", authenticated: true },
  };
  const kimi: InstanceInfo = {
    ...engine(), instanceId: "kimi", driverKind: "kimiAgent", displayName: "Kimi",
    snapshot: { state: "available", authenticated: false },
  };
  const qwen: InstanceInfo = {
    ...engine(), instanceId: "qwen", driverKind: "qwenAgent", displayName: "Qwen", access: "custom",
    snapshot: { state: "available", authenticated: false },
  };

  it("treats org attention as unready and ignores an update on a connected engine", () => {
    expect(providerRailUnready(kimi)).toBe(true);
    expect(providerRailUnready(grok)).toBe(false);
    expect(providerRailUnready(grok, { attention: true })).toBe(true);
    expect(providerRailUnready({ ...grok, snapshot: { ...grok.snapshot, update: { title: "Update", message: "A newer CLI", command: "npm i" } } })).toBe(false);
  });

  it("hides sign-in required providers in each group and keeps the selected one visible", () => {
    const html = renderToStaticMarkup(createElement(ModelEngineRail, {
      instances: [grok, kimi, qwen], selectedInstance: grok, wide: true, onSelect: () => {},
    }));
    expect(html).toContain('data-rail-provider="grok"');
    expect(html).not.toContain('data-rail-provider="kimi"');
    expect(html).not.toContain('data-rail-provider="qwen"');
    expect(html).not.toContain("data-rail-unready");
    expect(html).not.toContain("need sign-in");
    expect(html).not.toContain(">Local<");
  });

  it("hides several unready Cloud providers without a fold group", () => {
    const gemini: InstanceInfo = {
      ...engine(), instanceId: "gemini", driverKind: "geminiAgent", displayName: "Gemini",
      snapshot: { state: "available", authenticated: false },
    };
    const html = renderToStaticMarkup(createElement(ModelEngineRail, {
      instances: [grok, kimi, gemini], selectedInstance: grok, wide: true, onSelect: () => {},
    }));
    expect(html).toContain('data-rail-provider="grok"');
    expect(html).not.toContain('data-rail-provider="kimi"');
    expect(html).not.toContain('data-rail-provider="gemini"');
    expect(html).not.toContain("data-rail-unready");
    expect(html).not.toContain("need sign-in");
  });

  it("hides an org No access yet provider even when the CLI session looks signed in", () => {
    const opencode: InstanceInfo = {
      ...engine(), instanceId: "opencode", driverKind: "opencodeGo", displayName: "OpenCode",
      snapshot: { state: "available", authenticated: true },
    };
    const html = renderToStaticMarkup(createElement(ModelEngineRail, {
      instances: [grok, opencode], selectedInstance: grok, wide: true, onSelect: () => {},
      statusOf: (instance) => instance.instanceId === "opencode"
        ? { label: "No access yet", attention: true }
        : { label: "Connected", attention: false },
    }));
    expect(html).toContain('data-rail-provider="grok"');
    expect(html).not.toContain('data-rail-provider="opencode"');
    expect(html).not.toContain("No access yet");
    expect(html).not.toContain("data-rail-unready");
  });

  it("keeps a selected unready provider visible", () => {
    const html = renderToStaticMarkup(createElement(ModelEngineRail, {
      instances: [kimi], selectedInstance: kimi, wide: true, onSelect: () => {},
    }));
    expect(html).toContain('data-rail-provider="kimi"');
    expect(html).not.toContain("data-rail-unready");
  });

  it("lists unready providers in the group when the appearance setting is on", () => {
    const html = renderToStaticMarkup(createElement(ModelEngineRail, {
      instances: [grok, kimi, qwen], selectedInstance: grok, wide: true, showUnready: true, onSelect: () => {},
    }));
    expect(html).toContain('data-rail-provider="kimi"');
    expect(html).toContain('data-rail-provider="qwen"');
    expect(html).not.toContain("data-rail-unready");
  });
});

describe("organisation policy", () => {
  it("shows an engine the organisation disallows as managed and dimmed, not hidden", () => {
    const blocked: InstanceInfo = { ...engine(), policy: { organizationName: "Fixture Agency", reason: "Fixture Agency allows only company models on this computer. Choose a Company model for this bot." } };
    const markup = renderToStaticMarkup(createElement(ModelEngineRail, { instances: [blocked], onSelect: () => {} }));
    expect(markup).toContain('aria-label="OpenAI · Managed by Fixture Agency"');
    expect(markup).toContain("opacity-40");
    const allowed = renderToStaticMarkup(createElement(ModelEngineRail, { instances: [engine()], onSelect: () => {} }));
    expect(allowed).not.toContain("Managed by");
  });
});

describe("while the bot is working (omb #4395)", () => {
  it("unlocks the menu when the engine offers a reasoning level", async () => {
    const { lockedWhileBusy, offersReasoning } = await import("./ModelPicker.tsx-parts/model-picker-reasoning");
    const withEffort = engine(["low", "high"]);
    const state = { instances: [withEffort], modelVariantSessions: {} };
    const busyBot = { ...bot(), busy: true };
    expect(offersReasoning(state, withEffort, busyBot.modelSelection, busyBot.threadId)).toBe(true);
    expect(lockedWhileBusy(state, busyBot, false, busyBot.threadId)).toBe(false);
    expect(lockedWhileBusy(state, busyBot, true, busyBot.threadId)).toBe(true);
    expect(lockedWhileBusy(state, busyBot, false, busyBot.threadId)).toBe(false);
    const bare = engine();
    expect(lockedWhileBusy({ instances: [bare], modelVariantSessions: {} }, busyBot, false, busyBot.threadId)).toBe(true);
  });

  it("lets a variant change while the bot is working", () => {
    const variantEngine: InstanceInfo = {
      ...engine(),
      capabilities: { modelVariants: true },
      models: {
        default: "gpt-5.6",
        options: [{ id: "gpt-5.6", label: "GPT-5.6", variants: [{ id: "fast", label: "Fast" }, { id: "deep", label: "Deep" }] }],
      },
    };
    fixture.instances = [variantEngine];
    const busy = { ...bot(), busy: true, modelSelection: { instanceId: "codex", model: "gpt-5.6", variant: "fast" } };
    const markup = renderToStaticMarkup(createElement(ModelVariantRow, { bot: busy }));
    expect(markup).not.toMatch(/disabled/);
    expect(markup).toContain("Fast");
  });
});
