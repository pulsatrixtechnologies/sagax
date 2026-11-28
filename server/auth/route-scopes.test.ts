// #4471: a member typed a password on a secret request card of their own bot
// and got "forbidden: this session lacks the admin scope". Every route nobody
// had listed for members fell to admin scope in silence. Now each route of the
// server is classed: the person's own (CLIENT_ALLOW), opened by a permission
// (PERMISSION_ROUTES), or held in server/auth/admin-routes.ts with its reason.
import type { IncomingMessage } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { judgeRoute, NOT_ROUTE_METHODS, routeScopeTable, scopeOf, unclassedForms } from "../../scripts/tool-policy/route-scopes.ts";
import { routeInventory } from "../../scripts/tool-policy/route-inventory.ts";
import { routeSamples } from "../../scripts/tool-policy/route-sample.ts";
import { readFileSync } from "node:fs";
import { ADMIN_ONLY_PREFIX, ADMIN_ROUTE_CODE, ADMIN_ROUTES, OTHER_AUTH_ROUTES, adminOnlyRefusal } from "./admin-routes.ts";
import { clientRouteOwnerBot, requiredScope, resolveRequestAuth } from "./request-auth.ts";
import { SessionRegistry } from "./sessions.ts";

const root = fileURLToPath(new URL("../..", import.meta.url));
const ORG = { orgDirectory: true, orgPairing: true };

describe("a member's own secret request card (#4471)", () => {
  // The card of the report: a login the bot's commands read from a private
  // file for 24 hours (delivery "file"), or by reference; a key saved in
  // Settings; the paired phone's sealed entry.
  it.each([
    ["POST", "/api/bots/b-1/secret-cards/m-1/save"],
    ["POST", "/api/bots/b-1/secret-cards/m-1/provided"],
    ["POST", "/api/bots/b-1/secret-cards/m-1/provide"],
    ["POST", "/api/bots/b-1/secret-cards/m-1/resume"],
    ["POST", "/api/bots/b-1/secret-cards/m-1/dismiss"],
    ["POST", "/api/bots/b-1/vault-cards/m-1/self-start"],
    ["POST", "/api/bots/b-1/vault-cards/m-1/self-status"],
    ["POST", "/api/bots/b-1/vault-cards/m-1/signed-in"],
  ])("is the person's own route: %s %s", (method, path) => {
    expect(requiredScope(method, path, ORG)).toBe("client");
    expect(requiredScope(method, path, {})).toBe("client");
  });

  let dir = "";
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ""; });

  it("lets a member's session save the value instead of refusing it", () => {
    dir = mkdtempSync(join(tmpdir(), "route-scopes-"));
    const sessions = new SessionRegistry({ file: join(dir, "sessions.json") });
    const member = sessions.issue({ label: "browser", scopes: ["client"] });
    const req = { method: "POST", headers: { host: "bots.example.com", authorization: `Bearer ${member.token}` }, socket: { remoteAddress: "127.0.0.1" } } as unknown as IncomingMessage;
    const gate = resolveRequestAuth(req, { sessions, cookieName: "c", streamPath: "/api/events", url: new URL("/api/bots/b-1/secret-cards/m-1/save", "http://x"), features: ORG });
    expect(gate.error).toBe("");
    expect(gate.auth?.kind).toBe("session");
  });
});

describe("every route of the server is classed (#4471)", () => {
  const table = routeScopeTable(root);

  it("reads the server's routes", () => {
    expect(table.length).toBeGreaterThan(300);
  });

  it("has no route that falls to admin without a reason", () => {
    const unclassed = table.filter((row) => !row.classed).map((row) => `${unclassedForms(row.route, row.scopes).join(", ") || `${row.route.method} ${row.samples[0]}`}  (${row.route.file}:${row.route.line})`);
    expect(unclassed, "class each route: CLIENT_ALLOW for what a person does for themselves or their own bots, else ADMIN_ROUTES or OTHER_AUTH_ROUTES with the reason (server/auth/admin-routes.ts)").toEqual([]);
  });

  it("judges each method a route is guarded with, not the route as a whole", () => {
    // a new PUT next to a member's GET would fall to admin in silence: the
    // GET being classed does not class it
    const put = judgeRoute({ kind: "exact", route: "/api/me/blocks", method: "PUT", file: "server/routes/x.ts", line: 1 }, ["/api/me/blocks"]);
    expect(put.classed).toBe(false);
    expect(judgeRoute({ kind: "exact", route: "/api/me/blocks", method: "GET", file: "server/routes/x.ts", line: 1 }, ["/api/me/blocks"]).classed).toBe(true);
    // a route the inventory reads no method for answers only some of them
    expect(judgeRoute({ kind: "exact", route: "/api/me/blocks", method: "ANY", file: "server/routes/x.ts", line: 1 }, ["/api/me/blocks"]).classed).toBe(true);
  });

  // review of #4471: the sample took only the first branch, so the other
  // branches of an alternation were never asked about
  it("judges every branch of an alternation and every optional part", () => {
    expect(routeSamples("pattern", "^\\/api\\/x\\/(a|b)$")).toEqual(["/api/x/a", "/api/x/b"]);
    expect(routeSamples("pattern", "^\\/api\\/x(?:\\/(c|d))?\\/e$")).toEqual(["/api/x/e", "/api/x/c/e", "/api/x/d/e"]);
    // a pattern like (a|b) where only a is classed fails: GET /api/me/blocks
    // is a member's, /api/me/nothing-here is in no list
    const route = { kind: "pattern" as const, route: "^\\/api\\/me\\/(blocks|nothing-here)$", method: "GET" as const, file: "server/routes/x.ts", line: 1 };
    const row = judgeRoute(route, routeSamples(route.kind, route.route)!);
    expect(row.classed).toBe(false);
    expect(unclassedForms(route, row.scopes)).toEqual(["GET /api/me/nothing-here"]);
    const any = { ...route, method: "ANY" as const };
    expect(unclassedForms(any, judgeRoute(any, routeSamples(any.kind, any.route)!).scopes)).toEqual(["ANY /api/me/nothing-here"]);
  });

  // desktop-bridge routes are the person's own computer, never admin by default
  it.each([
    ["POST", "/api/desktop-bridge/00000000-0000-0000-0000-000000000000/progress"],
    ["POST", "/api/desktop-bridge/00000000-0000-0000-0000-000000000000/mac-apps"],
    ["POST", "/api/desktop-bridge/00000000-0000-0000-0000-000000000000/local-models"],
    ["POST", "/api/me/desktop-bridge/computers/access"],
  ])("opens the person's own desktop route %s %s", (method, path) => {
    expect(requiredScope(method, path, ORG)).toBe("client");
  });

  it("keeps only the method noise the inventory still reads", () => {
    const unclassedRead = new Set(table.flatMap((row) => {
      const methods = new Set(row.scopes.map(({ method }) => method));
      const forms = row.samples.flatMap((sample) => row.route.method === "ANY"
        ? (row.scopes.some((s) => s.sample === sample && s.scope.kind !== "unclassed") ? [] : [`ANY ${sample}`])
        : [...methods].filter((method) => row.scopes.some((s) => s.sample === sample && s.method === method && s.scope.kind === "unclassed")).map((method) => `${method} ${sample}`));
      return forms;
    }));
    const stale = Object.keys(NOT_ROUTE_METHODS).filter((key) => !unclassedRead.has(key));
    expect(stale).toEqual([]);
  });

  it("holds a route as an administrator's only with a reason in plain words", () => {
    for (const rule of [...ADMIN_ROUTES, ...OTHER_AUTH_ROUTES]) {
      expect(rule.reserved.length, String(rule.path)).toBeGreaterThan(20);
      expect(rule.reserved, String(rule.path)).not.toMatch(/scope|[–—]/);
    }
  });

  it("gives each held rule the app's sentence, in English and in French", () => {
    const en = JSON.parse(readFileSync(join(root, "src/locales/en.json"), "utf8")) as Record<string, string>;
    const fr = JSON.parse(readFileSync(join(root, "src/locales/fr.json"), "utf8")) as Record<string, string>;
    for (const rule of [...ADMIN_ROUTES, ...OTHER_AUTH_ROUTES]) {
      expect(rule.key, String(rule.path)).toMatch(/^serverError\.adminRoute\.[a-zA-Z]+$/);
      expect(en[rule.key], rule.key).toBe(`${ADMIN_ONLY_PREFIX}: ${rule.reserved}.`);
      expect(fr[rule.key], rule.key).toMatch(/^Seul un administrateur peut faire ça : /);
    }
    expect(new Set([...ADMIN_ROUTES, ...OTHER_AUTH_ROUTES].map((rule) => rule.key)).size).toBe(ADMIN_ROUTES.length + OTHER_AUTH_ROUTES.length);
  });

  it("keeps no held rule that no route of the server matches", () => {
    const samples = routeInventory(root).flatMap((route) => routeSamples(route.kind, route.route) ?? []);
    const stale = [...ADMIN_ROUTES, ...OTHER_AUTH_ROUTES].filter((rule) => !samples.some((sample) => rule.path.test(sample))).map((rule) => String(rule.path));
    expect(stale).toEqual([]);
  });

  it("keeps the organization, the shared server and its billing an administrator's", () => {
    for (const [method, path] of [
      ["PATCH", "/api/org"],
      ["POST", "/api/org/invites"],
      ["GET", "/api/admin/remote-sessions"],
      ["POST", "/api/workspace-backup/restore"],
      ["PUT", "/api/me/spend-cap"],
      ["POST", "/api/bots/b-1/computer/provision"],
      ["POST", "/api/tool-grants"],
      ["GET", "/api/decisions"],
    ] as const) {
      expect(requiredScope(method, path, ORG), `${method} ${path}`).toBe("admin");
      expect(scopeOf(method, path).kind, `${method} ${path}`).toBe("admin");
    }
  });
});

describe("the refusal of an administrator's route (#4471)", () => {
  it("says in plain words what is reserved and why, never a scope", () => {
    const refusal = adminOnlyRefusal("PATCH", "/api/org");
    // its own code: a handler's admin_only refusal keeps its own meaning
    expect(refusal.code).toBe(ADMIN_ROUTE_CODE);
    expect(ADMIN_ROUTE_CODE).not.toBe("admin_only");
    expect(refusal.reasonKey).toBe("serverError.adminRoute.orgSettings");
    expect(refusal.error.startsWith(ADMIN_ONLY_PREFIX)).toBe(true);
    expect(refusal.error).toContain("everyone in it");
    expect(refusal.error).not.toMatch(/scope/);
    // a path no list names still reads plainly
    expect(adminOnlyRefusal("GET", "/api/not-a-route").error).not.toMatch(/scope/);
    expect(adminOnlyRefusal("GET", "/api/not-a-route").reasonKey).toBeUndefined();
  });
});

describe("a bot route a handler does not check itself (#4471)", () => {
  it("names the bot the gate checks the person owns", () => {
    expect(clientRouteOwnerBot("GET", "/api/bots/b-1/computer")).toBe("b-1");
    expect(clientRouteOwnerBot("DELETE", "/api/bots/b-1/saved-steps/r-1")).toBe("b-1");
    // a SOUL.md file proposal and the send state's Fix (it changes the Codex
    // account the bot's turns run on) are the bot owner's, not a user's
    expect(clientRouteOwnerBot("POST", "/api/bots/b-1/soul/apply-file")).toBe("b-1");
    expect(clientRouteOwnerBot("POST", "/api/bots/b-1/soul/discard-file")).toBe("b-1");
    expect(clientRouteOwnerBot("POST", "/api/bots/b-1/send-state/fix")).toBe("b-1");
    // the send state itself is read by anyone who may write to the bot
    expect(clientRouteOwnerBot("GET", "/api/bots/b-1/send-state")).toBeNull();
    expect(clientRouteOwnerBot("POST", "/api/bots/b-1/secret-cards/m-1/save")).toBeNull();
    expect(clientRouteOwnerBot("POST", "/api/bots/b-1/messages")).toBeNull();
  });
});
