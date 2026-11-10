// #3413 review: the first isolation rule rests on the declaration, not on a
// memory mark. A page that is not private to its person and whose served
// version declares a personal data capability keeps its shared state read
// only, for everyone, its person included, across a restart; and a private
// page that declares one loses its shared state when it becomes shared.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { PublishedPages } from "./published-pages.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const NOW = 1_800_000_000_000;
const DATA_PAGE = `<!doctype html><html><body><script type="application/sagax-capabilities+json">{"data":["team-board"]}</script><h1>Board</h1></body></html>`;
const PLAIN_PAGE = `<!doctype html><html><body><h1>Vote</h1></body></html>`;

function made(content: string, access: "private" | "org" | "link") {
  const dir = mkdtempSync(join(tmpdir(), "sagax-page-guard-"));
  dirs.push(dir);
  const pages = new PublishedPages(dir, () => NOW);
  const proposed = pages.propose({ ownerId: "person-a", botId: "lead", threadId: "t1", title: "Board", kind: "html", content });
  if (!proposed.ok) throw new Error(proposed.error);
  const published = pages.publish(proposed.page.id, { version: proposed.version.n, access, expiresAt: null });
  if ("ok" in published) throw new Error(published.error);
  return { pages, dir, id: proposed.page.id };
}

describe("shared state of a page that reads personal data", () => {
  it("refuses every write while the page is shared, its person's included, and after a restart", () => {
    const { pages, dir, id } = made(DATA_PAGE, "org");
    for (const by of ["person-b", "person-a"]) {
      const result = pages.setState(id, { key: "k", value: "board", by });
      expect(result).toMatchObject({ ok: false, code: "shared_write_after_data", status: 409 });
    }
    // a restart: a fresh store on the same folder still refuses
    const again = new PublishedPages(dir, () => NOW);
    expect(again.setState(id, { key: "k", value: "board", by: "person-b" })).toMatchObject({ ok: false, code: "shared_write_after_data" });
    expect(again.stateReadOnlyForData(id)).toBe(true);
  });

  it("lets a page private to its person keep its state, and clears it when it becomes shared", () => {
    const { pages, id } = made(DATA_PAGE, "private");
    expect(pages.setState(id, { key: "k", value: "my board", by: "person-a" })).toMatchObject({ ok: true });
    expect(Object.keys(pages.state(id))).toEqual(["k"]);
    const shared = pages.update(id, { access: "org" });
    expect("ok" in shared).toBe(false);
    expect(pages.state(id)).toEqual({});
  });

  it("clears it too when the private page gets an invite, an editor, or a place in its bot's Library", () => {
    for (const share of [
      (pages: PublishedPages, id: string) => pages.setInvites(id, { people: ["person-c"], teams: [] }),
      (pages: PublishedPages, id: string) => pages.setEditors(id, ["person-c"]),
      (pages: PublishedPages, id: string) => pages.setBotShared(id, true),
    ]) {
      const { pages, id } = made(DATA_PAGE, "private");
      pages.setState(id, { key: "k", value: "my board", by: "person-a" });
      share(pages, id);
      expect(pages.state(id)).toEqual({});
    }
  });

  it("leaves a page that declares no data exactly as before", () => {
    const { pages, id } = made(PLAIN_PAGE, "org");
    expect(pages.setState(id, { key: "k", value: 1, by: "person-b" })).toMatchObject({ ok: true });
    const priv = made(PLAIN_PAGE, "private");
    priv.pages.setState(priv.id, { key: "k", value: 1, by: "person-a" });
    priv.pages.update(priv.id, { access: "org" });
    expect(Object.keys(priv.pages.state(priv.id))).toEqual(["k"]);
  });

  it("stays read only when a version without the block becomes current by publish (second review)", () => {
    const { pages, id } = made(DATA_PAGE, "org");
    const v2 = pages.propose({ pageId: id, ownerId: "person-a", botId: "lead", threadId: "t1", title: "Board", kind: "html", content: PLAIN_PAGE });
    if (!v2.ok) throw new Error(v2.error);
    pages.publish(id, { version: v2.version.n, access: "org", expiresAt: null });
    expect(pages.get(id)?.currentVersion).toBe(v2.version.n);
    expect(pages.setState(id, { key: "k", value: "board of person-b", by: "person-b" })).toMatchObject({ ok: false, code: "shared_write_after_data" });
  });

  it("stays read only when the bot replaces the version itself on a page kept updated", () => {
    const { pages, id } = made(DATA_PAGE, "org");
    pages.setKeepUpdated(id, true);
    const v2 = pages.propose({ pageId: id, ownerId: "person-a", botId: "lead", threadId: "t1", title: "Board", kind: "html", content: PLAIN_PAGE });
    if (!v2.ok) throw new Error(v2.error);
    expect(pages.get(id)?.currentVersion).toBe(v2.version.n);
    expect(pages.setState(id, { key: "k", value: "board of person-b", by: "person-b" })).toMatchObject({ ok: false, code: "shared_write_after_data" });
  });

  it("keeps the mark after the data version is trimmed away, and only revoke clears it", () => {
    const { pages, dir, id } = made(DATA_PAGE, "org");
    pages.setKeepUpdated(id, true);
    for (let index = 0; index < 25; index++) pages.propose({ pageId: id, ownerId: "person-a", botId: "lead", threadId: "t1", title: "Board", kind: "html", content: PLAIN_PAGE });
    expect(pages.setState(id, { key: "k", value: 1, by: "person-b" })).toMatchObject({ ok: false, code: "shared_write_after_data" });
    // the mark is on the page itself: a restart keeps it
    expect(new PublishedPages(dir, () => NOW).setState(id, { key: "k", value: 1, by: "person-b" })).toMatchObject({ ok: false, code: "shared_write_after_data" });
    pages.revoke(id);
    const plain = pages.get(id)!.versions.at(-1)!.n;
    pages.publish(id, { version: plain, access: "org", expiresAt: null });
    expect(pages.setState(id, { key: "k", value: 1, by: "person-b" })).toMatchObject({ ok: true });
  });

  it("clears the state of a private page when it becomes shared, even when the data version is no longer current", () => {
    const { pages, id } = made(DATA_PAGE, "private");
    const v2 = pages.propose({ pageId: id, ownerId: "person-a", botId: "lead", threadId: "t1", title: "Board", kind: "html", content: PLAIN_PAGE });
    if (!v2.ok) throw new Error(v2.error);
    pages.publish(id, { version: v2.version.n, access: "private", expiresAt: null });
    pages.setState(id, { key: "k", value: "my board", by: "person-a" });
    pages.update(id, { access: "org" });
    expect(pages.state(id)).toEqual({});
  });
});
