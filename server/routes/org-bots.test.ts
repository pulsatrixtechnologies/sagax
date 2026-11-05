import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";

import type { RequestAuth } from "../auth/request-auth.ts";
import { createOrgBotsRoutes } from "./org-bots.ts";
import { PASS, type RouteContext } from "./table.ts";

const auth = { kind: "loopback", trust: "owner" } as unknown as RequestAuth;

function ctx(path: string, method: string) {
  const sent: Array<{ status: number; body: unknown }> = [];
  const context = {
    req: {} as IncomingMessage,
    res: { setHeader: () => undefined } as unknown as ServerResponse,
    url: new URL(`http://x${path}`),
    path,
    method,
    auth,
    json: ((_res: unknown, status: number, payload: unknown) => {
      sent.push({ status, body: payload });
    }) as RouteContext["json"],
    readBody: (async () => null) as RouteContext["readBody"],
  } satisfies RouteContext;
  return { context, sent };
}

describe("createOrgBotsRoutes", () => {
  it("passes foreign paths and refuses non-GET", async () => {
    const route = createOrgBotsRoutes({
      authzViewerFor: () => ({ orgAdmin: true }),
      store: { bots: [] } as any,
      botFacts: () => ({}),
      visibleGrants: () => null,
      principalTeams: () => [],
      principals: { byId: () => null },
      describeGrantTarget: () => ({ label: "" }),
      wireGrants: () => [],
      engineOfBot: () => ({ instanceId: "", driver: "" }),
      botPublicProfile: () => ({}),
      botRunning: () => false,
    });
    expect(await route(ctx("/api/bots", "GET").context)).toBe(PASS);
    const bad = ctx("/api/org/bots", "POST");
    await route(bad.context);
    expect(bad.sent[0]?.status).toBe(405);
  });

  it("lists bots for an admin viewer", async () => {
    const route = createOrgBotsRoutes({
      authzViewerFor: () => ({ orgAdmin: true }),
      store: { bots: [{ id: "b1", name: "Nova", section: undefined }] },
      botFacts: () => ({ ownerPrincipalId: "pr_1", grants: [] }),
      visibleGrants: () => [],
      principalTeams: () => [],
      principals: { byId: () => ({ id: "pr_1" }) },
      describeGrantTarget: () => ({ label: "Owner" }),
      wireGrants: () => [],
      engineOfBot: () => ({ instanceId: "e1", driver: "openai" }),
      botPublicProfile: () => ({ name: "Nova" }),
      botRunning: () => false,
    });
    const call = ctx("/api/org/bots", "GET");
    await route(call.context);
    expect(call.sent[0]?.status).toBe(200);
    expect((call.sent[0]?.body as { bots: unknown[] }).bots).toHaveLength(1);
  });
});
