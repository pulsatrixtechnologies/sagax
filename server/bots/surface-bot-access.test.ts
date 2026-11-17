import { describe, expect, it } from "vitest";

import { surfaceTargetRefused, type SurfaceAccessInput } from "./surface-bot-access.ts";

// Bob's surface bot "sb" holds conversation "t1"; "orion" is an ordinary bot.
const input = (session: SurfaceAccessInput["session"], path: string, adminCard = false): SurfaceAccessInput => ({
  session,
  path,
  surfaceOf: (kind, id) => ((kind === "bots" && id === "sb") || (kind === "threads" && id === "t1") ? { ownerPrincipalId: "pr_bob" } : null),
  openAdminCard: () => adminCard,
});
const BOB = { principalId: "PR_BOB", orgAdmin: false };
const ANN = { principalId: "pr_ann", orgAdmin: true };
const CAT = { principalId: "pr_cat", orgAdmin: false };

describe("lot S1: a surface bot is its person's alone", () => {
  it("answers its person, refuses everyone else, an admin's session included", () => {
    for (const path of ["/api/bots/sb", "/api/bots/sb/messages", "/api/bots/sb/workspace", "/api/threads/t1/messages", "/api/threads/t1"]) {
      expect(surfaceTargetRefused(input(BOB, path)), path).toBe(false);
      expect(surfaceTargetRefused(input(ANN, path)), path).toBe(true);
      expect(surfaceTargetRefused(input(CAT, path)), path).toBe(true);
    }
    // another bot, another route, the loopback: untouched
    expect(surfaceTargetRefused(input(ANN, "/api/bots/orion/messages"))).toBe(false);
    expect(surfaceTargetRefused(input(ANN, "/api/routines"))).toBe(false);
    expect(surfaceTargetRefused(input(null, "/api/bots/sb/messages"))).toBe(false);
  });
  it("lets an organization admin answer the server command card the existing rule gives them, and nothing else", () => {
    expect(surfaceTargetRefused(input(ANN, "/api/threads/t1/respond", true))).toBe(false);
    expect(surfaceTargetRefused(input(ANN, "/api/threads/t1/respond", false))).toBe(true);
    expect(surfaceTargetRefused(input(ANN, "/api/threads/t1/messages", true))).toBe(true);
    // a member who is not an admin never answers it
    expect(surfaceTargetRefused(input(CAT, "/api/threads/t1/respond", true))).toBe(true);
  });
});
