// Library tab: files and artifacts in one list, pinned ones on top, the rest
// grouped by period, one line per item (icon and name), no search, no filter,
// no Files | Artifacts switch.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { ArtifactList } from "@/lib/artifacts";
import type { ThreadFile } from "@/lib/chat-files";
import type { ArtifactSummary } from "../../../shared/artifacts";

const { LibraryBody } = await import("./LibraryTab");
const { artifactStatus, intervalLabel } = await import("../artifacts/ArtifactsSection");

const now = Date.parse("2026-10-26T12:00:00Z");
const DAY = 24 * 3_600_000;
const artifact = (id: string, title: string, favorite: boolean, extra: Partial<ArtifactSummary> = {}): ArtifactSummary => ({
  id, botId: "bot1", title, favorite, popped: false, createdAt: now - 3_600_000, updatedAt: now - 120_000, rev: 1,
  refresh: { state: "idle", failures: 0 }, ...extra,
});
const file = (id: string, name: string, daysAgo: number, extra: Partial<ThreadFile> = {}): ThreadFile => ({
  id: id.repeat(24).slice(0, 24), messageId: "m1", source: "written", path: name, name, at: now - daysAgo * DAY, size: 12, available: true, ...extra,
});
const list = (artifacts: ArtifactSummary[] | null, error = false): ArtifactList => ({ artifacts, error, reload: () => {}, patch: () => {} });
const render = (files: ThreadFile[] | null, artifacts: ArtifactList, extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(LibraryBody, { threadId: "t1", files, list: artifacts, now, ...extra }));

beforeEach(() => setLocale("en"));

describe("Library tab", () => {
  const files = [file("a", "plan.md", 1), file("b", "export.zip", 3, { mime: "application/zip" }), file("c", "notes.md", 12)];
  const artifacts = [artifact("art_0000001", "Dispatch email preview in French", false, { updatedAt: now - 20 * DAY })];

  it("shows files and artifacts together, grouped by period, each group in a rounded card", () => {
    const html = render(files, list(artifacts));
    const thisWeek = html.indexOf('data-library-group="thisWeek"');
    const older = html.indexOf('data-library-group="older"');
    expect(thisWeek).toBeGreaterThan(-1);
    expect(older).toBeGreaterThan(thisWeek);
    expect(html).toContain("This week");
    expect(html).toContain("Older");
    expect(html).toContain("rounded-2xl");
    const week = html.slice(thisWeek, older);
    expect(week).toContain("plan.md");
    expect(week).toContain("export.zip");
    expect(week).not.toContain("notes.md");
    const old = html.slice(older);
    expect(old).toContain("notes.md");
    expect(old).toContain("Dispatch email preview in French");
    expect(old).toContain("data-artifact-row=");
    expect(html).not.toContain('data-library-group="pinned"');
  });

  it("has no search bar, no Filter button and no Files | Artifacts switch", () => {
    const html = render(files, list(artifacts));
    expect(html).not.toContain("Search files");
    expect(html).not.toContain("Filter");
    expect(html).not.toContain("data-library-choice");
    expect(html).not.toContain('role="tablist"');
    expect(html).not.toContain('type="search"');
  });

  it("puts pinned files and pinned artifacts under Pinned on top, once", () => {
    const html = render(
      [file("a", "plan.md", 1), file("c", "notes.md", 30, { pinned: true })],
      list([artifact("art_0000001", "Preview", true, { updatedAt: now - 40 * DAY })]),
    );
    const pinned = html.indexOf('data-library-group="pinned"');
    expect(pinned).toBeGreaterThan(-1);
    expect(pinned).toBeLessThan(html.indexOf('data-library-group="thisWeek"'));
    const section = html.slice(pinned, html.indexOf('data-library-group="thisWeek"'));
    expect(section).toContain("Pinned");
    expect(section).toContain("notes.md");
    expect(section).toContain("Preview");
    expect(section).not.toContain("plan.md");
    // not listed a second time below
    expect(html.slice(html.indexOf('data-library-group="thisWeek"'))).not.toContain("notes.md");
    expect(html).not.toContain('data-library-group="older"');
    expect(section).toContain('data-library-pin="on"');
    expect(html.slice(html.indexOf('data-library-group="thisWeek"'))).toContain('data-library-pin="off"');
  });

  it("offers Pin or Unpin on a file's row and in its menu", () => {
    const html = render([file("a", "plan.md", 1), file("b", "x.md", 2, { pinned: true })], list([]), { openMenus: true });
    expect(html).toContain('aria-label="Pin"');
    expect(html).toContain('aria-label="Unpin"');
    expect(html).toContain('role="menuitem"');
  });

  it("an artifact's row pins through the same control and its menu has one Open, no Pop out, and delete", () => {
    const html = render([], list([artifact("art_0000001", "CPU", false)]), { openMenus: true });
    expect(html).toContain('data-library-pin="off"');
    expect(html.match(/>Open</g)).toHaveLength(1);
    expect(html).not.toContain("Pop out");
    expect(html).not.toContain("in its own window");
    expect(html).not.toContain("Dock back");
    expect(html).not.toContain("Close window");
    expect(html).toContain("Delete");
  });

  it("keeps a short empty message", () => {
    const html = render([], list([]));
    expect(html).toContain("data-library-empty");
    expect(html).toContain("Files and artifacts from this chat show up here.");
    expect(html).not.toContain("data-library-group");
  });

  it("shows loading, then a retry on error", () => {
    expect(render(null, list(null))).toContain("Loading");
    const html = render(null, list(null, true), { filesError: true });
    expect(html).toContain("Couldn&#x27;t load this library.");
  });

  it("speaks French: Épinglés, Cette semaine, Plus ancien", () => {
    setLocale("fr");
    const html = render([file("a", "plan.md", 1), file("c", "old.md", 30), file("d", "pin.md", 30, { pinned: true })], list([]));
    expect(html).toContain("Épinglés");
    expect(html).toContain("Cette semaine");
    expect(html).toContain("Plus ancien");
    expect(html).toContain('aria-label="Épingler"');
    expect(html).toContain('aria-label="Désépingler"');
  });
});

describe("an artifact's refresh state on its row", () => {
  const source = { kind: "tool" as const, tool: "workspace_read", args: { path: "stats.json" } };

  it("says how fresh it is and how often it refreshes", () => {
    const fresh = artifact("art_ok00001", "Tickets", false, { source, intervalSeconds: 300, dataAt: now - 60_000, refresh: { state: "ok", failures: 0 } });
    expect(artifactStatus(fresh, now)).toEqual({ tone: "muted", text: "Updated 1 min ago · every 5 min" });
    expect(intervalLabel(30)).toBe("30 s");
    expect(intervalLabel(7200)).toBe("2 h");
    expect(intervalLabel(86_400)).toBe("1 d");
    const html = render([], list([fresh]));
    // a healthy artifact is just its icon and name; only a problem gets a mark
    expect(html).not.toContain("data-artifact-status");
  });

  it("explains a blocked source, a pause and a failed run, with the server's words in the tooltip", () => {
    const blocked = artifact("art_bl00001", "CPU", false, { source, intervalSeconds: 60, refresh: { state: "blocked", failures: 0, error: "This tool needs your approval each time." } });
    expect(artifactStatus(blocked, now)).toMatchObject({ tone: "warning", text: expect.stringContaining("needs your approval"), detail: "This tool needs your approval each time." });
    const paused = artifact("art_pa00001", "CPU", false, { source, intervalSeconds: 60, refresh: { state: "paused", failures: 3, error: "down" } });
    expect(artifactStatus(paused, now)).toMatchObject({ tone: "danger", text: "Refresh paused after 3 failures. Refresh now, or ask the bot." });
    const byBot = artifact("art_pb00001", "CPU", false, { source, intervalSeconds: 60, refresh: { state: "paused", failures: 0 } });
    expect(artifactStatus(byBot, now).text).toBe("Refresh paused by the bot.");
    const failed = artifact("art_er00001", "CPU", false, { source, intervalSeconds: 60, refresh: { state: "error", failures: 1, lastRunAt: now - 120_000, error: "no such file" } });
    expect(artifactStatus(failed, now)).toMatchObject({ tone: "warning", text: "Refresh failed 2 min ago; it tries again.", detail: "no such file" });
    const html = render([], list([blocked]));
    expect(html).toContain('data-artifact-status="blocked"');
    expect(html).toContain("This tool needs your approval each time.");
  });

  it("an artifact with no source just says when it changed, in French too", () => {
    setLocale("fr");
    expect(artifactStatus(artifact("art_st00001", "Note", false), now).text).toContain("Mis à jour");
    const paused = artifact("art_pa00001", "CPU", false, { source, intervalSeconds: 60, refresh: { state: "paused", failures: 3 } });
    expect(artifactStatus(paused, now).text).toBe("Rafraîchissement en pause après 3 échecs. Rafraîchissez maintenant ou demandez au bot.");
  });
});

describe("Library tab: the bot's pages (2026-10-28)", () => {
  const page = (id: string, title: string, pinned: boolean, daysAgo: number) => ({
    id, title, status: "draft", access: "private", expiresAt: null, currentVersion: null, botId: "bot1", threadId: "t1",
    createdAt: now - daysAgo * DAY, updatedAt: now - daysAgo * DAY, expired: false, versions: [{ n: 1, kind: "html", title, createdAt: 1, state: "proposed", bytes: 1, botId: "bot1" }], pinned,
  });

  it("lists pages with their page icon in Pinned and This week, with Open, Share…, Unpin and Delete… in the menu", () => {
    const html = render([], list([]), { pages: [page("pageAAAA1111", "Quarterly overview", true, 1), page("pageBBBB2222", "Weekly report", false, 2)], openMenus: true });
    const pinned = html.indexOf('data-library-group="pinned"');
    const week = html.indexOf('data-library-group="thisWeek"');
    expect(pinned).toBeGreaterThan(-1);
    expect(html.slice(pinned, week)).toContain('data-library-page="pageAAAA1111"');
    expect(html.slice(week)).toContain('data-library-page="pageBBBB2222"');
    expect(html).toContain("data-page-glyph");
    for (const label of ["Open", "Share…", "Unpin", "Pin", "Delete…"]) expect(html).toContain(`>${label}<`);
  });
});

describe("Library tab: a mini preview on every row (2026-10-28)", () => {
  const ID = (n: number) => n.toString(16).padStart(24, "0");
  const picture = (n: number, name: string, mime: string) => file(ID(n), name, 1, { id: ID(n), mime });
  const rowOf = (html: string, id: string) => {
    const at = html.indexOf(`data-library-file="${id}"`);
    return html.slice(at, html.indexOf("</li>", at));
  };

  it("an image shows its own thumbnail from the thumbnail URL, lazy, never the original", () => {
    const html = render([picture(1, "chart.png", "image/png"), picture(2, "photo.jpg", "image/jpeg"), picture(3, "anim.gif", "image/gif"), picture(4, "shot.webp", "image/webp"), picture(5, "logo.svg", "image/svg+xml")], list([]));
    for (const n of [1, 2, 3, 4, 5]) {
      const row = rowOf(html, ID(n));
      expect(row).toContain("data-library-thumb");
      expect(row).toContain(`src="/api/threads/t1/files/${ID(n)}?thumb=1"`);
      expect(row).toContain('loading="lazy"');
      expect(row).toContain("object-cover");
      expect(row).toContain("rounded-md");
      // the original and the full-size preview are never the row's source
      expect(row).not.toContain(`files/${ID(n)}"`);
      expect(row).not.toContain("preview=1");
    }
  });

  it("an image that is not available, or that the server cannot draw (HEIC), keeps an icon", () => {
    const html = render([picture(1, "gone.png", "image/png"), picture(2, "iphone.heic", "image/heic")].map((f, i) => (i === 0 ? { ...f, available: false } : f)), list([]));
    expect(html).not.toContain("data-library-thumb");
    expect(rowOf(html, ID(1))).toContain('data-library-glyph="image"');
    expect(rowOf(html, ID(2))).toContain('data-library-glyph="image"');
  });

  it("each type has its own mark: code (HTML too), document, archive, PDF, code, other", () => {
    const html = render([
      picture(1, "dashboard.html", "text/html"),
      picture(2, "plan.md", "text/markdown"),
      picture(3, "notes.txt", "text/plain"),
      picture(4, "export.zip", "application/zip"),
      picture(5, "report.pdf", "application/pdf"),
      picture(6, "script.py", "text/x-python"),
      picture(7, "blob.bin", "application/octet-stream"),
    ], list([]));
    const kind = (n: number) => /data-library-glyph="([a-z]+)"/.exec(rowOf(html, ID(n)))?.[1];
    expect([1, 2, 3, 4, 5, 6, 7].map(kind)).toEqual(["code", "document", "document", "archive", "pdf", "code", "other"]);
    expect(rowOf(html, ID(5))).toContain("data-glyph-pdf");
    // an .html file is a file, not a Page (#1922)
    expect(rowOf(html, ID(1))).not.toContain("data-page-glyph");
  });
});

describe("Library tab: an artifact and a Page never look alike (#1922)", () => {
  const page = (id: string, status: string, access: string, expired = false) => ({
    id, title: id, status, access, expiresAt: null, currentVersion: status === "published" ? 1 : null, botId: "bot1", threadId: "t1",
    createdAt: now, updatedAt: now - 1000, expired, versions: [], pinned: false,
  });
  const rowAt = (html: string, attr: string) => {
    const at = html.indexOf(attr);
    expect(at).toBeGreaterThan(-1);
    return html.slice(at, html.indexOf("</li>", at));
  };
  const glyphOf = (row: string) => /data-library-glyph="([a-z]+)"/.exec(row)?.[1];
  const svgOf = (row: string) => /<svg[^>]*class="([^"]*lucide[^"]*)"/.exec(row)?.[1];

  it("an artifact wears an app window titled Artifact, a Page a globe titled Page, pinned or not", () => {
    const html = render([], list([artifact("art_0000001", "Queue overview", false), artifact("art_0000002", "Pinned board", true)]), {
      pages: [page("pageAAAA1111", "published", "org"), { ...page("pageBBBB2222", "draft", "private"), pinned: true }],
    });
    for (const id of ["art_0000001", "art_0000002"]) {
      const row = rowAt(html, `data-artifact-row="${id}"`);
      expect(glyphOf(row)).toBe("artifact");
      expect(row).toContain('title="Artifact"');
      expect(svgOf(row)).toContain("lucide-app-window");
      expect(row).not.toContain("data-page-glyph");
    }
    for (const id of ["pageAAAA1111", "pageBBBB2222"]) {
      const row = rowAt(html, `data-library-page="${id}"`);
      expect(glyphOf(row)).toBe("page");
      expect(row).toMatch(/title="Page: [^"]+"/);
      expect(svgOf(row)).toContain("lucide-globe");
    }
  });

  it("a draft Page and a published one differ, and each published audience has its own badge", () => {
    const html = render([], list([]), {
      pages: [
        page("pageDRAFT001", "draft", "link"),
        page("pageMINE0001", "published", "private"),
        page("pageORG00001", "published", "org"),
        page("pageLINK0001", "published", "link"),
        page("pageGONE0001", "revoked", "link"),
        page("pageOLD00001", "published", "link", true),
      ],
    });
    const state = (id: string) => /data-page-state="([a-z]+)"/.exec(rowAt(html, `data-library-page="${id}"`))?.[1];
    expect(["pageDRAFT001", "pageMINE0001", "pageORG00001", "pageLINK0001", "pageGONE0001", "pageOLD00001"].map(state))
      .toEqual(["draft", "private", "org", "link", "revoked", "expired"]);
    const draft = rowAt(html, 'data-library-page="pageDRAFT001"');
    const live = rowAt(html, 'data-library-page="pageLINK0001"');
    expect(draft).toContain('title="Page: draft"');
    expect(live).toContain('title="Page: published for anyone with the link"');
    expect(draft).toContain("opacity-60");
    expect(live).not.toContain("opacity-60");
    expect(draft).toContain("lucide-pencil-line");
    expect(live).toContain("lucide-link");
    expect(rowAt(html, 'data-library-page="pageORG00001"')).toContain("lucide-building-2");
  });

  it("the marks use theme tokens only, never a fixed colour", () => {
    const html = render([], list([artifact("art_0000001", "Queue overview", false)]), { pages: [page("pageAAAA1111", "published", "link")] });
    expect(html).not.toMatch(/from-sky-|to-indigo-|text-white/);
  });

  it("groups: Pinned, Today, This week, then Older showing five with Show more", () => {
    const hours = (h: number) => now - h * 3_600_000;
    const startOfToday = new Date(now).setHours(0, 0, 0, 0);
    const items = [
      file("a", "today.md", 0, { at: Math.max(startOfToday, hours(0.01)) }),
      file("b", "yesterday.md", 0, { at: startOfToday - 3_600_000 }),
      file("c", "pinned.md", 40, { pinned: true }),
      ...Array.from({ length: 7 }, (_, i) => file(String.fromCharCode(100 + i), `old-${i}.md`, 20 + i)),
    ];
    const html = render(items, list([]));
    const order = ["pinned", "today", "thisWeek", "older"].map((id) => html.indexOf(`data-library-group="${id}"`));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html.slice(order[1]!, order[2]!)).toContain("today.md");
    expect(html.slice(order[2]!, order[3]!)).toContain("yesterday.md");
    expect(html).toContain("Today");
    const older = html.slice(order[3]!);
    expect(older.match(/data-library-file=/g)).toHaveLength(5);
    expect(older).toContain("data-library-show-more");
    expect(older).toContain("Show more");
  });
});
