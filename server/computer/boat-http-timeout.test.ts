// A Boat HTTP call that brings no AbortSignal used to hang on a stalled
// relay. boatFetch now defaults to BOAT_HTTP_TIMEOUT_MS; this pins that
// bound on the sleep path's /stop (no caller signal of its own).
import { createHash } from "node:crypto";
import { createServer, type Server, type ServerResponse } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { BOAT_HTTP_TIMEOUT_MS } from "./boat.ts";

describe("Boat HTTP default timeout", () => {
  const botId = "boat-http-timeout-bot";
  const hash = createHash("sha256").update(botId).digest("hex").slice(0, 6);
  const prefix = botId.slice(0, 8).toLowerCase().replace(/[^a-z0-9]/g, "");
  const machineName = `ogb-${prefix}-${hash}`;
  const held: ServerResponse[] = [];
  let api: Server;
  let sleepBoat: typeof import("./boat.ts").sleepBoat;

  beforeAll(async () => {
    api = createServer((req, res) => {
      const path = new URL(req.url ?? "/", "http://boat.test").pathname;
      req.resume();
      req.on("end", () => {
        res.setHeader("content-type", "application/json");
        if (path === "/api/box/v1/boxes") {
          res.end(JSON.stringify({ boxes: [{ id: "bx_23456789", name: machineName, state: "ready" }] }));
          return;
        }
        if (path === "/api/box/v1/boxes/bx_23456789" && req.method === "GET") {
          res.end(JSON.stringify({ ok: true, box: { id: "bx_23456789", name: machineName, state: "ready" } }));
          return;
        }
        if (path.endsWith("/commands")) {
          res.end(JSON.stringify({ exitCode: 0, stdout: "", stderr: "" }));
          return;
        }
        // /stop accepts and never answers: the default signal must cut it.
        held.push(res);
      });
    });
    await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
    vi.stubEnv("SAGAX_BOX_API", `http://127.0.0.1:${(api.address() as { port: number }).port}/api/box/v1`);
    vi.resetModules();
    ({ sleepBoat } = await import("./boat.ts"));
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    for (const res of held) res.destroy();
    api.closeAllConnections();
    await new Promise<void>((resolve) => api.close(() => resolve()));
  });

  it("exports the twenty-second default used when a call brings no signal", () => {
    expect(BOAT_HTTP_TIMEOUT_MS).toBe(20_000);
  });

  it("aborts a stalled /stop that brought no signal, without waiting the wall clock", async () => {
    const controller = new AbortController();
    const realTimeout = AbortSignal.timeout.bind(AbortSignal);
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
      // findBoat also uses 20_000 explicitly; both share this controller so the
      // abort below ends the hung /stop the moment lookup has finished.
      if (ms === BOAT_HTTP_TIMEOUT_MS) return controller.signal;
      return realTimeout(ms);
    });
    try {
      const sleeping = sleepBoat({ box: { token: "box_test" } } as never, botId);
      await vi.waitFor(() => expect(timeout).toHaveBeenCalledWith(BOAT_HTTP_TIMEOUT_MS));
      // /stop is the call that hangs; abort after at least one 20 s bound was armed.
      await vi.waitFor(() => expect(held.length).toBeGreaterThan(0));
      controller.abort(new DOMException("Timed out", "TimeoutError"));
      await expect(sleeping).rejects.toThrow();
    } finally {
      timeout.mockRestore();
    }
  });
});
