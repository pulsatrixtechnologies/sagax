// #3216: a route that throws after its reply started must not crash the server.
import { createServer, request, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

import { json } from "../harness/http.ts";
import { answerRequestError } from "./request-error.ts";

const servers: ReturnType<typeof createServer>[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

/** A server whose handler mirrors handleRequest: route, then catch -> answerRequestError. */
async function serve(route: (res: ServerResponse) => Promise<void>, log: (...args: unknown[]) => void) {
  const rejections: unknown[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      try {
        await route(res);
      } catch (e) {
        return answerRequestError(res, e, req.method ?? "GET", req.url ?? "/", log);
      }
    })().catch((e) => rejections.push(e));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { port: (server.address() as AddressInfo).port, rejections };
}

function get(port: number, path: string): Promise<{ status: number; body: string; aborted: boolean }> {
  return new Promise((resolve) => {
    const req = request({ host: "127.0.0.1", port, path }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body, aborted: false }));
      res.on("error", () => resolve({ status: res.statusCode ?? 0, body, aborted: true }));
      res.on("aborted", () => resolve({ status: res.statusCode ?? 0, body, aborted: true }));
    });
    req.on("error", () => resolve({ status: 0, body: "", aborted: true }));
    req.end();
  });
}

describe("answerRequestError (#3216)", () => {
  it("answers a JSON error when nothing was sent yet", async () => {
    const log = vi.fn();
    const { port, rejections } = await serve(async () => {
      throw Object.assign(new Error("busy"), { status: 409, code: "guarded_busy" });
    }, log);
    const reply = await get(port, "/api/x");
    expect(reply.status).toBe(409);
    expect(JSON.parse(reply.body)).toEqual({ error: "busy", code: "guarded_busy" });
    expect(rejections).toEqual([]);
    expect(log).not.toHaveBeenCalled();
  });

  it("keeps an unknown code out of the reply", async () => {
    const { port } = await serve(async () => {
      throw Object.assign(new Error("boom"), { code: "ENOENT" });
    }, vi.fn());
    const reply = await get(port, "/api/y");
    expect(reply.status).toBe(500);
    expect(JSON.parse(reply.body)).toEqual({ error: "boom" });
  });

  it("does not throw ERR_HTTP_HEADERS_SENT when a streamed reply then fails", async () => {
    const log = vi.fn();
    const { port, rejections } = await serve(async (res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("data: first\n\n");
      throw new Error("stream source failed");
    }, log);
    const reply = await get(port, "/api/events");
    expect(reply.status).toBe(200);
    expect(rejections).toEqual([]);
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0]![0])).toContain("GET /api/events");
  });

  it("does not throw when a route already answered with json() and then fails", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.fn();
    const { port, rejections } = await serve(async (res) => {
      json(res, 200, { ok: true });
      throw new Error("late failure");
    }, log);
    const reply = await get(port, "/api/z");
    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.body)).toEqual({ ok: true });
    expect(rejections).toEqual([]);
    expect(log).toHaveBeenCalledTimes(1);
    errors.mockRestore();
  });

  it("json() drops a second reply instead of throwing", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = { headersSent: true, writableEnded: false, writeHead: vi.fn(), end: vi.fn() } as unknown as ServerResponse;
    expect(() => json(res, 500, { error: "x" })).not.toThrow();
    expect(res.writeHead).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalledTimes(1);
    errors.mockRestore();
  });
});
