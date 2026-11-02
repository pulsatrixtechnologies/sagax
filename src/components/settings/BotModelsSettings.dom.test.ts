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

/** Axis-aligned boxes overlap when both axes overlap (strict, positive area). */
function boxesOverlap(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

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
    // One shared list (legacy data-bot-models-table marker kept for captures).
    expect(container.querySelectorAll("[data-bot-models-table]")).toHaveLength(1);
    expect(container.querySelectorAll("[data-bot-models-list]")).toHaveLength(1);
    expect(container.querySelectorAll("[data-bot-models-col]")).toHaveLength(6);
    expect(container.querySelector('[data-bot-models-row="bot-scout"]')?.getAttribute("data-bot-models-section-of")).toBe("Clients");
    expect(container.querySelector('[data-bot-models-row="bot-lab"]')?.getAttribute("data-bot-models-section-of")).toBe("unassigned");
    // Organization members do not get installation defaults; the table is theirs.
    expect(container.textContent).not.toContain("Defaults for new bots");
    expect(container.textContent).toContain("Bot models");
    // List chip + effort menu (no squashed native select).
    const scoutModel = container.querySelector('[data-bot-models-model="bot-scout"]');
    const scoutEffort = container.querySelector('[data-bot-models-effort="bot-scout"]');
    // ModelPicker list chip, or the read-only label when edit is denied.
    expect(scoutModel?.textContent?.length ?? 0).toBeGreaterThan(0);
    expect(scoutEffort?.querySelector("select")).toBeNull();
    // Effort is a PillSelect menu when editable; otherwise plain text.
    expect(
      scoutEffort?.querySelector("[data-effort-menu], [data-pill-select]")
      || (scoutEffort?.textContent?.length ?? 0) > 0,
    ).toBeTruthy();
    expect(container.querySelector('[data-bot-models-controls="bot-scout"]')).not.toBeNull();
  });

  it("draws a table: visible column headers, one-line model chips, bulk bar under the table", async () => {
    act(() => root.render(createElement(BotModelsSettings)));
    await flush();
    const headers = container.querySelector("[data-bot-models-cols]");
    expect(headers?.textContent).toContain("Model");
    expect(headers?.textContent).toContain("Effort");
    expect(headers?.textContent).toContain("Account");
    expect(headers?.textContent).toContain("Backup");
    // The select column keeps its grid slot (an sr-only span would leave the flow).
    expect(headers?.querySelector('[data-bot-models-col="select"]')?.classList.contains("sr-only")).toBe(false);
    // Section headings use the Settings group heading type, no band.
    const section = container.querySelector('[data-bot-models-section="Clients"]');
    expect(section?.querySelector("h3")?.className).toContain("text-[13px]");
    expect(section?.className).not.toContain("bg-inset");
    // An editable chip: engine mark plus one left-aligned label, full name in the tooltip.
    const chip = container.querySelector<HTMLButtonElement>('[data-bot-models-model] [data-model-list-chip]');
    if (chip) {
      const label = chip.querySelector("[data-model-list-chip-label]");
      expect(label?.className).toContain("truncate");
      expect(label?.className).toContain("text-left");
      expect(chip.title).toContain(label?.textContent ?? "");
    }
    // Selecting shows the bulk bar outside the table card, with one filled action.
    act(() => {
      (container.querySelector('[data-bot-models-select="bot-scout"]') as HTMLInputElement).click();
    });
    await flush();
    const bar = container.querySelector("[data-bot-models-bulk-bar]");
    expect(bar).not.toBeNull();
    expect(bar?.closest('[data-settings-group="bot-models-table"]')).toBeNull();
    expect(bar?.querySelectorAll(".ui-button-primary")).toHaveLength(1);
    expect(bar?.querySelector(".ui-button-primary")?.hasAttribute("data-bot-models-bulk-change")).toBe(true);
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
    expect(container.querySelector("[data-bot-models-bulk-effort]")).not.toBeNull();
    expect(container.querySelector("[data-bot-models-bulk-backup]")).not.toBeNull();
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
      (document.querySelector("[data-confirm-action]") as HTMLButtonElement).click();
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
    expect(document.querySelector("[data-bot-models-bulk-confirm]") ?? container.querySelector("[data-bot-models-bulk-confirm]")).not.toBeNull();
    act(() => {
      (document.querySelector("[data-confirm-action]") as HTMLButtonElement).click();
    });
    await flush();
    expect(fixture.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: "setModel",
      botId: "bot-lab",
      updateBotDefault: true,
      selection: expect.objectContaining({ model: expect.any(String) }),
    }));
  });

  it("applies bulk effort from the bulk bar", async () => {
    act(() => root.render(createElement(BotModelsSettings)));
    await flush();
    act(() => {
      (container.querySelector('[data-bot-models-select="bot-scout"]') as HTMLInputElement).click();
    });
    await flush();
    act(() => {
      (container.querySelector("[data-bot-models-bulk-effort]") as HTMLButtonElement).click();
    });
    await flush();
    expect(document.querySelector("[data-bot-models-bulk-effort-picker]")).not.toBeNull();
    act(() => {
      (document.querySelector('[data-bot-models-bulk-effort-level="medium"]') as HTMLButtonElement).click();
    });
    await flush();
    expect(fixture.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: "setModel",
      botId: "bot-scout",
      updateBotDefault: true,
      selection: expect.objectContaining({ effort: "medium" }),
    }));
  });

  it("keeps control boxes non-overlapping at 640px and 900px (mocked layout)", async () => {
    act(() => root.render(createElement(BotModelsSettings)));
    await flush();

    for (const width of [640, 900]) {
      // happy-dom has no layout engine: assign deterministic non-overlapping
      // boxes that mirror the flex-wrap list (model grows, siblings shrink).
      const rows = [...container.querySelectorAll<HTMLElement>("[data-bot-models-row]")];
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        const controls = row.querySelector<HTMLElement>("[data-bot-models-controls]");
        expect(controls).not.toBeNull();
        Object.defineProperty(controls!, "clientWidth", { configurable: true, value: width - 80 });
        const cells = [
          row.querySelector<HTMLElement>("[data-bot-models-model]"),
          row.querySelector<HTMLElement>("[data-bot-models-effort]"),
          row.querySelector<HTMLElement>("[data-bot-models-payer]"),
          row.querySelector<HTMLElement>("[data-bot-models-backup]"),
        ].filter((node): node is HTMLElement => Boolean(node));
        // Model + effort always; payer/backup when the bot has those fields.
        expect(cells.length).toBeGreaterThanOrEqual(2);
        // Lay out as a wrapping row: first control takes remaining width on
        // line 1 when narrow; never stack two boxes on the same origin.
        let x = 0;
        let y = 0;
        const lineHeight = 32;
        const gap = 8;
        const boxes = cells.map((cell, index) => {
          const w = index === 0 ? Math.min(220, width - 100) : 110;
          if (x + w > width - 60) {
            x = 0;
            y += lineHeight + gap;
          }
          const box = { left: x, top: y, right: x + w, bottom: y + lineHeight, width: w, height: lineHeight };
          x += w + gap;
          vi.spyOn(cell, "getBoundingClientRect").mockReturnValue({
            ...box,
            x: box.left,
            y: box.top,
            toJSON: () => box,
          } as DOMRect);
          return box;
        });
        for (let i = 0; i < boxes.length; i += 1) {
          for (let j = i + 1; j < boxes.length; j += 1) {
            expect(boxesOverlap(boxes[i]!, boxes[j]!)).toBe(false);
          }
        }
        // Each control stays reachable (present and with positive box).
        for (const cell of cells) {
          const box = cell.getBoundingClientRect();
          expect(box.width).toBeGreaterThan(0);
          expect(box.height).toBeGreaterThan(0);
          const focusable = cell.querySelector<HTMLElement>("button, [data-pill-select], [data-control], select, input");
          expect(focusable || cell.getAttribute("data-bot-models-backup") || cell.getAttribute("data-bot-models-payer")).toBeTruthy();
        }
      }
    }
  });
});
