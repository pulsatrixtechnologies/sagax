import { describe, expect, it } from "vitest";

import { cleanUrl, collectBotLinks, fileKind, linksInText, mergeBotFiles, pageOf, readPageQuery } from "./bot-library.ts";
import type { ThreadFile } from "../threads/thread-files.ts";

describe("bot links", () => {
  it("finds bare and Markdown links, trimming sentence punctuation", () => {
    expect(linksInText("See https://example.test/a, and [the docs](https://docs.example.test/x_(y)).")).toEqual([
      { url: "https://example.test/a" },
      { url: "https://docs.example.test/x_(y)", title: "the docs" },
    ]);
    expect(linksInText("(https://example.test/paren) end.")).toEqual([{ url: "https://example.test/paren" }]);
    expect(linksInText("ftp://nope.test javascript:alert(1) http://user:pw@host.test")).toEqual([]);
  });

  it("rejects what is not a usable web address", () => {
    expect(cleanUrl("https://example.test/ok!")).toBe("https://example.test/ok");
    expect(cleanUrl("https://")).toBeNull();
    expect(cleanUrl(`https://example.test/${"a".repeat(3000)}`)).toBeNull();
  });

  it("never keeps a Markdown code mark, raw or percent-encoded (%60)", () => {
    expect(linksInText("Open [http://127.0.0.1:8787/](http://127.0.0.1:8787/%60) on the computer.")).toEqual([{ url: "http://127.0.0.1:8787/" }]);
    expect(linksInText("[`http://127.0.0.1:8787/`](http://127.0.0.1:8787/`)")).toEqual([{ url: "http://127.0.0.1:8787/" }]);
    expect(linksInText("Run `curl https://api.example.test/v1/items` then `https://example.test/a`.")).toEqual([
      { url: "https://api.example.test/v1/items" },
      { url: "https://example.test/a" },
    ]);
    expect(cleanUrl("https://example.test/page%60%22")).toBe("https://example.test/page");
    expect(cleanUrl("https://example.test/a`b")).toBe("https://example.test/a");
    expect(cleanUrl(`https://example.test/${"%60".repeat(5_000)}`)).toBeNull();
  });

  it("drops quotes, brackets and trailing punctuation around a bare link", () => {
    const urls = (text: string) => linksInText(text).map((link) => link.url);
    expect(urls("See **https://example.test/a**.")).toEqual(["https://example.test/a"]);
    expect(urls("<https://example.test/b>, \"https://example.test/c\"; 'https://example.test/d'")).toEqual([
      "https://example.test/b", "https://example.test/c", "https://example.test/d",
    ]);
    expect(urls("\u00ab https://example.test/fr \u00bb et https://example.test/e]")).toEqual(["https://example.test/fr", "https://example.test/e"]);
    expect(urls("https://example.test/q?a=1&amp;b=2. https://example.test/h&gt;")).toEqual(["https://example.test/q?a=1&b=2", "https://example.test/h"]);
    expect(urls("http://[::1]:8787/x.")).toEqual(["http://[::1]:8787/x"]);
    expect(urls("https://example.test/p?a=1&amp;gtin=2&amp;ltv=3 https://example.test/wiki/O'Brien' https://example.test/q?ids%5B%5D=1")).toEqual([
      "https://example.test/p?a=1&gtin=2&ltv=3", "https://example.test/wiki/O'Brien", "https://example.test/q?ids%5B%5D=1",
    ]);
  });

  it("reads one address once per message, with a clean title", () => {
    expect(linksInText("[**Guide**](https://example.test/g) and https://example.test/g again, https://EXAMPLE.test")).toEqual([
      { url: "https://example.test/g", title: "Guide" },
      { url: "https://example.test/" },
    ]);
    expect(linksInText("[example.test/x](https://example.test/x)")).toEqual([{ url: "https://example.test/x" }]);
  });

  it("deduplicates across threads at the newest mention, newest first, and keeps a title", () => {
    const links = collectBotLinks([
      { threadId: "t1", messages: [
        { id: "m1", kind: "text", text: "[Report](https://example.test/r)", at: 10 },
        { id: "m2", kind: "activity", text: "https://tool.test/ignored", at: 50 },
      ] },
      { threadId: "t2", messages: [
        { id: "m3", kind: "text", text: "again https://example.test/r", at: 30 },
        { id: "m4", text: "www https://www.Other.test/x", at: 20 },
      ] },
    ]);
    expect(links).toEqual([
      { url: "https://example.test/r", domain: "example.test", title: "Report", messageId: "m3", threadId: "t2", at: 30 },
      { url: "https://www.other.test/x", domain: "other.test", messageId: "m4", threadId: "t2", at: 20 },
    ]);
  });
});

describe("bot files", () => {
  const file = (over: Partial<ThreadFile>): ThreadFile => ({
    id: "f".repeat(24), messageId: "m", source: "upload", path: "/x", name: "x", at: 1, size: 3, available: true, ...over,
  });

  it("splits media from files and builds the existing per-thread URLs", () => {
    const merged = mergeBotFiles([
      { threadId: "t1", files: [file({ id: "a".repeat(24), name: "photo.png", mime: "image/png", at: 5, localPath: "/secret/photo.png" })] },
      { threadId: "t2", files: [
        file({ id: "b".repeat(24), name: "clip.mp4", mime: "video/mp4", at: 9 }),
        file({ id: "c".repeat(24), name: "notes.pdf", mime: "application/pdf", at: 7 }),
      ] },
    ]);
    expect(merged.map((entry) => [entry.name, entry.kind])).toEqual([["clip.mp4", "media"], ["notes.pdf", "file"], ["photo.png", "media"]]);
    const photo = merged.find((entry) => entry.name === "photo.png")!;
    expect(photo.url).toBe(`/api/threads/t1/files/${"a".repeat(24)}`);
    expect(photo.previewUrl).toBe(`/api/threads/t1/files/${"a".repeat(24)}?preview=1`);
    expect(JSON.stringify(merged)).not.toContain("/secret/");
    expect(merged.find((entry) => entry.name === "clip.mp4")!.previewUrl).toBeUndefined();
    expect(mergeBotFiles([{ threadId: "t2", files: [file({ mime: "application/pdf" })] }], "media")).toEqual([]);
    expect(fileKind(undefined)).toBe("file");
  });

  it("pages with an opaque cursor", () => {
    expect(readPageQuery(new URLSearchParams(""))).toEqual({ ok: true, offset: 0, limit: 30 });
    expect(readPageQuery(new URLSearchParams("cursor=4&limit=500"))).toEqual({ ok: true, offset: 4, limit: 100 });
    expect(readPageQuery(new URLSearchParams("cursor=-1")).ok).toBe(false);
    expect(readPageQuery(new URLSearchParams("limit=0")).ok).toBe(false);
    expect(pageOf([1, 2, 3], 0, 2)).toEqual({ items: [1, 2], nextCursor: "2", total: 3 });
    expect(pageOf([1, 2, 3], 2, 2)).toEqual({ items: [3], nextCursor: null, total: 3 });
  });
});
