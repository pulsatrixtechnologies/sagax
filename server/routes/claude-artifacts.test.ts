import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";

import type { RequestAuth } from "../auth/request-auth.ts";
import { onArtifactPublished } from "../claude-artifacts/events.ts";
import { ArtifactSummaryCache, type PersonArtifactCall } from "../claude-artifacts/service.ts";
import { claudeArtifactCopyPrompt } from "../../shared/claude-chat-blocks.ts";
import type { InternalRouteContext } from "./internal-route.ts";
import { createClaudeArtifactInternalRoutes, createClaudeArtifactRoutes } from "./claude-artifacts.ts";
import type { RouteContext } from "./table.ts";

const URL_A = "https://claude.ai/artifact/abcdefgh12";
const URL_B = "https://claude.ai/artifact/ijklmnop34";
type Sent = { status: number; body: any };

function readerCall(log: string[]): PersonArtifactCall {
  return async (principalId, tool, input) => {
    log.push(`${principalId}:${tool}:${String(input.action)}`);
    if (tool === "ArtifactComments") return { ok: true, result: { threads: [{ id: "th1", status: "open", text: "hi" }] }, text: "ok" };
    if (input.action === "read") return { ok: true, result: { read: { title: "Plan" }, owned: true }, text: "<cowritten-artifact-html><p>Body</p></cowritten-artifact-html>" };
    return { ok: true, result: { artifacts: [] }, text: "" };
  };
}

function client(opts: {
  principal?: string;
  call: PersonArtifactCall;
  cache?: ArtifactSummaryCache;
  copy?: NonNullable<Parameters<typeof createClaudeArtifactRoutes>[0]["copy"]>;
}) {
  const route = createClaudeArtifactRoutes({
    principalId: () => opts.principal,
    call: opts.call,
    cache: opts.cache ?? new ArtifactSummaryCache(),
    ...(opts.copy ? { copy: opts.copy } : {}),
  });
  return async (method: string, path: string, body?: unknown) => {
    const sent: Sent[] = [];
    const url = new URL(`http://x${path}`);
    await route({
      req: {} as IncomingMessage,
      res: { setHeader: () => {} } as unknown as ServerResponse,
      url, path: url.pathname, method,
      auth: { kind: "loopback", scopes: ["client"] } as unknown as RequestAuth,
      json: ((_res: ServerResponse, status: number, payload: unknown) => { sent.push({ status, body: payload }); }) as RouteContext["json"],
      readBody: (async () => body) as unknown as RouteContext["readBody"],
    } as unknown as RouteContext);
    return sent[0];
  };
}

describe("/api/claude-artifacts (the person's routes)", () => {
  it("refuses a request with no person", async () => {
    const call = client({ call: readerCall([]) });
    expect(await call("GET", `/api/claude-artifacts/summary?url=${encodeURIComponent(URL_A)}`)).toMatchObject({ status: 403 });
  });

  it("answers 409 claude_not_signed_in when the person has no Claude login", async () => {
    const call = client({ principal: "p-1", call: async () => ({ ok: false, unavailable: "not_signed_in" }) });
    expect(await call("GET", `/api/claude-artifacts/summary?url=${encodeURIComponent(URL_A)}`)).toEqual({ status: 409, body: { error: "claude_not_signed_in" } });
  });

  it("caches a summary per person and drops it on invalidate", async () => {
    const log: string[] = [];
    const cache = new ArtifactSummaryCache();
    const call = client({ principal: "p-1", call: readerCall(log), cache });
    const path = `/api/claude-artifacts/summary?url=${encodeURIComponent(URL_A)}`;
    expect(await call("GET", path)).toEqual({ status: 200, body: { url: URL_A, title: "Plan", owned: true, summary: "Body" } });
    await call("GET", path);
    expect(log.filter((row) => row.endsWith(":read"))).toHaveLength(1);
    cache.invalidate(URL_A);
    await call("GET", path);
    expect(log.filter((row) => row.endsWith(":read"))).toHaveLength(2);
    expect(log.every((row) => row.startsWith("p-1:"))).toBe(true);
  });

  it("lists, replies and resolves through the person's call", async () => {
    const log: string[] = [];
    const call = client({ principal: "p-1", call: readerCall(log) });
    expect(await call("GET", `/api/claude-artifacts/comments?url=${encodeURIComponent(URL_A)}`)).toMatchObject({ status: 200, body: { threads: [{ id: "th1", status: "open", text: "hi", replies: [] }] } });
    expect(await call("POST", "/api/claude-artifacts/comments/reply", { url: URL_A, threadId: "th1", text: "done" })).toMatchObject({ status: 200, body: { ok: true } });
    expect(await call("POST", "/api/claude-artifacts/comments/resolve", { url: URL_A, threadId: "th1" })).toMatchObject({ status: 200, body: { ok: true } });
    expect(log).toEqual(["p-1:ArtifactComments:read", "p-1:ArtifactComments:reply", "p-1:ArtifactComments:resolve"]);
  });

  it("refuses a url that is not a claude.ai artifact", async () => {
    const call = client({ principal: "p-1", call: readerCall([]) });
    expect(await call("GET", "/api/claude-artifacts/summary?url=https%3A%2F%2Fexample.com%2Fx")).toMatchObject({ status: 400 });
  });

  it("POST /copy asks the bot with the Lot 1 republish prompt", async () => {
    const copy = vi.fn(async (_auth, botId, threadId, url) => {
      expect(botId).toBe("bot-1");
      expect(threadId).toBe("t-main");
      expect(url).toBe(URL_A);
      expect(claudeArtifactCopyPrompt(url)).toContain("fichier HTML");
      return { ok: true as const };
    });
    const call = client({ principal: "p-1", call: readerCall([]), copy });
    expect(await call("POST", "/api/claude-artifacts/copy", { url: URL_A, botId: "bot-1", threadId: "t-main" }))
      .toEqual({ status: 200, body: { ok: true } });
    expect(copy).toHaveBeenCalledOnce();
    expect(await call("POST", "/api/claude-artifacts/copy", { url: "https://example.com/x", botId: "bot-1" }))
      .toMatchObject({ status: 400 });
  });

  it("answers 404 for /copy when the host did not wire a copy handler", async () => {
    const call = client({ principal: "p-1", call: readerCall([]) });
    expect(await call("POST", "/api/claude-artifacts/copy", { url: URL_A, botId: "bot-1" }))
      .toEqual({ status: 404, body: { error: "not found" } });
  });
});

describe("POST /api/internal/claude-artifact (the bot's tool)", () => {
  function internal(opts: { call: PersonArtifactCall; owns?: boolean; file?: string | null }) {
    const route = createClaudeArtifactInternalRoutes({
      call: opts.call,
      ownsThread: () => opts.owns ?? true,
      speaker: () => "p-1",
      workspaceFile: () => opts.file ?? null,
    });
    return async (body: unknown) => {
      const sent: Sent[] = [];
      await route({
        res: {} as ServerResponse, path: "/api/internal/claude-artifact", method: "POST",
        json: ((_res: ServerResponse, status: number, payload: unknown) => { sent.push({ status, body: payload }); }) as InternalRouteContext["json"],
        capability: { botId: "bot-1", threadId: "t1", generation: "g" },
        readBody: async () => body,
      } as unknown as InternalRouteContext);
      return sent[0];
    };
  }

  it("refuses another bot's conversation and local file keys", async () => {
    const ok: PersonArtifactCall = async () => ({ ok: true, result: {}, text: "" });
    expect(await internal({ call: ok, owns: false })({ tool: "Artifact", input: {} })).toMatchObject({ status: 403 });
    expect(await internal({ call: ok })({ tool: "Artifact", input: { action: "publish", file_path: "/etc/passwd" } })).toMatchObject({ status: 400 });
    expect(await internal({ call: ok })({ tool: "Artifact", input: {}, html: "<p/>", file: "a.html" })).toMatchObject({ status: 400 });
    expect(await internal({ call: ok, file: null })({ tool: "Artifact", input: {}, file: "../x.html" })).toMatchObject({ status: 400 });
    expect(await internal({ call: ok })({ tool: "Bash", input: {} })).toMatchObject({ status: 400 });
  });

  it("runs as the speaker, stages html and notes an owned publish", async () => {
    const seen: unknown[] = [];
    const published: unknown[] = [];
    const stop = onArtifactPublished((event) => published.push(event));
    const call: PersonArtifactCall = async (principalId, tool, input, page) => {
      seen.push({ principalId, tool, input, page });
      return { ok: true, result: { url: URL_A, title: "Plan" }, text: "" };
    };
    const sent = await internal({ call })({ tool: "Artifact", input: { action: "publish", title: "Plan" }, html: "<p>x</p>" });
    stop();
    expect(sent).toMatchObject({ status: 200, body: { result: { url: URL_A } } });
    expect(seen).toEqual([{ principalId: "p-1", tool: "Artifact", input: { action: "publish", title: "Plan" }, page: { html: "<p>x</p>" } }]);
    expect(published).toEqual([expect.objectContaining({ url: URL_A, botId: "bot-1", threadId: "t1", principalId: "p-1" })]);
  });

  it("answers blocked other_account with the account", async () => {
    const call: PersonArtifactCall = async () => ({ ok: false, blocked: "other_account", account: "person@example.com" });
    expect(await internal({ call })({ tool: "Artifact", input: { action: "read", url: URL_A } }))
      .toEqual({ status: 200, body: { blocked: "other_account", account: "person@example.com" } });
  });

  it("Lot 1 slice: foreign read is blocked, then publish from file owns the new URL", async () => {
    const published: unknown[] = [];
    const stop = onArtifactPublished((event) => published.push(event));
    const calls: Array<{ action: unknown; page?: unknown }> = [];
    const call: PersonArtifactCall = async (_principalId, tool, input, page) => {
      calls.push({ action: input.action, page });
      if (tool === "Artifact" && input.action === "read" && input.url === URL_A) {
        return { ok: false, blocked: "other_account", account: "other@example.com" };
      }
      if (tool === "Artifact" && input.action === "publish") {
        expect(page).toEqual({ file: "/workspace/dispatch-history.html" });
        return { ok: true, result: { url: URL_B, title: "Historique du dispatch", owned: true }, text: "" };
      }
      return { ok: false, error: "unexpected" };
    };
    const route = internal({ call, file: "/workspace/dispatch-history.html" });
    expect(await route({ tool: "Artifact", input: { action: "read", url: URL_A } }))
      .toEqual({ status: 200, body: { blocked: "other_account", account: "other@example.com" } });
    expect(await route({
      tool: "Artifact",
      input: { action: "publish", title: "Historique du dispatch" },
      file: "dispatch-history.html",
    })).toMatchObject({ status: 200, body: { result: { url: URL_B, owned: true } } });
    stop();
    expect(calls).toEqual([
      { action: "read", page: undefined },
      { action: "publish", page: { file: "/workspace/dispatch-history.html" } },
    ]);
    expect(published).toEqual([expect.objectContaining({ url: URL_B, botId: "bot-1", threadId: "t1", principalId: "p-1" })]);
  });
});
