import { describe, expect, it } from "vitest";

import { CLIENT_ALLOW } from "../auth/request-auth.ts";
import { expandPattern, fakeId, fillShape, memberRouteShapes, OWNED_KINDS } from "./authz-routes.ts";

const ALL = { orgDirectory: true, orgPairing: true, sharedComputers: true, serverCatalogue: true } as const;

describe("authorization matrix route list (server/auth/authz-matrix.e2e.test.ts)", () => {
  it("expands every CLIENT_ALLOW row and names every id in it", () => {
    // throws, naming the row, on an id SLOT_KINDS does not name
    const shapes = memberRouteShapes(ALL);
    const rows = new Set(shapes.map((s) => s.rule));
    expect(rows.size).toBe(new Set(CLIENT_ALLOW.map((r) => `${r.methods.join(",")} ${r.path.source}`)).size);
  });

  it("each shape, filled with fake ids, is a path its own row accepts", () => {
    const bad = memberRouteShapes(ALL).filter((s) => !s.pattern.test(fillShape(s, () => undefined))).map((s) => `${s.method} ${s.template}`);
    expect(bad).toEqual([]);
  });

  it("expands optional groups and alternations", () => {
    const shapes = expandPattern(String.raw`^\/api\/bots\/[\w-]+\/code\/(?:branch(?:\/(?:diff|pull))?|branches\/archived)$`);
    const text = shapes.map((seq) => seq.map((a) => ("lit" in a ? a.lit : "{id}")).join(""));
    expect(text).toEqual(["/api/bots/{id}/code/branch", "/api/bots/{id}/code/branch/diff", "/api/bots/{id}/code/branch/pull", "/api/bots/{id}/code/branches/archived"]);
  });

  it("aims at something a person owns in most rows", () => {
    const owned = memberRouteShapes(ALL).filter((s) => s.pieces.some((p) => "slot" in p && OWNED_KINDS.has(p.slot.kind)));
    expect(owned.length).toBeGreaterThan(200);
    expect(fakeId({ kind: "person", prefix: "pr_", cls: "[0-9a-f-]{36}" })).toHaveLength(36);
  });
});
