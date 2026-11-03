// Pages: the person chooses an audience when they share, pins a page, and
// lets the bot keep a published page up to date. A page marked person does
// not enter a room or a group. Artifacts are not involved.
import { mkdtempSync, rmSync } from "node:fs";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "./harness/http.ts";
import { PublishedPages } from "./pages/published-pages.ts";
import type { RequestAuth } from "./auth/request-auth.ts";
import { createPublishedPageRoutes, type PublishedPageRouteDeps } from "./routes/published-pages.ts";
import { pageMayEnter } from "../shared/page-audience.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

let now = 1_800_000_000_000;
function store(): PublishedPages {
  const dir = mkdtempSync(join(tmpdir(), "sagax-page-share-"));
  dirs.push(dir);
  return new PublishedPages(dir, () => now);
}

const HTML = "<!doctype html><html><body><h1>Rapport</h1></body></html>";
function proposed(pages: PublishedPages) {
  const result = pages.propose({ botId: "bot1", threadId: "t1", title: "Rapport", kind: "html", content: HTML, ownerId: "pr_alice" });
  if (!result.ok) throw new Error(result.error);
  return result.page;
}

type Answer = { status: number; body: string };
function request(path: string, method: string) {
  const req = new IncomingMessage(new Socket());
  req.method = method;
  req.url = path;
  req.headers = { "content-type": "application/json" };
  const res = new ServerResponse(req);
  const chunks: Buffer[] = [];
  let resolve!: (value: Answer) => void;
  const done = new Promise<Answer>((r) => { resolve = r; });
  res.write = ((chunk: unknown) => { if (chunk) chunks.push(Buffer.from(chunk as string)); return true; }) as typeof res.write;
  res.end = ((chunk?: unknown) => {
    if (chunk) chunks.push(Buffer.from(chunk as string));
    resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") });
    return res;
  }) as typeof res.end;
  return { req, res, done };
}

const session = (principalId: string): RequestAuth => ({
  kind: "session", via: "cookie", scopes: ["client"], session: { id: "s1", principalId } as never,
});

function routes(pages: PublishedPages) {
  const deps: PublishedPageRouteDeps = {
    pages,
    owner: (auth) => auth.kind === "session" ? auth.session.principalId : undefined,
    isPerson: (auth) => auth.kind === "session" && Boolean(auth.session.principalId),
    origin: () => "https://sagax.example.com",
    reachable: () => true,
    now: () => now,
  };
  return createPublishedPageRoutes(deps);
}

async function call(handler: ReturnType<typeof routes>, auth: RequestAuth, method: string, path: string, body?: unknown) {
  const { req, res, done } = request(path, method);
  process.nextTick(() => {
    if (body !== undefined) req.push(JSON.stringify(body));
    req.push(null);
  });
  await handler({ req, res, url: new URL(`http://x${path}`), path, method, auth, json, readBody });
  const answer = await done;
  return { status: answer.status, body: answer.body ? JSON.parse(answer.body) as Record<string, unknown> : null };
}

describe("page share, pin and keep up to date", () => {
  it("starts with the person, and refuses a room or a group until they choose one", async () => {
    const pages = store();
    const page = proposed(pages);
    expect(page.audience).toEqual({ kind: "person" });
    const handler = routes(pages);
    const alice = session("pr_alice");
    await call(handler, alice, "PATCH", `/api/pages/${page.id}`, { audience: "room", id: "room-9" });
    expect(pages.get(page.id)?.audience).toEqual({ kind: "person" });
    const placed = await call(handler, alice, "POST", `/api/pages/${page.id}/place`, { into: "room", id: "room-1" });
    expect(placed.status).toBe(403);
    expect(placed.body).toMatchObject({ code: "page_audience_person" });
    expect(pageMayEnter({ kind: "person" }, { kind: "group", id: "g1" })).toBe(false);
    expect(pages.get(page.id)?.updatedAt).toBe(page.updatedAt);

    const shared = await call(handler, alice, "POST", `/api/pages/${page.id}/share`, { audience: "room", id: "room-1" });
    expect(shared.status).toBe(200);
    expect(shared.body).toMatchObject({ page: { audience: { kind: "room", id: "room-1" } } });
    expect((await call(handler, alice, "POST", `/api/pages/${page.id}/place`, { into: "room", id: "room-1" })).status).toBe(200);
    expect((await call(handler, alice, "POST", `/api/pages/${page.id}/place`, { into: "room", id: "room-2" })).body).toMatchObject({ code: "page_audience_mismatch" });
    expect((await call(handler, alice, "POST", `/api/pages/${page.id}/place`, { into: "group", id: "room-1" })).body).toMatchObject({ code: "page_audience_mismatch" });

    await call(handler, alice, "POST", `/api/pages/${page.id}/share`, { audience: "person" });
    expect((await call(handler, alice, "POST", `/api/pages/${page.id}/place`, { into: "room", id: "room-1" })).body).toMatchObject({ code: "page_audience_person" });
    expect((await call(handler, session("pr_bob"), "POST", `/api/pages/${page.id}/share`, { audience: "group", id: "g1" })).status).toBe(404);
    expect(pages.get(page.id)?.audience).toEqual({ kind: "person" });
  });

  it("pins for the person and lets the bot replace only a published page they allowed", async () => {
    const pages = store();
    const page = proposed(pages);
    const handler = routes(pages);
    const alice = session("pr_alice");
    const pinned = await call(handler, alice, "PATCH", `/api/pages/${page.id}`, { pinned: true, keepUpdated: true });
    expect(pinned.status).toBe(200);
    expect(pinned.body).toMatchObject({ page: { pinned: true, keepUpdated: true } });
    expect(pages.list("pr_alice")[0]?.id).toBe(page.id);

    const draft = pages.propose({ pageId: page.id, botId: "bot1", threadId: "t1", title: "Rapport", kind: "html", content: HTML, ownerId: "pr_alice" });
    if (!draft.ok) throw new Error(draft.error);
    expect(draft.page.status).toBe("draft");
    expect(draft.page.currentVersion).toBeNull();

    pages.publish(page.id, { version: 1, access: "private", expiresAt: null, by: "pr_alice" });
    const kept = pages.propose({ pageId: page.id, botId: "bot1", threadId: "t1", title: "Rapport", kind: "html", content: "<p>jour</p>", ownerId: "pr_alice" });
    if (!kept.ok) throw new Error(kept.error);
    expect(kept.page.currentVersion).toBe(kept.version.n);
    expect(kept.page.access).toBe("private");
    expect(kept.page.audience).toEqual({ kind: "person" });
    expect(kept.version.state).toBe("published");

    pages.setKeepUpdated(page.id, false, "pr_alice");
    const held = pages.propose({ pageId: page.id, botId: "bot1", threadId: "t1", title: "Rapport", kind: "html", content: "<p>attente</p>", ownerId: "pr_alice" });
    if (!held.ok) throw new Error(held.error);
    expect(held.version.state).toBe("proposed");
    expect(held.page.currentVersion).toBe(kept.version.n);
    expect(held.page.access).toBe("private");
  });

  it("a person's edit of a page the bot keeps up to date replaces the published version and not the audience", () => {
    const pages = store();
    const page = proposed(pages);
    pages.share(page.id, { kind: "group", id: "g1" }, "pr_alice");
    pages.publish(page.id, { version: 1, access: "org", expiresAt: null });
    pages.setKeepUpdated(page.id, true);
    const edited = pages.edit(page.id, { kind: "html", content: "<p>ensemble</p>", by: "pr_alice" });
    if (!edited.ok) throw new Error(edited.error);
    expect(edited.version.author).toBe("person");
    expect(edited.version.state).toBe("published");
    expect(edited.page.access).toBe("org");
    expect(edited.page.audience).toEqual({ kind: "group", id: "g1" });
    expect(pageMayEnter(edited.page.audience ?? { kind: "person" }, { kind: "room", id: "g1" })).toBe(false);
  });
});
