// Characterization: parseRequest matches the former inline handleRequest URL gate.
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";

import { parseRequest } from "./parse-request.ts";

function fakeReq(url: string, method = "GET"): IncomingMessage {
  return Object.assign(new EventEmitter(), { url, method }) as IncomingMessage;
}

function fakeRes(): ServerResponse {
  return Object.assign(new EventEmitter(), {
    headersSent: false,
    writableEnded: false,
  }) as ServerResponse;
}

describe("parseRequest", () => {
  it("returns url, path and method for a valid request", () => {
    const reply = vi.fn();
    const parsed = parseRequest(fakeReq("/api/health?x=1", "POST"), fakeRes(), 7780, reply);
    expect(reply).not.toHaveBeenCalled();
    expect(parsed).toEqual({
      url: expect.any(URL),
      path: "/api/health",
      method: "POST",
    });
    expect(parsed!.url.searchParams.get("x")).toBe("1");
    expect(parsed!.url.port).toBe("7780");
  });

  it("defaults method to GET when missing", () => {
    const req = fakeReq("/pair");
    delete (req as { method?: string }).method;
    const parsed = parseRequest(req, fakeRes(), 80, vi.fn());
    expect(parsed?.method).toBe("GET");
    expect(parsed?.path).toBe("/pair");
  });

  it("answers 400 and returns null for an invalid URL", () => {
    const reply = vi.fn();
    const res = fakeRes();
    // Node's URL rejects a path with a raw space when used as a path-only URL.
    const parsed = parseRequest(fakeReq("http://\x00"), res, 7780, reply);
    expect(parsed).toBeNull();
    expect(reply).toHaveBeenCalledWith(res, 400, { error: "invalid request URL" });
  });
});
