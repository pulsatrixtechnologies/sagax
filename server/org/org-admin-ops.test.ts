// Connections, logs, incidents and settings (server/org/org-admin-ops.ts) with
// faked dependencies.
import { describe, expect, it } from "vitest";

import { ConsoleRefusal } from "./org-admin-console.ts";
import { opsRoutes, timed, type OpsDeps, type SettingsChanges } from "./org-admin-ops.ts";
import type { ProblemRow } from "./org-problem-log.ts";
import { ServerLogRing } from "../process/server-log-ring.ts";
import { fakeConsole } from "../testing/console-context.ts";

const NOW = Date.UTC(2026, 9, 8, 12);
const problem = (id: string, kind: ProblemRow["kind"], reason: string): ProblemRow => ({
  id, at: NOW - 1000, kind, reason, botId: "b", botName: "Atlas", ownerPrincipalId: "pr_a", threadId: "t", title: "Digest", engine: "claude", detail: "429",
});

function setup() {
  const saved: SettingsChanges[] = [];
  const ring = new ServerLogRing({ now: () => NOW });
  ring.push("info", "[engines] ok");
  ring.push("error", "[omb-turn] failed");
  const deps: OpsDeps = {
    connections: async () => ({ engines: [{ id: "claude", name: "Claude", installed: true, version: "2.1", orgKey: true, people: 2 }], people: [], mcpServers: [], composio: { configured: false, apps: [] }, marketplaces: [], skills: [] }),
    test: async (kind, id) => (kind === "marketplace" ? null : id === "slow" ? new Promise(() => {}) : id === "boom" ? Promise.reject(new Error("refused by host")) : { ok: id === "claude", reason: id === "claude" ? null : "no_access", label: id === "claude" ? null : "No access" }),
    logs: (input) => ring.read(input),
    problems: () => [problem("p1", "failed", "rate_limited"), problem("p2", "refused", "no_access"), problem("p3", "stalled", "stalled")],
    settings: () => ({ org: { allowFullAccess: true }, policies: { allowedMarketplaces: null, allowedEngines: null, ownAccountsOutsideList: false, disabledModels: [], engineModels: { claude: [{ id: "m", label: "M" }] }, defaults: { engine: "claude", model: "m", approvalMode: null } }, backup: { enabled: false, schedule: null, lastAt: null, ok: null } }),
    saveSettings: (changes) => {
      if (changes.allowedEngines?.includes("ghost")) throw new ConsoleRefusal(400, "engine_not_installed", "No engine ghost.");
      saved.push(changes);
    },
    now: () => NOW,
  };
  return { saved, console: fakeConsole(opsRoutes(deps), () => NOW) };
}

describe("ops", () => {
  it("connections: admin only, the view as given", async () => {
    const { console } = setup();
    expect((await console.call("GET", "connections")).body.engines[0]).toMatchObject({ id: "claude", orgKey: true, people: 2 });
  });

  it("connections/test: timed, audited, 501 for a line that cannot be tested", async () => {
    const { console } = setup();
    const okTest = await console.call("POST", "connections/test", { body: { kind: "engine", id: "claude" } });
    expect(okTest.body).toMatchObject({ ok: true, latencyMs: expect.any(Number), reason: null, label: null });
    expect(console.records.at(-1)).toMatchObject({ category: "engine", action: "connections.test", target: { kind: "engine", id: "claude" }, after: { ok: true } });
    expect((await console.call("POST", "connections/test", { body: { kind: "engine", id: "codex", principalId: "pr_b" } })).body).toMatchObject({ ok: false, reason: "no_access" });
    expect((await console.call("POST", "connections/test", { body: { kind: "engine", id: "boom" } })).body).toMatchObject({ ok: false, reason: "error", label: "refused by host" });
    expect(await console.call("POST", "connections/test", { body: { kind: "marketplace", id: "local" } })).toMatchObject({ status: 501, body: { code: "not_implemented", reason: expect.any(String) } });
    expect((await console.call("POST", "connections/test", { body: { kind: "dns", id: "x" } })).status).toBe(400);
  });

  it("a test that never answers times out", async () => {
    const started = Date.now();
    const got = await timed(() => new Promise((resolve) => setTimeout(() => resolve({ ok: true, reason: null, label: null }), 5)));
    expect(got.result).toEqual({ ok: true, reason: null, label: null });
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("logs: level filter, limit, cursor", async () => {
    const { console } = setup();
    const all = await console.call("GET", "logs");
    expect(all.body.lines.map((line: { area: string }) => line.area)).toEqual(["omb-turn", "engines"]);
    expect((await console.call("GET", "logs?level=error")).body.lines).toHaveLength(1);
    const first = await console.call("GET", "logs?limit=1");
    expect((await console.call("GET", `logs?limit=1&before=${first.body.next}`)).body.lines[0].area).toBe("engines");
    for (const query of ["level=debug", "limit=0", "limit=501", "before=x"]) expect((await console.call("GET", `logs?${query}`)).status).toBe(400);
  });

  it("incidents: failures only, readable, filtered by kind", async () => {
    const { console } = setup();
    const all = await console.call("GET", "incidents", { locale: "fr" });
    expect(all.body.items.map((item: { id: string }) => item.id)).toEqual(["p1", "p3"]);
    expect(all.body.items[0]).toMatchObject({ kind: "failed", bot: { id: "b", name: "Atlas" }, reason: "rate_limited", label: "Le fournisseur limite le débit", threadId: "t", title: "Digest" });
    expect((await console.call("GET", "incidents?kind=stalled")).body.items.map((item: { id: string }) => item.id)).toEqual(["p3"]);
    expect((await console.call("GET", "incidents?kind=refused")).status).toBe(400);
  });

  it("settings: the shape, strict changes, refusals", async () => {
    const { console, saved } = setup();
    expect((await console.call("GET", "settings")).body).toMatchObject({ policies: { allowedEngines: null, defaults: { engine: "claude" } }, backup: { enabled: false } });
    const posted = await console.call("POST", "settings", { body: { allowFullAccess: false, memberEnvironmentAutonomy: false, memberAutoApproval: false, allowVaultExport: false, allowedEngines: ["claude"], defaults: { approvalMode: "ask" }, pluginMarketplaces: { mode: "list", allow: ["acme/plugins"] }, interimAttachDays: 0 } });
    expect(posted.status).toBe(200);
    expect(saved.at(-1)).toEqual({ allowFullAccess: false, memberEnvironmentAutonomy: false, memberAutoApproval: false, allowVaultExport: false, allowedEngines: ["claude"], defaults: { approvalMode: "ask" }, pluginMarketplaces: { mode: "list", allow: ["acme/plugins"] }, interimAttachDays: 0 });
    for (const body of [{}, { other: 1 }, { allowFullAccess: "no" }, { memberEnvironmentAutonomy: "yes" }, { memberAutoApproval: "yes" }, { memberAutoApproval: null }, { allowVaultExport: "no" }, { allowVaultExport: null }, { allowedEngines: ["bad id!"] }, { defaults: { approvalMode: "maybe" } }, { interimAttachDays: 91 }, { pluginMarketplaces: { mode: "some" } }]) {
      expect((await console.call("POST", "settings", { body })).status).toBe(400);
    }
    expect((await console.call("POST", "settings", { body: { allowedEngines: ["ghost"] } })).body).toMatchObject({ code: "engine_not_installed" });
    // 2026-10-30: own accounts outside the list, a boolean
    expect((await console.call("POST", "settings", { body: { ownAccountsOutsideList: true } })).status).toBe(200);
    expect(saved.at(-1)).toEqual({ ownAccountsOutsideList: true });
    expect((await console.call("POST", "settings", { body: { ownAccountsOutsideList: "yes" } })).status).toBe(400);
    // 2026-10-30 (lot 2): models off one by one, `<engine>/<model>`
    expect((await console.call("POST", "settings", { body: { disabledModels: ["claude/opus", "claude/opus", "openrouter/vendor/model"] } })).status).toBe(200);
    expect(saved.at(-1)).toEqual({ disabledModels: ["claude/opus", "openrouter/vendor/model"] });
    expect((await console.call("POST", "settings", { body: { disabledModels: ["no-slash"] } })).status).toBe(400);
  });
});
