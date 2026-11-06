import { describe, expect, it, vi } from "vitest";
import { createAuthenticate } from "./authenticate.ts";

describe("createAuthenticate", () => {
  it("returns a function", () => {
    const authenticate = createAuthenticate(() => ({}) as any);
    expect(typeof authenticate).toBe("function");
  });

  it("PASS-style pre-auth after resolve ends the request without auth", async () => {
    const json = vi.fn();
    const authenticate = createAuthenticate(() => ({
      resolveRequestAuth: () => ({ auth: null, status: 401, code: "sign_in_required", error: "sign in" }),
      sessions: {},
      SESSION_COOKIE: "sagax",
      desktopMutationToken: undefined,
      companionMutationToken: undefined,
      lendingEnabled: () => false,
      IDENTITY: { kind: "personal" },
      LOOPBACK: { trust: false, localBrowsers: false },
      cliOwnerToken: undefined,
      WORKER_RELAY_TOKEN: undefined,
      sessionPermits: () => false,
      parseCookies: () => new Map(),
      HOSTED_WORKSPACE: false,
      requestOrigin: () => null,
      serializeSessionCookie: () => "",
      cookieMaxAgeSeconds: () => 0,
      dispatchPreAuthRoutes: async () => true,
      PRE_AUTH_AFTER_RESOLVE: [],
      json,
      readBody: async () => ({}),
    } as any));
    const res = { setHeader: vi.fn() } as any;
    const auth = await authenticate({ headers: {} } as any, res, new URL("http://127.0.0.1/api/health"), "/api/health", "GET", { m: null });
    expect(auth).toBeNull();
    expect(json).not.toHaveBeenCalled();
  });
});
