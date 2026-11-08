import { describe, expect, it } from "vitest";
import { chatDefaultRoles, cwPermissionFor, heldRolesOf, minimalRole, roleCoverage, roleRefusalOf, routineDefaultRole, routineMandateOf, matchingRoleRule, actingAsOf, permissionPathKey } from "./perspicax-roles.ts";

const listing = {
  acting_as: { slug: "service-desk", name: "Service Desk", token: { scope: "profile:p-1", expires_at: "2026-11-05T12:00:00Z" } },
  profiles: [
    { slug: "service-desk", name: "Service Desk", read_only: false, explicit_only: false, reachable: true, can: { read: true, write: true, routines_run: true, approvals_answer: null, flow: true, sagax: false } },
    { slug: "full-access", name: "Full Access", read_only: false, explicit_only: false, reachable: true, can: { read: true, write: true, routines_run: true, approvals_answer: true, flow: true, sagax: true } },
    { slug: "bot-attribution", name: "Bot attribution", read_only: false, explicit_only: true, reachable: true, can: { read: true, write: true } },
    { slug: "", name: "no slug" },
  ],
};

describe("perspicax roles", () => {
  it("reads the held roles and the role in use", () => {
    const held = heldRolesOf(listing);
    expect(held.map((role) => role.slug)).toEqual(["service-desk", "full-access", "bot-attribution"]);
    expect(held[0]).toMatchObject({ name: "Service Desk", readOnly: false, explicitOnly: false, can: { write: true, approvals_answer: null } });
    expect(chatDefaultRoles(held).map((role) => role.slug)).toEqual(["service-desk", "full-access"]);
    expect(actingAsOf(listing)).toEqual({ slug: "service-desk", name: "Service Desk", id: "p-1" });
  });

  it("tells a 403 refusal from an act-as lapse", () => {
    expect(roleRefusalOf({ result: { isError: true, structuredContent: { code: "upstream_error", details: { status: 403 } } } })).toMatchObject({ status: 403 });
    expect(roleRefusalOf({ result: { isError: true, structuredContent: { code: "policy_denied", details: { status: 403, reason: "act_as_expired" } } } })).toBeNull();
    expect(roleRefusalOf({ result: { isError: true, content: [{ type: "text", text: "ConnectWise returned HTTP 403 Forbidden" }] } })).toMatchObject({ status: 403 });
    expect(roleRefusalOf({ result: { isError: true, content: [{ type: "text", text: "not found" }] } })).toBeNull();
    expect(roleRefusalOf({ result: { content: [{ type: "text", text: "403 rows" }] } })).toBeNull();
  });

  it("maps a refused call to the CW permission an administrator fixes", () => {
    expect(cwPermissionFor("cw_psa_log_time", {}, false)).toEqual({ path: "time/entries", module: "Time & Expense", func: "Time Entry", operation: "Add" });
    expect(cwPermissionFor("cw_psa_query", { resource: "schedule/holidayLists/12/holidays" }, true)).toMatchObject({ path: "schedule/holidayLists", module: "System", func: "Table Setup", operation: "Inquire" });
    expect(cwPermissionFor("cw_psa_query", { resource: "/system/workflows" }, true)).toMatchObject({ module: "System", func: "Workflow Rules" });
    expect(cwPermissionFor("cw_psa_project__tickets_write", { action: "update" }, false)).toMatchObject({ path: "project/tickets", module: "Project", func: "Project Tickets", operation: "Edit" });
    expect(cwPermissionFor("cw_psa_schedule_entries_write", { action: "delete" }, false)).toMatchObject({ path: "schedule/entries", operation: "Delete" });
  });

  // #2960: the dotted resource the conventions name is the same permission path
  it("maps a dotted resource to the same path as the slashed one", () => {
    expect(cwPermissionFor("cw_psa_query", { resource: "service.tickets" }, true)).toEqual(cwPermissionFor("cw_psa_query", { resource: "service/tickets" }, true));
    expect(cwPermissionFor("cw_psa_query", { resource: "service.tickets" }, true)).toMatchObject({ path: "service/tickets", module: "Service Desk", func: "Service Tickets" });
    expect(cwPermissionFor("cw_psa_write", { resource: "service.tickets.notes", action: "create" }, false)).toMatchObject({ path: "service/tickets/notes", operation: "Add" });
  });

  // #2960: a rule saved under the dotted path answers the slashed one
  it("matches a rule saved under a dotted path", () => {
    const rule = { id: "r", from: { slug: "", name: "" }, to: { slug: "full-access", name: "Full Access" }, path: "service.tickets", ownerId: "owner", createdAt: 0 };
    expect(matchingRoleRule([rule], "owner", "", "service/tickets")).toBe(rule);
    expect(matchingRoleRule([rule], "owner", "", "service/tickets/notes")).toBe(rule);
    expect(matchingRoleRule([rule], "owner", "", "service/boards")).toBeUndefined();
    expect(permissionPathKey(" /Service.Tickets/ ")).toBe("service/tickets");
  });

  it("computes a routine role's coverage and picks the minimal role", () => {
    const held = heldRolesOf(listing);
    const refusals = [{ role: "service-desk", path: "time/entries", operation: "Inquire" as const }, { role: "service-desk", path: "project/tickets", operation: "Edit" as const }];
    const mandate = ["schedule_create", "status_change"];
    const dispatch = roleCoverage("service-desk", held, mandate, refusals);
    expect(dispatch.covered).toEqual(mandate);
    expect(dispatch.refusedReads.map((read) => read.path)).toEqual(["time/entries"]);
    expect(dispatch.ok).toBe(false);
    expect(roleCoverage("service-desk", held, ["project_percent_complete"], refusals).notCovered).toEqual([]);
    expect(minimalRole(held, mandate, [])).toBe("service-desk");
    expect(minimalRole(held, [], [])).toBe("service-desk");
    expect(routineDefaultRole(held, mandate, ["full-access"], [])).toBe("full-access");
    const readOnly = heldRolesOf({ profiles: [{ slug: "viewer", name: "Viewer", read_only: true, can: { read: true, write: false } }] });
    expect(roleCoverage("viewer", readOnly, ["status_change"], []).notCovered).toEqual([{ item: "status_change", why: "read_only" }]);
    expect(minimalRole(readOnly, ["status_change"], [])).toBe("");
  });

  it("reads a Flow describe card and matches an owner's rule", () => {
    expect(routineMandateOf({ routine: { name: "x", inputs: { standing_mandate: ["schedule_create", " status_change "] }, server_profiles: ["service-desk"] } })).toEqual({ mandate: ["schedule_create", "status_change"], serverProfiles: ["service-desk"] });
    const rules = [{ id: "r", from: { slug: "service-desk", name: "Service Desk" }, to: { slug: "", name: "" }, path: "schedule/holidayLists", ownerId: "owner", createdAt: 0 }];
    expect(matchingRoleRule(rules, "owner", "service-desk", "schedule/holidayLists")).toBeDefined();
    expect(matchingRoleRule(rules, "someone-else", "service-desk", "schedule/holidayLists")).toBeUndefined();
    expect(matchingRoleRule(rules, "owner", "service-desk", "time/entries")).toBeUndefined();
  });
});
