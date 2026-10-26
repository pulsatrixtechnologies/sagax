// The desktop's key runs in the system browser (2026-10-18): the app opens
// the ceremony page through its bridge, then asks the ceremony's status.
import { afterEach, describe, expect, it, vi } from "vitest";

import { registerSecurityKey, securityKeyInBrowser, securityKeysUsable, waitForCeremony } from "./step-up-client";
import { signInAgainPath } from "./sign-in-again";

const ID = "a".repeat(43);
const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => {
  vi.unstubAllGlobals();
});

function desktop(statuses: string[]) {
  const calls: string[] = [];
  const opened: string[] = [];
  let returned = 0;
  vi.stubGlobal("location", { hostname: "127.0.0.1", protocol: "http:" });
  vi.stubGlobal("window", { isSecureContext: true, PublicKeyCredential: function () {}, ogb: { securityKey: {
    open: async (pageUrl: string) => { opened.push(pageUrl); return { ok: true }; },
    returned: async () => { returned++; return true; },
  } } });
  vi.stubGlobal("navigator", { credentials: {} });
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${path}`);
    if (path === "/api/security-keys/register") {
      expect(JSON.parse(String(init?.body))).toMatchObject({ name: "Mac", via: "desktop-window" });
      return answer(200, { ceremonyId: ID, kind: "register", rpId: "localhost", options: {}, expiresAt: Date.now() + 120_000, pageUrl: `/api/security-keys/ceremony/${ID}/page` });
    }
    if (path.endsWith("/status")) return answer(200, { status: statuses.shift() ?? "waiting" });
    return answer(404, {});
  }));
  return { calls, opened, returned: () => returned };
}

describe("security keys in the desktop app", () => {
  it("opens the ceremony in the system browser and waits for its end", async () => {
    const bridge = desktop(["waiting", "waiting", "done"]);
    expect(securityKeysUsable()).toBe(true);
    expect(securityKeyInBrowser()).toBe(true);
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const done = registerSecurityKey("Mac");
    await vi.runAllTimersAsync();
    await done;
    vi.useRealTimers();
    expect(bridge.opened).toEqual([`/api/security-keys/ceremony/${ID}/page`]);
    expect(bridge.calls.filter((call) => call.endsWith("/status"))).toHaveLength(3);
    expect(bridge.returned()).toBe(1);
  });

  it("a failed or expired ceremony throws in the person's words", async () => {
    desktop(["failed"]);
    await expect(registerSecurityKey("Mac")).rejects.toMatchObject({ code: "failed" });
  });

  it("a first key with an old sign-in is refused with its own code", async () => {
    desktop([]);
    vi.stubGlobal("fetch", vi.fn(async () => answer(403, { error: "Sign in again, then add your first key.", code: "reauth_required" })));
    await expect(registerSecurityKey("Mac")).rejects.toMatchObject({ code: "reauth_required" });
  });

  it("stops waiting when asked, and gives up after the ceremony's end", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => answer(200, { status: "waiting" })));
    const stop = new AbortController();
    stop.abort();
    expect(await waitForCeremony(ID, Date.now() + 60_000, stop.signal, 1)).toBe("cancelled");
    expect(await waitForCeremony(ID, Date.now() - 10_000, undefined, 1)).toBe("expired");
  });

  it("Sign in again is the server's forced Pulsatrix sign-in, else nothing (an email code never counts)", async () => {
    expect(await signInAgainPath(async () => answer(200, { identity: { kind: "perspicax", protocol: "oidc", issuer: "https://id.example.com", loginPath: "/auth/oidc/start" } }))).toBe("/auth/oidc/start?fresh=1");
    expect(await signInAgainPath(async () => answer(200, { capabilities: {} }))).toBeNull();
    expect(await signInAgainPath(async () => { throw new Error("offline"); })).toBeNull();
    expect(await signInAgainPath(async () => answer(500, {}))).toBeNull();
    expect(await signInAgainPath(async () => answer(200, { identity: { kind: "perspicax", loginPath: "//evil.example.com" } }))).toBeNull();
  });
});
