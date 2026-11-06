// @vitest-environment happy-dom
// The Bot folder on the bot's profile page (#2313, plain surface): one card
// labelled "Bot folder" in grey above it, its rows (Use memory, the folder's
// path, the files) with a line icon, the name in 14px and a grey line under
// it; no bordered box, no underlined link, no primary button. The folder's
// "..." menu opens Upkeep and Changes as two more labelled cards under it.
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConfirmProvider } from "@/components/ConfirmProvider";
import { SettingsSurfaceProvider } from "@/components/SettingsPrimitives";
import { setLocale } from "@/lib/i18n";
import type { MemoryJournalRow } from "@/lib/memory";
import type { WorkspaceEntry, WorkspaceListing } from "@/lib/workspace-files";
import type { Bot } from "@/state/store";

const fixture = vi.hoisted(() => ({
  fetchWorkspace: vi.fn(),
  fetchMemoryJournal: vi.fn(),
  fetchUpkeepStatus: vi.fn(),
  fetchMemoryOverview: vi.fn(),
  markMemoryReviewed: vi.fn(),
  dispatch: vi.fn(),
}));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: () => {} }));
vi.mock("@/lib/memory", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/memory")>()),
  fetchMemoryJournal: fixture.fetchMemoryJournal,
  fetchUpkeepStatus: fixture.fetchUpkeepStatus,
  fetchMemoryOverview: fixture.fetchMemoryOverview,
  markMemoryReviewed: fixture.markMemoryReviewed,
}));
vi.mock("@/lib/workspace-files", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/workspace-files")>()),
  fetchWorkspace: fixture.fetchWorkspace,
}));
vi.mock("@/state/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/state/store")>()),
  useStore: () => ({ state: {}, dispatch: fixture.dispatch }),
}));

const { WorkspaceFilesSection } = await import("./WorkspaceFilesSection");

const now = Date.parse("2026-10-15T12:00:00Z");
const file = (path: string, extra: Partial<WorkspaceEntry> = {}): WorkspaceEntry => ({
  path, kind: "file", bytes: 120, createdAt: now, modifiedAt: now, load: "every-turn", editable: true, markdown: true, forgotten: false, ...extra,
});
const listing: WorkspaceListing = {
  workspacePath: "/data/workspaces/pepper",
  now,
  forgottenAfterDays: 30,
  budgets: { rules: { maxLines: 60, maxBytes: 8000 }, memory: { maxLines: 200, maxBytes: 24000 }, soul: { maxBytes: 24000 } },
  rulesTemplate: "# Rules\n",
  soul: file("SOUL.md", { editable: false, virtual: "soul" }),
  entries: [
    file("MEMORY.md", { budget: { maxLines: 200, maxBytes: 24000, lines: 2, bytes: 40, over: false } }),
    { path: "memory", kind: "dir", bytes: 0, load: "never", editable: false, markdown: false, forgotten: false },
    file("memory/clients.md", { load: "on-demand" }),
  ],
  truncated: false,
};
const bot = { id: "pepper", name: "Pepper", memoryEnabled: true } as unknown as Bot;
const change: MemoryJournalRow = {
  id: "j1", at: now - 60_000, botId: "pepper", path: "memory/clients.md", actor: "bot", via: "chat",
  kind: "edited", beforeHash: "a", afterHash: "b", diff: "-old line\n+new line", added: 1, removed: 1, canRevert: true,
};

let root: Root;
let container: HTMLDivElement;
const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const q = <T extends Element = HTMLElement>(selector: string) => container.querySelector<T>(selector);
const click = async (selector: string) => {
  const element = q(selector);
  if (!element) throw new Error(`missing ${selector}`);
  await act(async () => { element.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  await flush();
};

const plainSurface = (element: ReactElement) => createElement(SettingsSurfaceProvider, { surface: "plain", children: element });
function render(props: Partial<Parameters<typeof WorkspaceFilesSection>[0]> = {}) {
  act(() => root.render(plainSurface(createElement(ConfirmProvider, null, createElement(WorkspaceFilesSection, {
    bot, active: true, onOpenSection: () => {}, initial: listing, initialExpanded: ["memory"], memoryEditable: true, ...props,
  })))));
}
// the HelpTip popovers (<details>) carry the app's popover outline
const markup = () => container.innerHTML.replace(/<details[\s\S]*?<\/details>/g, "");
const expectPlain = () => {
  const html = markup();
  expect(html).not.toMatch(/\bborder(-\[|-border|-hairline|-accent)/);
  expect(html).not.toContain("underline");
  expect(html).not.toContain("ui-button-primary");
  expect(html).not.toContain("font-medium");
  expect(html).not.toContain("font-semibold");
};

beforeEach(() => {
  setLocale("en");
  for (const mock of Object.values(fixture)) mock.mockReset();
  fixture.fetchWorkspace.mockResolvedValue(listing);
  fixture.fetchMemoryJournal.mockResolvedValue([change]);
  fixture.fetchUpkeepStatus.mockResolvedValue({ enabled: true, modelSteps: true });
  fixture.fetchMemoryOverview.mockResolvedValue({});
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("Bot folder on the profile page (plain)", () => {
  it("is one card labelled Bot folder: Use memory, the path and the files are its rows, nothing framed", async () => {
    const onToggle = vi.fn();
    render({ memory: { enabled: true, busy: false, onToggle } });
    await flush();
    const folder = q("[data-files-folder]")!;
    expect(folder.querySelector("h3")?.textContent).toBe("Bot folder");
    // the toolbar sits at the label's right
    expect(folder.querySelector("[data-files-upload]")).not.toBeNull();
    expect(folder.querySelector("[data-files-options]")).not.toBeNull();
    const card = folder.querySelector("[data-settings-surface]")!;
    expect(card.className).toContain("bg-card");
    // Use memory: a row with its switch
    const memoryRow = card.querySelector("[data-memory-toggle]")!;
    expect(memoryRow.textContent).toContain("Use memory");
    const toggle = memoryRow.querySelector<HTMLElement>('[role="switch"]')!;
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    await act(async () => { toggle.click(); });
    expect(onToggle).toHaveBeenCalledWith(false);
    // the folder's path, grey under its name (advanced mode)
    const path = card.querySelector("[data-workspace-path]")!;
    expect(path.textContent).toBe("/data/workspaces/pepper");
    expect(path.closest(".text-ink-secondary")).not.toBeNull();
    expect(path.className).not.toContain("font-mono");
    // the files: a row each, what loads when grey under the name
    expect(card.querySelector('[data-file-open="MEMORY.md"]')).not.toBeNull();
    expect(card.querySelector('[data-file-open="memory/clients.md"]')).not.toBeNull();
    expect(card.querySelectorAll("[data-file-details]").length).toBeGreaterThan(0);
    expect(card.querySelector("[data-file-details]")!.className).toContain("text-ink-secondary");
    expectPlain();
  });

  it("opens Upkeep and Changes as two labelled cards under the folder, a change a row with its diff and Undo", async () => {
    render({ memory: { enabled: true, busy: false, onToggle: () => {} } });
    await flush();
    expect(q("[data-folder-options]")).toBeNull();
    await click("[data-files-options]");
    const options = q("[data-folder-options]")!;
    expect(options).not.toBeNull();
    // under the folder's card, not inside it
    expect(q("[data-files-folder]")!.contains(options)).toBe(false);
    expect(options.querySelector("[data-memory-upkeep] h3")?.textContent).toBe("Upkeep");
    expect(options.querySelector("[data-memory-changes] h3")?.textContent).toBe("Changes");
    expect(options.textContent).toContain("Tidy memory automatically");
    const row = options.querySelector('[data-journal-row="j1"]')!;
    expect(row.textContent).toContain("Undo");
    const fold = row.querySelector<HTMLElement>("[data-inline-fold]")!;
    expect(fold.getAttribute("data-inline-fold")).toBe("closed");
    expect(row.querySelector("pre")!.hidden).toBe(true);
    await act(async () => { fold.click(); });
    expect(fold.getAttribute("data-inline-fold")).toBe("open");
    expect(row.querySelector("pre")!.hidden).toBe(false);
    expectPlain();
  });

  it("shows the lending notice as a row of the folder's card, Mark reviewed a pill", async () => {
    fixture.fetchMemoryOverview.mockResolvedValue({ lendingReview: { token: "t1", changed: ["memory/clients.md"] } });
    fixture.markMemoryReviewed.mockResolvedValue({ ok: true });
    render();
    await flush();
    const notice = q("[data-lending-review]")!;
    expect(notice).not.toBeNull();
    expect(q("[data-files-folder] [data-settings-surface]")!.contains(notice)).toBe(true);
    expect(notice.textContent).toContain("memory/clients.md");
    const button = notice.querySelector<HTMLButtonElement>("button")!;
    expect(button.textContent).toContain("Mark reviewed");
    expect(button.className).toContain("ui-button");
    expectPlain();
    await act(async () => { button.click(); });
    await flush();
    expect(fixture.markMemoryReviewed).toHaveBeenCalledWith("pepper", "t1");
    expect(q("[data-lending-review]")).toBeNull();
  });

  it("asks a new file's name inside the card, on a plain field", async () => {
    render();
    await flush();
    await click("[data-files-new-menu]");
    const kind = document.querySelector<HTMLElement>('[data-files-kind="file"]')!;
    await act(async () => { kind.click(); });
    await flush();
    const box = q("[data-files-create]")!;
    expect(q("[data-files-folder] [data-settings-surface]")!.contains(box)).toBe(true);
    expect(box.querySelector("[data-files-new-name]")!.className).toContain("bg-inset");
    expectPlain();
  });
});
