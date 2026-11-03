import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { createArtifactStore, type ArtifactStore } from "../artifacts.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { removeTempDir } from "../testing/cleanup.ts";
import type { Artifact } from "../../shared/artifacts.ts";
import type { InternalRouteContext } from "./internal-route.ts";
import { createArtifactInternalRoutes, createArtifactRoutes, type ArtifactRouteDeps } from "./artifacts.ts";
import { PASS, type RouteContext } from "./table.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) void removeTempDir(dir); });

function freshStore(): ArtifactStore {
  const dir = mkdtempSync(join(tmpdir(), "omb-artifact-routes-"));
  dirs.push(dir);
  return createArtifactStore({ file: join(dir, "artifacts.json") });
}

type Sent = { status: number; body: any };

function internal(store: ArtifactStore, opts: { owns?: boolean; botId?: string } = {}) {
  const route = createArtifactInternalRoutes({ artifacts: () => store, ownsThread: () => opts.owns ?? true, speaker: () => "p-1" });
  return async (body: Record<string, unknown>, path = "/api/internal/artifacts") => {
    const sent: Sent[] = [];
    const out = await route({
      res: {} as ServerResponse,
      path,
      method: "POST",
      json: ((_res: ServerResponse, status: number, payload: unknown) => { sent.push({ status, body: payload }); }) as InternalRouteContext["json"],
      capability: { botId: opts.botId ?? "bot-1", threadId: "t1", generation: "g" },
      readBody: async () => body,
    });
    return { out, sent: sent[0] };
  };
}

function client(store: ArtifactStore, over: Partial<ArtifactRouteDeps> = {}) {
  const route = createArtifactRoutes({
    artifacts: () => store,
    mayUseBot: (_auth, botId) => botId !== "hidden",
    mayView: () => true,
    ...over,
  });
  return async (method: string, path: string, body?: unknown) => {
    const sent: Sent[] = [];
    const headers: Record<string, string> = {};
    const url = new URL(`http://x${path}`);
    const out = await route({
      req: { headers: { "content-type": "application/json" } } as unknown as IncomingMessage,
      res: { setHeader: (key: string, value: string) => { headers[key] = value; } } as unknown as ServerResponse,
      url,
      path: url.pathname,
      method,
      auth: { kind: "loopback", scopes: ["admin", "client"] } as unknown as RequestAuth,
      json: ((_res: ServerResponse, status: number, payload: unknown) => { sent.push({ status, body: payload }); }) as RouteContext["json"],
      readBody: (async () => body) as unknown as RouteContext["readBody"],
    });
    return { out, sent: sent[0], headers };
  };
}

describe("POST /api/internal/artifacts (the bot's tools)", () => {
  it("saves, lists, updates and deletes for the capability's own bot", async () => {
    const store = freshStore();
    const call = internal(store);
    const saved = await call({ tool: "save_artifact", args: { title: "CPU", html: "<b>1</b>", source: { kind: "command", command: "cat stats.json" }, interval_seconds: 60 } });
    expect(saved.sent).toMatchObject({ status: 201, body: { artifact: { title: "CPU", interval_seconds: 60, favorite: false } } });
    expect(saved.sent?.body.artifact).not.toHaveProperty("html");
    const id = saved.sent?.body.artifact.id as string;
    expect(store.get(id)).toMatchObject({ botId: "bot-1", threadId: "t1", ownerPrincipalId: "p-1" });

    expect((await call({ tool: "list_artifacts", args: {} })).sent?.body.artifacts).toHaveLength(1);
    expect((await call({ tool: "update_artifact", args: { artifact_id: id, favorite: true, paused: true } })).sent)
      .toMatchObject({ status: 200, body: { artifact: { favorite: true, refresh: { state: "paused" } } } });
    expect((await call({ tool: "update_artifact", args: { artifact_id: "nope" } })).sent?.status).toBe(400);
    expect((await call({ tool: "delete_artifact", args: { artifact_id: id } })).sent).toEqual({ status: 200, body: { ok: true } });
    expect(store.all()).toEqual([]);
  });

  it("never reaches another bot's artifact", async () => {
    const store = freshStore();
    const mine = await internal(store)({ tool: "save_artifact", args: { title: "A", html: "<p>" } });
    const id = mine.sent?.body.artifact.id as string;
    const other = internal(store, { botId: "bot-2" });
    expect((await other({ tool: "update_artifact", args: { artifact_id: id, title: "B" } })).sent?.status).toBe(404);
    expect((await other({ tool: "delete_artifact", args: { artifact_id: id } })).sent?.status).toBe(404);
    expect((await other({ tool: "list_artifacts", args: {} })).sent?.body.artifacts).toEqual([]);
  });

  it("refuses another conversation, an unknown tool, and passes other paths", async () => {
    const store = freshStore();
    expect((await internal(store, { owns: false })({ tool: "list_artifacts" })).sent?.status).toBe(403);
    expect((await internal(store)({ tool: "show_widget" })).sent?.status).toBe(400);
    expect((await internal(store)({}, "/api/internal/other")).out).toBe(PASS);
  });
});

describe("the person's artifact routes", () => {
  function seed(store: ArtifactStore): Artifact {
    const made = store.create("bot-1", "t1", { title: "Tickets", html: "<p>doc</p>" });
    if (!made.ok) throw new Error("seed");
    return made.artifact;
  }

  it("lists summaries without the document, and opens one with it", async () => {
    const store = freshStore();
    const artifact = seed(store);
    const call = client(store);
    const list = await call("GET", "/api/bots/bot-1/artifacts");
    expect(list.sent?.status).toBe(200);
    expect(list.sent?.body.artifacts[0]).not.toHaveProperty("html");
    expect(list.headers["cache-control"]).toBe("private, no-store");
    expect((await call("GET", `/api/bots/bot-1/artifacts/${artifact.id}`)).sent?.body.artifact.html).toBe("<p>doc</p>");
    expect((await call("GET", "/api/artifacts")).sent?.body.artifacts).toHaveLength(1);
  });

  it("changes favorite and popped only; anything else is the bot's", async () => {
    const store = freshStore();
    const artifact = seed(store);
    const call = client(store);
    expect((await call("PATCH", `/api/bots/bot-1/artifacts/${artifact.id}`, { favorite: true })).sent?.body.artifact.favorite).toBe(true);
    expect((await call("PATCH", `/api/bots/bot-1/artifacts/${artifact.id}`, { title: "x" })).sent).toMatchObject({ status: 400, body: { error: expect.stringContaining("Ask the bot") } });
    expect((await call("DELETE", `/api/bots/bot-1/artifacts/${artifact.id}`)).sent?.status).toBe(200);
    expect(store.get(artifact.id)).toBeNull();
  });

  it("hides a bot the viewer may not use, an artifact that is not theirs, and another bot's id", async () => {
    const store = freshStore();
    const artifact = seed(store);
    expect((await client(store)("GET", "/api/bots/hidden/artifacts")).sent?.status).toBe(404);
    expect((await client(store)("GET", `/api/bots/bot-2/artifacts/${artifact.id}`)).sent?.status).toBe(404);
    const strict = client(store, { mayView: () => false });
    expect((await strict("GET", "/api/bots/bot-1/artifacts")).sent?.body.artifacts).toEqual([]);
    expect((await strict("GET", `/api/bots/bot-1/artifacts/${artifact.id}`)).sent?.status).toBe(404);
    expect((await strict("GET", "/api/artifacts")).sent?.body.artifacts).toEqual([]);
  });

  it("refresh needs a source; watch keeps only artifacts the viewer may see", async () => {
    const store = freshStore();
    const artifact = seed(store);
    const watched: string[][] = [];
    const call = client(store, { refreshNow: async (a) => a, watch: (ids) => { watched.push([...ids]); } });
    expect((await call("POST", `/api/bots/bot-1/artifacts/${artifact.id}/refresh`)).sent?.status).toBe(409);
    expect((await call("POST", "/api/artifacts/watch", { ids: [artifact.id, "art_unknown123"] })).sent?.body).toEqual({ ok: true, watching: 1 });
    expect(watched).toEqual([[artifact.id]]);
    expect((await call("GET", "/api/other")).out).toBe(PASS);
  });

  it("lists earlier documents and puts one back", async () => {
    const store = freshStore();
    const artifact = seed(store);
    store.update("bot-1", artifact.id, { html: "<p>next</p>" });
    const call = client(store);
    const listed = await call("GET", `/api/bots/bot-1/artifacts/${artifact.id}?versions=1`);
    expect(listed.sent?.body.versions).toMatchObject([{ rev: 1, html: "<p>doc</p>" }]);
    expect((await call("GET", `/api/bots/bot-1/artifacts/${artifact.id}`)).sent?.body).not.toHaveProperty("versions");
    const restored = await call("POST", `/api/bots/bot-1/artifacts/${artifact.id}`, { restoreRev: 1 });
    expect(restored.sent?.body.artifact.html).toBe("<p>doc</p>");
    expect((await call("POST", `/api/bots/bot-1/artifacts/${artifact.id}`, { restoreRev: 99 })).sent?.status).toBe(404);
    expect((await call("POST", `/api/bots/bot-1/artifacts/${artifact.id}`, {})).sent?.status).toBe(400);
  });
});
