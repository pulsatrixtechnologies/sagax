import { describe, expect, it } from "vitest";
import { ApiError } from "@/state/store";
import { canManageTeamMap, teamMapMutationError } from "./team-map-access";
import { t } from "@/lib/i18n";

describe("canManageTeamMap", () => {
  it("lets an admin session manage teams on a solo server", () => {
    expect(canManageTeamMap({ kind: "session", id: "s", label: "Mac", scopes: ["admin", "client"], expiresAt: 1 })).toBe(true);
    expect(canManageTeamMap({ kind: "loopback" })).toBe(true);
  });

  it("refuses a member session on a solo server, a chat-only device and a remote client", () => {
    expect(canManageTeamMap({ kind: "session", id: "s", label: "Phone", scopes: ["client"], expiresAt: 1 })).toBe(false);
    expect(canManageTeamMap({ kind: "loopback", trust: "service" })).toBe(false);
    expect(canManageTeamMap({ kind: "session", id: "s", label: "Mac", scopes: ["admin", "client"], expiresAt: 1 }, true)).toBe(false);
    expect(canManageTeamMap(null)).toBe(false);
  });

  it("#2045: on an organization server a member manages their own teams", () => {
    expect(canManageTeamMap({ kind: "session", id: "s", label: "Phone", scopes: ["client"], expiresAt: 1 }, false, true)).toBe(true);
    expect(canManageTeamMap({ kind: "loopback" }, false, true)).toBe(true);
    expect(canManageTeamMap({ kind: "loopback", trust: "service" }, false, true)).toBe(false);
    expect(canManageTeamMap({ kind: "session", id: "s", label: "Phone", scopes: ["client"], expiresAt: 1 }, true, true)).toBe(false);
    expect(canManageTeamMap(null, false, true)).toBe(false);
  });
});

describe("teamMapMutationError", () => {
  it("replaces the raw admin-scope refusal with the team admin sentence", () => {
    const refusal = new ApiError("forbidden: this session lacks the admin scope", 403, {
      error: "forbidden: this session lacks the admin scope",
    });
    expect(teamMapMutationError(refusal)).toBe(t("team.adminOnly"));
    expect(teamMapMutationError(refusal)).not.toMatch(/admin scope|forbidden/i);
  });

  // #4471: the gate now refuses an admin-only route with code admin_route
  it("replaces the gate's admin_route refusal with the team admin sentence", () => {
    const refusal = new ApiError("Only an administrator can do this on this server.", 403, {
      error: "Only an administrator can do this on this server. Ask an administrator if you need it.",
      code: "admin_route",
    });
    expect(teamMapMutationError(refusal)).toBe(t("team.adminOnly"));
    // a handler's own admin_only refusal keeps its own words
    const handler = new ApiError("Restoring a backup stays an admin's.", 403, { error: "Restoring a backup stays an admin's.", code: "admin_only" });
    expect(teamMapMutationError(handler)).not.toBe(t("team.adminOnly"));
  });

  it("keeps a plain sentence from another failure", () => {
    expect(teamMapMutationError(new Error("A team with that name already exists."))).toBe("A team with that name already exists.");
  });
});
