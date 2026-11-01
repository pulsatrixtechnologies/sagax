import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ThreadFile } from "@/lib/chat-files";
import { setLocale } from "@/lib/i18n";

vi.mock("@/state/store", () => ({
  api: vi.fn(),
  useStore: () => ({ state: { loadingOlder: {} }, dispatch: vi.fn() }),
}));

const { FilesBrowser, downloadThreadFile } = await import("./FilesSection");
setLocale("en");
afterEach(() => vi.unstubAllGlobals());

const file = (name: string, patch: Partial<ThreadFile> = {}): ThreadFile => ({
  id: `${name.replace(/\W/g, "").padEnd(24, "0").slice(0, 24)}`,
  messageId: `m-${name}`,
  source: "written",
  path: `/work/${name}`,
  name,
  at: Date.UTC(2026, 8, 29, 12),
  size: 2048,
  available: true,
  ...patch,
});

const files = [
  file("chart.png", { source: "attachment", mime: "image/png" }),
  file("demo.mp4"),
  file("report.pdf", { source: "upload", path: "/data/attachments/11111111-1111-4111-8111-111111111111.pdf" }),
  file("main.ts", { path: "src/main.ts", localPath: "/work/src/main.ts" }),
  file("bundle.zip"),
  file("remote.png", { available: false, size: null, path: "/home/cua/remote.png" }),
];

const render = (props: Partial<Parameters<typeof FilesBrowser>[0]> = {}) => renderToStaticMarkup(createElement(FilesBrowser, {
  threadId: "thread-1",
  files,
  error: false,
  onRetry: () => undefined,
  onJump: () => undefined,
  initialView: "list",
  ...props,
}));

describe("FilesBrowser", () => {
  it("keeps one bar (search and Filter) and lists the files with their origin and size", () => {
    const html = render();
    expect(html).toContain('aria-label="Search files"');
    expect(html).toContain('data-files-filter=""');
    expect(html).toContain(">Filter</span>");
    // The menu is closed: no chips, no selects, no view toggle on screen.
    expect(html).not.toContain("aria-pressed");
    expect(html).not.toContain("<select");
    expect(html).not.toContain('role="menu"');
    expect(html).toContain('data-files-view="list"');
    for (const name of ["chart.png", "demo.mp4", "report.pdf", "main.ts", "bundle.zip", "remote.png"]) expect(html).toContain(name);
    expect(html).toContain("Bot attached · 2.0 KB");
    expect(html).toContain("You sent · 2.0 KB");
    expect(html).toContain("Not on this computer");
  });

  it("puts type (only kinds that have files), origin, sort and view in the Filter menu", () => {
    const html = render({ openMenus: "filter" });
    for (const [label, count] of [["All", 6], ["Images", 2], ["Videos", 1], ["Documents", 1], ["Code", 1], ["Other", 1]] as const) {
      expect(html).toMatch(new RegExp(`role="menuitemradio" aria-checked="(?:true|false)"[^>]*>.*?<span class="flex-1">${label}</span><span[^>]*>${count}</span>`));
    }
    // An empty kind is not offered.
    expect(html).not.toContain('data-files-type="audio"');
    for (const id of ["all", "bot", "you"]) expect(html).toContain(`data-files-origin="${id}"`);
    for (const id of ["newest", "name", "size"]) expect(html).toContain(`data-files-sort="${id}"`);
    for (const id of ["list", "grid"]) expect(html).toContain(`data-files-view-choice="${id}"`);
    expect(html).toMatch(/aria-checked="true"[^>]*data-files-type="all"/);
  });

  it("loads image thumbnails by opaque id, never by host path", () => {
    const html = render();
    expect(html).toContain(`src="/api/threads/thread-1/files/${files[0]!.id}?preview=1"`);
    expect(html).not.toMatch(/src="[^"]*(?:\/work\/|\/data\/attachments)/);
    // An unavailable image gets an icon, not a request.
    expect(html).not.toContain(`files/${files[5]!.id}?preview=1`);
  });

  it("gives each file one menu: jump, download, and copy path in Advanced only", () => {
    const closed = render();
    expect(closed.match(/aria-label="More for [^"]+"/g)).toHaveLength(6);
    expect(closed).not.toContain("Show in chat");
    const html = render({ openMenus: "all", advanced: true });
    expect(html.match(/>Show in chat</g)).toHaveLength(6);
    expect(html).toContain('aria-label="Download chart.png"');
    expect(html).toMatch(/<button type="button" role="menuitem" disabled="" aria-label="Download remote\.png"/);
    expect(html).toContain('title="/work/src/main.ts"');
    expect(html).not.toContain('title="/home/cua/remote.png"');
    // Simple mode: no Copy path.
    expect(render({ openMenus: "all" })).not.toContain(">Copy path<");
  });

  it("renders a grid when asked, and filters by kind", () => {
    const html = render({ initialView: "grid", initialFilter: "image" });
    expect(html).toContain('data-files-view="grid"');
    expect(html).toContain("chart.png");
    expect(html).toContain("remote.png");
    expect(html).not.toContain("report.pdf");
  });

  it("says what is missing per filter, and shows loading and error states", () => {
    expect(render({ initialFilter: "audio" })).toContain("No audio in this chat yet.");
    expect(render({ files: [] })).toContain("Files you send and files this bot makes in this chat show up here.");
    expect(render({ files: null })).toContain("Loading files…");
    const failed = render({ files: null, error: true });
    expect(failed).toContain("Couldn&#x27;t load this chat&#x27;s files.");
    expect(failed).toContain("Retry");
  });
});

describe("large file download", () => {
  it("preflights one byte then hands the opaque URL to the browser without a Blob", async () => {
    const fetcher = vi.fn(async () => new Response("x", {
      status: 206,
      headers: {
        "content-type": "video/mp4",
        "content-disposition": `attachment; filename="clip.mp4"`,
        "content-range": "bytes 0-0/1073741824",
      },
    }));
    const click = vi.fn();
    const remove = vi.fn();
    const append = vi.fn();
    const link = { href: "", download: "", style: { display: "" }, click, remove };
    vi.stubGlobal("fetch", fetcher);
    vi.stubGlobal("document", { createElement: vi.fn(() => link), body: { append } });
    const video = file("clip.mp4", { id: "0123456789abcdef01234567", size: 1024 * 1024 * 1024, mime: "video/mp4" });

    await downloadThreadFile("thread-1", video);

    expect(fetcher).toHaveBeenCalledWith("/api/threads/thread-1/files/0123456789abcdef01234567", {
      headers: { range: "bytes=0-0" },
    });
    expect(link).toMatchObject({ href: "/api/threads/thread-1/files/0123456789abcdef01234567", download: "clip.mp4" });
    expect(append).toHaveBeenCalledWith(link);
    expect(click).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
  });
});
