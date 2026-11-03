import { describe, expect, it } from "vitest";

import { FakeTailscaleControl, TailscaleControlError, createHttpTailscaleControl } from "./bot-tailscale-control.ts";

describe("FakeTailscaleControl", () => {
  it("mints oauth tokens and auth keys, then lists approved devices", async () => {
    const api = new FakeTailscaleControl();
    const token = await api.exchangeOAuth({ clientId: "cid", clientSecret: "sec" });
    expect(token.accessToken.startsWith("fake-token-")).toBe(true);
    const key = await api.createAuthKey({
      accessToken: token.accessToken,
      keyKind: "ephemeral",
      tags: ["tag:sagax"],
      requireApproval: true,
    });
    expect(key.key.startsWith("tskey-auth-")).toBe(true);
    expect(key.ephemeral).toBe(true);
    const pending = api.enrollPending({ name: "ada-bot" });
    expect(pending.pendingApproval).toBe(true);
    api.approve(pending.id, ["100.64.0.42"]);
    const listed = await api.listDevices(token.accessToken);
    expect(listed).toEqual([expect.objectContaining({
      id: pending.id,
      pendingApproval: false,
      addresses: ["100.64.0.42"],
    })]);
  });

  it("surfaces oauth failures without echoing secrets", async () => {
    const api = new FakeTailscaleControl();
    api.failOAuth = new TailscaleControlError("refused", "oauth_failed", 401);
    await expect(api.exchangeOAuth({ clientId: "cid", clientSecret: "super-secret-value" }))
      .rejects.toMatchObject({ code: "oauth_failed" });
  });
});

describe("createHttpTailscaleControl", () => {
  it("posts oauth and auth-key requests to the control API", async () => {
    const calls: Array<{ url: string; method?: string; auth?: string }> = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({
        url,
        method: init?.method,
        auth: typeof init?.headers === "object" && init.headers && "authorization" in (init.headers as Record<string, string>)
          ? (init.headers as Record<string, string>).authorization
          : undefined,
      });
      if (url.endsWith("/oauth/token")) {
        return new Response(JSON.stringify({ access_token: "tok", expires_in: 60 }), { status: 200 });
      }
      if (url.includes("/keys") && init?.method === "POST") {
        return new Response(JSON.stringify({
          id: "k1",
          key: "tskey-auth-TESTKEY0001",
          capabilities: { devices: { create: { ephemeral: true, reusable: false, tags: ["tag:sagax"] } } },
        }), { status: 200 });
      }
      if (url.includes("/devices") && !init?.method) {
        return new Response(JSON.stringify({
          devices: [{ id: "d1", name: "bot", hostname: "bot", addresses: ["100.64.0.1"], authorized: true, tags: ["tag:sagax"] }],
        }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch;

    const api = createHttpTailscaleControl({ baseUrl: "https://control.test", fetchImpl });
    const oauth = await api.exchangeOAuth({ clientId: "id", clientSecret: "sec" });
    expect(oauth.accessToken).toBe("tok");
    const key = await api.createAuthKey({
      accessToken: oauth.accessToken,
      keyKind: "ephemeral",
      tags: ["tag:sagax"],
    });
    expect(key.key).toBe("tskey-auth-TESTKEY0001");
    const devices = await api.listDevices(oauth.accessToken);
    expect(devices[0]?.addresses).toEqual(["100.64.0.1"]);
    expect(calls.some((c) => c.url.includes("/oauth/token"))).toBe(true);
    expect(JSON.stringify(calls)).not.toMatch(/sec|TESTKEY/i);
  });
});
