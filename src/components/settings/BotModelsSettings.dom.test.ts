// @vitest-environment happy-dom
// Settings > Models > Bot models (#1675): the real page with synthetic bots.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";

const fixture = vi.hoisted(() => {
  const dispatch = vi.fn();
  const bots = [
    {
      id: "bot-scout",
      name: "Scout",
      section: "Clients",
      ownerUserId: "p-me",
      threadId: "t-scout",
      modelSelection: { instanceId: "grok", model: "grok-4", effort: "high" },
      fallback: [{ instanceId: "claude", model: "sonnet" }],
      turnPayerDefault: "owner" as const,
      turnPayer: "speaker" as const,
      messages: [],
      tasks: [],
    },
    {
      id: "bot-atlas",
      name: "Atlas",
      section: "Clients",
      ownerUserId: "p-me",
      threadId: "t-atlas",
      modelSelection: { instanceId: "claude", model: "sonnet", auto: true },
      messages: [],
      tasks: [],
    },
    {
      id: "bot-lab",
      name: "Lab Bot",
      section: undefined,
      ownerUserId: "p-me",
      threadId: "t-lab",
      modelSelection: { instanceId: "grok", model: "grok-4" },
      messages: [],
      tasks: [],
    },
    {
      id: "bot-other",
      name: "Not Mine",
      ownerUserId: "p-other",
      threadId: "t-other",
      modelSelection: { instanceId: "grok", model: "grok-4" },
      messages: [],
      tasks: [],
    },
  ];
  const instances = [
    {
      instanceId: "grok",
      displayName: "Grok",
      driverKind: "grokAgent",
      snapshot: { state: "available", authenticated: true },
      models: { default: "grok-4", options: [{ id: "grok-4", label: "Grok 4" }] },
      capabilities: { effortLevels: ["low", "medium", "high"] },
    },
    {
      instanceId: "claude",
      displayName: "Claude",
      driverKind: "claudeAgent",
      snapshot: { state: "available", authenticated: false },
      models: { default: "sonnet", options: [{ id: "sonnet", label: "Sonnet" }, { id: "opus", label: "Opus" }] },
      capabilities: { effortLevels: ["low", "medium", "high"] },
    },
  ];
  return {
    dispatch,
    api: vi.fn(),
    state: {
      bots,
      instances,
      config: {
        viewer: { role: "member", operator: false, principalId: "p-me", email: "me@example.com", name: "Me", canCreateBots: true },
        personalSettings: true,
        newBotDefaults: { profile: { modelSelection: { instanceId: "grok", model: "grok-4", effort: "medium" } } },
      },
      modelVariantSessions: {},
    },
  };
});

vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: (...args: unknown[]) => fixture.api(...args),
  useStore: () => ({ state: fixture.state, dispatch: fixture.dispatch, refreshInstances: vi.fn(), refreshModels: vi.fn() }),
}));
vi.mock("@/lib/perspicax-org", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/perspicax-org")>();
  return {
    ...actual,
    // Solo path: the real ModelPicker mounts without organization readiness.
    usePerspicaxOrg: () => null,
    useMyEngines: () => null,
    useMyEngineModels: () => new Map(),
    useOrgPeople: () => [],
    reloadMyEngines: vi.fn(),
  };
});
// Keep ModelPicker/EffortRow real on the page; only stub Defaults (opens a dialog).
vi.mock("../NewBotDialog", () => ({
  DefaultBotSettings: () => createElement("div", { "data-defaults-stub": "" }, "Defaults for new bots"),
}));
vi.mock("@/lib/personal-sections", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/personal-sections")>(),
  usePersonalSections: () => null,
}));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: () => {} }));
vi.mock("@/lib/offered-instances", () => ({
  useOfferedInstances: () => fixture.state.instances,
  engineOfferContext: () => ({}),
  modelSwitches: () => ({ org: null, mine: null }),
}));
vi.mock("@/lib/auto-model-preview", () => ({ useAutoModelStatus: () => null }));
vi.mock("@/lib/model-favorites", () => ({
  useModelFavorites: () => [],
  favoriteKey: (a: string, b: string) => `${a}/${b}`,
  toggleModelFavorite: vi.fn(),
}));

import { BotModelsSettings } from "./BotModelsSettings";

let root: Root;
let container: HTMLDivElement;

const flush = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

beforeEach(() => {
  setLocale("en");
  fixture.dispatch.mockReset();
  fixture.api.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  setLocale("en");
});

describe("BotModelsSettings page", () => {
  it("lists the person's bots by sidebar section and hides other people's", async () => {
    act(() => root.render(createElement(BotModelsSettings)));
    await flush();
    const page = container.querySelector("[data-bot-models-page]");
    expect(page).not.toBeNull();
    expect(container.querySelector('[data-bot-models-row="bot-scout"]')).not.toBeNull();
    expect(container.querySelector('[data-bot-models-row="bot-atlas"]')).not.toBeNull();
    expect(container.querySelector('[data-bot-models-row="bot-lab"]')).not.toBeNull();
    expect(container.querySelector('[data-bot-models-row="bot-other"]')).toBeNull();
    expect(container.querySelector('[data-bot-models-section="Clients"]')).not.toBeNull();
    expect(container.querySelector('[data-bot-models-section="unassigned"]')).not.toBeNull();
    // One shared table + colgroup so Engine / Effort / Who pays align across sections.
    expect(container.querySelectorAll("[data-bot-models-table]")).toHaveLength(1);
    expect(container.querySelectorAll("[data-bot-models-col]")).toHaveLength(6);
    expect(container.querySelector('[data-bot-models-row="bot-scout"]')?.getAttribute("data-bot-models-section-of")).toBe("Clients");
    expect(container.querySelector('[data-bot-models-row="bot-lab"]')?.getAttribute("data-bot-models-section-of")).toBe("unassigned");
    // Organization members do not get installation defaults; the table is theirs.
    expect(container.textContent).not.toContain("Defaults for new bots");
    expect(container.textContent).toContain("Bot models");
  });

  it("warns when a bot's engine is signed out", async () => {
    act(() => root.render(createElement(BotModelsSettings)));
    await flush();
    const atlas = container.querySelector('[data-bot-models-row="bot-atlas"]');
    expect(atlas?.getAttribute("data-bot-models-warning")).toBe("signedOut");
    expect(atlas?.textContent).toContain("Signed out of this engine");
  });

  it("shows a bulk confirmation summary before applying", async () => {
    act(() => root.render(createElement(BotModelsSettings)));
    await flush();
    const selectScout = container.querySelector('[data-bot-models-select="bot-scout"]') as HTMLInputElement;
    const selectLab = container.querySelector('[data-bot-models-select="bot-lab"]') as HTMLInputElement;
    act(() => {
      selectScout.click();
      selectLab.click();
    });
    await flush();
    expect(container.querySelector("[data-bot-models-bulk-bar]")).not.toBeNull();
    act(() => {
      (container.querySelector("[data-bot-models-bulk-auto]") as HTMLButtonElement).click();
    });
    await flush();
    const confirm = document.querySelector("[data-bot-models-bulk-confirm]") ?? container.querySelector("[data-bot-models-bulk-confirm]");
    expect(confirm).not.toBeNull();
    const summary = document.querySelector("[data-bot-models-bulk-summary]") ?? container.querySelector("[data-bot-models-bulk-summary]");
    expect(summary?.textContent).toContain("Scout");
    expect(summary?.textContent).toContain("Lab Bot");
    expect(summary?.textContent).toMatch(/to Auto/);
    act(() => {
      (document.querySelector("[data-bot-models-bulk-apply]") as HTMLButtonElement).click();
    });
    await flush();
    expect(fixture.dispatch).toHaveBeenCalled();
    const actions = fixture.dispatch.mock.calls.map((call) => call[0]);
    expect(actions.every((action) => action.type === "setModel" && action.updateBotDefault === true && action.selection.auto === true)).toBe(true);
    expect(actions.map((action) => action.botId).sort()).toEqual(["bot-lab", "bot-scout"]);
  });

  it("opens the bulk model picker and confirms a fixed model", async () => {
    act(() => root.render(createElement(BotModelsSettings)));
    await flush();
    act(() => {
      (container.querySelector('[data-bot-models-select="bot-lab"]') as HTMLInputElement).click();
    });
    await flush();
    act(() => {
      (container.querySelector("[data-bot-models-bulk-change]") as HTMLButtonElement).click();
    });
    await flush();
    const picker = document.querySelector("[data-bot-models-bulk-picker]");
    expect(picker).not.toBeNull();
    act(() => {
      (document.querySelector("[data-bot-models-bulk-pick]") as HTMLButtonElement).click();
    });
    await flush();
    expect(document.querySelector("[data-bot-models-bulk-confirm]")).not.toBeNull();
    act(() => {
      (document.querySelector("[data-bot-models-bulk-apply]") as HTMLButtonElement).click();
    });
    await flush();
    expect(fixture.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: "setModel",
      botId: "bot-lab",
      updateBotDefault: true,
      selection: expect.objectContaining({ model: expect.any(String) }),
    }));
  });
});
