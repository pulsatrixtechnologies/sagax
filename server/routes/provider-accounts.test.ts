import { describe, expect, it, vi } from "vitest";
import { ProviderAccountsError } from "../engines/provider-accounts.ts";
import { createProviderAccountsRoutes } from "./provider-accounts.ts";

describe("the person's provider routes", () => {
  it("uses only the authenticated owner, decodes compatible ids, returns metadata and refuses anonymous org sessions", async () => {
    const view = { keys: [{ provider: "compat:lab", last4: "abcd" }], servers: [] };
    const accounts = { list: vi.fn(async () => view), setKey: vi.fn(async () => view), setServer: vi.fn(async () => view) };
    const listed = vi.fn(async () => {}), changed = vi.fn(async () => {});
    const handler = createProviderAccountsRoutes({ accounts: accounts as never, listed, changed, owner: (auth) => {
      const principalId = (auth as unknown as { principal?: string }).principal;
      return principalId ? { principalId, sub: `sub-${principalId}` } : null;
    } });
    const call = async (method: string, path: string, body?: unknown, principal = "person-a") => {
      let answer: { status: number; body: unknown } | undefined;
      const header = vi.fn();
      await handler({ method, path, auth: { principal }, req: {}, res: { setHeader: header }, readBody: async () => body,
        json: (_res: unknown, status: number, result: unknown) => { answer = { status, body: result }; } } as never);
      expect(header).toHaveBeenCalledWith("cache-control", "no-store");
      return answer;
    };
    expect(await call("GET", "/api/me/providers")).toEqual({ status: 200, body: view });
    expect(listed).toHaveBeenCalledWith(view, { principalId: "person-a", sub: "sub-person-a" });
    expect(await call("PUT", "/api/me/providers/keys/compat%3Alab", { key: "test-person-key", principalId: "person-b" })).toEqual({ status: 200, body: view });
    expect(accounts.setKey).toHaveBeenCalledWith({ principalId: "person-a", sub: "sub-person-a" }, "compat:lab", "test-person-key");
    expect(changed).toHaveBeenCalledTimes(1);
    expect((await call("DELETE", "/api/me/providers/keys/compat%3Alab", undefined, ""))?.status).toBe(403);
    expect(accounts.setKey).toHaveBeenCalledTimes(1);
    expect((await call("PUT", "/api/me/providers/keys/fish", {}))?.status).toBe(400);
    expect((await call("PUT", "/api/me/providers/keys/%ZZ", { key: "test-person-key" }))?.status).toBe(400);
  });
});

it("returns the organization update code without replacing it with an admin refusal", async () => {
  const handler = createProviderAccountsRoutes({
    accounts: { list: async () => { throw new ProviderAccountsError(409, "Organization update needed", "provider_accounts_update_required"); } } as never,
    owner: () => ({ principalId: "person-a", sub: "subject-a" }),
  });
  const json = vi.fn();
  await handler({ method: "GET", path: "/api/me/providers", auth: {}, req: {}, res: { setHeader: vi.fn() }, json } as never);
  expect(json).toHaveBeenCalledWith(expect.anything(), 409, { error: "Organization update needed", code: "provider_accounts_update_required" });
});
