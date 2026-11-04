// @vitest-environment happy-dom
// Every field that edits markdown uses the shared MarkdownEditor. For each
// one: the editor mounts with the field's existing value, and a change goes
// out through the field's own handler and save path (same request, same
// body shape as the textarea it replaced).
import { createElement, type ReactElement } from "react";
import { ConfirmProvider } from "@/components/ConfirmProvider";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Bot, Group } from "@/state/store";
import type { WebhookTrigger } from "@/lib/webhooks";
import type { Routine } from "../../../shared/routines";
import { blurMarkdown, markdownEditorIn, markdownText, typeMarkdown } from "./markdown-editor-test-utils";

const fixture = vi.hoisted(() => ({
  api: vi.fn(),
  dispatch: vi.fn(),
  state: {} as Record<string, unknown>,
}));

vi.mock("@/state/store", async (original) => ({
  ...await original<typeof import("@/state/store")>(),
  api: fixture.api,
  useStore: () => ({ state: fixture.state, dispatch: fixture.dispatch, flushBotPatches: () => Promise.resolve() }),
}));
vi.mock("../DesktopCapabilities", async (original) => ({
  ...await original<typeof import("../DesktopCapabilities")>(),
  useCaptionChrome: () => ({ padClass: "" }),
  useMacInsetChrome: () => ({ macInset: false, browser: true }),
  useDesktopCapabilities: () => ({ capabilities: { host: {}, dictation: { available: false } }, ready: true }),
}));
vi.mock("../ExportTranscriptMenu", () => ({ ExportTranscriptMenu: () => null }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

const { setLocale, t } = await import("@/lib/i18n");
const { setInterfaceMode } = await import("@/lib/interface-mode");
const { BotEditorContext } = await import("../bot-settings/BotEditorContext");
const { SoulField } = await import("../SoulField");
const { MemoryEditorDialog } = await import("../bot-settings/MemorySection");
const { SkillPage } = await import("../plugins/SkillPage");
const { GroupMemoryBody } = await import("../GroupMemoryTab");
const { GroupPanel } = await import("../GroupPanel");
const { SectionContextDialog } = await import("../TeamMapPage");
const { RoutineEditor, QuickComposer } = await import("../RoutineCalendarPage");
const { TriggersPanel } = await import("../TriggersPanel");
const { WebhookEditor } = await import("../WebhooksPanel");
const { AboutMeEditor } = await import("../AboutMeSettings");
const { DraftMemory } = await import("../NewBotDialog");

let host: HTMLDivElement;
let root: Root;
const render = (element: ReactElement) => flushSync(() => root.render(createElement(ConfirmProvider, null, element)));
const settle = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};
const button = (scope: ParentNode, text: string) =>
  [...scope.querySelectorAll<HTMLButtonElement>("button")].find((element) => element.textContent?.trim() === text);

const bot = {
  id: "scout", threadId: "thread", name: "Scout", title: "", description: "Finds things.", soul: "# Scout\n\nBe brief.",
  color: "green", notifications: true, unread: false, busy: false, messages: [], hidden: false,
  modelSelection: { instanceId: "claude", model: "m" },
} as unknown as Bot;

beforeEach(() => {
  setLocale("en");
  setInterfaceMode("advanced");
  fixture.api.mockReset();
  fixture.dispatch.mockReset();
  fixture.state = { bots: [bot], groups: [], config: null, webhooks: [], webhookAttempts: [], routineRuns: [], webhookIngress: { available: true }, instances: [], routines: [], calendarCalls: [] };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

describe("markdown fields", () => {
  it("SOUL.md: mounts with the soul and patches the bot", async () => {
    const request = vi.fn().mockResolvedValue({ soul: bot.soul, revision: "r1", bytes: 18, limit: 16_000, file: "/bots/scout/SOUL.md", drift: false });
    const onPatch = vi.fn();
    render(createElement(BotEditorContext.Provider, { value: { request } }, createElement(SoulField, { bot, onPatch })));
    const editor = await markdownEditorIn(host, "soul");
    expect(markdownText(editor)).toBe("# Scout\n\nBe brief.");
    expect(editor.getAttribute("aria-labelledby")).toBe("bot-soul-label-scout");
    typeMarkdown(editor, "# Scout\n\n- Be brief.");
    expect(onPatch).toHaveBeenLastCalledWith({ soul: "# Scout\n\n- Be brief." });
  });

  it("MEMORY.md: mounts with the file and reports edits to the dialog", async () => {
    const onChange = vi.fn();
    const noop = vi.fn();
    render(createElement(MemoryEditorDialog, {
      editing: { path: "MEMORY.md", text: "# Memory\n\n- Ada leads", hash: "h", dirty: false, readOnly: false },
      botName: "Scout", conflict: null, saving: false, savedDraft: null,
      onChange, onSave: noop, onDiscard: noop, onClose: noop, onReload: noop, onOverwrite: noop, onDismissDraft: noop, onOpenIndex: noop,
    }));
    const editor = await markdownEditorIn(document.body, "memory");
    expect(markdownText(editor)).toBe("# Memory\n\n- Ada leads");
    typeMarkdown(editor, "# Memory\n\n- Ada leads\n- Bob reviews");
    expect(onChange).toHaveBeenLastCalledWith("# Memory\n\n- Ada leads\n- Bob reviews");
  });

  it("a daily log stays read-only in the editor", async () => {
    const noop = vi.fn();
    render(createElement(MemoryEditorDialog, {
      editing: { path: "memory/2026-10-09.md", text: "log", hash: "h", dirty: false, readOnly: true },
      botName: "Scout", conflict: null, saving: false, savedDraft: null,
      onChange: noop, onSave: noop, onDiscard: noop, onClose: noop, onReload: noop, onOverwrite: noop, onDismissDraft: noop, onOpenIndex: noop,
    }));
    const editor = await markdownEditorIn(document.body, "memory");
    expect(editor.getAttribute("contenteditable")).toBe("true");
    expect(document.body.querySelector<HTMLButtonElement>('[data-md-tool="bold"]')!.disabled).toBe(true);
  });

  it("SKILL.md instructions: loads the body and saves through PUT", async () => {
    fixture.api.mockImplementation(async (_path: string, init?: { method?: string }) => {
      if (!init) return { text: "---\nname: release-notes\ndescription: Writes notes\n---\n\n## Steps\n\n1. Read the log" };
      return {};
    });
    const skill = { name: "release-notes", description: "Writes notes", source: "local-import", enabled: true, tags: [], version: null, importedAt: "2026-10-08T00:00:00Z", warnings: [], assignedBots: [] };
    const onSaved = vi.fn();
    render(createElement(SkillPage, { skill, onBack: vi.fn(), onSaved, onDeleted: vi.fn() }) as ReactElement);
    await settle();
    const editor = await markdownEditorIn(host, "skill-instructions");
    expect(markdownText(editor)).toBe("## Steps\n\n1. Read the log");
    typeMarkdown(editor, "## Steps\n\n1. Read the log\n2. Write the notes");
    flushSync(() => host.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());
    await settle();
    expect(fixture.api).toHaveBeenCalledWith("/api/skills-library/release-notes", {
      method: "PUT",
      body: JSON.stringify({ name: "release-notes", description: "Writes notes", instructions: "## Steps\n\n1. Read the log\n2. Write the notes" }),
    });
  });

  it("group memory: mounts with the draft and reports edits", async () => {
    const onDraft = vi.fn();
    const noop = vi.fn();
    const view = { enabled: true, canEdit: true, text: "- Ops meets Monday", capacity: { lines: 1, bytes: 18, maxLines: 200, maxBytes: 24_000, loadedLines: 1, loadedBytes: 18, truncated: false, hash: "h" } };
    render(createElement(GroupMemoryBody, { view, draft: view.text, conflict: false, error: null, saving: false, onDraft, onReset: noop, onSave: noop, onToggle: noop, onReload: noop, onOverwrite: noop } as never));
    const editor = await markdownEditorIn(host, "group-memory");
    expect(markdownText(editor)).toBe("- Ops meets Monday");
    typeMarkdown(editor, "- Ops meets Tuesday");
    expect(onDraft).toHaveBeenLastCalledWith("- Ops meets Tuesday");
  });

  it("group instructions: mounts with the bulletin and saves it on blur", async () => {
    const group = { id: "room", name: "Ops", bulletin: "Be brief.", memberIds: [], messages: [], defaultResponder: { kind: "auto" } } as unknown as Group;
    render(createElement(GroupPanel, { group, members: [], details: null, advanced: null, canEdit: true }));
    flushSync(() => button(document.body, t("groupPanel.tab.instructions"))!.click());
    const editor = await markdownEditorIn(document.body, "group-instructions");
    expect(markdownText(editor)).toBe("Be brief.");
    typeMarkdown(editor, "**Be brief.**");
    blurMarkdown(editor);
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "patchGroup", groupId: "room", patch: { bulletin: "**Be brief.**" } });
  });

  it("team instructions: loads the section context and saves it with PUT", async () => {
    fixture.api.mockImplementation(async (_path: string, init?: { method?: string; body?: string }) => {
      if (init?.method === "PUT") return { section: "ops", label: "Ops", text: JSON.parse(init.body!).text, updatedAt: 2, maxBytes: 8_000 };
      return { section: "ops", label: "Ops", text: "## Goals\n\n- Ship", updatedAt: 1, maxBytes: 8_000 };
    });
    render(createElement(SectionContextDialog, { section: "ops", label: "Ops", onClose: vi.fn() }));
    await settle();
    const editor = await markdownEditorIn(document.body, "team-instructions");
    expect(markdownText(editor)).toBe("## Goals\n\n- Ship");
    typeMarkdown(editor, "## Goals\n\n- Ship\n- Test");
    const save = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((element) => /Save/.test(element.textContent ?? "") && !element.disabled)!;
    flushSync(() => save.click());
    await settle();
    expect(fixture.api).toHaveBeenCalledWith("/api/section-context?section=ops", { method: "PUT", body: JSON.stringify({ text: "## Goals\n\n- Ship\n- Test" }) });
  });

  it("routine instructions: enters Edit with the prompt and saves it as the routine prompt", async () => {
    const routine: Routine = {
      id: "weekly", name: "Weekly digest", prompt: "Summarise the **week**", target: "bot", botId: bot.id,
      runOn: "maus", enabled: true, schedule: { type: "daily", time: "09:00", weekdays: [1, 2, 3, 4, 5] }, durationMinutes: 30,
      nextRunAt: null, createdAt: 1, updatedAt: 1,
    };
    const request = vi.fn().mockImplementation(async (_path: string, init?: { body?: string }) => ({
      routine: { ...routine, ...JSON.parse(init?.body ?? "{}") },
    }));
    fixture.api.mockResolvedValue({});
    render(createElement(ConfirmProvider, null, createElement(BotEditorContext.Provider, { value: { request } }, createElement(RoutineEditor, { routine, bots: [bot], lockedBotId: bot.id, onClose: vi.fn() }))));
    await settle();
    // 83dd3cc52: an existing routine opens in view mode, then Edit mounts
    // the markdown field in place. Keep the saved prompt through both modes.
    expect(document.body.querySelector("[data-routine-editor-actions=view]")).not.toBeNull();
    expect(document.body.querySelector("[data-routine-instruction-text] strong")?.textContent).toBe("week");
    const edit = document.body.querySelector<HTMLButtonElement>("[data-routine-edit-mode]");
    expect(edit).not.toBeNull();
    flushSync(() => edit!.click());
    const editor = await markdownEditorIn(document.body, "routine-instructions");
    expect(markdownText(editor)).toBe("Summarise the **week**");
    typeMarkdown(editor, "Summarise the **week**\n\n- wins\n- risks");
    const save = button(document.body, "Save") ?? button(document.body, "Save changes");
    flushSync(() => save!.click());
    await settle();
    const call = request.mock.calls.find(([path]) => path === "/api/routines/weekly");
    expect(call).toBeDefined();
    expect(call![1].method).toBe("PATCH");
    expect(JSON.parse(call![1].body).prompt).toBe("Summarise the **week**\n\n- wins\n- risks");
    expect(document.body.querySelector("[data-routine-editor-actions=view]")).not.toBeNull();
    expect([...document.body.querySelectorAll("[data-routine-instruction-text] li")].map((item) => item.textContent)).toEqual(["wins", "risks"]);
  });

  it("quick routine: mounts empty and posts the instructions as the prompt", async () => {
    fixture.api.mockResolvedValue({ routine: { id: "new" } });
    const onSavedRoutine = vi.fn();
    render(createElement(ConfirmProvider, null, createElement(QuickComposer, {
      seed: { kind: "routine", at: Date.UTC(2026, 9, 10, 9), durationMinutes: 30, botIds: [bot.id], name: "Check inbox", description: "Read *new* mail" },
      bots: [bot], routinesOnly: true, onClose: vi.fn(), onMore: vi.fn(), onSavedRoutine, onSavedCall: vi.fn(),
    })));
    const editor = await markdownEditorIn(document.body, "routine-instructions-quick");
    expect(markdownText(editor)).toBe("Read *new* mail");
    typeMarkdown(editor, "Read *new* mail\n- [ ] reply");
    flushSync(() => button(document.body, "Save")!.click());
    await settle();
    const [path, init] = fixture.api.mock.calls.find(([target]) => target === "/api/routines")!;
    expect(path).toBe("/api/routines");
    expect(JSON.parse(init.body).prompt).toBe("Read *new* mail\n- [ ] reply");
    expect(onSavedRoutine).toHaveBeenCalled();
  });

  it("trigger instructions: start empty and post with the new trigger", async () => {
    fixture.api.mockResolvedValue({ webhook: { id: "w1" } });
    render(createElement(TriggersPanel));
    const editor = await markdownEditorIn(document.body, "trigger-instructions");
    expect(markdownText(editor)).toBe("");
    typeMarkdown(editor, "Summarise the **event**");
    flushSync(() => document.body.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());
    await settle();
    const [, init] = fixture.api.mock.calls.find(([target]) => target === "/api/webhooks")!;
    expect(JSON.parse(init.body).prompt).toBe("Summarise the **event**");
  });

  it("webhook default instructions: mount with the saved prompt and patch it", async () => {
    const webhook = {
      id: "w1", endpointId: "ep-w1", name: "GitHub", prompt: "## Rule\n\nTriage it", botId: bot.id, runOn: "maus", enabled: true,
      createdAt: 1, updatedAt: 1, deliveryCount: 0, tokenLast4: "k3Yz",
    } as WebhookTrigger;
    fixture.api.mockResolvedValue({ webhook });
    render(createElement(WebhookEditor, { webhook, bots: [bot], onClose: vi.fn(), onCredential: vi.fn() }));
    const editor = await markdownEditorIn(document.body, "webhook-instructions");
    expect(markdownText(editor)).toBe("## Rule\n\nTriage it");
    typeMarkdown(editor, "## Rule\n\n1. Triage it");
    flushSync(() => button(document.body, "Save changes")!.click());
    await settle();
    const [path, init] = fixture.api.mock.calls.find(([, options]) => options?.method === "PATCH" || options?.method === "PUT")!;
    expect(path).toContain("/api/webhooks/w1");
    expect(JSON.parse(init.body).prompt).toBe("## Rule\n\n1. Triage it");
  });

  it("About me: mounts with the saved text and saves on blur", async () => {
    fixture.state = { ...fixture.state, config: { profile: { aboutMe: "I run **ops**." } } };
    fixture.api.mockImplementation(async (_path: string, init?: { body?: string }) => ({ profile: JSON.parse(init?.body ?? "{}").profile }));
    render(createElement(AboutMeEditor));
    const editor = await markdownEditorIn(host, "about-me");
    expect(markdownText(editor)).toBe("I run **ops**.");
    expect(editor.id).toBe("profile-about-me");
    typeMarkdown(editor, "I run **ops** in Montreal.");
    blurMarkdown(editor);
    await settle();
    expect(fixture.api).toHaveBeenCalledWith("/api/config", expect.objectContaining({ method: "PUT", body: JSON.stringify({ profile: { aboutMe: "I run **ops** in Montreal." } }) }));
  });

  it("New bot draft memory: mounts with the template file and writes it back", async () => {
    const setMemory = vi.fn();
    const draft = { template: { memory: { "MEMORY.md": "# Notes" } }, setMemory };
    render(createElement(DraftMemory, { draft } as never));
    const editor = await markdownEditorIn(host, "new-bot-memory");
    expect(markdownText(editor)).toBe("# Notes");
    typeMarkdown(editor, "# Notes\n\n- first");
    expect(setMemory).toHaveBeenLastCalledWith("MEMORY.md", "# Notes\n\n- first");
  });
});
