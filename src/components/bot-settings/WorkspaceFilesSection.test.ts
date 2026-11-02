// Files: the whole workspace with when each file reaches the bot, sizes
// against budgets, dates, last use and the forgotten marker; document
// actions only on docs/; Simple mode keeps the badges, not their details.
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup as renderMarkup } from "react-dom/server";
import { ConfirmProvider } from "@/components/ConfirmProvider";

const renderToStaticMarkup = (node: ReactNode) => renderMarkup(createElement(ConfirmProvider, null, node));
import { beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { WorkspaceEntry, WorkspaceListing } from "@/lib/workspace-files";
import type { Bot } from "@/state/store";

const fixture = vi.hoisted(() => ({ advanced: true }));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => fixture.advanced, setAdvancedMode: () => {} }));

const { WorkspaceFilesSection, entryDetails } = await import("./WorkspaceFilesSection");

const now = Date.parse("2026-10-09T12:00:00Z");
const day = 24 * 60 * 60_000;
const file = (path: string, load: WorkspaceEntry["load"], extra: Partial<WorkspaceEntry> = {}): WorkspaceEntry => ({
  path, kind: "file", bytes: 120, createdAt: now - 2 * day, modifiedAt: now - day, load, editable: true, markdown: true, forgotten: false, ...extra,
});
const listing: WorkspaceListing = {
  workspacePath: "/data/workspaces/pepper",
  now,
  forgottenAfterDays: 30,
  budgets: { rules: { maxLines: 60, maxBytes: 8000 }, memory: { maxLines: 200, maxBytes: 24000 }, soul: { maxBytes: 24000 } },
  rulesTemplate: "# Rules\n",
  soul: { ...file("SOUL.md", "every-turn", { editable: false, virtual: "soul", budget: { maxBytes: 24000, lines: 0, bytes: 900, over: false } }), lastUsedAt: now - 60_000 },
  entries: [
    file("MEMORY.md", "every-turn", { budget: { maxLines: 200, maxBytes: 24000, lines: 12, bytes: 800, over: false }, lastUsedAt: now - 60_000 }),
    file("RULES.md", "every-turn", { budget: { maxLines: 60, maxBytes: 8000, lines: 4, bytes: 90, over: false } }),
    { path: "docs", kind: "dir", bytes: 0, load: "never", editable: false, markdown: false, forgotten: false },
    file("docs/onboarding.md", "on-demand", { createdAt: now - 90 * day, modifiedAt: now - 90 * day, forgotten: true }),
    { path: "memory", kind: "dir", bytes: 0, load: "never", editable: false, markdown: false, forgotten: false },
    { path: "memory/log", kind: "dir", bytes: 0, load: "never", editable: false, markdown: false, forgotten: false },
    file("memory/log/2026-10-08.md", "never"),
    file("report.pdf", "never", { editable: false, markdown: false }),
  ],
  truncated: false,
};
const bot = { id: "pepper", name: "Pepper" } as unknown as Bot;
const render = (expanded?: string[]) => renderToStaticMarkup(createElement(WorkspaceFilesSection, { bot, active: false, onOpenSection: () => {}, initial: listing, initialExpanded: expanded }))
  .replace(/&#x27;/g, "'").replace(/&quot;/g, '"');

beforeEach(() => {
  setLocale("en");
  fixture.advanced = true;
});

describe("WorkspaceFilesSection", () => {
  it("lists SOUL.md first, then the tree with folders collapsed, each visible file with its load badge", () => {
    const html = render();
    const rows = [...html.matchAll(/data-file-row="([^"]+)"/g)].map((match) => match[1]);
    expect(rows).toEqual(["SOUL.md", "MEMORY.md", "RULES.md", "docs", "memory", "report.pdf"]);
    expect(html).toContain('data-folder-toggle="memory"');
    expect(html).toContain('data-folder-expanded="false"');
    expect(html).toContain('aria-label="Expand memory"');
    expect(html).not.toContain('data-file-row="docs/onboarding.md"');
    expect(html).not.toContain('data-file-row="memory/log"');
    expect(html).not.toContain('data-file-row="memory/log/2026-10-08.md"');
    const badges = [...html.matchAll(/data-load-badge="([\w-]+)"/g)].map((match) => match[1]);
    expect(badges).toEqual(["every-turn", "every-turn", "every-turn", "never"]);
    for (const label of [">Every turn<", ">Never loaded<"]) expect(html).toContain(label);
  });

  it("opens a folder like a file manager, nested folders still collapsed", () => {
    const memory = render(["memory"]);
    expect([...memory.matchAll(/data-file-row="([^"]+)"/g)].map((match) => match[1])).toEqual([
      "SOUL.md", "MEMORY.md", "RULES.md", "docs", "memory", "memory/log", "report.pdf",
    ]);
    expect(memory).toContain('data-folder-toggle="memory"');
    expect(memory).toContain('aria-label="Collapse memory"');
    expect(memory).toContain('aria-label="Expand log"');
    expect(memory).not.toContain('data-file-row="memory/log/2026-10-08.md"');
    const open = render(["docs", "memory", "memory/log"]);
    expect([...open.matchAll(/data-file-row="([^"]+)"/g)].map((match) => match[1])).toEqual([
      "SOUL.md", "MEMORY.md", "RULES.md", "docs", "docs/onboarding.md", "memory", "memory/log", "memory/log/2026-10-08.md", "report.pdf",
    ]);
    expect(open).toContain(">On demand<");
  });

  it("marks a file nobody used in 30 days that does not load every turn as forgotten", () => {
    const html = render(["docs"]);
    expect(html).toMatch(/data-file-row="docs\/onboarding.md" data-forgotten=""/);
    expect(html.match(/data-forgotten-badge=""/g)).toHaveLength(1);
    expect(html).toContain("Not used in 30 days and not loaded every turn");
  });

  it("shows sizes against budgets, dates and last use in Advanced", () => {
    const html = render();
    expect(html).toContain("12 / 200 lines · 800 B / 23.4 KB");
    expect(html).toContain("4 / 60 lines · 90 B / 7.8 KB");
    expect(html).toContain("last used 1 min ago");
    expect(html).toContain("not used yet");
    expect(html).toContain("data-workspace-path");
    expect(entryDetails(listing.entries[3]!, now)).toContain("120 B · created");
  });

  it("keeps the badges and drops their details in Simple mode", () => {
    fixture.advanced = false;
    const html = render(["docs"]);
    expect(html).toContain(">Every turn<");
    expect(html).not.toContain("data-file-details");
    expect(html).not.toContain("data-workspace-path");
    expect(html).not.toContain('title="Loaded into the system prompt');
    expect(html).toContain("data-forgotten-badge");
  });

  it("offers a row menu on every entry, Upload any type, and New File/Folder", () => {
    const html = render(["docs"]);
    expect(html).toContain('data-file-menu="docs/onboarding.md"');
    expect(html).toContain('data-file-menu="MEMORY.md"');
    expect(html).toContain('data-file-menu="RULES.md"');
    expect(html).toContain('data-core=""');
    expect(html).toContain("data-files-new-menu");
    expect(html).toContain("data-files-upload");
    expect(html).toContain("data-files-upload-input");
    expect(html).not.toContain('accept=".md,.markdown,text/markdown"');
  });
});
