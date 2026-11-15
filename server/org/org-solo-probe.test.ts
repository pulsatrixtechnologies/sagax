// #3043 (QA 2026-11-08): a solo server answers the web app's organization
// probe with a quiet 200; without the header GET /api/org stays the 404
// no_organization the phone app and older clients read.
import { describe, expect, it } from "vitest";

import { createSoloOrgRoutes, ORG_PROBE_HEADER } from "./org-routes.ts";

async function get(headers: Record<string, string>, path = "/api/org") {
  const routes = createSoloOrgRoutes({ state: {} } as never);
  let answer: { status: number; body: unknown } | undefined;
  await routes({
    req: { headers }, res: { setHeader() {} }, path, method: "GET", auth: { kind: "none" },
    json: (_res: unknown, status: number, body: unknown) => { answer = { status, body }; },
  } as never);
  return answer!;
}

describe("solo GET /api/org", () => {
  it("answers the probe with 200 { org: null } and everyone else with 404 no_organization", async () => {
    expect(await get({ [ORG_PROBE_HEADER]: "1" })).toEqual({ status: 200, body: { org: null, code: "no_organization" } });
    expect(await get({})).toMatchObject({ status: 404, body: { code: "no_organization" } });
  });
});

// #4360: the app asks a solo server whether its owner is alone
// (src/lib/server-alone.ts) through the sign-in directory. A server with no
// directory yet answers that probe with a quiet, empty 200, never a failed
// request in the console; without the header it stays 404 no_organization.
describe("solo GET /api/org/invites with no directory", () => {
  it("answers the probe with an empty 200 and everyone else with 404 no_organization", async () => {
    expect(await get({ [ORG_PROBE_HEADER]: "1" }, "/api/org/invites")).toEqual({
      status: 200,
      body: { org: null, people: [], pendingInvites: [], code: "no_organization" },
    });
    expect(await get({}, "/api/org/invites")).toMatchObject({ status: 404, body: { code: "no_organization" } });
  });
});
