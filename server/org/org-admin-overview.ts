// `GET /api/org/admin/overview` (console design 4.1 and section 5): the
// server's health in one answer for the console's Overview page. Counts are
// within a manager's reach; host, engines, sandboxes, deploy and backup are
// facts of the server and the same for everyone who may read the page.
import { cpus, freemem, loadavg, totalmem } from "node:os";
import { readFileSync } from "node:fs";
import { statfs } from "node:fs/promises";

import type { EngineSelfCheck } from "../engines/engines-self-check.ts";
import { ok, type ConsoleContext, type ConsoleRoute } from "./org-admin-console.ts";
import { reasonLabel, type ProblemRow } from "./org-problem-log.ts";
import type { UsageRow } from "../usage/usage-ledger.ts";

const DAY_MS = 24 * 60 * 60_000;

export interface OverviewHost {
  diskTotalBytes: number | null;
  diskFreeBytes: number | null;
  memTotalBytes: number;
  memUsedBytes: number;
  load: [number, number, number];
  cpus: number;
}

export interface OverviewEngine {
  id: string;
  name: string;
  /** The pinned version (engines.lock.json), or the probe's. */
  version: string | null;
  state: "ok" | "failed" | "not_preinstalled";
  /** What `--version` printed at boot. */
  reported: string | null;
  reason: string | null;
  checkedAt: number | null;
}

export interface OverviewRun {
  routineId: string;
  botId: string;
  status: string;
  at: number;
  ownerPrincipalId: string | null;
  runAsPrincipalId: string | null;
}

export interface OverviewDeps {
  version(): string;
  startedAt: number;
  deploy(): { image: string | null; builtAt: number | null; commit: string | null };
  host(): Promise<OverviewHost>;
  engines(): OverviewEngine[];
  sandboxes(): Promise<{ enabled: boolean; running: number; limit: number | null }>;
  /** Every person of the organization with their public presence. */
  presence(): Array<{ principalId: string; state: "online" | "away" | "offline" }>;
  usageRows(range: { from: Date; to: Date }): UsageRow[];
  routineRuns(from: number): OverviewRun[];
  problems(from: number): ProblemRow[];
  backup(): BackupStatus;
}

/** The deploy facts the image or the deployment sets in the environment. */
export function deployFacts(env: NodeJS.ProcessEnv = process.env): { image: string | null; builtAt: number | null; commit: string | null } {
  const text = (name: string) => env[name]?.trim().slice(0, 200) || null;
  const built = text("SAGAX_IMAGE_BUILT_AT");
  const builtAt = built ? (/^\d{10,13}$/.test(built) ? Number(built) * (built.length === 10 ? 1000 : 1) : Date.parse(built)) : Number.NaN;
  return {
    image: text("SAGAX_IMAGE"),
    builtAt: Number.isFinite(builtAt) ? builtAt : null,
    commit: text("SAGAX_IMAGE_COMMIT"),
  };
}

export interface BackupStatus {
  enabled: boolean;
  schedule: string | null;
  lastAt: number | null;
  ok: boolean | null;
}

/** The backup facts the deployment writes (its snapshot job), from
 * SAGAX_BACKUP_STATUS_FILE or <data>/backup-status.json:
 * `{"enabled": true, "schedule": "daily 03:00 UTC", "lastAt": <ms or ISO>,
 * "ok": true}`. Sagax itself takes no scheduled backup; with no file, every
 * fact is unknown (null) and `enabled` false. */
export function readBackupStatus(path: string): BackupStatus {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return { enabled: false, schedule: null, lastAt: null, ok: null };
  }
  const value = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const last = typeof value.lastAt === "number" ? value.lastAt : typeof value.lastAt === "string" ? Date.parse(value.lastAt) : Number.NaN;
  return {
    enabled: value.enabled === true,
    schedule: typeof value.schedule === "string" && value.schedule.trim() ? value.schedule.trim().slice(0, 120) : null,
    lastAt: Number.isFinite(last) ? last : null,
    ok: typeof value.ok === "boolean" ? value.ok : null,
  };
}

/** Disk of the data folder, memory and load of the host. */
export async function hostFacts(dataDir: string): Promise<OverviewHost> {
  let diskTotalBytes: number | null = null;
  let diskFreeBytes: number | null = null;
  try {
    const stats = await statfs(dataDir);
    diskTotalBytes = Number(stats.blocks) * Number(stats.bsize);
    diskFreeBytes = Number(stats.bavail) * Number(stats.bsize);
  } catch {
    /* not every platform answers statfs */
  }
  const memTotalBytes = totalmem();
  const [a = 0, b = 0, c = 0] = loadavg();
  return {
    diskTotalBytes, diskFreeBytes, memTotalBytes, memUsedBytes: Math.max(0, memTotalBytes - freemem()),
    load: [round2(a), round2(b), round2(c)], cpus: cpus().length,
  };
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/** The engines the image carries (its manifest, checked at boot), or, with
 * no manifest, the configured instances as the probes found them. */
export function selfCheckEngines(check: EngineSelfCheck, checkedAt: number | null, fallback: () => Array<{ id: string; name: string; installed: boolean; version: string | null }>): OverviewEngine[] {
  if (check.manifest) {
    const installed = check.manifest.installed.map((engine): OverviewEngine => {
      const result = check.checks.find((candidate) => candidate.id === engine.id);
      return {
        id: engine.id, name: engine.name, version: engine.version || null,
        state: result?.ok ? "ok" : "failed",
        reported: result?.version ?? null,
        reason: result && !result.ok ? (result.error ?? "It did not start.") : result ? null : "Not checked yet.",
        checkedAt: result ? checkedAt : null,
      };
    });
    const unavailable = check.manifest.notPreinstalled.map((engine): OverviewEngine => ({
      id: engine.id, name: engine.name, version: null, state: "not_preinstalled", reported: null, reason: engine.reason, checkedAt,
    }));
    return [...installed, ...unavailable];
  }
  return fallback().map((engine) => ({
    id: engine.id, name: engine.name, version: engine.version, state: engine.installed ? "ok" : "failed",
    reported: engine.version, reason: engine.installed ? null : "Not installed on this server.", checkedAt: null,
  }));
}

/** The p-th percentile (0 to 100) of sorted values, nearest rank. */
export function percentile(sorted: readonly number[], p: number): number | null {
  if (!sorted.length) return null;
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(sorted.length, rank) - 1]!;
}

/** Whether a usage row counts for this caller (the usage route's rule). */
export function usageRowInReach(row: UsageRow, inReach: (principalId: string | null | undefined) => boolean, admin: boolean): boolean {
  if (admin) return true;
  const trigger = row.trigger;
  if (trigger.kind === "user" && trigger.principalId && inReach(trigger.principalId)) return true;
  if (trigger.kind === "routine" && trigger.runAsPrincipalId && inReach(trigger.runAsPrincipalId)) return true;
  if (trigger.kind === "user" && !trigger.principalId) return false;
  return inReach(row.ownerPrincipalId);
}

export function buildOverview(ctx: Pick<ConsoleContext, "reach" | "inReach" | "locale" | "now">, deps: OverviewDeps, facts: {
  host: OverviewHost;
  sandboxes: { enabled: boolean; running: number; limit: number | null };
}) {
  const now = ctx.now();
  const admin = ctx.reach === null;
  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);
  const from = Math.min(dayStart.getTime(), now - DAY_MS);
  const rows = deps.usageRows({ from: new Date(from), to: new Date(now) }).filter((row) => usageRowInReach(row, ctx.inReach, admin));
  let today = 0;
  let last24h = 0;
  const durations = new Map<string, number[]>();
  const turnsByEngine = new Map<string, number>();
  for (const row of rows) {
    const at = Date.parse(row.at);
    if (at >= dayStart.getTime()) today += 1;
    if (at < now - DAY_MS) continue;
    last24h += 1;
    const engine = row.instanceId || "unknown";
    turnsByEngine.set(engine, (turnsByEngine.get(engine) ?? 0) + 1);
    if (typeof row.durationMs === "number" && Number.isFinite(row.durationMs) && row.durationMs >= 0) {
      const list = durations.get(engine) ?? [];
      list.push(row.durationMs);
      durations.set(engine, list);
    }
  }
  const latency = [...turnsByEngine.entries()].map(([engine, turns]) => {
    const sorted = (durations.get(engine) ?? []).sort((a, b) => a - b);
    return { engine, turns, p50Ms: percentile(sorted, 50), p90Ms: percentile(sorted, 90) };
  }).sort((a, b) => b.turns - a.turns || a.engine.localeCompare(b.engine));

  const runs = deps.routineRuns(now - DAY_MS).filter((run) => admin || ctx.inReach(run.runAsPrincipalId) || ctx.inReach(run.ownerPrincipalId));
  const problems = deps.problems(now - DAY_MS).filter((row) => admin || ctx.inReach(row.ownerPrincipalId) || ctx.inReach(row.runAsPrincipalId));
  const byReason = new Map<string, number>();
  for (const row of problems) byReason.set(row.reason, (byReason.get(row.reason) ?? 0) + 1);

  const presence = { online: 0, idle: 0, away: 0, offline: 0 };
  for (const person of deps.presence()) {
    if (!admin && !ctx.inReach(person.principalId)) continue;
    presence[person.state] += 1;
  }

  return {
    version: deps.version(),
    startedAt: deps.startedAt,
    deploy: deps.deploy(),
    host: facts.host,
    engines: deps.engines(),
    sandboxes: facts.sandboxes,
    presence,
    turns: { today, last24h },
    routines: { runs24h: runs.length, failed24h: runs.filter((run) => run.status === "failed").length },
    errors: {
      last24h: problems.length,
      byReason: [...byReason.entries()]
        .map(([reason, count]) => ({ reason, label: reasonLabel(reason, ctx.locale), count }))
        .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
    },
    latency,
    backup: (({ lastAt, ok: fine }) => ({ lastAt, ok: fine }))(deps.backup()),
  };
}

export function overviewRoutes(deps: OverviewDeps): ConsoleRoute[] {
  return [{
    method: "GET",
    path: "overview",
    min: "manager",
    async handle(ctx) {
      const [host, sandboxes] = await Promise.all([deps.host(), deps.sandboxes()]);
      return ok(buildOverview(ctx, deps, { host, sandboxes }));
    },
  }];
}
