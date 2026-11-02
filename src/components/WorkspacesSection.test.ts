import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConfigStatus } from "@/state/store";
import { WorkspacesSection, WorkspacesTable, workspacesAvailable, type FleetView } from "./WorkspacesSection";

const fixture = vi.hoisted(() => ({ config: null as ConfigStatus | null }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  useStore: () => ({ state: { config: fixture.config }, dispatch: () => {} }),
}));
afterEach(() => vi.unstubAllGlobals());

/** The open-source edition reports every feature; an enterprise layer may report fewer. */
const OPEN_SOURCE = ["admin", "billing", "budgets", "whitelabel"];
function config(features: string[], fleet: boolean, edition: "oss" | "enterprise" = "oss"): ConfigStatus {
  return {
    box: { configured: false }, vps: { configured: false, sshAlias: "" },
    rooms: { turnTimeoutMinutes: 30 }, localVm: { mode: "shared", maxInstances: 1 },
    edition: { edition, features }, fleet: { available: fleet },
  } as ConfigStatus;
}

const fleet: FleetView = {
  domain: "agentada.cc",
  operator: "maus",
  workspaces: [
    { slug: "acme", host: "acme.agentada.cc", port: 8810, status: "running", createdAt: "", live: "active", usage: { month: "2026-09", turns: 12, costUsd: 3.5, billableUsd: 7 } },
    { slug: "globex", host: "globex.agentada.cc", port: 8820, status: "suspended", createdAt: "", live: "inactive", usage: { month: "2026-09", turns: 0, costUsd: null, billableUsd: null } },
  ],
};

describe("workspaces section", () => {
  it.each(["provisioning", "error", "retained"] as const)("does not offer normal lifecycle actions for %s workspaces", status => {
    const html = renderToStaticMarkup(createElement(WorkspacesTable, {
      fleet: { ...fleet, workspaces: [{ ...fleet.workspaces[0]!, status }] }, onAct: () => {}, busy: null,
    }));
    expect(html).toContain("Contact the server operator");
    expect(html).not.toContain("<button");
    expect(html).not.toContain(">Running<");
  });
  it("appears on the open-source edition wherever a fleet agent runs, and not where a layer withholds admin", () => {
    expect(workspacesAvailable(config(OPEN_SOURCE, true))).toBe(true);
    expect(workspacesAvailable(config(OPEN_SOURCE, false))).toBe(false);
    expect(workspacesAvailable(config(["sso"], true, "enterprise"))).toBe(false);
    expect(workspacesAvailable(config([], true))).toBe(false);
    expect(workspacesAvailable(config(["admin"], true, "enterprise"))).toBe(true);
    fixture.config = config(OPEN_SOURCE, false);
    expect(renderToStaticMarkup(createElement(WorkspacesSection, { load: async () => fleet }))).toBe("");
  });

  it("lists workspaces with their state, this month's cost and billable, and the actions that fit", () => {
    const html = renderToStaticMarkup(createElement(WorkspacesTable, { fleet, onAct: () => {}, busy: null }));
    expect(html).toContain("acme.agentada.cc");
    expect(html).toContain("Running");
    expect(html).toContain("$3.50");
    expect(html).toContain("$7.00");
    expect(html).toContain("Suspended");
    expect(html).toContain(">Suspend<");
    expect(html).toContain(">Resume<");
    expect(html).toContain(">Delete<");
    expect(html).toContain('href="https://globex.agentada.cc"');
    expect(renderToStaticMarkup(createElement(WorkspacesTable, { fleet: { ...fleet, workspaces: [] }, onAct: () => {}, busy: null }))).toContain("No installations on agentada.cc yet");
  });
});
