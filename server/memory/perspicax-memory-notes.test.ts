import { describe, expect, it, vi } from "vitest";

import { MEMORY_READ_PREFIX, PerspicaxMemoryNotesClient, memoryReadPath } from "./perspicax-memory-notes.ts";

describe("perspicax-memory-notes client", () => {
  it("builds read paths under /api/v1/memory/read", () => {
    expect(memoryReadPath("/tree")).toBe(`${MEMORY_READ_PREFIX}/tree`);
    expect(memoryReadPath("/entry", { scope: "me", id: "n1" })).toBe(`${MEMORY_READ_PREFIX}/entry?scope=me&id=n1`);
    expect(memoryReadPath("folder", { scope: "org", name: "ops" })).toBe(`${MEMORY_READ_PREFIX}/folder?scope=org&name=ops`);
  });

  it("sends the person's access token as Bearer, never a link token", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ tiers: [] }), { status: 200, headers: { "content-type": "application/json" } }));
    const accessToken = vi.fn(async () => "person-access-token");
    const client = new PerspicaxMemoryNotesClient({
      baseUrl: () => "https://px.example.test",
      accessToken,
      fetcher: fetcher as unknown as typeof fetch,
    });
    const result = await client.call("pr_alice", "GET", memoryReadPath("/tree"));
    expect(result).toEqual({ ok: true, status: 200, body: { tiers: [] } });
    expect(accessToken).toHaveBeenCalledWith("pr_alice");
    expect(fetcher).toHaveBeenCalledTimes(1);
    const call = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("https://px.example.test/api/v1/memory/read/tree");
    expect(call[1]).toMatchObject({
      method: "GET",
      headers: expect.objectContaining({ authorization: "Bearer person-access-token" }),
    });
    expect(JSON.stringify(call[1]?.headers)).not.toContain("link");
  });

  it("maps a missing token to unauthorized and a network failure to unreachable", async () => {
    const noToken = new PerspicaxMemoryNotesClient({
      baseUrl: () => "https://px.example.test",
      accessToken: async () => null,
      fetcher: vi.fn() as unknown as typeof fetch,
    });
    expect(await noToken.call("pr_x", "GET", memoryReadPath("/tree"))).toEqual({ ok: false, error: "unauthorized" });

    const down = new PerspicaxMemoryNotesClient({
      baseUrl: () => null,
      accessToken: async () => "t",
    });
    expect(await down.call("pr_x", "GET", memoryReadPath("/tree"))).toEqual({ ok: false, error: "unreachable" });

    const boom = new PerspicaxMemoryNotesClient({
      baseUrl: () => "https://px.example.test",
      accessToken: async () => "t",
      fetcher: vi.fn(async () => { throw new Error("offline"); }) as unknown as typeof fetch,
    });
    expect(await boom.call("pr_x", "GET", memoryReadPath("/tree"))).toEqual({ ok: false, error: "unreachable" });
  });

  it("forwards refused status bodies without logging", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ code: "memory_conflict", details: { version: 3 } }), {
      status: 409,
      headers: { "content-type": "application/json" },
    }));
    const client = new PerspicaxMemoryNotesClient({
      baseUrl: () => "https://px.example.test",
      accessToken: async () => "t",
      fetcher: fetcher as unknown as typeof fetch,
    });
    expect(await client.call("pr_a", "PUT", memoryReadPath("/entry"), { scope: "me", id: "n1", body: "x" })).toEqual({
      ok: false,
      error: "refused",
      status: 409,
      body: { code: "memory_conflict", details: { version: 3 } },
    });
  });
});
