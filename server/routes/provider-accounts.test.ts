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

describe("GET /api/me/providers/catalog (#4329)", () => {
  const instances = [
    { instanceId: "codex", driverKind: "codex", displayName: "Codex", access: "subscription", snapshot: { state: "available", account: { email: "ada@example.com" } }, models: { options: [{ id: "gpt-6", label: "GPT-6" }] } },
    { instanceId: "chatgpt", driverKind: "codex", displayName: "ChatGPT plan", access: "subscription", snapshot: { state: "available" }, models: { options: [{ id: "gpt-6", label: "GPT-6" }] } },
    { instanceId: "personal-1", driverKind: "openai-compat", displayName: "Home server", access: "api", providerAccount: { provider: "compat:lab", serverId: "lab" }, snapshot: { state: "available" }, models: { options: [{ id: "qwen3", label: "Qwen3" }] } },
  ] as const;
  const call = async (handler: ReturnType<typeof createProviderAccountsRoutes>, auth: unknown = { principal: "person-a" }) => {
    let answer: { status: number; body: unknown } | undefined;
    const result = await handler({ method: "GET", path: "/api/me/providers/catalog", auth, req: {}, res: { setHeader: vi.fn() }, readBody: async () => undefined,
      json: (_res: unknown, status: number, body: unknown) => { answer = { status, body }; } } as never);
    return answer ?? result;
  };

  it("answers one list by provider for the caller's own engines, servers and bots link", async () => {
    const seen: unknown[] = [];
    const handler = createProviderAccountsRoutes({
      accounts: { list: vi.fn(async () => ({ keys: [], servers: [{ instanceId: "lab", name: "Home server", url: "https://lab.example.test/v1", protocol: "anthropic", models: [] }] })) } as never,
      owner: (auth) => ({ principalId: (auth as unknown as { principal: string }).principal, sub: "sub-a" }),
      catalog: {
        instances: async (auth) => { seen.push(auth); return instances as never; },
        botsLink: () => ({ linked: true, enabled: true, orgAllowed: true }),
      },
    });
    const answer = await call(handler) as { status: number; body: { providers: Array<{ id: string; label: string; connections: Array<{ kind: string; label: string; harnesses: Array<{ harness: string; mark: string }> }> }> } };
    expect(answer.status).toBe(200);
    expect(seen).toEqual([{ principal: "person-a" }]);
    expect(answer.body.providers.map((provider) => provider.label)).toEqual(["OpenAI", "SpaceXAI", "Home server"]);
    expect(answer.body.providers[0]!.connections.map((connection) => connection.label)).toEqual(["ada@example.com", "OpenAI"]);
    // the server's protocol comes from the person's accounts; its address never leaves
    expect(answer.body.providers[2]!.connections[0]!.harnesses.find((pair) => pair.harness === "claudeAgent")?.mark).toBe("small");
    expect(JSON.stringify(answer.body)).not.toContain("lab.example.test");
    // the bots link: a connection of the xAI group, an account like a sign-in
    expect(answer.body.providers[1]!.connections.map((connection) => connection.kind)).toEqual(["botsLink"]);
  });

  it("reads a solo server's catalog without an owner, and keeps refusing a session without a personal identity", async () => {
    const handler = createProviderAccountsRoutes({
      accounts: { list: vi.fn(async () => ({ keys: [], servers: [] })) } as never,
      owner: (auth) => ((auth as { solo?: boolean }).solo ? undefined : null),
      catalog: { instances: async () => instances.slice(0, 1) as never },
    });
    const solo = await call(handler, { solo: true }) as { status: number; body: { providers: Array<{ id: string }> } };
    expect(solo.status).toBe(200);
    expect(solo.body.providers.map((provider) => provider.id)).toEqual(["openai"]);
    expect((await call(handler, {}) as { status: number }).status).toBe(403);
  });

  it("serves an Azure resource with the built in runtime only, behind the default address row or a person's server", async () => {
    const rows = [
      { instanceId: "openaiCompat", driverKind: "openai-compat", displayName: "Other", access: "api", snapshot: { state: "available" }, models: { options: [{ id: "deployment-a", label: "deployment-a" }] } },
      { instanceId: "personal-2", driverKind: "openai-compat", displayName: "Team resource", access: "api", providerAccount: { provider: "compat:res", serverId: "res" }, snapshot: { state: "available" }, models: { options: [{ id: "deployment-b", label: "deployment-b" }] } },
      instances[2],
    ];
    const handler = createProviderAccountsRoutes({
      accounts: { list: vi.fn(async () => ({ keys: [], servers: [
        { instanceId: "res", name: "Team resource", url: "https://team-res.openai.azure.com/openai/v1", protocol: "openai", models: [] },
        { instanceId: "lab", name: "Home server", url: "https://lab.example.test/v1", protocol: "openai", models: [] },
      ] })) } as never,
      owner: (auth) => ({ principalId: (auth as unknown as { principal: string }).principal, sub: "sub-a" }),
      catalog: {
        instances: async () => rows as never,
        instanceConfigs: () => ({
          openaiCompat: { driver: "openai-compat", config: { url: "https://res-two.services.ai.azure.com/api/projects/p" } },
          openai: { driver: "openai-compat", config: { url: "https://res-three.openai.azure.com", catalog: "openai" } },
          anthropicRes: { driver: "openai-compat", config: { url: "https://res-four.openai.azure.com", protocol: "anthropic" } },
          codex: { driver: "codex", config: { url: "https://res-five.openai.azure.com" } },
        }),
      },
    });
    const answer = await call(handler) as { status: number; body: { providers: Array<{ id: string; connections: Array<{ harnesses: Array<{ harness: string; mark: string }> }> }> } };
    expect(answer.status).toBe(200);
    const pi = (id: string) => answer.body.providers.find((provider) => provider.id === id)!.connections[0]!.harnesses.find((pair) => pair.harness === "piAgent")?.mark;
    expect(pi("server:openaiCompat")).toBe("no");
    expect(pi("server:res")).toBe("no");
    expect(pi("server:lab")).toBe("works");
    expect(JSON.stringify(answer.body)).not.toContain("azure.com");
  });
});
