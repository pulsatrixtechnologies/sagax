import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";

import type { CallbackResult } from "../mcp-oauth.ts";
import type { json, readBody } from "../harness/http.ts";
import {
  createMcpOAuthCallbackRoutes,
  MCP_OAUTH_CALLBACK_PATH,
  type McpOAuthCallbackDeps,
} from "./mcp-oauth-callback.ts";
import { PASS, type PreAuthRouteContext } from "./table.ts";

function harness(overrides: Partial<McpOAuthCallbackDeps> = {}) {
  const findOwner = vi.fn(((_state: string) => ({
    callback: vi.fn(async (): Promise<CallbackResult> => ({ ok: true, name: "notes" })),
  })) as McpOAuthCallbackDeps["findOwner"]);
  const phoneReturnLocation = vi.fn((_result: CallbackResult): string | null => null);
  const callbackPage = vi.fn((_result: CallbackResult, _lang: string | undefined) => ({
    html: "<html>done</html>",
    nonce: "n0nce",
  }));
  const deps: McpOAuthCallbackDeps = {
    findOwner,
    phoneReturnLocation,
    callbackPage,
    ...overrides,
  };
  const route = createMcpOAuthCallbackRoutes(deps);

  const call = async (opts: {
    method?: string;
    path?: string;
    query?: string;
    headers?: Record<string, string | string[] | undefined>;
  } = {}) => {
    const method = opts.method ?? "GET";
    const path = opts.path ?? MCP_OAUTH_CALLBACK_PATH;
    const url = new URL(`http://x${path}${opts.query ? `?${opts.query}` : ""}`);
    let status = 0;
    const headersOut: Record<string, string> = {};
    let body: string | undefined;
    const res = {
      headersSent: false,
      writableEnded: false,
      writeHead(code: number, headers?: Record<string, string>) {
        status = code;
        if (headers) Object.assign(headersOut, headers);
        return this;
      },
      end(text?: string) {
        body = text;
        this.writableEnded = true;
        this.headersSent = true;
      },
      setHeader() {},
    };
    const ctx: PreAuthRouteContext = {
      req: { headers: opts.headers ?? {} } as IncomingMessage,
      res: res as unknown as ServerResponse,
      url,
      path,
      method,
      auth: null,
      json: ((() => undefined) as unknown as typeof json),
      readBody: (async () => ({})) as unknown as typeof readBody,
    };
    const out = await route(ctx);
    return { out, status, headers: headersOut, body, deps, findOwner, phoneReturnLocation, callbackPage };
  };

  return { call, deps, findOwner, phoneReturnLocation, callbackPage };
}

describe("createMcpOAuthCallbackRoutes", () => {
  it("PASSes foreign paths and methods", async () => {
    const h = harness();
    expect((await h.call({ path: "/api/health" })).out).toBe(PASS);
    expect((await h.call({ path: "/api/mcp-oauth/callback", method: "POST" })).out).toBe(PASS);
    expect((await h.call({ path: "/api/mcp-oauth/other" })).out).toBe(PASS);
    expect(h.findOwner).not.toHaveBeenCalled();
  });

  it("answers 200 HTML when result.ok", async () => {
    const h = harness();
    const result = await h.call({ query: "state=abc&code=tok" });
    expect(result.out).toBeUndefined();
    expect(result.status).toBe(200);
    expect(result.body).toBe("<html>done</html>");
    expect(result.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(result.headers["referrer-policy"]).toBe("no-referrer");
    expect(result.headers["x-content-type-options"]).toBe("nosniff");
    expect(result.headers["content-security-policy"]).toContain("nonce-n0nce");
    expect(h.callbackPage).toHaveBeenCalled();
  });

  it("answers 400 HTML when !result.ok", async () => {
    const owner = {
      callback: vi.fn(async (): Promise<CallbackResult> => ({
        ok: false,
        name: "notes",
        error: "The sign-in was cancelled.",
      })),
    };
    const h = harness({ findOwner: () => owner });
    const result = await h.call({ query: "state=bad" });
    expect(result.status).toBe(400);
    expect(result.body).toBe("<html>done</html>");
    expect(result.headers["content-type"]).toBe("text/html; charset=utf-8");
  });

  it("302 when phoneReturnLocation returns a URL", async () => {
    const phoneReturnLocation = vi.fn(() => "sagax://oauth-done?status=ok&server=notes");
    const h = harness({ phoneReturnLocation });
    const result = await h.call({ query: "state=phone" });
    expect(result.status).toBe(302);
    expect(result.headers.location).toBe("sagax://oauth-done?status=ok&server=notes");
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(result.headers["referrer-policy"]).toBe("no-referrer");
    expect(result.body).toBeUndefined();
    expect(h.callbackPage).not.toHaveBeenCalled();
  });

  it("calls findOwner with state from the query", async () => {
    const h = harness();
    await h.call({ query: "state=person-state-42&code=x" });
    expect(h.findOwner).toHaveBeenCalledWith("person-state-42");
    await h.call({ query: "code=only" });
    expect(h.findOwner).toHaveBeenCalledWith("");
  });
});
