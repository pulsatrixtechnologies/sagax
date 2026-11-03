// server/safety/network-guard.ts refuses the blocked hosts on every Node path.
import http from "node:http";
import https from "node:https";
import { describe, expect, it } from "vitest";

import "./network-guard.ts";

describe("server network guard", () => {
  it("refuses fetch to the original project's services and analytics", async () => {
    await expect(fetch("https://accounts.openmausbot.com/healthz")).rejects.toMatchObject({ code: "ERR_SAGAX_BLOCKED_HOST" });
    await expect(fetch("https://us.i.posthog.com/e/")).rejects.toMatchObject({ code: "ERR_SAGAX_BLOCKED_HOST" });
    await expect(fetch("https://raw.githubusercontent.com/milind-soni/openmausbot-teams/main/catalog.json")).rejects.toMatchObject({ code: "ERR_SAGAX_BLOCKED_HOST" });
  });

  it("refuses node:http(s) requests before a socket opens", () => {
    expect(() => https.request("https://cloud.openmausbot.com/")).toThrow(/does not contact/);
    expect(() => https.get({ hostname: "c-1.openmausbot.com", path: "/" })).toThrow(/does not contact/);
    expect(() => http.request({ host: "openmausbot.com:80" })).toThrow(/does not contact/);
  });

  it("leaves loopback alone", async () => {
    const server = http.createServer((_req, res) => res.end("ok"));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as { port: number };
    try {
      expect(await (await fetch(`http://127.0.0.1:${port}/`)).text()).toBe("ok");
    } finally {
      server.close();
    }
  });
});
