import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import type { RequestAuth } from "../auth/request-auth.ts";
import { SECTION_CONTEXT_MAX_BYTES } from "../rooms/section-context.ts";
import { createSectionContextRoutes, type SectionContextRouteDeps } from "./section-context.ts";
import { PASS, type RouteContext } from "./table.ts";

const auth = { kind: "loopback", trust: "owner", scopes: ["admin"] } as unknown as RequestAuth;

function deps(over: Partial<SectionContextRouteDeps> = {}): SectionContextRouteDeps {
  return {
    sections: () => ["Ops"],
    bots: () => [],
    groups: () => [],
    sectionKey: (section) => section ?? "",
    read: () => ({ text: "brief", updatedAt: 1 }),
    write: (_section, text) => ({ text, updatedAt: 2 }),
    ...over,
  };
}

function ctx(path: string, method = "GET", body: unknown = null, query = "?section=Ops") {
  const sent: Array<{ status: number; body: unknown }> = [];
  const context = {
    req: {} as IncomingMessage,
    res: {} as ServerResponse,
    url: new URL(`http://x${path}${query}`),
    path,
    method,
    auth,
    json: ((_res: unknown, status: number, payload: unknown) => { sent.push({ status, body: payload }); }) as RouteContext["json"],
    readBody: (async () => body) as RouteContext["readBody"],
  } satisfies RouteContext;
  return { context, sent };
}

describe("createSectionContextRoutes", () => {
  it("passes foreign paths", async () => {
    const route = createSectionContextRoutes(deps());
    expect(await route(ctx("/api/team-memory").context)).toBe(PASS);
    expect(await route(ctx("/api/section-context", "POST").context)).toBe(PASS);
  });

  it("requires the section query parameter", async () => {
    const route = createSectionContextRoutes(deps());
    const call = ctx("/api/section-context", "GET", null, "");
    await route(call.context);
    expect(call.sent).toEqual([{ status: 400, body: { error: "section is required" } }]);
  });

  it("404s an unknown team", async () => {
    const route = createSectionContextRoutes(deps({ sections: () => [] }));
    const call = ctx("/api/section-context", "GET", null, "?section=Missing");
    await route(call.context);
    expect(call.sent).toEqual([{ status: 404, body: { error: "no such team" } }]);
  });

  it("reads and writes the brief", async () => {
    const write = vi.fn((_section: string, text: string) => ({ text, updatedAt: 9 }));
    const route = createSectionContextRoutes(deps({ write }));
    const get = ctx("/api/section-context");
    await route(get.context);
    expect(get.sent[0]).toEqual({
      status: 200,
      body: {
        section: "Ops",
        label: "Ops",
        text: "brief",
        updatedAt: 1,
        maxBytes: SECTION_CONTEXT_MAX_BYTES,
      },
    });
    const put = ctx("/api/section-context", "PUT", { text: "new" });
    await route(put.context);
    expect(write).toHaveBeenCalledWith("Ops", "new");
    expect(put.sent[0]?.status).toBe(200);
    expect((put.sent[0]?.body as { ok: boolean } | undefined)?.ok).toBe(true);
  });

  it("#2045: stores the brief under the caller's owner/id key", async () => {
    const write = vi.fn((_section: string, text: string) => ({ text, updatedAt: 9 }));
    const read = vi.fn(() => ({ text: "scoped", updatedAt: 4 }));
    const alice = { kind: "session", session: { principalId: "pr_alice" } } as unknown as RequestAuth;
    const bob = { kind: "session", session: { principalId: "pr_bob" } } as unknown as RequestAuth;
    const route = createSectionContextRoutes(deps({
      write,
      read,
      storageKey: (caller, section) => {
        const owner = caller.kind === "session" ? caller.session.principalId : "local";
        return `${owner}/sec_${section === "Ops" ? (owner === "pr_alice" ? "a" : "b") : "x"}`;
      },
    }));
    const alicePut = ctx("/api/section-context", "PUT", { text: "Alice brief" });
    alicePut.context.auth = alice;
    await route(alicePut.context);
    expect(write).toHaveBeenCalledWith("pr_alice/sec_a", "Alice brief");
    const bobGet = ctx("/api/section-context");
    bobGet.context.auth = bob;
    await route(bobGet.context);
    expect(read).toHaveBeenCalledWith("pr_bob/sec_b");
  });

  it("refuses a non-string body on PUT", async () => {
    const route = createSectionContextRoutes(deps());
    const call = ctx("/api/section-context", "PUT", { text: 1 });
    await route(call.context);
    expect(call.sent).toEqual([{ status: 400, body: { error: "text must be a string" } }]);
  });
});
