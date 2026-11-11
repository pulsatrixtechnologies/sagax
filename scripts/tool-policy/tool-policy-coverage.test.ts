// B1: every route the server answers has a policy row (server/tools/tool-policy.ts).
// A new route fails here until `node scripts/tool-policy/generate.ts` writes
// its row and the row is reviewed.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { routeInventory } from "./route-inventory.ts";
import { classifyRoute, personalRoute, policyFor, policyKey, toolPolicyRows, UNKNOWN_ROUTE_POLICY } from "../../server/tools/tool-policy.ts";

const root = fileURLToPath(new URL("../..", import.meta.url));
const inventory = routeInventory(root);
const rows = toolPolicyRows();
const keys = new Set(rows.map(policyKey));

describe("tool policy coverage", () => {
  it("finds the server's routes", () => {
    expect(inventory.length).toBeGreaterThan(300);
  });

  it("still lists the hang-up route extracted from index.ts", () => {
    expect(inventory.map(policyKey)).toContain("POST exact /api/internal/voice-call/end");
  });

  it("has a policy row for every route", () => {
    const missing = inventory.filter((r) => !keys.has(policyKey(r))).map((r) => `${policyKey(r)}  (${r.file}:${r.line})`);
    expect(missing, "run: node scripts/tool-policy/generate.ts, then review the new rows").toEqual([]);
  });

  it("has no row for a route that is gone", () => {
    const live = new Set(inventory.map(policyKey));
    expect(rows.filter((r) => !live.has(policyKey(r))).map(policyKey), "run: node scripts/tool-policy/generate.ts").toEqual([]);
  });

  it("declares a tier, readOnly and a scope on every row; admin is never on by default", () => {
    const bad = rows.filter((r) => !["read", "write", "admin"].includes(r.tier) || typeof r.readOnly !== "boolean"
      || !/^[a-z0-9-]+:(read|write|admin)$/.test(r.scope) || (r.tier === "admin" && r.defaultEnabled)
      || ((r.destructive || r.billing) && r.tier !== "admin" && !personalRoute(r.route)) || (r.readOnly && r.method !== "GET"));
    expect(bad.map(policyKey)).toEqual([]);
  });

  it("classifies by method and area", () => {
    expect(classifyRoute("GET", "/api/bots")).toMatchObject({ tier: "read", readOnly: true, scope: "bots:read", defaultEnabled: true });
    expect(classifyRoute("POST", "/api/bots")).toMatchObject({ tier: "write", readOnly: false });
    expect(classifyRoute("ANY", "/api/routines")).toMatchObject({ tier: "write", readOnly: false });
    expect(classifyRoute("DELETE", "/api/routines/")).toMatchObject({ tier: "admin", destructive: true, defaultEnabled: false });
    expect(classifyRoute("GET", "/api/org/members")).toMatchObject({ tier: "admin", defaultEnabled: false });
    expect(classifyRoute("POST", "^\\/api\\/billing\\/checkout$")).toMatchObject({ tier: "admin", billing: true, defaultEnabled: false });
  });

  it("marks a deletion of the person's own resource owner-scoped, never an org, admin, billing or rights route", () => {
    for (const [method, route] of [
      ["DELETE", "^\\/api\\/bots\\/([\\w-]+)$"],
      ["DELETE", "^\\/api\\/bots\\/([\\w-]+)\\/workspace\\/file$"],
      ["DELETE", "^\\/api\\/bots\\/([\\w-]+)\\/projects(?:\\/([\\w-]+))?$"],
      ["DELETE", "^\\/api\\/bots\\/([\\w-]+)\\/queue\\/([\\w-]+)$"],
      ["DELETE", "^\\/api\\/webhooks\\/([\\w-]+)(\\/rotate)?$"],
      ["DELETE", "/api/routine-runs"],
      // #3283: the rest of what a member owns
      ["DELETE", "^\\/api\\/bots\\/([\\w-]+)\\/direct-grants\\/([^/]+)$"],
      ["DELETE", "^\\/api\\/bots\\/([\\w-]+)\\/command-allowlist(?:\\/([\\w-]+))?$"],
      ["DELETE", "^\\/api\\/bots\\/([\\w-]+)\\/workspace\\/entry$"],
      ["DELETE", "^\\/api\\/bots\\/([\\w-]+)\\/tasks\\/([\\w-]+)$"],
      ["DELETE", "^\\/api\\/bots\\/([\\w-]+)\\/task-list\\/(task_[A-Za-z0-9_-]+)$"],
      ["DELETE", "^\\/api\\/bots\\/[\\w-]+\\/rules\\/sets\\/([a-z0-9-]+)$"],
      ["DELETE", "^\\/api\\/groups\\/([\\w-]+)$"],
      ["DELETE", "^\\/api\\/groups\\/([\\w-]+)\\/queue\\/([\\w-]+)$"],
      ["DELETE", "^\\/api\\/groups\\/([\\w-]+)\\/tasks\\/([\\w-]+)$"],
      ["DELETE", "^\\/api\\/groups\\/[\\w-]+\\/projects\\/[\\w-]+$"],
      ["DELETE", "^\\/api\\/groups\\/[\\w-]+\\/tasks\\/[\\w-]+$"],
    ] as const) {
      expect(classifyRoute(method, route), route).toMatchObject({ tier: "admin", defaultEnabled: false, ownerScoped: true });
    }
    for (const [method, route] of [
      ["ANY", "^\\/api\\/bots\\/([\\w-]+)\\/tool-grants\\/(tg_[\\w-]+)\\/revoke$"],
      ["ANY", "^\\/api\\/me\\/tool-grants\\/(tg_[\\w-]+)\\/revoke$"],
      ["DELETE", "^\\/api\\/team-memory\\/([\\w-]+)$"],
      ["DELETE", "^\\/api\\/auth\\/sessions\\/([\\w-]+)$"],
      ["POST", "^\\/api\\/computers\\/vps\\/([\\w-]+)\\/remove$"],
      ["ANY", "^\\/api\\/org\\/invites\\/([^/]+)\\/revoke$"],
      ["GET", "/api/org/members"],
      ["POST", "^\\/api\\/billing\\/checkout$"],
      ["DELETE", "/api/keys/1"],
    ] as const) {
      expect(classifyRoute(method, route).ownerScoped, route).toBeUndefined();
    }
    // The reviewed table predates the field: the request reads it from the route.
    expect(policyFor("DELETE", "/api/bots/bot-1")).toMatchObject({ tier: "admin", ownerScoped: true, matched: true });
    expect(policyFor("DELETE", "/api/bots/bot-1/workspace/file")).toMatchObject({ tier: "admin", ownerScoped: true });
    expect(policyFor("DELETE", "/api/webhooks/wh-1")).toMatchObject({ ownerScoped: true });
    expect(policyFor("DELETE", "/api/bots/bot-1/direct-grants/pr_bob")).toMatchObject({ tier: "admin", ownerScoped: true });
    expect(policyFor("DELETE", "/api/groups/room-1")).toMatchObject({ tier: "admin", ownerScoped: true });
    expect(policyFor("DELETE", "/api/groups/room-1/tasks/t-1")).toMatchObject({ tier: "admin", ownerScoped: true });
    expect(policyFor("POST", "/api/bots/bot-1/tool-grants/tg_1/revoke").ownerScoped).toBeUndefined();
    expect(policyFor("DELETE", "/api/team-memory/m-1").ownerScoped).toBeUndefined();
  });

  it("treats an unknown route as a write, off by default", () => {
    expect(policyFor("GET", "/api/definitely-not-a-route")).toEqual({ ...UNKNOWN_ROUTE_POLICY, matched: false });
    expect(UNKNOWN_ROUTE_POLICY).toMatchObject({ tier: "write", readOnly: false, defaultEnabled: false });
  });

  it("matches a request to its most specific row", () => {
    expect(policyFor("GET", "/api/bots")).toMatchObject({ matched: true, tier: "read" });
    expect(policyFor("DELETE", "/api/bots/abc")).toMatchObject({ matched: true, tier: "admin" });
  });
});

it.each(["/api/me/providers/keys/openai", "/api/me/providers/servers/lab", "/api/me/voice-keys/fish"])("keeps personal provider deletion available to its person: %s", (path) => {
  expect(classifyRoute("DELETE", path)).toMatchObject({ tier: "write", scope: "me:write", defaultEnabled: true, destructive: true });
});

// 2026-11-03 (audit N-2): the generator still imported ./tool-policy-types.ts
// after the regroup moved it to server/tools/, so the next regeneration broke
// the typecheck. Its output must be the reviewed table, byte for byte.
it("regenerates the reviewed table as it is, with imports that resolve", () => {
  const dir = mkdtempSync(join(tmpdir(), "tool-policy-"));
  try {
    const out = join(dir, "tool-policy.generated.ts");
    const run = spawnSync(process.execPath, [fileURLToPath(new URL("./generate.ts", import.meta.url))], {
      env: { ...process.env, TOOL_POLICY_OUT: out }, encoding: "utf8",
    });
    expect(run.status, run.stderr).toBe(0);
    // the reviewed table as git holds it (LF): a Windows checkout hands it CRLF
    expect(readFileSync(out, "utf8")).toBe(readFileSync(join(root, "server", "tool-policy.generated.ts"), "utf8").replace(/\r\n/g, "\n"));
    for (const [, spec] of readFileSync(out, "utf8").matchAll(/from "(\.[^"]+)"/g)) {
      expect(existsSync(join(root, "server", spec!)), spec).toBe(true);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
