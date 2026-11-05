import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";

import type { RequestAuth } from "../auth/request-auth.ts";
import { createPeopleAvatarRoutes } from "./people-avatar.ts";
import { PASS, type RouteContext } from "./table.ts";

const auth = { kind: "loopback", trust: "owner" } as unknown as RequestAuth;

function ctx(path: string, method: string, query = "") {
  const sent: Array<{ status: number; body: unknown }> = [];
  const ended: Buffer[] = [];
  const heads: Array<Record<string, string>> = [];
  const context = {
    req: {} as IncomingMessage,
    res: {
      writeHead: (_status: number, headers: Record<string, string>) => { heads.push(headers); },
      end: (buf: Buffer) => { ended.push(buf); },
    } as unknown as ServerResponse,
    url: new URL(`http://x${path}${query}`),
    path,
    method,
    auth,
    json: ((_res: unknown, status: number, payload: unknown) => {
      sent.push({ status, body: payload });
    }) as RouteContext["json"],
    readBody: (async () => null) as RouteContext["readBody"],
  } satisfies RouteContext;
  return { context, sent, ended, heads };
}

describe("createPeopleAvatarRoutes", () => {
  it("passes foreign paths and methods", async () => {
    const route = createPeopleAvatarRoutes({
      principals: { byId: () => null },
      issuer: "iss",
      perspicaxDirectory: {},
    });
    expect(await route(ctx("/api/people/pr_1", "GET").context)).toBe(PASS);
    expect(await route(ctx("/api/people/pr_1/avatar", "POST").context)).toBe(PASS);
  });

  it("serves avatar bytes", async () => {
    const bytes = Buffer.from([1, 2, 3]);
    const route = createPeopleAvatarRoutes({
      principals: {
        byId: () => ({ subject: { iss: "iss", sub: "s" }, avatar: "abc" }),
      },
      issuer: "iss",
      perspicaxDirectory: {
        avatar: vi.fn(async () => ({ contentType: "image/png", bytes })),
      },
    });
    const call = ctx("/api/people/pr_1/avatar", "GET", "?v=abc");
    await route(call.context);
    expect(call.sent).toEqual([]);
    expect(call.ended[0]).toEqual(bytes);
    expect(call.heads[0]?.["content-type"]).toBe("image/png");
  });
});
