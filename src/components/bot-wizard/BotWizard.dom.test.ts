// @vitest-environment happy-dom
// The wizard's screen: the two mode cards, the draft made on the server, the
// mode switch that keeps everything, skipping a step, the Primary Bot's
// guided conversation, and Finish.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyWizardPatch, newWizardDraft, type WizardDraft } from "../../../shared/bot-wizard";

const fixture = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  dispatch: vi.fn(),
  lib: {
    listWizardDrafts: vi.fn(),
    readWizardDraft: vi.fn(),
    startWizardDraft: vi.fn(),
    patchWizardDraft: vi.fn(),
    createWizardBot: vi.fn(),
    openWizardThread: vi.fn(),
    sendWizardMessage: vi.fn(),
    finishWizard: vi.fn(),
    deleteWizardDraft: vi.fn(),
    createDesignerBot: vi.fn(),
  },
}));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  useStore: () => ({ state: fixture.state, dispatch: fixture.dispatch }),
}));
vi.mock("@/lib/bot-wizard", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/bot-wizard")>(), ...fixture.lib }));
vi.mock("./WizardSteps", () => ({
  stepTitle: (step: string) => `title:${step}`,
  stepIntro: (step: string) => `intro:${step}`,
  StepBody: ({ step }: { step: string }) => createElement("div", { "data-stub-step": step }),
  useRuleEffects: (draft: { rules: Record<string, string> }) => [Object.fromEntries(Object.keys(draft.rules).map((id) => [id, id.startsWith("ask") ? "ask" : "deny"])), () => {}],
}));
vi.mock("./WizardConversation", () => ({
  WizardConversation: ({ botId, threadId }: { botId: string; threadId: string }) => createElement("div", { "data-stub-chat": `${botId}:${threadId}` }),
}));
vi.mock("../Avatar", () => ({ BotAvatar: () => null }));
vi.mock("../BotZipImport", () => ({
  BotZipImportDialog: () => createElement("div", { "data-stub-import": "zip" }),
  BotZipImportPanel: () => createElement("div", { "data-stub-import": "zip" }),
}));
vi.mock("../AgentImport", () => ({
  AgentImportDialog: () => createElement("div", { "data-stub-import": "agent" }),
  AgentImportPanel: () => createElement("div", { "data-stub-import": "agent" }),
}));
vi.mock("../NewBotDialog", () => ({
  NewBotForm: () => createElement("div", { "data-stub-template": "form" }),
  NewBotDialog: () => null,
}));

const { BotWizard } = await import("./BotWizard");

const newBot = { id: "bot-new", name: "Nova", title: "", description: "", color: "green", messages: [], threadId: "t-new", modelSelection: { instanceId: "", model: "" } };
const designer = { id: "bot-designer", name: "Concepteur de bots", title: "", description: "", color: "blue", messages: [], threadId: "t-d", modelSelection: { instanceId: "", model: "" } };
const readyEngine = { id: "claude", install: true, access: "default", snapshot: { state: "available", authenticated: true } };
const primary = { id: "bot-primary", name: "Chef", chiefOfStaff: true, title: "", description: "", color: "blue", messages: [], threadId: "t-p", modelSelection: { instanceId: "", model: "" } };

let server: WizardDraft | null;
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  server = null;
  fixture.dispatch.mockReset();
  fixture.state = { bots: [primary], botWizard: { botId: null } };
  for (const fn of Object.values(fixture.lib)) fn.mockReset();
  fixture.lib.listWizardDrafts.mockResolvedValue([]);
  fixture.lib.createWizardBot.mockImplementation(async () => {
    fixture.state = { ...fixture.state, bots: [primary, newBot] };
    return newBot;
  });
  fixture.lib.startWizardDraft.mockImplementation(async (botId: string, body: { origin: "new" | "redo"; mode: "guided" | "manual" }) => {
    server = newWizardDraft({ botId, owner: "pr_me", origin: body.origin, mode: body.mode, now: 1 });
    return server;
  });
  fixture.lib.patchWizardDraft.mockImplementation(async (_botId: string, patch: Parameters<typeof applyWizardPatch>[1]) => {
    server = applyWizardPatch(server!, patch, (server?.updatedAt ?? 1) + 1);
    return server;
  });
  fixture.lib.readWizardDraft.mockImplementation(async () => ({ draft: server, suggestions: { rules: [], routines: [], tools: [], apps: [] } }));
  fixture.lib.openWizardThread.mockResolvedValue("thread-guided");
  fixture.lib.createDesignerBot.mockImplementation(async () => {
    fixture.state = { ...fixture.state, bots: [...(fixture.state.bots as unknown[]), designer] };
    return designer;
  });
  fixture.lib.sendWizardMessage.mockResolvedValue(undefined);
  fixture.lib.finishWizard.mockImplementation(async (draft: WizardDraft) => ({ draft: { ...draft, status: "done" }, failed: [] }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const click = async (selector: string) => {
  const target = container.querySelector<HTMLButtonElement>(selector);
  expect(target, selector).not.toBeNull();
  await act(async () => { target!.click(); });
};
const render = async () => { await act(async () => { root.render(createElement(BotWizard)); }); };
const rerender = render;

describe("the bot creation wizard", () => {
  it("opens on the two mode cards, then creates the bot and its draft in manual mode", async () => {
    await render();
    expect(container.querySelector('[data-wizard-choose="guided"]')?.textContent).toContain("Chef");
    expect(container.querySelector('[data-wizard-choose="manual"]')).not.toBeNull();
    await click('[data-wizard-choose="manual"]');
    expect(fixture.lib.createWizardBot).toHaveBeenCalledTimes(1);
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "botAdded", bot: newBot, preserveSelection: true });
    expect(fixture.lib.startWizardDraft).toHaveBeenCalledWith("bot-new", { origin: "new", mode: "manual" });
    await rerender();
    expect(container.querySelector('[data-stub-step="identity"]')).not.toBeNull();
    expect(container.querySelector("[data-wizard-guided-chat]")).toBeNull();
    // guided mode never opened: no conversation with the Primary Bot yet
    expect(fixture.lib.openWizardThread).not.toHaveBeenCalled();
  });

  it("skips a step, goes back, and switching mode keeps the draft and opens the guided conversation", async () => {
    await render();
    await click('[data-wizard-choose="manual"]');
    await rerender();
    await click("[data-wizard-skip]");
    expect(fixture.lib.patchWizardDraft).toHaveBeenLastCalledWith("bot-new", { skip: "identity" });
    expect(container.querySelector('[data-stub-step="soul"]')).not.toBeNull();
    await click("[data-wizard-next]");
    expect(container.querySelector('[data-stub-step="rules"]')).not.toBeNull();

    await click('[data-wizard-mode="guided"]');
    expect(fixture.lib.patchWizardDraft).toHaveBeenCalledWith("bot-new", { mode: "guided" });
    // the same draft: still on Rules, Identity still skipped
    expect(server).toMatchObject({ mode: "guided", step: "rules", skipped: ["identity"] });
    expect(fixture.lib.openWizardThread).toHaveBeenCalledWith("bot-primary", expect.any(String));
    expect(fixture.lib.sendWizardMessage).toHaveBeenCalledWith("bot-primary", "thread-guided", expect.stringContaining("Nova"));
    expect(server).toMatchObject({ guidedBotId: "bot-primary", guidedThreadId: "thread-guided" });
    await rerender();
    expect(container.querySelector('[data-stub-chat="bot-primary:thread-guided"]')).not.toBeNull();
    expect(container.querySelector('[data-stub-step="rules"]')).not.toBeNull();

    await click('[data-wizard-mode="manual"]');
    expect(server).toMatchObject({ mode: "manual", step: "rules", guidedThreadId: "thread-guided" });
    // back to guided later: the same conversation, never a second one
    await click('[data-wizard-mode="guided"]');
    expect(fixture.lib.openWizardThread).toHaveBeenCalledTimes(1);
  });

  it("the guided card starts with the Primary Bot's conversation", async () => {
    await render();
    await click('[data-wizard-choose="guided"]');
    expect(fixture.lib.startWizardDraft).toHaveBeenCalledWith("bot-new", { origin: "new", mode: "guided" });
    expect(fixture.lib.sendWizardMessage).toHaveBeenCalledTimes(1);
    await rerender();
    expect(container.querySelector("[data-wizard-guided-chat]")).not.toBeNull();
  });

  it("with no bot to guide, Guided creates the Bot designer, which leads, with no admin step", async () => {
    fixture.state = { bots: [], botWizard: { botId: null }, instances: [readyEngine] };
    await render();
    expect(container.querySelector('[data-wizard-choose="guided"]')?.getAttribute("data-wizard-guided-state")).toBe("designer");
    await click('[data-wizard-choose="guided"]');
    expect(fixture.lib.createDesignerBot).toHaveBeenCalledTimes(1);
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "botAdded", bot: designer, preserveSelection: true });
    expect(fixture.lib.openWizardThread).toHaveBeenCalledWith("bot-designer", expect.any(String));
    expect(fixture.lib.sendWizardMessage).toHaveBeenCalledWith("bot-designer", "thread-guided", expect.stringContaining("Nova"));
    expect(server).toMatchObject({ guidedBotId: "bot-designer", mode: "guided" });
  });

  it("with no bot and no engine, the guided card says so and opens the engines, never a dead button", async () => {
    fixture.state = { bots: [], botWizard: { botId: null }, instances: [{ ...readyEngine, snapshot: { state: "missing" } }] };
    await render();
    const card = container.querySelector('[data-wizard-choose="guided"]')!;
    expect(card.getAttribute("data-wizard-guided-state")).toBe("needs-engine");
    expect(container.querySelector("[data-wizard-connect-engine]")).not.toBeNull();
    await click("[data-wizard-connect-engine]");
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "closeBotWizard" });
    expect(fixture.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "toggleAppSettings", open: true }));
    expect(fixture.lib.createDesignerBot).not.toHaveBeenCalled();
    expect(fixture.lib.createWizardBot).not.toHaveBeenCalled();
  });

  it("quick create is the first step; other starts keep template, browse and imports", async () => {
    fixture.state = { bots: [primary], botWizard: { botId: null }, config: { viewer: { canCreateBots: true } } };
    await render();
    expect(container.querySelector("[data-wizard-quick-create]")).not.toBeNull();
    expect([...container.querySelectorAll("[data-wizard-other]")].map((node) => node.getAttribute("data-wizard-other")))
      .toEqual(["template", "browse", "import-agent", "import-zip"]);
    await click('[data-wizard-other="template"]');
    expect(container.querySelector('[data-stub-template="form"]')).not.toBeNull();
    await click("[data-wizard-back-view]");
    expect(container.querySelector("[data-wizard-quick-create]")).not.toBeNull();
    await click('[data-wizard-other="browse"]');
    expect(fixture.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "openBotCatalog", section: "templates" }));
    await click('[data-wizard-other="import-agent"]');
    expect(container.querySelector('[data-stub-import="agent"]')).not.toBeNull();
  });

  it("quick create sends name, colour and shape through newBot", async () => {
    fixture.state = { bots: [primary], botWizard: { botId: null }, config: { viewer: { canCreateBots: true } } };
    await render();
    const name = container.querySelector<HTMLInputElement>("[data-wizard-quick-name]")!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(name, "Nova");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click('[data-wizard-quick-shape="bean"]');
    await click('[data-wizard-quick-color="blue"]');
    await click("[data-wizard-quick-submit]");
    expect(fixture.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: "newBot",
      settings: expect.objectContaining({
        name: "Nova",
        color: "blue",
        mascotLook: expect.objectContaining({ character: "shape", shape: "bean" }),
      }),
    }));
  });

  it("resumes an open draft of a bot straight on its step and mode", async () => {
    fixture.state = { bots: [primary, newBot], botWizard: { botId: "bot-new" } };
    server = applyWizardPatch(newWizardDraft({ botId: "bot-new", owner: "pr_me", origin: "new", mode: "manual", now: 1 }), { step: "routines" }, 2);
    await render();
    expect(container.querySelector('[data-stub-step="routines"]')).not.toBeNull();
    expect(fixture.lib.createWizardBot).not.toHaveBeenCalled();
  });

  it("Redo opens the mode choice on the existing bot, never a new bot", async () => {
    fixture.state = { bots: [primary, newBot], botWizard: { botId: "bot-new", redo: true } };
    fixture.lib.readWizardDraft.mockRejectedValue(new Error("none"));
    await render();
    expect(container.querySelector("[data-wizard-mode-choice]")?.textContent).toContain("Nova");
    expect(container.querySelector("[data-wizard-other-starts]")).toBeNull();
    await click('[data-wizard-choose="manual"]');
    expect(fixture.lib.createWizardBot).not.toHaveBeenCalled();
    expect(fixture.lib.startWizardDraft).toHaveBeenCalledWith("bot-new", { origin: "redo", mode: "manual", restart: true });
  });

  it("finishes from the recap and opens the bot", async () => {
    fixture.state = { bots: [primary, newBot], botWizard: { botId: "bot-new" } };
    server = applyWizardPatch(newWizardDraft({ botId: "bot-new", owner: "pr_me", origin: "new", mode: "manual", now: 1 }), { step: "recap", routines: ["morning-brief"] }, 2);
    await render();
    await click("[data-wizard-finish]");
    expect(fixture.lib.finishWizard).toHaveBeenCalledWith(expect.objectContaining({ botId: "bot-new", routines: ["morning-brief"] }), expect.any(String));
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "closeBotWizard" });
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "select", id: "bot-new" });
  });

  it("Tools and apps is off the path unless the bot uses apps or a computer", async () => {
    await render();
    await click('[data-wizard-choose="manual"]');
    await rerender();
    await click("[data-wizard-next]");
    await click("[data-wizard-next]");
    expect(container.querySelector('[data-stub-step="rules"]')).not.toBeNull();
    await click("[data-wizard-next]");
    // Rules goes straight to Routines, and back
    expect(container.querySelector('[data-stub-step="routines"]')).not.toBeNull();
    await click("[data-wizard-back]");
    expect(container.querySelector('[data-stub-step="rules"]')).not.toBeNull();
    expect(container.textContent).toContain("5");
  });

  it("the recap is a compact summary: the bot's card, one line per step with Edit, Try it and Finish", async () => {
    fixture.state = { bots: [primary, { ...newBot, description: "Sorts the inbox", soul: "You are Nova.", approvalMode: "auto", mcpServers: [] }], botWizard: { botId: "bot-new" } };
    server = applyWizardPatch(newWizardDraft({ botId: "bot-new", owner: "pr_me", origin: "new", mode: "manual", roleId: "inbox", now: 1 }),
      { step: "recap", rules: { "ask-send-mail": "r1", "deny-payment": "r2", "deny-delete-mail": "r3" }, routines: ["inbox-triage"] }, 2);
    fixture.lib.readWizardDraft.mockImplementation(async () => ({ draft: server, suggestions: { rules: [], routines: [], tools: [], apps: [] } }));
    await render();
    const card = container.querySelector("[data-wizard-recap-card]")!;
    expect(card.textContent).toContain("Nova");
    expect(card.textContent).toContain("Sorts the inbox");
    expect(container.querySelector("[data-wizard-try]")).not.toBeNull();
    expect(container.querySelector("[data-wizard-finish]")).not.toBeNull();
    // read only: no step's form is drawn on the recap
    expect(container.querySelector("[data-stub-step]")).toBeNull();
    expect([...container.querySelectorAll("[data-wizard-recap-section]")].map((row) => row.getAttribute("data-wizard-recap-section")))
      .toEqual(["identity", "soul", "rules", "tools", "routines"]);
    const rules = container.querySelector('[data-wizard-recap-section="rules"] [data-wizard-recap-summary]')!.textContent!;
    expect(rules).toContain("1");
    expect(rules).toContain("2");
    await click('[data-wizard-recap-edit="tools"]');
    expect(fixture.lib.patchWizardDraft).toHaveBeenLastCalledWith("bot-new", { step: "tools" });
    expect(container.querySelector('[data-stub-step="tools"]')).not.toBeNull();
  });

  it("Later closes and keeps the draft", async () => {
    await render();
    await click('[data-wizard-choose="manual"]');
    await click("[data-wizard-later]");
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "closeBotWizard" });
    expect(fixture.lib.deleteWizardDraft).not.toHaveBeenCalled();
  });
});
