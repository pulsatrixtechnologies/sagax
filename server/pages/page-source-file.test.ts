// #3488: a Page proposed from a file of the bot's own workspace (read by the
// server byte for byte), the size and SHA-256 of a stored source in the
// proposal's answer and the version listing, and a paged read of a source
// (or the whole source saved to the bot's workspace).
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PAGE_LIMITS, parsePageProposal } from "../../shared/published-pages.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { json, readBody } from "../harness/http.ts";
import { createInternalMemoryRoutes, type InternalMemoryBot, type InternalMemoryDeps } from "../routes/internal-memory.ts";
import type { InternalRouteContext } from "../routes/internal-route.ts";
import { createPublishedPageRoutes } from "../routes/published-pages.ts";
import { workspaceDir } from "../workspace/workspace.ts";
import { readWorkspaceSourceFile, readWorkspaceText } from "../workspace/workspace-files.ts";
import { PublishedPages, pageSourceDigest, pageSourceSlice } from "./published-pages.ts";

// multi-byte characters (2, 3 and 4 bytes), CRLF line ends and a trailing newline
const SOURCE = "﻿<!doctype html>\r\n<h1>Été 漢字 😀</h1>\r\n<p>ligne\tdeux é</p>\n".repeat(40);
const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

const dirs: string[] = [];
let counter = 0;
let BOT = "";
let OTHER = "";
beforeEach(() => {
  BOT = `page-src-${process.pid}-${counter++}`;
  OTHER = `page-src-other-${process.pid}-${counter++}`;
  mkdirSync(join(workspaceDir(BOT), "docs"), { recursive: true });
  mkdirSync(join(workspaceDir(OTHER), "docs"), { recursive: true });
});
afterEach(() => {
  rmSync(workspaceDir(BOT), { recursive: true, force: true });
  rmSync(workspaceDir(OTHER), { recursive: true, force: true });
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function store(): PublishedPages {
  const dir = mkdtempSync(join(tmpdir(), "sagax-pages-3488-"));
  dirs.push(dir);
  return new PublishedPages(dir, () => 1_800_000_000_000);
}

describe("parsePageProposal: content or path, exactly one", () => {
  it("takes path alone, refuses both and neither", () => {
    expect(parsePageProposal({ title: "R", kind: "html", path: "docs/r.html" })).toMatchObject({ ok: true, value: { path: "docs/r.html", content: "" } });
    expect(parsePageProposal({ title: "R", kind: "html", path: "docs/r.html", content: "<p>x</p>" })).toMatchObject({ ok: false });
    expect(parsePageProposal({ title: "R", kind: "html" })).toMatchObject({ ok: false });
    expect(parsePageProposal({ title: "R", kind: "html", path: "  " })).toMatchObject({ ok: false });
    expect(parsePageProposal({ title: "R", kind: "html", path: 3 })).toMatchObject({ ok: false });
    expect(parsePageProposal({ title: "R", kind: "html", content: "<p>x</p>" })).toMatchObject({ ok: true, value: { content: "<p>x</p>" } });
  });
});

describe("readWorkspaceSourceFile", () => {
  it("reads the file byte for byte", () => {
    writeFileSync(join(workspaceDir(BOT), "docs", "page.html"), SOURCE);
    const read = readWorkspaceSourceFile(BOT, "docs/page.html", PAGE_LIMITS.contentBytes);
    expect(Buffer.from(read.content, "utf8").equals(Buffer.from(SOURCE, "utf8"))).toBe(true);
    expect(read.bytes).toBe(Buffer.byteLength(SOURCE));
  });

  it("refuses a path out of the workspace, a link out, another bot's workspace, a hidden file", () => {
    writeFileSync(join(workspaceDir(OTHER), "docs", "theirs.html"), "<p>theirs</p>");
    symlinkSync(join(workspaceDir(OTHER), "docs", "theirs.html"), join(workspaceDir(BOT), "docs", "link.html"));
    symlinkSync(join(workspaceDir(OTHER), "docs"), join(workspaceDir(BOT), "outside"));
    writeFileSync(join(workspaceDir(BOT), ".secret"), "x");
    for (const path of [
      `../${OTHER}/docs/theirs.html`,
      join(workspaceDir(OTHER), "docs", "theirs.html"),
      "docs/link.html",
      "outside/theirs.html",
      ".secret",
      "docs/../../x",
    ]) {
      expect(() => readWorkspaceSourceFile(BOT, path, PAGE_LIMITS.contentBytes), path).toThrow();
    }
  });

  it("#3612: reads a file of an installed plugin by the path workspace_read takes, read only and byte for byte", () => {
    const plugin = mkdtempSync(join(tmpdir(), "sagax-pages-3612-plugin-"));
    dirs.push(plugin);
    mkdirSync(join(plugin, "pages"), { recursive: true });
    writeFileSync(join(plugin, "pages", "report.html"), SOURCE);
    writeFileSync(join(plugin, ".hidden.html"), "<p>x</p>");
    mkdirSync(join(plugin, ".claude-plugin"), { recursive: true });
    writeFileSync(join(plugin, ".claude-plugin", "plugin.json"), "{}");
    symlinkSync(join(workspaceDir(OTHER), "docs"), join(plugin, "out"));
    writeFileSync(join(workspaceDir(OTHER), "docs", "theirs.html"), "<p>theirs</p>");
    const plugins = [{ name: "acme", dir: plugin }];
    const read = readWorkspaceSourceFile(BOT, "plugins/acme/pages/report.html", PAGE_LIMITS.contentBytes, plugins);
    expect(read.path).toBe("plugins/acme/pages/report.html");
    expect(Buffer.from(read.content, "utf8").equals(readFileSync(join(plugin, "pages", "report.html")))).toBe(true);
    expect(readWorkspaceText(BOT, "plugins/acme/pages/report.html", 0, plugins).path).toBe(read.path);
    for (const path of [
      "plugins/acme/.hidden.html",
      "plugins/acme/.claude-plugin/plugin.json",
      "/workspace/sagax-plugins/acme/pages/report.html",
      plugin + "/pages/report.html",
      "plugins/acme/../acme/pages/report.html",
      "plugins/acme/out/theirs.html",
      // a plugin this bot does not have (another bot's or another person's)
      "plugins/other/pages/report.html",
    ]) {
      expect(() => readWorkspaceSourceFile(BOT, path, PAGE_LIMITS.contentBytes, plugins), path).toThrow();
    }
    // without the plugin list, plugins/ is not this bot's
    expect(() => readWorkspaceSourceFile(BOT, "plugins/acme/pages/report.html", PAGE_LIMITS.contentBytes)).toThrow(/no such file/);
  });

  it("refuses a file over the limit and one that is not UTF-8", () => {
    writeFileSync(join(workspaceDir(BOT), "docs", "big.html"), "x".repeat(101));
    expect(() => readWorkspaceSourceFile(BOT, "docs/big.html", 100)).toThrow(/over/);
    writeFileSync(join(workspaceDir(BOT), "docs", "bin.html"), Buffer.from([0x3c, 0xff, 0xfe, 0x3e]));
    expect(() => readWorkspaceSourceFile(BOT, "docs/bin.html", 100)).toThrow(/UTF-8/);
  });
});

describe("size and SHA-256 of a stored source", () => {
  it("the proposal and the version listing carry them, computed in one place", () => {
    const pages = store();
    const proposed = pages.propose({ botId: "bot1", threadId: "t1", title: "R", kind: "html", content: SOURCE });
    if (!proposed.ok) throw new Error(proposed.error);
    const digest = { bytes: Buffer.byteLength(SOURCE), sha256: sha(Buffer.from(SOURCE, "utf8")) };
    expect(pageSourceDigest(SOURCE)).toEqual(digest);
    expect(proposed.version).toMatchObject(digest);
    const summary = pages.summary(pages.get(proposed.page.id)!, "https://x", true);
    expect(summary.versions[0]).toMatchObject(digest);
  });

  it("a version stored before the hash: absent from the listing, recorded once on its first source read", () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-pages-3488-legacy-"));
    dirs.push(dir);
    const first = new PublishedPages(dir, () => 1_800_000_000_000);
    const proposed = first.propose({ botId: "bot1", threadId: "t1", title: "R", kind: "html", content: SOURCE });
    if (!proposed.ok) throw new Error(proposed.error);
    // the index as an older server wrote it: no sha256 on the version
    const index = join(dir, "published-pages.json");
    const raw = JSON.parse(readFileSync(index, "utf8"));
    for (const page of raw.pages) for (const version of page.versions) delete version.sha256;
    writeFileSync(index, JSON.stringify(raw));
    const pages = new PublishedPages(dir, () => 1_800_000_000_000);
    const listed = pages.summary(pages.get(proposed.page.id)!, "https://x", true).versions[0]!;
    expect(listed.sha256).toBeUndefined();
    expect(listed.bytes).toBe(Buffer.byteLength(SOURCE));
    expect(pages.source(proposed.page.id, 1)!.version.sha256).toBe(sha(SOURCE));
    // kept on the record (and on disk), so the listing has it from now on
    expect(pages.summary(pages.get(proposed.page.id)!, "https://x", true).versions[0]!.sha256).toBe(sha(SOURCE));
    const reread = new PublishedPages(dir, () => 1_800_000_000_000);
    expect(reread.get(proposed.page.id)!.versions[0]!.sha256).toBe(sha(SOURCE));
  });

  it("#3584: a hash that cannot be saved never fails the read it belongs to", () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-pages-3584-readonly-"));
    dirs.push(dir);
    const first = new PublishedPages(dir, () => 1_800_000_000_000);
    const proposed = first.propose({ botId: "bot1", threadId: "t1", title: "R", kind: "html", content: SOURCE });
    if (!proposed.ok) throw new Error(proposed.error);
    const index = join(dir, "published-pages.json");
    const raw = JSON.parse(readFileSync(index, "utf8"));
    for (const page of raw.pages) for (const version of page.versions) delete version.sha256;
    writeFileSync(index, JSON.stringify(raw));
    const pages = new PublishedPages(dir, () => 1_800_000_000_000);
    // the index's folder read only: the save of the hash fails (as on a full disk)
    chmodSync(dir, 0o500);
    try {
      const read = pages.source(proposed.page.id, 1, { offset: 0, limit: 100 });
      expect(read).not.toBeNull();
      expect(read!.version).toMatchObject({ n: 1, bytes: Buffer.byteLength(SOURCE), sha256: sha(SOURCE) });
      expect(Buffer.from(SOURCE, "utf8").subarray(0, Buffer.byteLength(read!.content)).toString("utf8")).toBe(read!.content);
      expect(pages.source(proposed.page.id, 1)!.content).toBe(SOURCE);
    } finally {
      chmodSync(dir, 0o700);
    }
    // nothing was saved: the next read records it
    expect(new PublishedPages(dir, () => 1_800_000_000_000).get(proposed.page.id)!.versions[0]!.sha256).toBeUndefined();
  });
});

describe("paged read of a source", () => {
  it("slices never cut a character and concatenate to the source exactly", () => {
    const whole = Buffer.from(SOURCE, "utf8");
    for (const limit of [1, 2, 3, 5, 7, 64, 1000]) {
      const parts: Buffer[] = [];
      let offset: number | null = 0;
      while (offset !== null) {
        const slice = pageSourceSlice(SOURCE, offset, limit);
        expect(slice.offset).toBe(offset);
        expect(slice.text).not.toContain("�");
        parts.push(Buffer.from(slice.text, "utf8"));
        offset = slice.nextOffset;
      }
      expect(Buffer.concat(parts).equals(whole), `limit ${limit}`).toBe(true);
    }
  });

  it("the person's source route honours offset and limit and gives size and hash", async () => {
    const pages = store();
    const proposed = pages.propose({ botId: "bot1", threadId: "t1", title: "R", kind: "html", content: SOURCE, ownerId: "pr_alice" });
    if (!proposed.ok) throw new Error(proposed.error);
    const handler = createPublishedPageRoutes({
      pages,
      owner: (auth) => auth.kind === "session" ? auth.session.principalId : undefined,
      isPerson: () => true,
      origin: () => "https://x",
      reachable: () => true,
    });
    const alice: RequestAuth = { kind: "session", via: "cookie", scopes: ["client"], session: { id: "s1", principalId: "pr_alice" } as never };
    const get = async (path: string) => {
      const req = new IncomingMessage(new Socket());
      req.method = "GET";
      req.url = path;
      const res = new ServerResponse(req);
      const chunks: Buffer[] = [];
      const done = new Promise<{ status: number; body: Record<string, any> }>((resolve) => {
        res.end = ((chunk?: unknown) => {
          if (chunk) chunks.push(Buffer.from(chunk as string));
          resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
          return res;
        }) as typeof res.end;
      });
      process.nextTick(() => req.push(null));
      await handler({ req, res, url: new URL(`http://x${path}`), path: path.split("?")[0]!, method: "GET", auth: alice, json, readBody });
      return done;
    };
    const base = `/api/pages/${proposed.page.id}/versions/1/source`;
    const whole = await get(base);
    expect(whole.status).toBe(200);
    expect(whole.body).toMatchObject({ content: SOURCE, version: { n: 1, bytes: Buffer.byteLength(SOURCE), sha256: sha(SOURCE) }, nextOffset: null });
    let text = "";
    let offset: number | null = 0;
    while (offset !== null) {
      const page = await get(`${base}?offset=${offset}&limit=777`);
      expect(page.status).toBe(200);
      text += page.body.content;
      offset = page.body.nextOffset;
    }
    expect(text).toBe(SOURCE);
    expect((await get(`${base}?offset=-1`)).status).toBe(400);
    expect((await get(`${base}?limit=0`)).status).toBe(400);
  });
});

describe("#3584: workspace_read from an offset inside a character", () => {
  it("starts at the next character, never with a broken one, and goes on to the end exactly", () => {
    writeFileSync(join(workspaceDir(BOT), "docs", "page.html"), SOURCE);
    const whole = Buffer.from(SOURCE, "utf8");
    // byte 1 is inside the 3-byte BOM; the first "É" of "Été" is 2 bytes
    const inside = [1, 2, whole.indexOf(Buffer.from("Été", "utf8")) + 1, whole.indexOf(Buffer.from("😀", "utf8")) + 3];
    for (const offset of inside) {
      const read = readWorkspaceText(BOT, "docs/page.html", offset);
      expect(read.offset, `offset ${offset}`).toBeGreaterThan(offset);
      expect(read.offset - offset, `offset ${offset}`).toBeLessThan(4);
      expect(read.text).not.toContain("�");
      expect(Buffer.from(read.text, "utf8").equals(whole.subarray(read.offset, read.offset + Buffer.byteLength(read.text)))).toBe(true);
    }
  });
});

describe("the bot's internal routes", () => {
  const bot: InternalMemoryBot = { id: "", name: "Ada", color: "blue", threadId: "t-main", memoryEnabled: true };

  function harness(pages: PublishedPages, plugins: Array<{ name: string; dir: string; scope: string }> = [], asked: Array<[string, string]> = []) {
    bot.id = BOT;
    let proposal: ((input: { title: string; kind: string; content: string; path?: string; pageId?: string }) => unknown) | undefined;
    const deps = {
      bot: (id: string) => (id === BOT ? bot : null),
      botByThread: () => bot,
      groupByThread: () => null,
      taskByThread: () => null,
      isConfidentialThread: () => false,
      ownsThread: () => true,
      requireActive: () => undefined,
      createCard: ({ proposePage }: { proposePage: typeof proposal }) => {
        proposal = proposePage;
        return { ok: true, messageId: "m1" };
      },
      authored: () => undefined,
      proposePublishedPage: (input: Parameters<PublishedPages["propose"]>[0]) => pages.propose(input),
      getPage: (id: string) => pages.get(id),
      pageSource: (id: string, n: number, range?: { offset?: number; limit?: number }) => pages.source(id, n, range),
      isPerspicax: () => false,
      botOwner: () => "owner",
      markBotRead: () => undefined,
      pageThreadName: () => "Ada",
      localPrincipalId: () => "pr_owner",
      scopedPluginFolders: (sender: InternalMemoryBot, person: string) => {
        asked.push([sender.id, person]);
        return sender.id === BOT ? plugins : [];
      },
    } as unknown as InternalMemoryDeps;
    const route = createInternalMemoryRoutes(deps);
    const call = async (path: string, body: Record<string, unknown>, botId = BOT) => {
      const sent: Array<{ status: number; body: any }> = [];
      const ctx: InternalRouteContext = {
        res: {} as ServerResponse,
        path,
        method: "POST",
        url: new URL(`http://local${path}`),
        json: ((_res, status, out) => { sent.push({ status, body: out }); }) as InternalRouteContext["json"],
        capability: { botId, threadId: "t-1", generation: "g-1" },
        readBody: async () => body,
      };
      await route(ctx);
      return sent[0]!;
    };
    const propose = async (input: { title: string; kind: string; content: string; path?: string; pageId?: string }) => {
      await call("/api/internal/options-card", { tool: "propose_page" });
      return proposal!(input) as { ok: boolean; pageId?: string; bytes?: number; sha256?: string; status?: number; error?: string };
    };
    return { call, propose };
  }

  it("propose_page with path stores the file byte for byte and answers its size and hash", async () => {
    writeFileSync(join(workspaceDir(BOT), "docs", "page.html"), SOURCE);
    const pages = store();
    const { propose } = harness(pages);
    const result = await propose({ title: "R", kind: "html", content: "", path: "docs/page.html" });
    expect(result).toMatchObject({ ok: true, bytes: Buffer.byteLength(SOURCE), sha256: sha(SOURCE) });
    const stored = pages.content(result.pageId!, 1)!;
    expect(Buffer.from(stored, "utf8").equals(readFileSync(join(workspaceDir(BOT), "docs", "page.html")))).toBe(true);
  });

  it("propose_page with path refuses an escape and another bot's workspace", async () => {
    writeFileSync(join(workspaceDir(OTHER), "docs", "theirs.html"), "<p>theirs</p>");
    const pages = store();
    const { propose } = harness(pages);
    for (const path of [`../${OTHER}/docs/theirs.html`, join(workspaceDir(OTHER), "docs", "theirs.html"), "docs/missing.html"]) {
      expect(await propose({ title: "R", kind: "html", content: "", path }), path).toMatchObject({ ok: false });
    }
    expect(pages.list(undefined)).toHaveLength(0);
  });

  it("#3612: propose_page with path takes a file of the bot's installed plugin, as workspace_read does", async () => {
    const plugin = mkdtempSync(join(tmpdir(), "sagax-pages-3612-route-"));
    dirs.push(plugin);
    mkdirSync(join(plugin, "pages"), { recursive: true });
    writeFileSync(join(plugin, "pages", "report.html"), SOURCE);
    writeFileSync(join(plugin, ".hidden.html"), "<p>x</p>");
    const pages = store();
    const asked: Array<[string, string]> = [];
    const { propose } = harness(pages, [{ name: "acme", dir: plugin, scope: "bot" }], asked);
    const result = await propose({ title: "R", kind: "html", content: "", path: "plugins/acme/pages/report.html" });
    expect(result).toMatchObject({ ok: true, bytes: Buffer.byteLength(SOURCE), sha256: sha(SOURCE) });
    expect(Buffer.from(pages.content(result.pageId!, 1)!, "utf8").equals(readFileSync(join(plugin, "pages", "report.html")))).toBe(true);
    // the calling bot's plugins, for the person of the turn, never another's
    expect(asked).toEqual([[BOT, "pr_owner"]]);
    for (const path of ["plugins/acme/.hidden.html", "plugins/acme/../../x", "/workspace/sagax-plugins/acme/pages/report.html", "plugins/other/pages/report.html"]) {
      expect(await propose({ title: "R", kind: "html", content: "", path }), path).toMatchObject({ ok: false });
    }
    expect(await propose({ title: "R", kind: "html", content: "", path: "plugins/acme/pages/missing.html" })).toMatchObject({ ok: false, status: 404 });
  });

  it("page_comments source reads exact slices; save_to writes nothing", async () => {
    const pages = store();
    const proposed = pages.propose({ botId: BOT, threadId: "t-1", title: "R", kind: "html", content: SOURCE });
    if (!proposed.ok) throw new Error(proposed.error);
    const { call } = harness(pages);
    let text = "";
    let offset: number | null = 0;
    while (offset !== null) {
      const answer = await call("/api/internal/page-comments", { page_id: proposed.page.id, action: "source", offset, limit: 500 });
      expect(answer.status).toBe(200);
      expect(answer.body.version).toMatchObject({ n: 1, bytes: Buffer.byteLength(SOURCE), sha256: sha(SOURCE) });
      text += answer.body.content;
      offset = answer.body.nextOffset;
    }
    expect(text).toBe(SOURCE);
    // no write path: a page source never lands on a rules, memory or
    // heartbeat file of the workspace
    for (const target of ["rules/house.md", "memory/notes.md", "HEARTBEAT.md", "docs/copy.html"]) {
      await call("/api/internal/page-comments", { page_id: proposed.page.id, action: "source", save_to: target });
      expect(existsSync(join(workspaceDir(BOT), target)), target).toBe(false);
    }
  });

  it("names why the stored source differs from the file: secret masked, design system applied", async () => {
    const secret = `sk-ant-api03-${"a1B2c3D4e5".repeat(8)}`;
    writeFileSync(join(workspaceDir(BOT), "docs", "secret.html"), `<p>${secret}</p>\n`);
    writeFileSync(join(workspaceDir(BOT), "docs", "design.html"), "<section data-screen=\"Home\" data-device=\"phone\"><h1>Hi</h1></section>\n");
    const pages = store();
    const { propose } = harness(pages);
    const masked = await propose({ title: "R", kind: "html", content: "", path: "docs/secret.html" }) as Record<string, any>;
    const file = readFileSync(join(workspaceDir(BOT), "docs", "secret.html"));
    expect(masked).toMatchObject({ ok: true, given: { bytes: file.length, sha256: sha(file) }, changedBy: ["secret_masked"] });
    expect(masked.sha256).toBe(sha(pages.content(masked.pageId, 1)!));
    const design = await propose({ title: "D", kind: "design", content: "", path: "docs/design.html" }) as Record<string, any>;
    const designFile = readFileSync(join(workspaceDir(BOT), "docs", "design.html"));
    expect(design).toMatchObject({ ok: true, given: { sha256: sha(designFile) }, changedBy: ["design_system_applied"] });
    expect(design.sha256).toBe(sha(pages.content(design.pageId, 1)!));
    // #3584: both causes on one file: both named, the stored hash is the stored source's
    writeFileSync(join(workspaceDir(BOT), "docs", "both.html"), `<section data-screen="Home" data-device="phone"><p>${secret}</p></section>\n`);
    const both = await propose({ title: "B", kind: "design", content: "", path: "docs/both.html" }) as Record<string, any>;
    const bothFile = readFileSync(join(workspaceDir(BOT), "docs", "both.html"));
    expect(both).toMatchObject({ ok: true, given: { bytes: bothFile.length, sha256: sha(bothFile) }, changedBy: ["secret_masked", "design_system_applied"] });
    expect(both.sha256).toBe(sha(pages.content(both.pageId, 1)!));
    expect(pages.content(both.pageId, 1)).not.toContain(secret);
    // nothing changed: no given, no changedBy
    writeFileSync(join(workspaceDir(BOT), "docs", "plain.html"), SOURCE);
    const plain = await propose({ title: "P", kind: "html", content: "", path: "docs/plain.html" }) as Record<string, any>;
    expect(plain.given).toBeUndefined();
    expect(plain.changedBy).toBeUndefined();
  });

  it("another bot never reads the page's source", async () => {
    const pages = store();
    const proposed = pages.propose({ botId: "someone-else", threadId: "t-9", title: "R", kind: "html", content: SOURCE });
    if (!proposed.ok) throw new Error(proposed.error);
    const { call } = harness(pages);
    expect((await call("/api/internal/page-comments", { page_id: proposed.page.id, action: "source" })).status).toBe(404);
  });
});
