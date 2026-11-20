// @vitest-environment happy-dom
// Knowledge on the bot page (M-20261119-081): To review, then the Bot folder
// in place. The Skills, Write a command and Its work sections are gone and
// nothing they offered is lost: the folder's "..." menu holds Skills, Learn
// from use, Write a command and the Memory page; a skill's own folder
// (skills/<name>/) says its state under its name and carries its actions
// (Review changes, Share, Turn on or off...) in its "..." menu; skills/ says
// what waits for a review. To review (#3400) moved here from the Skills card.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConfirmProvider } from "@/components/ConfirmProvider";
import { SettingsSurfaceProvider } from "@/components/SettingsPrimitives";
import { setLocale } from "@/lib/i18n";
import type { WorkspaceEntry, WorkspaceListing } from "@/lib/workspace-files";
import type { Bot } from "@/state/store";

const fixture = vi.hoisted(() => ({
  fetchWorkspace: vi.fn(),
  dispatch: vi.fn(),
  config: { features: { skillsLibrary: true } } as Record<string, unknown>,
}));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: () => {} }));
vi.mock("@/lib/memory", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/memory")>()),
  fetchMemoryJournal: vi.fn(async () => []),
  fetchUpkeepStatus: vi.fn(async () => ({ enabled: true })),
  fetchMemoryOverview: vi.fn(async () => ({})),
}));
vi.mock("@/lib/workspace-files", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/workspace-files")>()),
  fetchWorkspace: fixture.fetchWorkspace,
}));
vi.mock("@/state/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/state/store")>()),
  useStore: () => ({ state: { bots: [], config: fixture.config }, dispatch: fixture.dispatch, flushBotPatches: () => Promise.resolve() }),
}));

const { BotFolderCard, skillOfEntry } = await import("./BotFolderCard");
const { BotEditorContext } = await import("../../bot-settings/BotEditorContext");

const now = Date.parse("2026-11-19T12:00:00Z");
const file = (path: string, extra: Partial<WorkspaceEntry> = {}): WorkspaceEntry => ({
  path, kind: "file", bytes: 120, createdAt: now, modifiedAt: now, load: "every-turn", editable: true, markdown: true, forgotten: false, ...extra,
});
const dir = (path: string): WorkspaceEntry => ({ path, kind: "dir", bytes: 0, load: "never", editable: false, markdown: false, forgotten: false });
const listing: WorkspaceListing = {
  workspacePath: "/data/workspaces/pepper",
  now,
  forgottenAfterDays: 30,
  budgets: { rules: { maxLines: 60, maxBytes: 8000 }, memory: { maxLines: 200, maxBytes: 24000 }, soul: { maxBytes: 24000 } },
  rulesTemplate: "# Rules\n",
  soul: file("SOUL.md", { editable: false, virtual: "soul" }),
  entries: [
    file("MEMORY.md"), file("RULES.md"),
    dir("docs"), dir("memory"), dir("skills"),
    dir("skills/weekly-report"), file("skills/weekly-report/SKILL.md", { load: "on-demand" }),
    dir("skills/intake"), file("skills/intake/SKILL.md", { load: "on-demand" }),
  ],
  truncated: false,
};
const bot = { id: "pepper", name: "Pepper", memoryEnabled: true } as unknown as Bot;

type SkillsAnswer = { skills: unknown[]; staged: unknown[]; library: unknown[]; assignedSkills: string[] };
const SKILLS: SkillsAnswer = {
  skills: [
    { name: "weekly-report", description: "Writes the weekly report.", enabled: true, source: "", warnings: [], origin: "private" },
    { name: "intake", description: "Sorts new requests.", enabled: false, source: "", warnings: ["stored SKILL.md changed after review - enablement is blocked"], origin: "private" },
  ],
  staged: [],
  library: [],
  assignedSkills: [],
};
let skillsAnswer: SkillsAnswer = SKILLS;
const request = vi.fn(async (path: string, _init?: RequestInit) => (path === `/api/bots/${bot.id}/skills` ? skillsAnswer : {}));

let root: Root;
let container: HTMLDivElement;
const flush = async () => { for (let i = 0; i < 4; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const q = <T extends Element = HTMLElement>(selector: string) => container.querySelector<T>(selector);
const press = async (element: Element | null, what: string) => {
  if (!element) throw new Error(`missing ${what}`);
  await act(async () => { (element as HTMLElement).click(); });
  await flush();
};
/** The items of the menu open now (portalled to the body). */
const menuItems = () => Array.from(document.querySelectorAll<HTMLElement>("[role='menu'] [data-files-menu-item]")).map((item) => item.getAttribute("data-files-menu-item"));

const handlers = {
  onOpenSection: vi.fn(),
  onOpenChat: vi.fn(),
  onOpenSkills: vi.fn(),
  onWriteCommand: vi.fn(),
  onOpenMemory: vi.fn(),
};
function render(props: Record<string, unknown> = {}) {
  act(() => root.render(createElement(SettingsSurfaceProvider, {
    surface: "plain",
    children: createElement(ConfirmProvider, null, createElement(BotEditorContext.Provider, {
      value: { request: request as never },
      children: createElement(BotFolderCard, {
        bot, active: true, lock: null, memoryEditable: true, memory: { enabled: true, busy: false, onToggle: () => {} }, skillsShown: true, refreshKey: 0, ...handlers, ...props,
      }),
    })),
  })));
}

beforeEach(() => {
  setLocale("en");
  request.mockClear();
  fixture.dispatch.mockReset();
  for (const handler of Object.values(handlers)) handler.mockReset();
  fixture.fetchWorkspace.mockReset();
  fixture.fetchWorkspace.mockResolvedValue(listing);
  skillsAnswer = SKILLS;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("Knowledge: To review, then the Bot folder (M-20261119-081)", () => {
  it("finds a skill's folder by its name, only directly under skills/", () => {
    const skills = SKILLS.skills as Parameters<typeof skillOfEntry>[1];
    expect(skillOfEntry("skills/intake", skills)?.name).toBe("intake");
    expect(skillOfEntry("skills/intake/SKILL.md", skills)).toBeNull();
    expect(skillOfEntry("docs/intake", skills)).toBeNull();
    expect(skillOfEntry("skills/unknown", skills)).toBeNull();
  });

  it("draws To review then the folder, with no Skills card and no Write a command card", async () => {
    render();
    await flush();
    const review = q('[data-settings-group="bot-profile-review"]')!;
    const folder = q("[data-files-folder]")!;
    expect(review).not.toBeNull();
    expect(folder).not.toBeNull();
    expect(review.compareDocumentPosition(folder) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(q("[data-skills-section]"), "no Skills card").toBeNull();
    expect(q("[data-write-command]"), "no Write a command card").toBeNull();
    expect(container.textContent).not.toContain("Its work");
  });

  it("the folder's ... menu holds Skills, Learn from use, Write a command, the Memory page, then Upkeep and changes", async () => {
    render();
    await flush();
    await press(q("[data-files-options]"), "the folder's menu");
    expect(menuItems()).toEqual(["skills", "learning", "command", "memory", "options"]);
    const learning = document.querySelector<HTMLElement>('[data-files-menu-item="learning"]')!;
    expect(learning.getAttribute("role")).toBe("menuitemcheckbox");
    expect(learning.getAttribute("aria-checked")).toBe("true");
    expect(learning.textContent).toContain("Learn from use");
    await press(learning, "Learn from use");
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "updateBot", botId: "pepper", patch: { skillLearning: false } });
    for (const [item, handler] of [["skills", handlers.onOpenSkills], ["command", handlers.onWriteCommand], ["memory", handlers.onOpenMemory]] as const) {
      await press(q("[data-files-options]"), "the folder's menu");
      await press(document.querySelector(`[data-files-menu-item="${item}"]`), item);
      expect(handler, item).toHaveBeenCalledTimes(1);
    }
  });

  it("a skill's folder says its state and carries its actions; skills/ says what waits", async () => {
    render({ });
    await flush();
    await press(q('[data-folder-toggle="skills"]'), "open skills/");
    const waiting = q('[data-file-note="skills"]')!;
    expect(waiting.textContent).toBe("1 to review");
    const intake = q('[data-file-note="skills/intake"]')!;
    expect(intake.textContent).toContain("Needs review");
    expect(intake.textContent).toContain("Off");
    expect(intake.textContent).toContain("Sorts new requests.");
    expect(q('[data-file-note="skills/weekly-report"]')!.textContent).toContain("Writes the weekly report.");
    // the skill's own actions first in its "..." menu, then the folder's own
    await press(q('[data-file-menu="skills/intake"]'), "the menu of skills/intake");
    const items = menuItems();
    expect(items.slice(0, 4)).toEqual(["skill-open", "skill-review", "skill-edit", "skill-toggle"]);
    expect(items).toContain("skill-share");
    expect(items).toContain("skill-remove");
    expect(document.querySelector('[data-files-menu-item="skill-review"]')!.textContent).toContain("Review changes");
    expect(document.querySelector('[data-files-menu-item="skill-share"]')!.textContent).toContain("Share");
    // skills/ itself: Skills, then the folder's own items
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    await press(q('[data-file-menu="skills"]'), "the menu of skills/");
    expect(menuItems()).toEqual(["skills"]);
  });

  it("a folder this viewer may not change says why and keeps its ... menu (the skills, the Memory page)", async () => {
    render({ lock: "persona.locked.owner" });
    await flush();
    expect(q("[data-files-folder]")).toBeNull();
    const locked = q('[data-settings-group="bot-profile-locked-files"]')!;
    expect(locked).not.toBeNull();
    await press(locked.querySelector("[data-files-options]"), "the locked folder's menu");
    expect(menuItems()).toEqual(["skills", "learning", "command", "memory"]);
  });

  it("#3400: To review lists each proposal, decided in place on the chat's card, or one row when none waits", async () => {
    skillsAnswer = {
      skills: [], library: [], assignedSkills: [],
      staged: [{ id: "st1", name: "pricing-check", gist: "Compares a quote with the last three prices.", action: "create", sha256: "a".repeat(64), card: { threadId: "th1", requestId: "rq1", messageId: "m1" } }],
    };
    render();
    await flush();
    const reviewCard = q('[data-settings-group="bot-profile-review"]')!;
    const row = reviewCard.querySelector<HTMLElement>('[data-bot-profile-row="review-st1"]')!;
    expect(row.textContent).toContain("pricing-check");
    expect(row.textContent).toContain("Compares a quote");
    await press(row.querySelector("[data-bot-profile-review-open]"), "Open in chat");
    expect(handlers.onOpenChat).toHaveBeenCalledTimes(1);
    skillsAnswer = { skills: [], library: [], assignedSkills: [], staged: [] };
    await press(row.querySelector("[data-bot-profile-review-allow]"), "Enable");
    const answer = request.mock.calls.find(([path]) => path === "/api/threads/th1/respond");
    expect(answer).toBeDefined();
    expect(JSON.parse(String((answer![1] as RequestInit).body))).toEqual({ requestId: "rq1", behavior: "allow", reviewedSha256: "a".repeat(64), via: "profile" });
    expect(q("[data-bot-profile-review-empty]")?.textContent).toContain("You're all caught up");
  });

  it("reads the skills again when the Skills modal closes (refreshKey)", async () => {
    render();
    await flush();
    const reads = () => request.mock.calls.filter(([path]) => path === `/api/bots/${bot.id}/skills`).length;
    const before = reads();
    render({ refreshKey: 1 });
    await flush();
    expect(reads()).toBe(before + 1);
  });
});
