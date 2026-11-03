// The console's Overview (server/org/org-admin-overview.ts): counts within a
// manager's reach, latency percentiles per engine, errors by reason, the
// engines of the boot self-check, deploy and backup facts.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { EngineSelfCheck } from "../engines/engines-self-check.ts";
import { buildOverview, deployFacts, hostFacts, percentile, readBackupStatus, selfCheckEngines, type OverviewDeps } from "./org-admin-overview.ts";
import { removeTempDir } from "../testing/cleanup.ts";
import type { ProblemRow } from "./org-problem-log.ts";
import type { UsageRow } from "../usage/usage-ledger.ts";

const dir = mkdtempSync(join(tmpdir(), "omb-overview-"));
afterAll(() => removeTempDir(dir));

const NOW = Date.UTC(2026, 9, 8, 15);
const row = (at: number, instanceId: string, principalId: string, durationMs?: number): UsageRow => ({
  at: new Date(at).toISOString(), botId: "b", botName: "B", threadId: "t", instanceId, driverKind: "claudeAgent", model: "m",
  input: 1, output: 1, costUsd: null, trigger: { kind: "user", principalId }, ownerPrincipalId: "owner", ...(durationMs !== undefined ? { durationMs } : {}),
});
const problem = (kind: ProblemRow["kind"], reason: string, owner: string): ProblemRow => ({
  id: `${kind}-${reason}-${owner}`, at: NOW - 1000, kind, reason, botId: "b", botName: "B", ownerPrincipalId: owner, threadId: "t", title: null, engine: null, detail: "",
});

const deps: OverviewDeps = {
  version: () => "0.4.14",
  startedAt: NOW - 3_600_000,
  deploy: () => ({ image: "sagax:1", builtAt: null, commit: null }),
  host: async () => ({ diskTotalBytes: 1, diskFreeBytes: 1, memTotalBytes: 1, memUsedBytes: 1, load: [0, 0, 0], cpus: 1 }),
  engines: () => [],
  sandboxes: async () => ({ enabled: false, running: 0, limit: null }),
  presence: () => [{ principalId: "carol", state: "online" }, { principalId: "dave", state: "away" }, { principalId: "bob", state: "offline" }],
  usageRows: () => [
    row(NOW - 1000, "claude", "carol", 100), row(NOW - 2000, "claude", "carol", 300), row(NOW - 3000, "claude", "dave", 900),
    row(NOW - 4000, "codex", "dave"), row(NOW - 30 * 3_600_000, "claude", "carol", 50),
  ],
  routineRuns: () => [
    { routineId: "r1", botId: "b", status: "completed", at: NOW - 1000, ownerPrincipalId: "carol", runAsPrincipalId: null },
    { routineId: "r2", botId: "b", status: "failed", at: NOW - 1000, ownerPrincipalId: "dave", runAsPrincipalId: "dave" },
  ],
  problems: () => [problem("failed", "rate_limited", "carol"), problem("failed", "rate_limited", "dave"), problem("refused", "no_access", "dave")],
  backup: () => ({ enabled: true, schedule: "daily", lastAt: NOW - 1000, ok: true }),
};
const host = { diskTotalBytes: 1, diskFreeBytes: 1, memTotalBytes: 1, memUsedBytes: 1, load: [0, 0, 0] as [number, number, number], cpus: 1 };
const sandboxes = { enabled: false, running: 0, limit: null };

describe("overview", () => {
  it("an admin counts everything: turns, latency per engine, runs, errors by reason, presence", () => {
    const got = buildOverview({ reach: null, inReach: () => true, locale: "en", now: () => NOW }, deps, { host, sandboxes });
    expect(got.turns).toEqual({ today: 4, last24h: 4 });
    expect(got.latency).toEqual([
      { engine: "claude", turns: 3, p50Ms: 300, p90Ms: 900 },
      { engine: "codex", turns: 1, p50Ms: null, p90Ms: null },
    ]);
    expect(got.routines).toEqual({ runs24h: 2, failed24h: 1 });
    expect(got.errors).toEqual({ last24h: 3, byReason: [
      { reason: "rate_limited", label: "The provider is rate limiting", count: 2 },
      { reason: "no_access", label: expect.any(String), count: 1 },
    ] });
    expect(got.presence).toEqual({ online: 1, idle: 0, away: 1, offline: 1 });
    expect(got.backup).toEqual({ lastAt: NOW - 1000, ok: true });
    expect(got.version).toBe("0.4.14");
  });

  it("a manager counts their reach only, labels in French", () => {
    const reach = new Set(["carol"]);
    const got = buildOverview({ reach, inReach: (id) => Boolean(id && reach.has(id)), locale: "fr", now: () => NOW }, deps, { host, sandboxes });
    expect(got.turns.last24h).toBe(2);
    expect(got.routines).toEqual({ runs24h: 1, failed24h: 0 });
    expect(got.errors).toEqual({ last24h: 1, byReason: [{ reason: "rate_limited", label: "Le fournisseur limite le débit", count: 1 }] });
    expect(got.presence).toEqual({ online: 1, idle: 0, away: 0, offline: 0 });
  });

  it("percentiles by nearest rank", () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([5], 90)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9);
  });

  it("engines from the image manifest, else from the instances", () => {
    const check = new EngineSelfCheck({
      installed: [{ id: "claude", name: "Claude Code", drivers: ["claudeAgent"], kind: "npm", version: "2.1.0", bin: "claude" }, { id: "codex", name: "Codex", drivers: ["codex"], kind: "npm", version: "0.5.0", bin: "codex" }],
      notPreinstalled: [{ id: "cursor", name: "Cursor", drivers: ["cursorAgent"], reason: "No Linux build" }],
    }, [
      { id: "claude", name: "Claude Code", drivers: ["claudeAgent"], bin: "claude", pinned: "2.1.0", version: "2.1.0 (Claude Code)", ok: true },
      { id: "codex", name: "Codex", drivers: ["codex"], bin: "codex", pinned: "0.5.0", ok: false, error: "exit 1" },
    ]);
    expect(selfCheckEngines(check, 42, () => [])).toEqual([
      { id: "claude", name: "Claude Code", version: "2.1.0", state: "ok", reported: "2.1.0 (Claude Code)", reason: null, checkedAt: 42 },
      { id: "codex", name: "Codex", version: "0.5.0", state: "failed", reported: null, reason: "exit 1", checkedAt: 42 },
      { id: "cursor", name: "Cursor", version: null, state: "not_preinstalled", reported: null, reason: "No Linux build", checkedAt: 42 },
    ]);
    expect(selfCheckEngines(new EngineSelfCheck(null), null, () => [{ id: "claude", name: "Claude", installed: false, version: null }])).toEqual([
      { id: "claude", name: "Claude", version: null, state: "failed", reported: null, reason: "Not installed on this server.", checkedAt: null },
    ]);
  });

  it("deploy facts from the environment, backup facts from the status file, host facts", async () => {
    expect(deployFacts({ SAGAX_IMAGE: "ghcr.io/x/sagax:0.4.14", SAGAX_IMAGE_BUILT_AT: "2026-10-08T12:00:00Z", SAGAX_IMAGE_COMMIT: "abc123" }))
      .toEqual({ image: "ghcr.io/x/sagax:0.4.14", builtAt: Date.UTC(2026, 9, 8, 12), commit: "abc123" });
    expect(deployFacts({ SAGAX_IMAGE_BUILT_AT: "1760000000" }).builtAt).toBe(1_760_000_000_000);
    expect(deployFacts({})).toEqual({ image: null, builtAt: null, commit: null });
    expect(readBackupStatus(join(dir, "missing.json"))).toEqual({ enabled: false, schedule: null, lastAt: null, ok: null });
    writeFileSync(join(dir, "backup.json"), JSON.stringify({ enabled: true, schedule: "daily 03:00 UTC", lastAt: "2026-10-08T03:00:00Z", ok: false }));
    expect(readBackupStatus(join(dir, "backup.json"))).toEqual({ enabled: true, schedule: "daily 03:00 UTC", lastAt: Date.UTC(2026, 9, 8, 3), ok: false });
    const facts = await hostFacts(dir);
    expect(facts.memTotalBytes).toBeGreaterThan(0);
    expect(facts.cpus).toBeGreaterThan(0);
    expect(facts.load).toHaveLength(3);
  });
});
