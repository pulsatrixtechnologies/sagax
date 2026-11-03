// The process groups of the engine CLIs this server started, written down so
// the next start can close what an earlier run left behind.
//
// spawnCli (server/procs.ts) starts every engine CLI in a process group of
// its own, so stopping a turn stops what the CLI started too: its MCP
// servers, its sub-agents, the commands its tools ran. That group is not
// tied to the server. When the server stops without closing its sessions
// (a crash, a kill, a restart for an update), the CLIs lose their stdin and
// exit, and whatever they started keeps running, re-parented to init, with
// nothing left to stop it. Each group is recorded here while it lives; at
// start the server stops the groups still listed (reapOrphanEngineGroups).
//
// Only Sagax's own groups are ever signalled: a group is listed only when
// spawnCli made it, and a listed group whose leader still runs is stopped
// only when that leader is the very process recorded (same start time). A
// group whose leader is gone cannot have been reused (the system never gives
// a live group's id to a new process), so its remaining members are ours.
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { processStarted, processTable, type ListedProcess } from "../browser/browser-processes.ts";

interface RecordedGroup {
  pgid: number;
  /** The leader's start time as processTable gives it, once read. */
  started?: string;
  at: number;
}

interface RegistryFile {
  version: 1;
  groups: RecordedGroup[];
}

let registryPath: string | null = null;
const groups = new Map<number, RecordedGroup>();

function persist(): void {
  if (!registryPath) return;
  const body: RegistryFile = { version: 1, groups: [...groups.values()] };
  const temp = `${registryPath}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify(body), { mode: 0o600 });
    renameSync(temp, registryPath);
  } catch {
    try { rmSync(temp, { force: true }); } catch { /* nothing written */ }
  }
}

function readRegistry(path: string): RecordedGroup[] {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<RegistryFile>;
    if (parsed?.version !== 1 || !Array.isArray(parsed.groups)) return [];
    return parsed.groups.filter((group): group is RecordedGroup =>
      Boolean(group) && Number.isInteger(group.pgid) && group.pgid > 1 && (group.started === undefined || typeof group.started === "string"));
  } catch {
    return [];
  }
}

/** spawnCli made a group led by `pgid`. */
export function noteEngineGroupStarted(pgid: number | undefined): void {
  if (!pgid || !Number.isInteger(pgid) || pgid <= 1) return;
  const record: RecordedGroup = { pgid, at: Date.now() };
  groups.set(pgid, record);
  persist();
  if (!registryPath) return;
  void processStarted(pgid).then((started) => {
    if (!started || groups.get(pgid) !== record) return;
    record.started = started;
    persist();
  });
}

/** The group led by `pgid` is gone (every member exited or was stopped). */
export function noteEngineGroupEnded(pgid: number | undefined): void {
  if (!pgid || !groups.delete(pgid)) return;
  persist();
}

/** The groups listed now, for tests and diagnostics. */
export function recordedEngineGroups(): number[] {
  return [...groups.keys()];
}

/** Which recorded groups are an earlier run's leftovers, and their members,
 * read off one process table. Pure, so the ownership rule is tested alone. */
export function orphanedEngineGroups(
  recorded: readonly RecordedGroup[],
  table: ReadonlyMap<number, ListedProcess>,
  self: number = process.pid,
): Array<{ pgid: number; members: number[] }> {
  const out: Array<{ pgid: number; members: number[] }> = [];
  for (const group of recorded) {
    if (group.pgid === self) continue;
    const members = [...table].filter(([pid, row]) => row.pgid === group.pgid && !row.zombie && pid !== self).map(([pid]) => pid);
    if (!members.length) continue;
    const leader = table.get(group.pgid);
    // A live leader is ours only when it is the process recorded: same start.
    if (leader && !leader.zombie && (!group.started || leader.started !== group.started)) continue;
    out.push({ pgid: group.pgid, members });
  }
  return out;
}

function signalGroup(pgid: number, signal: NodeJS.Signals): void {
  try { process.kill(-pgid, signal); } catch { /* gone, or not ours to signal */ }
}

function groupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * At start: record new groups in `path` from now on, and stop the groups an
 * earlier run of this server recorded there and left running. Returns how
 * many groups were stopped. A no-op where process groups do not exist
 * (Windows), where taskkill already stops a CLI with its tree.
 */
export async function reapOrphanEngineGroups(path: string, options: { graceMs?: number; log?: (line: string) => void } = {}): Promise<number> {
  const earlier = readRegistry(path);
  registryPath = path;
  persist();
  if (process.platform === "win32" || !earlier.length) return 0;
  const table = await processTable();
  if (!table) return 0;
  const orphans = orphanedEngineGroups(earlier, table);
  if (!orphans.length) return 0;
  for (const orphan of orphans) signalGroup(orphan.pgid, "SIGTERM");
  const deadline = Date.now() + (options.graceMs ?? 3_000);
  while (Date.now() < deadline && orphans.some((orphan) => groupAlive(orphan.pgid))) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  for (const orphan of orphans) if (groupAlive(orphan.pgid)) signalGroup(orphan.pgid, "SIGKILL");
  const processes = orphans.reduce((sum, orphan) => sum + orphan.members.length, 0);
  options.log?.(`[engines] stopped ${orphans.length} process group(s), ${processes} process(es), an earlier run left running`);
  return orphans.length;
}

/** Test hook: forget the registry file and every recorded group. */
export function resetEngineGroupsForTests(): void {
  registryPath = null;
  groups.clear();
}
