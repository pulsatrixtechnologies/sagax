// A person's Library tab (#2117): the bot Library's look for the files the
// viewer and this person have together, each file served from its own
// conversation, and the bot Library's empty state with the person's line.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { ThreadFile } from "@/lib/chat-files";

const { PersonLibraryBody } = await import("./LibraryTab");

const now = Date.parse("2026-11-05T12:00:00Z");
const DAY = 24 * 3_600_000;
const file = (id: string, name: string, threadId: string, daysAgo: number, extra: Partial<ThreadFile> = {}): ThreadFile => ({
  id: id.repeat(24).slice(0, 24), messageId: "m1", source: "upload", path: name, name, at: now - daysAgo * DAY, size: 12, available: true,
  threadId, groupId: threadId.replace("t-", ""), groupName: threadId, ...extra,
});
const render = (files: ThreadFile[] | null, extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(PersonLibraryBody, { files, now, ...extra }));

beforeEach(() => setLocale("en"));

describe("Person Library tab", () => {
  it("lists the shared files in the bot Library's cards, grouped by period", () => {
    const html = render([
      file("a", "plan.pdf", "t-ops", 1, { mime: "application/pdf" }),
      file("b", "photo.png", "t-dm", 2, { mime: "image/png" }),
      file("c", "notes.txt", "t-ops", 20, { pinned: true }),
    ]);
    expect(html).toContain("data-library=");
    expect(html).toContain('data-library-group="pinned"');
    expect(html).toContain('data-library-group="thisWeek"');
    expect(html).toContain("rounded-2xl");
    for (const name of ["plan.pdf", "photo.png", "notes.txt"]) expect(html).toContain(name);
    // an image's thumbnail comes from its own conversation
    expect(html).toContain("/api/threads/t-dm/files/");
    expect(html).not.toContain("/api/threads//files/");
  });

  it("keeps the same file id in two conversations as two rows", () => {
    const html = render([file("d", "same.txt", "t-ops", 1), file("d", "same.txt", "t-dm", 1)]);
    expect(html.split("same.txt").length - 1).toBeGreaterThanOrEqual(2);
  });

  it("follows the bot Library's empty state with the person's line", () => {
    const html = render([]);
    expect(html).toContain("data-library-empty");
    expect(html).toContain("Files you and this person share in your groups and conversations show up here.");
  });

  it("shows loading, then the retry on an error", () => {
    expect(render(null)).toContain("Loading");
    expect(render(null, { filesError: true })).toContain("Retry");
  });
});
