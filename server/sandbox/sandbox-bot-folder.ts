// The layout of a person's server environment (/workspace), 2026-11-02:
// every bot works in its own folder, /workspace/bots/<slug>/, never at the
// root. The slug is the bot's name made safe for a path, kept for good once
// given (a renamed bot keeps its folder), and unique among the bots of this
// server: on a collision it gets a short numeric suffix (-2, -3), never an id.
//
//   /workspace/bots/<slug>/       a bot's own folder: the working directory of
//                                 its commands, its terminal, its routine
//                                 watches, and where relative paths start
//   /workspace/bots/<slug>/tmp/   its temporary files (TMPDIR), emptied of
//                                 anything older than 7 days at each start
//   /workspace/shared/            what the person's bots share
//   /workspace/_unsorted/<date>/  loose files of the root nobody could claim
//
// At the first bot call after the environment starts (its /tmp is a tmpfs, so
// a marker there says "this start was tidied"), the tidy moves every loose
// file or folder of the root into the folder of the bot whose conversations
// name it, else into _unsorted/<date>/. Nothing is deleted; each move is
// written to _unsorted/MOVES-<date>.md (and moves.json), and a link to the
// new place is left at the old path, so old absolute paths and commands run
// from the root keep working. The links are listed in /workspace/.hidden:
// Thunar (GLib) and the bot's root listing do not show them, the next tidy
// leaves them be. Routines whose prompt or watch names a moved path are
// also updated to the new path.
import { existsSync, readFileSync } from "node:fs";
import { writeFileAtomic } from "../atomic.ts";
import type { SandboxExecInput, SandboxExecOutput } from "./sandboxd-core.ts";
import { SANDBOX_WORKSPACE } from "./user-sandbox-spec.ts";
import { workspaceDiskLevel, type WorkspaceDisk } from "../../shared/workspace-disk.ts";

export const SANDBOX_BOTS_DIR = `${SANDBOX_WORKSPACE}/bots`;
export const SANDBOX_SHARED_DIR = `${SANDBOX_WORKSPACE}/shared`;
export const SANDBOX_UNSORTED_DIR = `${SANDBOX_WORKSPACE}/_unsorted`;
/** Days a file of a bot's tmp/ is kept after its last change. */
export const BOT_TMP_RETENTION_DAYS = 7;
/** The entries of /workspace the tidy never moves, besides every dot entry
 * (HOME is /workspace: .config, .ssh, .gitconfig, .sagax...). One list:
 * the tidy script receives it as is. */
export const SANDBOX_ROOT_KEEP: readonly string[] = [
  "bots",
  "shared",
  "_unsorted",
  "lost+found",
  "attachments",
  "sagax-plugins",
  "sagax-capability-skills",
  "skills",
  "marketplaces",
  "Desktop",
];

const SLUG_MAX = 40;
export const BOT_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;
/** A bot folder, as the provisioner accepts it for a terminal's directory. */
export const BOT_FOLDER_RE = /^\/workspace\/bots\/[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;

/** "Agent Mélanie (CW)" -> "agent-melanie-cw". Never empty. */
export function slugifyBotName(name: string): string {
  const slug = (name ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, "");
  return slug || "bot";
}

export function botFolderPath(slug: string): string {
  if (!BOT_SLUG_RE.test(slug)) throw new Error("invalid bot folder name");
  return `${SANDBOX_BOTS_DIR}/${slug}`;
}

/** Each bot's folder name, kept in DATA_DIR so it survives a rename. */
export class BotFolderRegistry {
  private readonly file: string;
  private readonly slugs = new Map<string, string>();
  private loaded = false;

  constructor(file: string) {
    this.file = file;
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (!existsSync(this.file)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as { slugs?: Record<string, unknown> };
      for (const [botId, slug] of Object.entries(parsed.slugs ?? {})) {
        if (typeof slug === "string" && BOT_SLUG_RE.test(slug)) this.slugs.set(botId, slug);
      }
    } catch (error) {
      console.error(`bot folders: ${this.file} is unreadable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** The folder name already given to this bot, or null. */
  known(botId: string): string | null {
    this.load();
    return this.slugs.get(botId) ?? null;
  }

  /** This bot's folder name, given now from its name when it has none. */
  slugFor(botId: string, name: string): string {
    this.load();
    const kept = this.slugs.get(botId);
    if (kept) return kept;
    const taken = new Set(this.slugs.values());
    const base = slugifyBotName(name);
    let slug = base;
    for (let n = 2; taken.has(slug); n++) slug = `${base.slice(0, SLUG_MAX - String(n).length - 1)}-${n}`;
    this.slugs.set(botId, slug);
    try {
      writeFileAtomic(this.file, `${JSON.stringify({ version: 1, slugs: Object.fromEntries(this.slugs) }, null, 2)}\n`);
    } catch (error) {
      console.error(`bot folders: could not save ${this.file}: ${error instanceof Error ? error.message : String(error)}`);
    }
    return slug;
  }

  folderFor(botId: string, name: string): string {
    return botFolderPath(this.slugFor(botId, name));
  }
}

/** Runs the command in the bot's folder (created on first use, with its
 * tmp/), TMPDIR there. Backend-neutral: a plain argv prefix, so the Docker
 * and Kubernetes provisioners, old or new, run it the same way. */
const IN_FOLDER_SH = 'd="$1"; shift; mkdir -p -- "$d/tmp" 2>/dev/null; if cd -- "$d" 2>/dev/null; then export TMPDIR="$d/tmp" SAGAX_BOT_DIR="$d"; else cd /workspace; fi; exec "$@"';

export function inBotFolder(input: SandboxExecInput, folder: string): SandboxExecInput {
  if (!BOT_FOLDER_RE.test(folder) || input.argv.length === 0) return input;
  return { ...input, argv: ["sh", "-c", IN_FOLDER_SH, "sagax-bot-folder", folder, ...input.argv] };
}

/** What the bot is told about the layout (tool descriptions, workplace note). */
export function botFolderNote(folder: string, serverDataDir?: string): string {
  return `In your server environment your own folder is ${folder}: your commands start there and relative paths resolve there. Keep your files in it, temporary files in ${folder}/tmp (emptied of files older than ${BOT_TMP_RETENTION_DAYS} days), and only what the person's other bots must share in ${SANDBOX_SHARED_DIR}. Never write loose files at the ${SANDBOX_WORKSPACE} root.${serverDataDir ? ` ${serverFolderNote(folder, serverDataDir)}` : ""}`;
}

/** 2026-11-02 (production): the engine itself runs on the Sagax server,
 * in a working folder under the server's data folder (the CLI may report it
 * as its current directory). That folder is not in the environment: a bot
 * that took it for its own folder called list_files on it. Said plainly in
 * the workplace note of every turn whose tools may run in the environment. */
export function serverFolderNote(folder: string, serverDataDir: string): string {
  return `Your engine itself runs on the Sagax server: its working folder and anything under ${serverDataDir} are on that server, not in your server environment. Never give such a path to your server environment tools (run_command, read_file, write_file, list_files); your files are in ${folder}.`;
}

export type { WorkspaceDisk };
export { workspaceDiskLevel };

const GiB = 1024 ** 3;

function formatSize(bytes: number): string {
  if (bytes >= GiB) return `${(bytes / GiB).toFixed(1)} GiB`;
  return `${Math.max(0, Math.round(bytes / (1024 * 1024)))} MiB`;
}

/** The line a tool result carries while the disk is (almost) full. */
export function workspaceDiskWarning(disk: WorkspaceDisk | null, folder?: string): string | null {
  const level = workspaceDiskLevel(disk);
  if (level === "normal" || !disk) return null;
  const where = folder ? ` Start with ${folder}/tmp and large files you no longer need.` : "";
  return level === "full"
    ? `[disk full: /workspace has ${formatSize(disk.freeBytes)} free of ${formatSize(disk.totalBytes)}. Writes will fail: free space now and tell the person.${where}]`
    : `[disk almost full: /workspace has ${formatSize(disk.freeBytes)} free of ${formatSize(disk.totalBytes)}. Free space soon and tell the person.${where}]`;
}

/** The tidy, run inside the environment (python3 -I -c SCRIPT mode).
 *   scan:  {"tidied": bool, "entries": [{name, dir}], "disk": {free, total}}
 *          (entries: the loose root entries, only when not tidied yet)
 *   apply: reads the plan on stdin ({"date", "moves": [{name, dest}]}), moves
 *          without overwriting, writes the manifests, empties old tmp files,
 *          marks this start tidied; prints {"moved": [{from, to}], "cleaned": n} */
export const TIDY_SCRIPT = String.raw`
import json, os, sys, time
ROOT = os.environ.get('SAGAX_TIDY_ROOT') or '/workspace'
MARK = os.environ.get('SAGAX_TIDY_MARK') or '/tmp/.sagax-workspace-tidy'
mode = sys.argv[1]
keep = set(json.loads(sys.argv[2]))
HIDDEN = os.path.join(ROOT, '.hidden')
def links():
    # The links the tidy left at the root (listed in .hidden, still links).
    try:
        names = [line.strip() for line in open(HIDDEN, encoding='utf-8')]
    except OSError:
        return set()
    return {n for n in names if n and '/' not in n and os.path.islink(os.path.join(ROOT, n))}
def disk():
    try:
        s = os.statvfs(ROOT)
        return {'free': s.f_bavail * s.f_frsize, 'total': s.f_blocks * s.f_frsize}
    except OSError:
        return None
if mode == 'scan':
    tidied = os.path.exists(MARK)
    entries = []
    if not tidied:
        ours = links()
        for name in sorted(os.listdir(ROOT)):
            if name.startswith('.') or name in keep or name in ours:
                continue
            path = os.path.join(ROOT, name)
            entries.append({'name': name, 'dir': os.path.isdir(path) and not os.path.islink(path)})
            if len(entries) >= 2000:
                break
    print(json.dumps({'tidied': tidied, 'entries': entries, 'disk': disk()}))
    sys.exit(0)
size = int(sys.argv[3])
plan = json.loads(sys.stdin.buffer.read(size).decode('utf-8')) if size > 0 else {'moves': []}
date = plan.get('date') or time.strftime('%Y-%m-%d', time.gmtime())
for folder in ('bots', 'shared'):
    os.makedirs(os.path.join(ROOT, folder), exist_ok=True)
moved = []
def free_name(dest, name):
    target = os.path.join(dest, name)
    if not os.path.lexists(target):
        return target
    stem, ext = os.path.splitext(name)
    if name.startswith('.') or os.path.isdir(os.path.join(ROOT, name)):
        stem, ext = name, ''
    n = 2
    while os.path.lexists(os.path.join(dest, '%s (%d)%s' % (stem, n, ext))):
        n += 1
    return os.path.join(dest, '%s (%d)%s' % (stem, n, ext))
for move in plan.get('moves', []):
    name = move.get('name', '')
    dest = move.get('dest', '')
    if not name or '/' in name or name in ('.', '..') or name.startswith('.') or name in keep:
        continue
    if not (dest.startswith(ROOT + '/bots/') or dest.startswith(ROOT + '/_unsorted/')) or '..' in dest.split('/'):
        continue
    source = os.path.join(ROOT, name)
    if not os.path.lexists(source):
        continue
    try:
        os.makedirs(dest, exist_ok=True)
        target = free_name(dest, name)
        os.rename(source, target)
        # A link at the old path: absolute paths and commands run from the
        # root still find it. Hidden from Thunar (.hidden) and the bot's
        # root listing, never moved again.
        try:
            os.symlink(target, source)
            linked = True
        except OSError:
            linked = False
        moved.append({'from': source, 'to': target, 'link': linked})
    except OSError as error:
        sys.stderr.write('could not move %s: %s\n' % (source, error))
if moved:
    unsorted = os.path.join(ROOT, '_unsorted')
    os.makedirs(unsorted, exist_ok=True)
    manifest = os.path.join(unsorted, 'MOVES-%s.md' % date)
    new = not os.path.exists(manifest)
    with open(manifest, 'a', encoding='utf-8') as out:
        if new:
            out.write('# Files moved out of /workspace on %s\n\nEach loose file or folder of the /workspace root was moved into the folder of the bot that made it, or into _unsorted/%s/ when no bot could be found. Nothing was deleted. A link was left at each old path (hidden: listed in /workspace/.hidden), so old paths still work; delete a link once nothing uses it.\n\n| Old path | New path | Link at old path |\n|---|---|---|\n' % (date, date))
        for row in moved:
            out.write('| %s | %s | %s |\n' % (row['from'], row['to'], 'yes' if row['link'] else 'no'))
    names = [os.path.basename(row['from']) for row in moved if row['link']]
    if names:
        try:
            known_names = [line.rstrip('\n') for line in open(HIDDEN, encoding='utf-8')]
        except OSError:
            known_names = []
        with open(HIDDEN, 'a', encoding='utf-8') as out:
            for name in names:
                if name not in known_names:
                    out.write(name + '\n')
    index = os.path.join(unsorted, 'moves.json')
    try:
        with open(index, encoding='utf-8') as source:
            known = json.load(source)
    except (OSError, ValueError):
        known = {}
    for row in moved:
        known[row['from']] = row['to']
    with open(index + '.tmp', 'w', encoding='utf-8') as out:
        json.dump(known, out, indent=1, sort_keys=True)
    os.replace(index + '.tmp', index)
cleaned = 0
limit = time.time() - int(sys.argv[4]) * 86400
bots = os.path.join(ROOT, 'bots')
for slug in os.listdir(bots):
    tmp = os.path.join(bots, slug, 'tmp')
    if os.path.islink(tmp) or not os.path.isdir(tmp):
        continue
    for base, dirs, files in os.walk(tmp, topdown=False):
        for name in files:
            path = os.path.join(base, name)
            try:
                if os.lstat(path).st_mtime < limit:
                    os.unlink(path)
                    cleaned += 1
            except OSError:
                pass
        if base != tmp:
            try:
                if not os.listdir(base) and os.lstat(base).st_mtime < limit:
                    os.rmdir(base)
            except OSError:
                pass
open(MARK, 'w').close()
print(json.dumps({'moved': moved, 'cleaned': cleaned, 'disk': disk()}))
`;

export interface TidyMove {
  from: string;
  to: string;
  /** A link to the new place was left at the old path. */
  link?: boolean;
}

export interface WorkspaceTidyDeps {
  exec(principalId: string, input: SandboxExecInput, botId?: string): Promise<SandboxExecOutput>;
  /** Which bot made each of these root entries, by its conversations and
   * tool calls; a name no single bot can be found for is left out. */
  attribute(principalId: string, names: readonly string[]): Map<string, string>;
  /** The folder of a bot (null: the bot is gone). */
  folderOf(botId: string): string | null;
  /** After moves: update what pointed at the old paths (routines). */
  moved?(principalId: string, moves: readonly TidyMove[]): void;
  now?: () => number;
  log?: (line: string) => void;
  /** The workspace root as the script sees it (tests). */
  root?: string;
}

/** How long a person's tidy check and disk figure are trusted before the
 * next bot call looks again (a restarted environment is caught by then). */
const RECHECK_MS = 5 * 60_000;

/** The start-of-environment tidy and the disk figure, per person. */
export class WorkspaceTidier {
  private readonly deps: WorkspaceTidyDeps;
  private readonly checked = new Map<string, { at: number; disk: WorkspaceDisk | null }>();
  private readonly running = new Map<string, Promise<void>>();

  constructor(deps: WorkspaceTidyDeps) {
    this.deps = deps;
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /** The last disk figure of this person's /workspace, or null. */
  disk(principalId: string): WorkspaceDisk | null {
    return this.checked.get(principalId)?.disk ?? null;
  }

  /** Forget a person (their environment was reset or removed). */
  forget(principalId: string): void {
    this.checked.delete(principalId);
  }

  /** Tidy once per start of this person's environment. Never throws. */
  ensure(principalId: string, botId?: string): Promise<void> {
    const last = this.checked.get(principalId);
    if (last && this.now() - last.at < RECHECK_MS) return Promise.resolve();
    const pending = this.running.get(principalId);
    if (pending) return pending;
    const run = this.tidy(principalId, botId)
      .catch((error: unknown) => { this.deps.log?.(`workspace tidy failed: ${error instanceof Error ? error.message : String(error)}`); })
      .finally(() => { this.running.delete(principalId); });
    this.running.set(principalId, run);
    return run;
  }

  private async tidy(principalId: string, botId?: string): Promise<void> {
    const keep = JSON.stringify(SANDBOX_ROOT_KEEP);
    const scan = await this.deps.exec(principalId, { argv: ["python3", "-I", "-c", TIDY_SCRIPT, "scan", keep], timeoutSec: 60, maxOutputBytes: 512 * 1024 }, botId);
    if (scan.exitCode !== 0) throw new Error(scan.stderr.trim().slice(0, 200) || "scan failed");
    const found = JSON.parse(scan.stdout.trim().split("\n").at(-1) ?? "{}") as { tidied?: boolean; entries?: Array<{ name?: unknown }>; disk?: { free?: unknown; total?: unknown } | null };
    const diskOf = (value: { free?: unknown; total?: unknown } | null | undefined): WorkspaceDisk | null =>
      value && typeof value.free === "number" && typeof value.total === "number" ? { freeBytes: value.free, totalBytes: value.total } : null;
    this.checked.set(principalId, { at: this.now(), disk: diskOf(found.disk) });
    if (found.tidied) return;
    const names = (found.entries ?? []).map((entry) => entry.name).filter((name): name is string => typeof name === "string" && name.length > 0);
    const date = new Date(this.now()).toISOString().slice(0, 10);
    const owners = names.length ? this.deps.attribute(principalId, names) : new Map<string, string>();
    const moves = names.map((name) => {
      const owner = owners.get(name);
      const folder = owner ? this.deps.folderOf(owner) : null;
      return { name, dest: folder ?? `${this.deps.root ? `${this.deps.root}/_unsorted` : SANDBOX_UNSORTED_DIR}/${date}` };
    });
    const plan = Buffer.from(JSON.stringify({ date, moves }), "utf8");
    const applied = await this.deps.exec(principalId, {
      argv: ["python3", "-I", "-c", TIDY_SCRIPT, "apply", keep, String(plan.length), String(BOT_TMP_RETENTION_DAYS)],
      stdinBase64: plan.toString("base64"),
      timeoutSec: 300,
      maxOutputBytes: 1024 * 1024,
    }, botId);
    if (applied.exitCode !== 0) throw new Error(applied.stderr.trim().slice(0, 200) || "tidy failed");
    const result = JSON.parse(applied.stdout.trim().split("\n").at(-1) ?? "{}") as { moved?: TidyMove[]; cleaned?: number; disk?: { free?: unknown; total?: unknown } | null };
    this.checked.set(principalId, { at: this.now(), disk: diskOf(result.disk) ?? diskOf(found.disk) });
    const moved = (result.moved ?? []).filter((row) => typeof row?.from === "string" && typeof row?.to === "string");
    if (moved.length) {
      this.deps.log?.(`workspace tidy: moved ${moved.length} loose entr${moved.length === 1 ? "y" : "ies"} out of /workspace`);
      try { this.deps.moved?.(principalId, moved); } catch (error) {
        this.deps.log?.(`workspace tidy: path update failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}

/** Replace each moved path in a text (a routine's prompt, a watched path):
 * only whole paths, so /workspace/a.txt never touches /workspace/a.txt.bak. */
export function rewriteMovedPaths(text: string, moves: readonly TidyMove[]): string {
  let out = text;
  for (const move of moves) {
    if (!out.includes(move.from)) continue;
    const escaped = move.from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`${escaped}(?![A-Za-z0-9._+-])`, "g"), move.to);
  }
  return out;
}
