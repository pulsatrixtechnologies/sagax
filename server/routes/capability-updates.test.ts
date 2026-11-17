// #4504: GET and POST /api/me/capability-updates: the session's person only,
// the same service for the page and the bots.
import { describe, expect, it } from "vitest";

import { CapabilityUpdates, type UpdateItem, type UpdatePerson } from "../capabilities/capability-updates.ts";
import { createCapabilityUpdatesRoutes } from "./capability-updates.ts";
import { PASS } from "./table.ts";

const items: Record<string, UpdateItem[]> = {
  pr_ada: [{ key: "plugin:me:me:review@acme", kind: "plugin", name: "Review", scope: "me", installedVersion: "1.0.0", availableVersion: "1.1.0", updateAvailable: true, canUpdate: true }],
  pr_bob: [{ key: "skill:bot:bot-b:steps", kind: "skill", name: "steps", scope: "bot", updateAvailable: true, canUpdate: true }],
};

function harness(refuse = false) {
  const updated: Array<[string, string]> = [];
  const service = new CapabilityUpdates({
    providers: [
      { kind: "plugin", items: (person) => (items[person.id] ?? []).filter((row) => row.kind === "plugin"), check: async () => false, update: async (person, item) => { updated.push([person.id, item.key]); } },
      { kind: "skill", items: (person) => (items[person.id] ?? []).filter((row) => row.kind === "skill"), check: async () => false, update: async (person, item) => { updated.push([person.id, item.key]); } },
    ],
  });
  const route = createCapabilityUpdatesRoutes({
    updates: service,
    // the person comes from the session only
    person: (auth) => {
      const principal = (auth as unknown as { principal?: string }).principal;
      return principal ? { id: principal, manager: false } satisfies UpdatePerson : null;
    },
    changeRefusal: () => (refuse ? { status: 403, body: { error: "forbidden", permission: "apps.ownIntegrations" } } : null),
  });
  const call = async (target: string, method: string, principal: string | undefined, body?: unknown) => {
    const sent: Array<{ status: number; body: unknown }> = [];
    const url = new URL(`http://localhost${target}`);
    const out = await route({
      req: { headers: { "content-type": "application/json" } } as never,
      res: { setHeader: () => undefined } as never,
      url, path: url.pathname, method,
      auth: { principal } as never,
      json: ((_: unknown, status: number, payload: unknown) => { sent.push({ status, body: payload }); }) as never,
      readBody: (async () => body) as never,
    });
    return { out, sent: sent[0] };
  };
  return { call, updated };
}

describe("/api/me/capability-updates", () => {
  it("lists the session person's items with the count", async () => {
    const h = harness();
    const { sent } = await h.call("/api/me/capability-updates", "GET", "pr_ada");
    expect(sent).toMatchObject({ status: 200, body: { count: 1, items: [{ key: "plugin:me:me:review@acme", installedVersion: "1.0.0", availableVersion: "1.1.0", updateAvailable: true }] } });
  });

  it("updates one item; another person's key is out of reach", async () => {
    const h = harness();
    const one = await h.call("/api/me/capability-updates", "POST", "pr_ada", { keys: ["plugin:me:me:review@acme"] });
    expect(one.sent).toMatchObject({ status: 200, body: { results: [{ key: "plugin:me:me:review@acme", status: "updated", from: "1.0.0", to: "1.1.0" }] } });
    const theirs = await h.call("/api/me/capability-updates", "POST", "pr_ada", { keys: ["skill:bot:bot-b:steps"] });
    expect(theirs.sent).toMatchObject({ status: 200, body: { results: [{ status: "failed" }] } });
    expect(h.updated).toEqual([["pr_ada", "plugin:me:me:review@acme"]]);
  });

  it("updates all of the person's own", async () => {
    const h = harness();
    await h.call("/api/me/capability-updates", "POST", "pr_bob", { all: true });
    expect(h.updated).toEqual([["pr_bob", "skill:bot:bot-b:steps"]]);
  });

  it("refuses without a person, a malformed body, and a person without apps.ownIntegrations", async () => {
    expect((await harness().call("/api/me/capability-updates", "GET", undefined)).sent).toMatchObject({ status: 403 });
    expect((await harness().call("/api/me/capability-updates", "POST", "pr_ada", { keys: [] })).sent).toMatchObject({ status: 400 });
    expect((await harness().call("/api/me/capability-updates", "POST", "pr_ada", { all: true, keys: ["x"] })).sent).toMatchObject({ status: 400 });
    expect((await harness(true).call("/api/me/capability-updates", "POST", "pr_ada", { all: true })).sent).toMatchObject({ status: 403 });
    expect((await harness().call("/api/me/capability-updates", "DELETE", "pr_ada")).sent).toMatchObject({ status: 405 });
    expect((await harness().call("/api/me/capabilities", "GET", "pr_ada")).out).toBe(PASS);
  });
});
