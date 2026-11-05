import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";

import type { RequestAuth } from "../auth/request-auth.ts";
import { createRoutineDelegationStubRoutes } from "./routine-delegation-stub.ts";
import { PASS, type RouteContext } from "./table.ts";

const auth = { kind: "loopback", trust: "owner" } as unknown as RequestAuth;

function ctx(path: string) {
  const sent: Array<{ status: number; body: unknown }> = [];
  const context = {
    req: {} as IncomingMessage,
    res: {} as ServerResponse,
    url: new URL(`http://x${path}`),
    path,
    method: "GET",
    auth,
    json: ((_res: unknown, status: number, payload: unknown) => {
      sent.push({ status, body: payload });
    }) as RouteContext["json"],
    readBody: (async () => null) as RouteContext["readBody"],
  } satisfies RouteContext;
  return { context, sent };
}

describe("createRoutineDelegationStubRoutes", () => {
  it("refuses the org route on a non-Perspicax server and passes others", async () => {
    const route = createRoutineDelegationStubRoutes();
    const call = ctx("/api/org/routine-delegation");
    await route(call.context);
    expect(call.sent[0]).toEqual({
      status: 403,
      body: { error: "This server does not sign people in with Pulsatrix.", code: "identity_perspicax" },
    });
    expect(await route(ctx("/api/bots").context)).toBe(PASS);
  });
});
