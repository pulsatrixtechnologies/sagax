// @vitest-environment happy-dom
// Bot > Model after the 2026-11-05 redesign (#2050): the Model card with the
// effort in Simple too, the "If it fails" card merging automatic recovery
// and the ordered backups (the switch, add, reorder, remove, the single
// backup kept in step as the first entry, seeding from an older single
// backup), and the closed Advanced fold with Who pays and Keep warm.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Bot, ConfigStatus, InstanceInfo } from "@/state/store";
import { setLocale } from "@/lib/i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fixture = vi.hoisted(() => ({
  config: null as ConfigStatus | null,
  instances: [] as InstanceInfo[],
  dispatch: vi.fn(),
  api: vi.fn(),
}));

vi.mock("@/state/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/state/store")>();
  return {
    ...actual,
    api: (...args: unknown[]) => fixture.api(...args),
    useStore: () => ({ state: { ...actual.initialState, config: fixture.config, instances: fixture.instances, bots: [] }, dispatch: fixture.dispatch }),
  };
});
vi.mock("../ModelPicker", () => ({
  ModelPicker: () => createElement("div", { "data-model-picker": "" }, "Default model"),
  EffortRow: () => createElement("div", { "data-effort-row": "" }, "Effort"),
}));
vi.mock("@/lib/perspicax-org", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/perspicax-org")>(),
  usePerspicaxOrg: () => null,
  useMyEngines: () => null,
}));
vi.mock("@/lib/offered-instances", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/offered-instances")>(),
  useOfferedInstances: () => fixture.instances,
}));
vi.mock("./BotHostSettings", () => ({ BotHostSettings: () => null }));

const { ModelSection, recoveryFor } = await import("./ModelSection");
const { BotEditorContext } = await import("./BotEditorContext");

const instance = (instanceId: string, displayName: string, models: Array<[string, string]>): InstanceInfo => ({
  instanceId, driverKind: "codex", displayName, access: "api", cliDefault: instanceId,
  snapshot: { state: "available", authenticated: true },
  models: { default: models[0]![0], options: models.map(([id, label]) => ({ id, label })) },
} as InstanceInfo);

function bot(over: Partial<Bot> = {}): Bot {
  return {
    id: "bot-1", threadId: "thread-1", name: "Scout", title: "Scout", description: "",
    notifications: false, color: "green", unread: false,
    modelSelection: { instanceId: "local", model: "test-model" }, messages: [],
    ownerUserId: "pr_zara", turnPayerDefault: "owner",
    ...over,
  } as Bot;
}

let host: HTMLDivElement;
let root: Root;

async function render(current: Bot, draft = false) {
  const section = createElement(ModelSection, { bot: current });
  const tree = draft
    ? createElement(BotEditorContext.Provider, { value: { request: fixture.api as never, draft: true } }, section)
    : section;
  await act(async () => { root.render(tree); });
  await flush();
  return host;
}
const flush = async () => { for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); }); };
const click = async (target: Element | null) => {
  expect(target, "the element to click").not.toBeNull();
  await act(async () => { (target as HTMLElement).click(); });
  await flush();
};
/** Opens a pill menu and picks the option with that label. */
const pick = async (trigger: Element | null, label: string) => {
  await click(trigger);
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((row) => row.textContent?.trim() === label);
  expect(option, `option ${label}`).toBeDefined();
  await click(option!);
};
const $ = (selector: string) => host.querySelector<HTMLElement>(selector);
const recoveryCard = () => $("[data-bot-recovery]");
const toggle = () => $('[data-settings-row="botRecoveryEnabled"] [role="switch"]') as HTMLButtonElement | null;
const patched = () => fixture.api.mock.calls.map((call) => [call[0] as string, JSON.parse((call[1] as { body: string }).body)]);

beforeEach(() => {
  setLocale("en");
  fixture.config = { viewer: { operator: true, role: "admin" }, cacheKeepWarm: { enabled: true, windowMinutes: 60 } } as unknown as ConfigStatus;
  fixture.instances = [
    instance("local", "Local", [["test-model", "Test model"]]),
    instance("backup", "Backup engine", [["m", "Backup model"], ["m2", "Second model"]]),
    instance("spare", "Spare", [["s", "Spare model"]]),
  ];
  fixture.dispatch = vi.fn();
  fixture.api = vi.fn(async (_path: string, init: { body: string }) => ({ stored: JSON.parse(init.body) }));
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => { fn(0); return 0; });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("recoveryFor: the single backup follows the ordered list", () => {
  it("is the first entry, and off with no backup when the list is empty", () => {
    expect(recoveryFor([{ instanceId: "a", model: "1" }, { instanceId: "b", model: "2" }], true)).toEqual({ enabled: true, backup: { instanceId: "a", model: "1" } });
    expect(recoveryFor([{ instanceId: "a", model: "1" }], false)).toEqual({ enabled: false, backup: { instanceId: "a", model: "1" } });
    expect(recoveryFor([], true)).toEqual({ enabled: false });
  });
});

describe("Bot > Model, solo", () => {
  it("draws the Model card with the effort, If it fails with its switch waiting for a backup, and the closed Advanced fold", async () => {
    await render(bot());
    expect($("[data-model-picker]")?.textContent).toBe("Default model");
    expect($("[data-effort-row]"), "effort shown without the global Advanced mode").not.toBeNull();
    const card = recoveryCard()!;
    expect(card.dataset.botRecovery).toBe("off");
    expect(card.textContent).toContain("If it fails");
    expect(card.textContent).toContain("Switch model if it fails");
    expect(card.textContent).toContain("Add a backup below first.");
    expect(toggle()!.disabled, "nothing to switch to yet").toBe(true);
    expect(toggle()!.getAttribute("aria-checked")).toBe("false");
    // the old two groups are gone
    expect(host.textContent).not.toContain("Automatic recovery");
    expect(host.textContent).not.toContain("Backup models for this bot");
    const advanced = $('[data-settings-card="botModel.advanced"][data-open]')!;
    expect(advanced.dataset.open, "closed by default").toBe("false");
    expect(advanced.querySelector('[data-settings-row="botPayerMode"]')?.textContent).toContain("Who pays for replies");
    expect(advanced.querySelector('[data-settings-row="botKeepWarm"]')?.textContent).toContain("Keep prompt cache warm");
    expect($("[data-bot-keep-warm]")?.dataset.botKeepWarm).toBe("follow");
  });

  it("adds the first backup: the ordered list gets it and the single backup follows, still off", async () => {
    await render(bot());
    await pick($('[data-settings-row="botBackup.add"] [data-pill-select]'), "Backup engine");
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "updateBot", botId: "bot-1", patch: { fallback: [{ instanceId: "backup", model: "m" }] } });
    expect(patched()).toEqual([["/api/bots/bot-1/runtime-settings", { automaticRecovery: { enabled: false, backup: { instanceId: "backup", model: "m" } } }]]);
  });

  it("turns recovery on with the first ordered backup, then off keeping it", async () => {
    await render(bot({ fallback: [{ instanceId: "backup", model: "m" }, { instanceId: "spare", model: "s" }] }));
    expect(toggle()!.disabled).toBe(false);
    expect(host.textContent).toContain("1. Backup engine");
    expect(host.textContent).toContain("2. Spare");
    await click(toggle());
    expect(patched()).toEqual([["/api/bots/bot-1/runtime-settings", { automaticRecovery: { enabled: true, backup: { instanceId: "backup", model: "m" } } }]]);
    expect(recoveryCard()!.dataset.botRecovery).toBe("on");
    expect(toggle()!.getAttribute("aria-checked")).toBe("true");
    await click(toggle());
    expect(patched()[1]).toEqual(["/api/bots/bot-1/runtime-settings", { automaticRecovery: { enabled: false, backup: { instanceId: "backup", model: "m" } } }]);
    expect(fixture.dispatch, "the switch never rewrites the list").not.toHaveBeenCalled();
  });

  it("reorders, changes a backup's model and removes one; the single backup is always the first entry", async () => {
    await render(bot({
      automaticRecovery: { enabled: true, backup: { instanceId: "backup", model: "m" } },
      fallback: [{ instanceId: "backup", model: "m" }, { instanceId: "spare", model: "s" }],
    }));
    const path = "/api/bots/bot-1/runtime-settings";
    expect((host.querySelector('[data-settings-row="botBackup.1"] [data-backup-move="up"]') as HTMLButtonElement).disabled, "first cannot go up").toBe(true);
    expect((host.querySelector('[data-settings-row="botBackup.2"] [data-backup-move="down"]') as HTMLButtonElement).disabled, "last cannot go down").toBe(true);
    await click(host.querySelector('[aria-label="Move Spare up"]'));
    expect(fixture.dispatch).toHaveBeenLastCalledWith({ type: "updateBot", botId: "bot-1", patch: { fallback: [{ instanceId: "spare", model: "s" }, { instanceId: "backup", model: "m" }] } });
    expect(patched().at(-1)).toEqual([path, { automaticRecovery: { enabled: true, backup: { instanceId: "spare", model: "s" } } }]);
    await pick($('[data-settings-row="botBackup.1"] [data-pill-select]'), "Second model");
    expect(fixture.dispatch).toHaveBeenLastCalledWith({ type: "updateBot", botId: "bot-1", patch: { fallback: [{ instanceId: "backup", model: "m2" }, { instanceId: "spare", model: "s" }] } });
    expect(patched().at(-1)).toEqual([path, { automaticRecovery: { enabled: true, backup: { instanceId: "backup", model: "m2" } } }]);
    await click(host.querySelector('[aria-label="Remove Backup engine from the fallback list"]'));
    expect(fixture.dispatch).toHaveBeenLastCalledWith({ type: "updateBot", botId: "bot-1", patch: { fallback: [{ instanceId: "spare", model: "s" }] } });
    expect(patched().at(-1)).toEqual([path, { automaticRecovery: { enabled: true, backup: { instanceId: "spare", model: "s" } } }]);
  });

  it("removing the last backup turns recovery off, and the add row stops at five", async () => {
    await render(bot({ automaticRecovery: { enabled: true, backup: { instanceId: "spare", model: "s" } }, fallback: [{ instanceId: "spare", model: "s" }] }));
    await click(host.querySelector('[aria-label="Remove Spare from the fallback list"]'));
    expect(fixture.dispatch).toHaveBeenLastCalledWith({ type: "updateBot", botId: "bot-1", patch: { fallback: [] } });
    expect(patched().at(-1)).toEqual(["/api/bots/bot-1/runtime-settings", { automaticRecovery: { enabled: false } }]);
    const five = ["a", "b", "c", "d", "e"].map((id) => ({ instanceId: id, model: "x" }));
    await render(bot({ fallback: five }));
    expect($('[data-settings-row="botBackup.add"]')).toBeNull();
    expect($('[data-settings-row="botBackup.5"]')).not.toBeNull();
  });

  it("shows an older single backup as the first ordered backup, switch on", async () => {
    await render(bot({ automaticRecovery: { enabled: true, backup: { instanceId: "gone", model: "old" } } }));
    expect(recoveryCard()!.dataset.botRecovery).toBe("on");
    expect(toggle()!.getAttribute("aria-checked")).toBe("true");
    expect($('[data-settings-row="botBackup.1"]')?.textContent).toContain("1. gone");
    expect($('[data-settings-row="botBackup.1"] [data-pill-select]')?.textContent).toContain("old");
    expect(fixture.dispatch, "shown, not written, until the list changes").not.toHaveBeenCalled();
  });

  it("surfaces a failed save on the card", async () => {
    fixture.api = vi.fn(async () => { throw new Error("Fixture save failed"); });
    await render(bot({ fallback: [{ instanceId: "spare", model: "s" }] }));
    await click(toggle());
    expect(recoveryCard()!.querySelector('[role="alert"]')?.textContent).toBe("Fixture save failed");
    expect(toggle()!.getAttribute("aria-checked"), "still off").toBe("false");
  });

  it("Keep warm overrides the workspace from the Advanced fold", async () => {
    await render(bot());
    await pick($('[data-settings-row="botKeepWarm"] [data-pill-select]'), "On");
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "updateBot", botId: "bot-1", patch: { cacheKeepWarm: true } });
    expect($('[data-settings-row="botKeepWarm"] [data-pill-select]')?.textContent).toContain("Same as Settings (On)");
  });
});

describe("Bot > Model, rights and drafts", () => {
  it("an organization member on someone else's bot sees the Model card only", async () => {
    fixture.config = { viewer: { operator: false, principalId: "pr_zara", email: "zara@example.test", name: "zara", role: "member", canCreateBots: true }, cacheKeepWarm: { enabled: false, windowMinutes: 60 } } as unknown as ConfigStatus;
    await render(bot({ ownerUserId: "pr_other" }));
    expect($("[data-model-picker]")).not.toBeNull();
    expect(recoveryCard()).toBeNull();
    expect($('[data-settings-row="botPayerMode"]')).toBeNull();
    // the prompt cache stays theirs to set, as before
    expect($('[data-settings-row="botKeepWarm"]')).not.toBeNull();
  });

  it("a creation draft has the Model card alone", async () => {
    await render(bot(), true);
    expect($("[data-model-picker]")).not.toBeNull();
    expect(recoveryCard()).toBeNull();
    expect($('[data-settings-card="botModel.advanced"]')).toBeNull();
  });

  it("a bot on a machine keeps only the Advanced fold beside its host", async () => {
    await render(bot({ host: { kind: "machine", deviceId: "dev-1" } } as Partial<Bot>));
    expect($("[data-model-picker]")).toBeNull();
    expect($("[data-effort-row]")).toBeNull();
    expect(recoveryCard()).toBeNull();
    expect($('[data-settings-row="botKeepWarm"]')).not.toBeNull();
  });
});
