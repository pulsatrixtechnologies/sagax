// @vitest-environment happy-dom
// The Bot folder is the memory's one interface (owner 2026-10-15): "Use memory"
// heads it, "New" makes a memory topic as well as a document, MEMORY.md is
// edited in place, memory files are deleted from their row, and the
// memory's options are in the folder's "..." menu.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ConfirmProvider } from "@/components/ConfirmProvider";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { WorkspaceEntry, WorkspaceListing } from "@/lib/workspace-files";
import type { Bot } from "@/state/store";

const EMPTY_HASH = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const fixture = vi.hoisted(() => ({
  saveMemoryDoc: vi.fn(),
  fetchMemoryDoc: vi.fn(),
  deleteMemoryDoc: vi.fn(),
  fetchWorkspace: vi.fn(),
  deleteWorkspaceEntry: vi.fn(),
  countWorkspaceFiles: vi.fn(),
  fetchMemoryJournal: vi.fn(),
  fetchUpkeepStatus: vi.fn(),
  fetchMemoryOverview: vi.fn(),
  dispatch: vi.fn(),
}));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: () => {} }));
vi.mock("@/lib/memory", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/memory")>()),
  saveMemoryDoc: fixture.saveMemoryDoc,
  fetchMemoryDoc: fixture.fetchMemoryDoc,
  deleteMemoryDoc: fixture.deleteMemoryDoc,
  fetchMemoryJournal: fixture.fetchMemoryJournal,
  fetchUpkeepStatus: fixture.fetchUpkeepStatus,
  fetchMemoryOverview: fixture.fetchMemoryOverview,
}));
vi.mock("@/lib/workspace-files", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/workspace-files")>()),
  fetchWorkspace: fixture.fetchWorkspace,
  deleteWorkspaceEntry: fixture.deleteWorkspaceEntry,
  countWorkspaceFiles: fixture.countWorkspaceFiles,
}));
vi.mock("@/state/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/state/store")>()),
  useStore: () => ({ state: {}, dispatch: fixture.dispatch }),
}));
// a plain field for the editor: the test reads and types its text
vi.mock("../markdown/MarkdownEditor", async () => {
  const { createElement: h } = await import("react");
  return {
    MarkdownEditor: ({ value, onChange, ariaLabel }: { value: string; onChange: (text: string) => void; ariaLabel: string }) =>
      h("textarea", { "aria-label": ariaLabel, value, onChange: (event: { target: { value: string } }) => onChange(event.target.value) }),
  };
});

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
const type = async (selector: string, value: string) => {
  const field = q<HTMLInputElement | HTMLTextAreaElement>(selector)!;
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")!.set!;
  await act(async () => {
    setter.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

function render(props: Partial<Parameters<typeof WorkspaceFilesSection>[0]> = {}) {
  act(() => root.render(createElement(ConfirmProvider, null, createElement(WorkspaceFilesSection, {
    bot, active: false, onOpenSection: () => {}, initial: listing, initialExpanded: ["memory"], memoryEditable: true, ...props,
  }))));
}

beforeEach(() => {
  setLocale("en");
  for (const mock of Object.values(fixture)) mock.mockReset();
  fixture.fetchWorkspace.mockResolvedValue(listing);
  fixture.fetchMemoryJournal.mockResolvedValue([]);
  fixture.fetchUpkeepStatus.mockResolvedValue(null);
  fixture.fetchMemoryOverview.mockResolvedValue({});
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("Bot folder: the memory's one interface", () => {
  it("heads the folder with Use memory, which turns memory off and on", async () => {
    const onToggle = vi.fn();
    render({ memory: { enabled: true, busy: false, onToggle } });
    const toggle = q('[role="switch"]')!;
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(container.textContent).toContain("Use memory");
    // first thing on the page
    expect(container.firstElementChild?.firstElementChild?.textContent).toContain("Use memory");
    await click('[role="switch"]');
    expect(onToggle).toHaveBeenCalledWith(false);
    // and nothing of the old Memory section: no MEMORY.md card, no Topics list
    expect(container.textContent).not.toContain("Topics");
  });

  it("creates a memory topic from New: a file in memory/ with its header, opened to write", async () => {
    fixture.saveMemoryDoc.mockImplementation(async (_bot: string, path: string, text: string) => ({ ok: true, doc: { path, text, hash: "h1" }, overview: {} }));
    fixture.fetchWorkspace.mockResolvedValue({ ...listing, entries: [...listing.entries, file("memory/Clients VIP.md", { load: "on-demand" })] });
    render();
    await click("[data-files-new-menu]");
    const topic = document.querySelector<HTMLElement>('[data-files-kind="topic"]');
    expect(topic).not.toBeNull();
    await act(async () => { topic!.click(); });
    await flush();
    expect(q('[data-files-create="topic"]')).not.toBeNull();
    await type("[data-files-new-name]", "Clients VIP");
    await click("[data-files-new]");
    expect(fixture.saveMemoryDoc).toHaveBeenCalledWith("pepper", "memory/Clients VIP.md", expect.stringContaining("title: Clients VIP"), EMPTY_HASH);
    expect(q('[data-file-editor="memory/Clients VIP.md"]')).not.toBeNull();
    expect(q("[data-files-create]")).toBeNull();
  });

  it("offers File and Folder to a viewer who may not edit memory, without a topic or folder options", async () => {
    render({ memoryEditable: false });
    await click("[data-files-new-menu]");
    expect(document.querySelector('[data-files-kind="file"]')).not.toBeNull();
    expect(document.querySelector('[data-files-kind="folder"]')).not.toBeNull();
    expect(document.querySelector('[data-files-kind="topic"]')).toBeNull();
    expect(q("[data-files-options]")).toBeNull();
  });

  it("edits MEMORY.md in place and saves it with the memory's conflict check", async () => {
    fixture.fetchMemoryDoc.mockResolvedValue({ path: "MEMORY.md", text: "- likes tea\n", hash: "h0" });
    fixture.saveMemoryDoc.mockResolvedValue({ ok: true, doc: { path: "MEMORY.md", text: "- likes coffee\n", hash: "h2" }, overview: {} });
    render();
    await click('[data-file-open="MEMORY.md"]');
    expect(fixture.fetchMemoryDoc).toHaveBeenCalledWith("pepper", "MEMORY.md");
    const editor = q<HTMLTextAreaElement>('[data-file-editor="MEMORY.md"] textarea')!;
    expect(editor.value).toBe("- likes tea\n");
    await type('[data-file-editor="MEMORY.md"] textarea', "- likes coffee\n");
    await click("[data-file-save]");
    expect(fixture.saveMemoryDoc).toHaveBeenCalledWith("pepper", "MEMORY.md", "- likes coffee\n", "h0");
  });

  it("deletes a memory topic from its row menu, after the red confirmation", async () => {
    fixture.deleteWorkspaceEntry.mockResolvedValue({ ok: true, path: "memory/clients.md", removed: 1 });
    fixture.countWorkspaceFiles.mockResolvedValue({ path: "memory/clients.md", count: 1 });
    render();
    await click('[data-file-menu="memory/clients.md"]');
    const del = document.querySelector<HTMLElement>('[data-file-delete="memory/clients.md"]');
    expect(del).not.toBeNull();
    await act(async () => { del!.click(); });
    await flush();
    expect(fixture.deleteWorkspaceEntry).not.toHaveBeenCalled();
    // the app's ConfirmDialog is portaled to the body
    const confirm = document.querySelector<HTMLButtonElement>("[data-confirm-action]")!;
    expect(document.querySelector('[data-confirm-tone="danger"]')).not.toBeNull();
    await act(async () => { confirm.click(); });
    await flush();
    expect(fixture.deleteWorkspaceEntry).toHaveBeenCalledWith("pepper", "memory/clients.md", { recursive: true });
  });

  it("keeps tidying and the memory's change log in the folder's ... menu", async () => {
    render({ active: true });
    await flush();
    expect(q("[data-folder-options]")).toBeNull();
    await click("[data-files-options]");
    expect(q("[data-folder-options]")).not.toBeNull();
    expect(container.textContent).toContain("Tidy memory automatically");
    expect(fixture.fetchMemoryJournal).toHaveBeenCalledWith("pepper");
  });
});
