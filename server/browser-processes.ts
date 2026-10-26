// The processes of one browser session: the agent-browser daemon and the
// Chrome under it (docs/browser-packaging.md, "Process hygiene").
//
// agent-browser 0.37 starts each daemon in a session of its own (setsid) and
// each Chrome in a process group of its own, so neither stops with the
// server, and a daemon that is killed leaves its Chrome running, re-parented
// to init. A browser is only closed once every process of its tree has
// exited; one that will not exit is stopped by process group. Each process is
// recorded with its start time, so a pid the system has since given to
// another program is never signalled.
import { execFile } from "node:child_process";
import { readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, unlinkSync } from "node:fs";
import { hostname } from "node:os";
import { basename, isAbsolute, join, sep } from "node:path";

/** A process as the system lists it; `started` tells it apart from a later
 * process that reused its pid. A zombie has exited and only waits for its
 * parent to collect it, so it counts as gone. `args` only when asked for. */
type ListedProcess = { ppid: number; pgid: number; zombie: boolean; started: string; args?: string };

/** One browser session's processes, read before anything was asked to stop. */
export interface BrowserProcessTree {
  daemon: number;
  /** pid → start time: the daemon and every process under it. Empty start
   * times where the system gives none (Windows). */
  members: Map<number, string>;
  /** Process groups one of the members leads: the daemon's own and Chrome's.
   * A helper Chrome starts after the snapshot joins its group. */
  groups: number[];
  /** Chrome's temporary profile folders. The daemon removes its Chrome's when
   * it closes it; a browser stopped here has them removed here instead. */
  profiles?: string[];
  /** Windows, which gives no start times: the image the daemon ran when read.
   * Its pid counts as the daemon only while it still runs that image. */
  image?: string;
}

/** agent-browser starts Chrome on a profile folder of its own,
 * `<tmp>/agent-browser-chrome-<uuid>`. Only an absolute path of exactly that
 * name, from Chrome's own arguments, is ever removed. */
const TEMPORARY_PROFILE = /^agent-browser-chrome-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function temporaryProfile(args: string | undefined): string | null {
  const dir = args?.split(" ").find((arg) => arg.startsWith("--user-data-dir="))?.slice("--user-data-dir=".length);
  return dir && isAbsolute(dir) && TEMPORARY_PROFILE.test(basename(dir)) ? dir : null;
}

/** macOS keeps ps at /bin/ps; a server started with a bare PATH (a service, a test fixture) still finds it there. */
const PS = process.platform === "darwin" ? "/bin/ps" : "ps";

/** A tool's output, or null when it failed. The C locale keeps `ps` start
 * times in one fixed five-word form. */
function execText(file: string, args: string[]): Promise<string | null> {
  return new Promise((done) => {
    execFile(file, args, { encoding: "utf8", timeout: 5_000, windowsHide: true, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, LC_ALL: "C" } }, (error, stdout) => done(error ? null : stdout));
  });
}

export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** A process's command line, its arguments joined by spaces. */
function linuxArgs(pid: number): string {
  try { return readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter(Boolean).join(" "); }
  catch { return ""; }
}

/** One process's command line, or null when it cannot be read (POSIX). */
async function processArgs(pid: number): Promise<string | null> {
  if (process.platform === "linux") return linuxArgs(pid) || null;
  return (await execText(PS, ["-ww", "-o", "args=", "-p", String(pid)]))?.trim() || null;
}

/** Every process on this machine, or null where none can be listed (Windows).
 * Linux reads /proc, so an image without procps still sees its processes;
 * one file at a time, so a busy host cannot run this out of descriptors. */
async function processTable(withArgs = false): Promise<Map<number, ListedProcess> | null> {
  if (process.platform === "win32") return null;
  const table = new Map<number, ListedProcess>();
  if (process.platform === "linux") {
    let names: string[];
    try { names = readdirSync("/proc"); } catch { return null; }
    for (const name of names) {
      if (!/^\d+$/.test(name)) continue;
      try {
        const stat = readFileSync(`/proc/${name}/stat`, "utf8");
        // The command name may hold spaces and parentheses; the fields follow its last ')'.
        const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
        table.set(Number(name), { ppid: Number(fields[1]), pgid: Number(fields[2]), zombie: fields[0] === "Z" || fields[0] === "X", started: fields[19] ?? "", ...withArgs ? { args: linuxArgs(Number(name)) } : {} });
      } catch { /* exited while listed */ }
    }
    return table;
  }
  // lstart is always five words (Tue Oct 13 23:48:58 2026); args follow.
  const listing = await execText(PS, ["-A", "-ww", "-o", `pid=,ppid=,pgid=,stat=,lstart=${withArgs ? ",args=" : ""}`]);
  if (listing === null) return null;
  for (const line of listing.split("\n")) {
    const [pid, ppid, pgid, stat, ...rest] = line.trim().split(/\s+/);
    if (!pid || !Number.isInteger(Number(pid)) || !Number.isInteger(Number(ppid)) || !Number.isInteger(Number(pgid))) continue;
    table.set(Number(pid), { ppid: Number(ppid), pgid: Number(pgid), zombie: stat?.startsWith("Z") === true, started: rest.slice(0, 5).join(" "), ...withArgs ? { args: rest.slice(5).join(" ") } : {} });
  }
  return table;
}

/** A process's environment, or null when it cannot be read. */
async function processEnvironment(pid: number): Promise<Map<string, string> | null> {
  let entries: string[];
  if (process.platform === "linux") {
    try { entries = readFileSync(`/proc/${pid}/environ`, "utf8").split("\0"); } catch { return null; }
  } else {
    // ps -E appends the environment to the arguments, space separated.
    const listing = await execText(PS, ["-E", "-ww", "-o", "command=", "-p", String(pid)]);
    if (listing === null) return null;
    entries = listing.trim().split(/\s+/);
  }
  return new Map(entries.flatMap((entry) => {
    const match = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(entry);
    return match ? [[match[1]!, match[2]!] as const] : [];
  }));
}

/** Windows: the image `pid` runs, lowercased; "" when no process has that
 * pid, null when tasklist could not say. */
async function imageOf(pid: number): Promise<string | null> {
  const row = await execText("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"]);
  return row === null ? null : /^"([^"]*)"/.exec(row.trim())?.[1]?.toLowerCase() ?? "";
}

/** The daemon `daemon` (from its pid file) and everything under it, or null
 * when that pid is not `session`'s daemon of this binary. agent-browser starts
 * a daemon through the binary's resolved path, so a symlink (a global npm
 * install) and its target both count, with AGENT_BROWSER_DAEMON=1 and the
 * session's name: a pid the system has since given to another program, to an
 * engine command of the same binary or to another session's daemon is not
 * it. Read before the daemon is asked to close: once it exits, its Chrome is
 * re-parented and no longer found below it. */
export async function browserProcessTree(binaryPath: string, daemon: number, session: string): Promise<BrowserProcessTree | null> {
  if (!Number.isInteger(daemon) || daemon <= 1 || daemon === process.pid || !processAlive(daemon)) return null;
  const paths = new Set([binaryPath]);
  try { paths.add(realpathSync(binaryPath)); } catch { /* compared by the given path only */ }
  if (process.platform === "win32") {
    // Windows shows no environments, trees or start times here: the image
    // tells the daemon from a later program given its pid, and taskkill /T
    // walks the tree from it.
    const image = await imageOf(daemon);
    return image && [...paths].some((path) => basename(path).toLowerCase() === image) ? { daemon, members: new Map([[daemon, ""]]), groups: [], image } : null;
  }
  const command = await processArgs(daemon);
  if (!command || ![...paths].some((path) => command === path || command.startsWith(`${path} `))) return null;
  const env = await processEnvironment(daemon);
  if (env?.get("AGENT_BROWSER_DAEMON") !== "1" || env.get("AGENT_BROWSER_SESSION") !== session) return null;
  const table = await processTable();
  if (!table?.has(daemon)) return null;
  const children = new Map<number, number[]>();
  for (const [pid, entry] of table) children.set(entry.ppid, [...children.get(entry.ppid) ?? [], pid]);
  const members = new Map<number, string>();
  const walk = (pid: number) => {
    members.set(pid, table.get(pid)!.started);
    for (const child of children.get(pid) ?? []) if (!members.has(child)) walk(child);
  };
  walk(daemon);
  const own = table.get(process.pid)?.pgid;
  const groups = [...members.keys()].filter((pid) => table.get(pid)!.pgid === pid && pid !== own);
  const profiles: string[] = [];
  for (const group of groups) {
    const profile = group === daemon ? null : temporaryProfile(await processArgs(group) ?? undefined);
    if (profile) profiles.push(profile);
  }
  return { daemon, members, groups, profiles };
}

/** Whether a Chrome's arguments name a profile folder inside `root`. */
function profileUnder(args: string, root: string): boolean {
  return args.includes(`--user-data-dir=${root.replace(/[\\/]+$/, "")}${sep}`);
}

/** Each Chrome an agent-browser daemon started that has outlived it (the
 * daemon was killed: by the OOM killer, by hand, or by the engine's own
 * restart of a stuck daemon), with the session it served. agent-browser
 * starts Chrome on a temporary `agent-browser-chrome-` profile with
 * --remote-debugging-port=0, in a group of its own, and Chrome inherits the
 * daemon's environment: AGENT_BROWSER_DAEMON=1 and the session's name. A
 * Chrome whose parent is still a daemon is not one. POSIX only: Windows lists
 * no environments to tell them by. */
export async function orphanedBrowsers(home: string | undefined, profiles?: string): Promise<Array<{ session: string; tree: BrowserProcessTree }>> {
  const table = await processTable(true);
  if (!table) return [];
  const found: Array<{ session: string; tree: BrowserProcessTree }> = [];
  for (const [pid, entry] of table) {
    const args = entry.args?.split(" ") ?? [];
    // On a temporary profile, or on a saved session's own profile under `profiles` (found, never removed).
    const onProfile = args.some((arg) => arg.startsWith("--user-data-dir=") && arg.includes("agent-browser-chrome-")) || (!!profiles && profileUnder(entry.args ?? "", profiles));
    if (entry.zombie || entry.pgid !== pid || !args.includes("--remote-debugging-port=0") || !onProfile) continue;
    // A daemon runs as agent-browser (or its platform build) with no
    // arguments; anything else is asked whether it is one.
    const parent = table.get(entry.ppid);
    if (parent && !parent.zombie && entry.ppid > 1 && (/(?:^|\/)agent-browser[^/\s]*$/.test(parent.args ?? "") || (await processEnvironment(entry.ppid))?.get("AGENT_BROWSER_DAEMON") === "1")) continue;
    const env = await processEnvironment(pid);
    const session = env?.get("AGENT_BROWSER_SESSION");
    if (env?.get("AGENT_BROWSER_DAEMON") !== "1" || !session || !/^[A-Za-z0-9_.-]{1,96}$/.test(session) || (home && env.get("HOME") !== home)) continue;
    const profile = temporaryProfile(entry.args);
    found.push({ session, tree: { daemon: pid, members: new Map([[pid, entry.started]]), groups: [pid], profiles: profile ? [profile] : [] } });
  }
  return found;
}

/** The lock a daemon's own Chrome held when last checked, and that daemon: while both live, a call lists no processes. */
const heldProfiles = new Map<string, { target: string; daemon: number }>();

function namesProfile(args: string, dir: string): boolean {
  const flag = `--user-data-dir=${dir}`;
  for (let at = args.indexOf(flag); at >= 0; at = args.indexOf(flag, at + 1)) {
    if (at + flag.length === args.length || args[at + flag.length] === " ") return true;
  }
  return false;
}

async function daemonOf(pid: number, table: Map<number, ListedProcess>): Promise<number | null> {
  for (let parent = table.get(pid)?.ppid ?? 0, depth = 0; parent > 1 && depth < 3; parent = table.get(parent)?.ppid ?? 0, depth++) {
    if (table.get(parent)?.zombie) return null;
    if ((await processEnvironment(parent))?.get("AGENT_BROWSER_DAEMON") === "1") return parent;
  }
  return null;
}

/** POSIX Chrome locks its profile with a SingletonLock symlink to `<host>-<pid>`. A later launch on the profile hands itself
 * to the Chrome the lock names and exits, and refuses a lock that names another host (a renamed Mac, a moved volume). A
 * Chrome whose daemon was killed keeps running, re-parented, and would take every later launch, so it is stopped; then the
 * stale lock goes. A daemon's own Chrome keeps its lock. The profile's contents are never touched. Windows: no lock handling. */
export async function releaseBrowserProfile(dir: string | undefined): Promise<void> {
  if (!dir || process.platform === "win32") return;
  let target: string;
  try { target = readlinkSync(join(dir, "SingletonLock")); }
  catch { heldProfiles.delete(dir); return; }
  const match = /^(.*)-(\d+)$/.exec(target);
  const held = heldProfiles.get(dir);
  if (held?.target === target && match?.[1] === hostname() && processAlive(Number(match[2])) && processAlive(held.daemon)) return;
  heldProfiles.delete(dir);
  const table = await processTable(true);
  if (!table) return;
  const browsers = [...table].filter(([, entry]) => !entry.zombie && namesProfile(entry.args ?? "", dir) && !/(?:^|\s)--type=/.test(entry.args ?? ""));
  for (const [pid, entry] of browsers) {
    const daemon = await daemonOf(pid, table);
    if (daemon !== null) { heldProfiles.set(dir, { target, daemon }); return; }
    if (!await stopBrowserProcesses({ daemon: pid, members: new Map([[pid, entry.started]]), groups: entry.pgid === pid ? [pid] : [] })) return;
  }
  for (const name of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) { try { unlinkSync(join(dir, name)); } catch { /* already gone */ } }
}

/** Whether `pid` is still the member of the tree it was when read: the same
 * start time, and not a zombie (exited, waiting to be collected). */
function stillRuns(tree: BrowserProcessTree, table: Map<number, ListedProcess>, pid: number): boolean {
  const entry = table.get(pid);
  return !!entry && !entry.zombie && entry.started === tree.members.get(pid);
}

/** What of a tree still runs: each member that is still the same process,
 * and every process in one of its groups, a helper Chrome started after the
 * tree was read included. The system gives no new process the number of a
 * group that still has a process in it (Linux and macOS alike), so a group is
 * still the tree's own unless its leader's number now runs another process:
 * then that group had emptied and the number came back, and it is never
 * signalled. */
function survivors(tree: BrowserProcessTree, table: Map<number, ListedProcess>): { pids: number[]; groups: number[] } {
  const same = (pid: number) => table.get(pid)?.started === tree.members.get(pid);
  const groups = tree.groups.filter((group) => !table.has(group) || same(group));
  const pids = [...table].filter(([pid, entry]) => !entry.zombie && ((tree.members.has(pid) && same(pid)) || groups.includes(entry.pgid))).map(([pid]) => pid);
  return { pids, groups: groups.filter((group) => pids.some((pid) => table.get(pid)!.pgid === group)) };
}

/** Windows: whether the tree's daemon still runs the image it ran when read;
 * null when tasklist could not say. Windows soon gives a freed pid to a new
 * process, which neither counts nor is ever killed as the daemon. */
async function windowsDaemonRuns(tree: BrowserProcessTree): Promise<boolean | null> {
  const image = await imageOf(tree.daemon);
  return image === null ? null : !!image && image === tree.image;
}

/** Whether any process of the tree still runs. */
export async function browserProcessesRunning(tree: BrowserProcessTree): Promise<boolean> {
  if (process.platform === "win32") return await windowsDaemonRuns(tree) ?? processAlive(tree.daemon);
  const table = await processTable();
  if (!table) return [...tree.members.keys()].some(processAlive);
  return survivors(tree, table).pids.length > 0;
}

/** Polls every 100 ms until `done()` or `ms` have passed; whether it was done. */
async function within(ms: number, done: () => Promise<boolean>): Promise<boolean> {
  for (const until = Date.now() + ms; ; await new Promise((resolve) => setTimeout(resolve, 100))) {
    if (await done()) return true;
    if (Date.now() >= until) return false;
  }
}

/** Stop a tree that would not close. Its root gets TERM first, alone: a
 * daemon then saves the session's sign-ins over its Chrome's DevTools
 * connection and stops that Chrome itself, so Chrome must still run while it
 * does (CONT wakes a stopped daemon to act on it). Past `graceMs`, the rest
 * of the tree is killed by process group. True once nothing of it runs. */
export async function stopBrowserProcesses(tree: BrowserProcessTree, graceMs = 1_500): Promise<boolean> {
  if (process.platform === "win32") {
    // /T takes the daemon's Chrome with it while the daemon still runs. Only
    // a pid that still runs the daemon's image is named: never one Windows
    // gave to another program, nor one tasklist could not vouch for.
    if (await windowsDaemonRuns(tree)) await execText("taskkill", ["/PID", String(tree.daemon), "/T", "/F"]);
    return within(2_000, async () => await windowsDaemonRuns(tree) === false);
  }
  const send = (target: number, signal: NodeJS.Signals) => { try { process.kill(target, signal); } catch { /* already gone */ } };
  const rootRuns = async () => {
    const table = await processTable();
    return table ? stillRuns(tree, table, tree.daemon) : processAlive(tree.daemon);
  };
  if (await rootRuns()) {
    send(tree.daemon, "SIGTERM");
    send(tree.daemon, "SIGCONT");
    await within(graceMs, async () => !await rootRuns());
  }
  let gone = false;
  for (let pass = 0; pass < 2 && !gone; pass++) {
    const table = await processTable();
    if (!table) {
      for (const pid of tree.members.keys()) send(pid, "SIGKILL");
    } else {
      const left = survivors(tree, table);
      if (!left.pids.length) { gone = true; break; }
      // A group at once, with whatever it starts meanwhile; a process in no
      // group of the tree's own by its number.
      for (const group of left.groups) send(-group, "SIGKILL");
      for (const pid of left.pids) if (!left.groups.includes(table.get(pid)!.pgid)) send(pid, "SIGKILL");
    }
    gone = await within(1_000, async () => !await browserProcessesRunning(tree));
  }
  // What the daemon would have removed had it closed this Chrome itself.
  if (gone) for (const dir of tree.profiles ?? []) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } }
  return gone;
}
