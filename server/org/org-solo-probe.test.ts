// #3043 (QA 2026-11-08): a solo server answers the web app's organization
// probe with a quiet 200; without the header GET /api/org stays the 404
// no_organization the phone app and older clients read.
import { describe, expect, it } from "vitest";

import { createSoloOrgRoutes, ORG_PROBE_HEADER } from "./org-routes.ts";

async function get(headers: Record<string, string>) {
  const routes = createSoloOrgRoutes({ state: {} } as never);
  let answer: { status: number; body: unknown } | undefined;
  await routes({
    req: { headers }, res: { setHeader() {} }, path: "/api/org", method: "GET", auth: { kind: "none" },
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
