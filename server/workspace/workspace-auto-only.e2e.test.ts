// This computer and the cloud computer are saved through the HTTP API.
// A Local VM or the browser still arrives as Auto. Off stays a restriction.
// A conversation is still not pinned to a place.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { launchVerificationServer, type VerificationServer } from "../../scripts/control-omb.ts";

describe("Workspace is always Auto over HTTP", () => {
  let session: VerificationServer;
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${session.info.url}${path}`, {
      method, headers: { "content-type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() as any };
  };

  beforeAll(async () => {
    // Without the fixed-workspace test seam: the product's own behaviour.
    session = await launchVerificationServer({ ...process.env, SAGAX_TEST_FIXED_WORKSPACE: "" });
  }, 60_000);
  afterAll(async () => { await session?.close(); });

  it("saves this computer and the cloud computer, reads the rest as Auto, and keeps Off", async () => {
    const bot = (await api("POST", "/api/bots")).body.bot;
    for (const place of ["local", "cloud"] as const) {
      // Auto on this computer still needs the warning the desktop sends.
      const patched = await api("PATCH", `/api/bots/${bot.id}`, { computer: place, ...(place === "local" ? { acknowledgeLocalAuto: true } : {}) });
      expect(patched.status, place).toBe(200);
      expect(patched.body.bot.computer, place).toBe(place);
    }
    for (const place of ["vm", "browser"]) {
      const patched = await api("PATCH", `/api/bots/${bot.id}`, { computer: place });
      expect(patched.status, place).toBe(200);
      expect(patched.body.bot, place).not.toHaveProperty("computer");
    }
    const off = await api("PATCH", `/api/bots/${bot.id}`, { computer: "off" });
    expect(off.status).toBe(200);
    expect(off.body.bot.computer).toBe("off");
    for (const auto of [null, "auto"]) {
      const back = await api("PATCH", `/api/bots/${bot.id}`, { computer: auto });
      expect(back.status).toBe(200);
      expect(back.body.bot).not.toHaveProperty("computer");
    }
    const malformed = await api("PATCH", `/api/bots/${bot.id}`, { computer: ["cloud"] });
    expect(malformed.status).toBe(400);
  });

  it("creates a bot on this computer when the request names it, and an Off bot when it says Off", async () => {
    const placed = await api("POST", "/api/bots", { settings: { computer: "local" } });
    expect(placed.status).toBe(201);
    expect(placed.body.bot.computer).toBe("local");
    const browser = await api("POST", "/api/bots", { settings: { computer: "browser" } });
    expect(browser.status).toBe(201);
    expect(browser.body.bot).not.toHaveProperty("computer");
    const off = await api("POST", "/api/bots", { settings: { computer: "off" } });
    expect(off.status).toBe(201);
    expect(off.body.bot.computer).toBe("off");
  });

  it("never pins a conversation to a place, without an error", async () => {
    const bot = (await api("POST", "/api/bots")).body.bot;
    for (const surface of ["cloud", "vm", "local", "browser", null]) {
      const patched = await api("PATCH", `/api/bots/${bot.id}/tasks/${bot.threadId}`, { surface });
      expect(patched.status, String(surface)).toBe(200);
      expect(patched.body.task.surface, String(surface)).toBeUndefined();
    }
    const listed = (await api("GET", "/api/bots?messages=0")).body.bots.find((candidate: { id: string }) => candidate.id === bot.id);
    expect(listed.tasks.find((task: { threadId: string }) => task.threadId === bot.threadId).surface).toBeUndefined();
    const rejected = await api("PATCH", `/api/bots/${bot.id}/tasks/${bot.threadId}`, { surface: "desktop" });
    expect(rejected.status).toBe(400);
  });
});
