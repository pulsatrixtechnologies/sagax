import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "../harness/http.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { createPersonLabelRoutes, personLabelRight, type PersonLabelRight } from "./person-labels.ts";
import { dispatchRoutes } from "./table.ts";

const id = (n: number) => `pr_0000000${n}-0000-4000-8000-000000000000`;
const ALICE = id(1);
const BOB = id(2);
const BOSS = id(3);
const ADMIN = id(4);
const MERGED = id(5);

describe("person labels", () => {
  const servers: Server[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
  });

  async function serve() {
    const people = new Map<string, { id: string; label?: string; teams?: { id: string; manager: boolean }[] }>([
      [ALICE, { id: ALICE }],
      [BOB, { id: BOB, label: "Dispatch", teams: [{ id: "ops", manager: false }] }],
      [BOSS, { id: BOSS, teams: [{ id: "ops", manager: true }] }],
      [ADMIN, { id: ADMIN }],
    ]);
    const changes: Array<{ principalId: string; before: string | null; after: string | null; right: PersonLabelRight }> = [];
    let saveFails = false;
    const routes = [createPersonLabelRoutes({
      caller: (auth) => {
        const who = auth.kind === "session" ? auth.session.principalId ?? null : null;
        const person = who ? people.get(who) : undefined;
        return {
          principalId: who,
          admin: auth.kind === "loopback" || who === ADMIN,
          managedTeamIds: (person?.teams ?? []).filter((team) => team.manager).map((team) => team.id),
        };
      },
      person: (principalId) => people.get(principalId) ?? null,
      labels: () => Object.fromEntries([...people.values()].filter((p) => p.label).map((p) => [p.id, p.label!])),
      save: (principalId, label) => {
        if (saveFails) return false;
        const person = people.get(principalId)!;
        if (label) person.label = label;
        else delete person.label;
        return true;
      },
      changed: ({ principalId, before, after, right }) => { changes.push({ principalId, before, after, right }); },
    })];
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const who = req.headers["x-who"] as string | undefined;
      const auth = (who ? { kind: "session", scopes: ["client"], session: { principalId: who } } : { kind: "loopback", scopes: ["admin"] }) as unknown as RequestAuth;
      const handled = await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody });
      if (!handled) json(res, 404, { from: "inline" });
    });
    servers.push(server);
    await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const put = (who: string | undefined, target: string, body: unknown) =>
      fetch(`${base}/api/people/${target}/label`, { method: "PUT", headers: { "content-type": "application/json", ...(who ? { "x-who": who } : {}) }, body: JSON.stringify(body) })
        .then(async (r) => ({ status: r.status, body: await r.json() as { label?: string | null; code?: string; from?: string } }));
    const labels = (who?: string) => fetch(`${base}/api/people/labels`, { headers: who ? { "x-who": who } : {} }).then((r) => r.json() as Promise<{ labels: Record<string, string> }>);
    return { people, changes, put, labels, failSaves: () => { saveFails = true; } };
  }

  it("lets a person set and clear their own label, trimmed", async () => {
    const h = await serve();
    expect(await h.put(ALICE, ALICE, { label: "  CTO " })).toEqual({ status: 200, body: { principalId: ALICE, label: "CTO" } });
    expect(h.people.get(ALICE)?.label).toBe("CTO");
    expect((await h.labels(BOB)).labels).toEqual({ [ALICE]: "CTO", [BOB]: "Dispatch" });
    expect(await h.put(ALICE, ALICE, { label: "" })).toEqual({ status: 200, body: { principalId: ALICE, label: null } });
    expect(h.people.get(ALICE)?.label).toBeUndefined();
    expect(h.changes).toEqual([
      { principalId: ALICE, before: null, after: "CTO", right: "self" },
      { principalId: ALICE, before: "CTO", after: null, right: "self" },
    ]);
  });

  it("lets an admin change anyone's and a manager their team's people; refuses the others with 403", async () => {
    const h = await serve();
    expect((await h.put(ADMIN, ALICE, { label: "CFO" })).status).toBe(200);
    expect((await h.put(undefined, ALICE, { label: "Ops" })).status).toBe(200);
    expect((await h.put(BOSS, BOB, { label: "Lead" })).status).toBe(200);
    expect(h.changes.map((change) => change.right)).toEqual(["admin", "admin", "manager"]);
    expect(await h.put(BOSS, ALICE, { label: "x" })).toMatchObject({ status: 403, body: { code: "person_label_forbidden" } });
    expect(await h.put(ALICE, BOB, { label: "x" })).toMatchObject({ status: 403, body: { code: "person_label_forbidden" } });
    expect(await h.put(BOB, BOSS, { label: "x" })).toMatchObject({ status: 403, body: { code: "person_label_forbidden" } });
    expect(h.people.get(BOB)?.label).toBe("Lead");
    expect(h.changes).toHaveLength(3);
  });

  it("refuses a bad body, a long or multi-line label and an unknown person; a same label changes nothing", async () => {
    const h = await serve();
    expect(await h.put(ALICE, ALICE, { label: "x".repeat(41) })).toMatchObject({ status: 400, body: { code: "label_too_long" } });
    expect(await h.put(ALICE, ALICE, { label: "a\nb" })).toMatchObject({ status: 400, body: { code: "label_one_line" } });
    expect(await h.put(ALICE, ALICE, { label: 3 })).toMatchObject({ status: 400, body: { code: "label_type" } });
    expect(await h.put(ALICE, ALICE, { title: "CTO" })).toMatchObject({ status: 400, body: { code: "label_type" } });
    expect(await h.put(ALICE, ALICE, { label: "CTO", extra: 1 })).toMatchObject({ status: 400 });
    expect(await h.put(ADMIN, MERGED, { label: "x" })).toMatchObject({ status: 404, body: { code: "unknown_person" } });
    expect(await h.put(BOB, BOB, { label: "Dispatch" })).toEqual({ status: 200, body: { principalId: BOB, label: "Dispatch" } });
    expect(h.changes).toEqual([]);
  });

  it("answers 500 when the label could not be written, and passes other paths", async () => {
    const h = await serve();
    h.failSaves();
    expect((await h.put(ALICE, ALICE, { label: "CTO" })).status).toBe(500);
    expect(h.changes).toEqual([]);
    expect((await h.put(ALICE, "pr_nope", { label: "CTO" })).body).toEqual({ from: "inline" });
  });

  it("names the strongest right", () => {
    const target = { id: BOB, teams: [{ id: "ops" }] };
    expect(personLabelRight({ principalId: BOB, admin: true, managedTeamIds: ["ops"] }, target)).toBe("self");
    expect(personLabelRight({ principalId: ADMIN, admin: true, managedTeamIds: ["ops"] }, target)).toBe("admin");
    expect(personLabelRight({ principalId: BOSS, admin: false, managedTeamIds: ["ops"] }, target)).toBe("manager");
    expect(personLabelRight({ principalId: BOSS, admin: false, managedTeamIds: ["sales"] }, target)).toBeNull();
    expect(personLabelRight({ principalId: null, admin: false, managedTeamIds: [] }, target)).toBeNull();
  });
});
