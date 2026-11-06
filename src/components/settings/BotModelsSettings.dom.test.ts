// @vitest-environment happy-dom
// Settings > Models > Bot models (#1675, redesigned #2050): the real page
// with synthetic bots: the Bot / Model · effort / Backup table, "All bots",
// the "Set model for n bots" button opening the two-pane selector, the
// Defaults card (editable solo, read-only with no Perspicax link in an
// organization) and the Active models link.
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
    org: null as null | { org: { name: string; identity: { kind: "perspicax"; issuer: string } } },
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
  useStore: () => ({ state: fixture.state, dispatch: fixture.dispatch, refreshInstances: vi.fn(async () => {}), refreshModels: vi.fn(async () => {}) }),
}));
vi.mock("@/lib/perspicax-org", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/perspicax-org")>();
  return {
    ...actual,
    // Solo path by default: the real ModelPicker mounts without organization readiness.
    usePerspicaxOrg: () => fixture.org,
    useMyEngines: () => null,
    useMyEngineModels: () => new Map(),
    useOrgPeople: () => [],
    reloadMyEngines: vi.fn(),
  };
});
// Keep ModelPicker/EffortRow real on the page; only stub Defaults (opens a dialog).
vi.mock("../NewBotDialog", async (importOriginal) => ({
  ...await importOriginal<typeof import("../NewBotDialog")>(),
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
  // the favorites sync reads /api/me/models once the picker mounts
  fixture.api.mockResolvedValue({ org: [], mine: [], favoriteModels: [] });
  fixture.org = null;
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  setLocale("en");
});

// "Edit several" mode: the checkboxes and the selection bar appear only then.
function editSeveral() {
  act(() => { (container.querySelector("[data-bot-models-edit-several]") as HTMLButtonElement).click(); });
}
const bar = () => container.querySelector("[data-selection-bar]");
const barButton = (label: string) =>
  [...(bar()?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find((button) => button.textContent?.includes(label)) ?? null;
const bulkChange = () => bar()?.querySelector<HTMLButtonElement>(".ui-button-primary") ?? null;

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
    // Bot, Model · effort, Backup (a bot has one); no checkbox column outside Edit several.
    expect(container.querySelectorAll("[data-bot-models-col]")).toHaveLength(3);
    expect(container.querySelector("[data-bot-models-select]")).toBeNull();
    expect(container.querySelector('[data-bot-models-row="bot-scout"]')?.getAttribute("data-bot-models-section-of")).toBe("Clients");
    expect(container.querySelector('[data-bot-models-row="bot-lab"]')?.getAttribute("data-bot-models-section-of")).toBe("unassigned");
    // Solo: the Defaults card is editable (no admin gate), no Perspicax link.
    expect(container.querySelector("[data-defaults-stub]")).not.toBeNull();
    expect(container.querySelector('[data-perspicax-link="newBotDefaults"]')).toBeNull();
    expect(container.textContent).toContain("Bot models");
    // One Model · effort cell per row (chip, or the read-only label when
    // edit is denied); no separate effort or payer columns.
    const scoutModel = container.querySelector('[data-bot-models-model="bot-scout"]');
    expect(scoutModel?.textContent?.length ?? 0).toBeGreaterThan(0);
    expect(scoutModel?.querySelector("select")).toBeNull();
    expect(container.querySelector('[data-bot-models-effort="bot-scout"]')).toBeNull();
    expect(container.querySelector('[data-bot-models-payer-cell="bot-scout"]')).toBeNull();
    expect(container.querySelector('[data-bot-models-controls="bot-scout"]')).not.toBeNull();
    // No "Active models" link under the table (the selector holds it).
    expect(container.querySelector('[data-link-row="models.activeModels"]')).toBeNull();
  });

  it("draws a table: visible column headers, one-line model chips, bulk bar under the table", async () => {
    act(() => root.render(createElement(BotModelsSettings)));
    await flush();
    const headers = container.querySelector("[data-bot-models-cols]");
    expect(headers?.textContent).toContain("Bot");
    expect(headers?.textContent).not.toContain("All bots");
    expect(headers?.textContent).toContain("Model · effort");
    expect(headers?.textContent).toContain("Backup");
    expect(headers?.textContent).not.toContain("Account");
    expect(headers?.querySelector('[data-bot-models-col="select"]')).toBeNull();
    // Section headings use the Settings group heading type, no band.
    const section = container.querySelector('[data-bot-models-section="Clients"]');
    expect(section?.querySelector("h3")?.className).toContain("text-[13px]");
    expect(section?.className).not.toContain("bg-inset");
    // An editable chip: engine mark plus one left-aligned label with the
    // effort after the model ("Grok 4 · High"), full name in the tooltip.
    const chip = container.querySelector<HTMLButtonElement>('[data-bot-models-model="bot-scout"] [data-model-list-chip]');
    expect(chip).not.toBeNull();
    const label = chip!.querySelector("[data-model-list-chip-label]");
    expect(label?.className).toContain("truncate");
    expect(label?.className).toContain("text-left");
    expect(label?.textContent).toContain("Grok 4");
    expect(label?.textContent).toContain("High");
    expect(chip!.title).toContain(label?.textContent ?? "");
    // Edit several shows the checkboxes; selecting shows the shared
    // selection bar outside the table card, with one filled action.
    editSeveral();
    await flush();
    expect(container.querySelector("[data-bot-models-edit-several]")?.textContent).toContain("Done");
    expect(headers?.querySelector('[data-bot-models-col="select"]')).not.toBeNull();
    expect(bar()).toBeNull();
    act(() => {
      (container.querySelector('[data-bot-models-select="bot-scout"]') as HTMLInputElement).click();
    });
    await flush();
    expect(bar()).not.toBeNull();
    expect(bar()?.closest('[data-settings-group="bot-models-table"]')).toBeNull();
    expect(bar()?.querySelectorAll(".ui-button-primary")).toHaveLength(1);
    expect(bulkChange()?.textContent).toContain("Set model for 1 bot");
    expect(barButton("Set backup")).not.toBeNull();
    // Escape closes the mode: no checkbox, no bar.
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    await flush();
    expect(bar()).toBeNull();
    expect(container.querySelector("[data-bot-models-select]")).toBeNull();
  });

  it("selects every bot with the All bots checkbox and shows it indeterminate for a partial selection", async () => {
    act(() => root.render(createElement(BotModelsSettings)));
    await flush();
    editSeveral();
    await flush();
    const all = container.querySelector('[data-bot-models-select-all]') as HTMLInputElement;
    expect(all.getAttribute("aria-label")).toBe("All bots");
    expect(all.checked).toBe(false);
    expect(all.indeterminate).toBe(false);
    act(() => { (container.querySelector('[data-bot-models-select="bot-scout"]') as HTMLInputElement).click(); });
    await flush();
    expect(all.indeterminate).toBe(true);
    act(() => { all.click(); });
    await flush();
    expect([...container.querySelectorAll<HTMLInputElement>("[data-bot-models-select]")].every((box) => box.checked)).toBe(true);
    expect(bulkChange()?.textContent).toContain("Set model for 3 bots");
    act(() => { all.click(); });
    await flush();
    expect(container.querySelectorAll<HTMLInputElement>("[data-bot-models-select]:checked")).toHaveLength(0);
    expect(bar()).toBeNull();
  });

  it("in an organization, shows Defaults for new bots read-only with the current choice and no Perspicax link", async () => {
    fixture.org = { org: { name: "Example", identity: { kind: "perspicax", issuer: "https://px.example.test" } } };
    act(() => root.render(createElement(BotModelsSettings)));
    await flush();
    expect(container.querySelector("[data-defaults-stub]"), "no editable defaults form").toBeNull();
    const row = container.querySelector('[data-settings-row="models.newBotDefaults"]');
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain("Chosen in Perspicax");
    expect(row?.querySelector('[data-perspicax-link="newBotDefaults"]')).toBeNull();
    expect(row?.querySelector("a")).toBeNull();
    // read-only in an organization: the card is an Advanced one (folded in Simple mode)
    expect(container.querySelector('[data-settings-group="bot-models-defaults"]')?.hasAttribute("data-settings-advanced")).toBe(true);
    // the table itself stays the person's: rows and Edit several are there
    expect(container.querySelector('[data-bot-models-row="bot-scout"]')).not.toBeNull();
    expect(container.querySelector("[data-bot-models-edit-several]")).not.toBeNull();
  });

  it("keeps Backup model choosable on a bot that already has a fallback engine", async () => {
    act(() => root.render(createElement(BotModelsSettings)));
    await flush();
    const cell = container.querySelector<HTMLElement>('[data-bot-models-backup-cell="bot-scout"]');
    expect(cell).not.toBeNull();
    const trigger = cell!.querySelector<HTMLElement>('[data-bot-models-backup="bot-scout"] [data-pill-select]');
    expect(trigger?.textContent).toMatch(/Claude|Sonnet/i);
    act(() => { trigger!.click(); });
    await flush();
    const panel = document.querySelector('[role="dialog"][aria-label="Backup"]');
    expect(panel).not.toBeNull();
    expect(panel?.querySelector('[aria-label="Backup model"]')).not.toBeNull();
    expect(panel?.querySelector('[aria-label="Add a fallback engine"]')).not.toBeNull();
  });

  it("always shows the Backup column: server default marked, empty cell says None and opens the engine/model editor", async () => {
    const scout = fixture.state.bots[0] as { fallback?: unknown };
    const savedFallback = scout.fallback;
    const config = fixture.state.config as Record<string, unknown>;
    try {
      // no bot backup, a server default: every row shows it, marked "default"
      scout.fallback = undefined;
      config.automaticRecovery = { enabled: true, backup: { instanceId: "claude", model: "sonnet" } };
      act(() => root.render(createElement(BotModelsSettings)));
      await flush();
      expect(container.querySelector('[data-bot-models-col="backup"]')).not.toBeNull();
      expect(container.querySelector('[data-bot-models-backup="bot-lab"]')?.textContent).toContain("default");
      expect(container.querySelector('[data-link-row="models.addBackup"]')).toBeNull();
      // nothing anywhere: Backup column stays, empty cells say None, per-bot editor opens
      delete config.automaticRecovery;
      act(() => root.render(createElement(BotModelsSettings, { key: "none" })));
      await flush();
      expect(container.querySelector('[data-bot-models-col="backup"]')).not.toBeNull();
      const cell = container.querySelector<HTMLElement>('[data-bot-models-backup-cell="bot-lab"]');
      expect(cell).not.toBeNull();
      const trigger = cell!.querySelector<HTMLElement>('[data-bot-models-backup="bot-lab"] [data-pill-select]');
      expect(trigger?.textContent).toContain("None");
      act(() => { trigger!.click(); });
      await flush();
      const panel = document.querySelector('[role="dialog"][aria-label="Backup"]');
      expect(panel).not.toBeNull();
      expect(panel?.textContent).toContain("No backup yet");
      expect(panel?.querySelector('[aria-label="Add a fallback engine"]')).not.toBeNull();
    } finally {
      scout.fallback = savedFallback;
      delete config.automaticRecovery;
    }
  });

  it("warns when a bot's engine is signed out", async () => {
    act(() => root.render(createElement(BotModelsSettings)));
    await flush();
    const atlas = container.querySelector('[data-bot-models-row="bot-atlas"]');
    expect(atlas?.getAttribute("data-bot-models-warning")).toBe("signedOut");
    expect(atlas?.textContent).toContain("Signed out of this engine");
  });

  it("opens the two-pane selector from Set model for n bots and applies the pick to every selected bot", async () => {
    act(() => root.render(createElement(BotModelsSettings)));
    await flush();
    editSeveral();
    await flush();
    act(() => {
      (container.querySelector('[data-bot-models-select="bot-scout"]') as HTMLInputElement).click();
      (container.querySelector('[data-bot-models-select="bot-lab"]') as HTMLInputElement).click();
    });
    await flush();
    const change = bulkChange() as HTMLButtonElement;
    expect(change.textContent).toContain("Set model for 2 bots");
    // no chip for the batch picker: only the menu, opened by the button
    expect(container.querySelector("[data-bot-models-bulk-dock] [data-model-list-chip]")).toBeNull();
    act(() => { change.click(); });
    await flush();
    const menu = document.querySelector("[data-model-menu]");
    expect(menu, "the selector opened").not.toBeNull();
    expect(menu?.querySelector("[data-model-panes]"), "one column, the chat bar menu").toBeNull();
    expect(menu?.querySelector("[data-model-settings-effort]"), "effort bar at the bottom").not.toBeNull();
    const option = menu!.querySelector<HTMLElement>('[data-model-option="grok-4"]');
    expect(option).not.toBeNull();
    act(() => { option!.click(); });
    await flush();
    const actions = fixture.dispatch.mock.calls.map((call) => call[0]).filter((action) => action.type === "setModel");
    expect(actions.map((action) => action.botId).sort()).toEqual(["bot-lab", "bot-scout"]);
    expect(actions.every((action) => action.updateBotDefault === true && action.selection.model === "grok-4")).toBe(true);
    // the selection stays so the person can set a backup next
    expect(bar()).not.toBeNull();
  });

  it("offers the Active models link inside the selector, opening the Advanced fold", async () => {
    act(() => root.render(createElement(BotModelsSettings)));
    await flush();
    editSeveral();
    await flush();
    act(() => { (container.querySelector('[data-bot-models-select="bot-lab"]') as HTMLInputElement).click(); });
    await flush();
    act(() => { bulkChange()!.click(); });
    await flush();
    const link = document.querySelector<HTMLElement>("[data-model-menu] [data-model-active-models]");
    expect(link?.textContent).toContain("Active models");
    act(() => { link!.click(); });
    await flush();
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "toggleAppSettings", open: true, section: "engines" });
  });

  it("sets a backup for every selected bot from the bulk bar", async () => {
    act(() => root.render(createElement(BotModelsSettings)));
    await flush();
    editSeveral();
    await flush();
    act(() => {
      (container.querySelector('[data-bot-models-select="bot-scout"]') as HTMLInputElement).click();
      (container.querySelector('[data-bot-models-select="bot-lab"]') as HTMLInputElement).click();
    });
    await flush();
    act(() => { barButton("Set backup")!.click(); });
    await flush();
    const picker = document.querySelector("[data-bot-models-bulk-backup-picker]");
    expect(picker).not.toBeNull();
    act(() => { (document.querySelector("[data-bot-models-bulk-backup-clear]") as HTMLButtonElement).click(); });
    await flush();
    const actions = fixture.dispatch.mock.calls.map((call) => call[0]).filter((action) => action.type === "updateBot");
    expect(actions.map((action) => action.botId).sort()).toEqual(["bot-lab", "bot-scout"]);
    expect(actions.every((action) => Array.isArray(action.patch.fallback) && action.patch.fallback.length === 0)).toBe(true);
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
          row.querySelector<HTMLElement>("[data-bot-models-backup-cell]"),
        ].filter((node): node is HTMLElement => Boolean(node));
        // Model · effort and Backup, always.
        expect(cells.length).toBe(2);
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
          expect(focusable || cell.querySelector("[data-bot-models-backup]")).toBeTruthy();
        }
      }
    }
  });
});
