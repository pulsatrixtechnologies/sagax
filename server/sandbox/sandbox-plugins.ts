// A bot's installed plugins, copied into its owner's cloud computer (the
// person's server environment) once per turn when they changed (2026-10-19,
// bot quality cause A). On an organization server a plugin lives on the
// Sagax host, where no command of anyone runs (withholdHostTools): the bot
// saw a plugin (Pulsatrix Flow's px_flow.py) it could not run and asked the
// person to run it. A copy in the person's own environment runs there, with
// the person's own rights and GitHub connection, never the host's.
//
// Rules:
//   - Only the bot owner's own environment receives the bot's plugins
//     (the caller checks): a plugin can come from a private marketplace the
//     owner reads, so it never lands in another person's environment.
//   - Only what the install kept (bot-plugins.ts strips hooks, MCP and LSP
//     servers) and no symlink (workspaceManifest refuses them).
//   - The folder is replaced whole and a digest marker says what is there.
//     #3619: what an environment holds is remembered (SandboxPluginPresence)
//     and each folder's digest too (sandbox-plugin-digests.ts): a turn whose
//     plugins did not change sends no command and reads no plugin file; the
//     markers left to check are read by one command for the whole turn.
//   - Copies may run at once into one environment (2026-11-04, an organization server: every
//     bot of a person resynced a refreshed Flow on its next turn): each copy
//     stages and unpacks under its own name, and the swap that loses a race
//     to an identical copy counts as copied.
import { execChild } from "../process/spawn-helper.ts";
import { createHash, randomBytes } from "node:crypto";
import { cpSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";

import type { SandboxExecInput } from "./sandboxd-core.ts";
import { manifestDigest, pluginFolderDigests, type PluginFolderDigests } from "./sandbox-plugin-digests.ts";
import { workspaceManifest } from "./sandbox-workspace-copy.ts";

/** Where the plugins land in the person's environment (/workspace persists). */
export const SANDBOX_PLUGINS_DIR = "/workspace/sagax-plugins";
/** Where the person's own skills land (syncPluginFoldersForTurn). */
export const SANDBOX_CAPABILITY_SKILLS_DIR = "/workspace/sagax-capability-skills";
/** #4082: each plugin's data folder in the environment, the place its text
 * names as `${CLAUDE_PLUGIN_DATA}`. Kept apart from the plugin folder, which
 * a copy replaces whole, so what a plugin stores survives its updates. */
export const SANDBOX_PLUGIN_DATA_DIR = "/workspace/sagax-plugin-data";

/** #4082: the paths a plugin's text names, in the environment. Without
 * `data`, `${CLAUDE_PLUGIN_DATA}` stays as written. */
export interface PluginEnvironmentPaths { root: string; data?: string }

/** One plugin's folder and data folder in the person's environment. */
export function sandboxPluginPaths(name: string, root = SANDBOX_PLUGINS_DIR, dataRoot = SANDBOX_PLUGIN_DATA_DIR): Required<PluginEnvironmentPaths> {
  return { root: `${root}/${name}`, data: `${dataRoot}/${name}` };
}

const PLUGIN_PATH_VARIABLE = /\$\{CLAUDE_PLUGIN_(ROOT|DATA)\}|\$CLAUDE_PLUGIN_(ROOT|DATA)(?![A-Za-z0-9_])/g;

/** #4082: a plugin's skill, command or agent text with `${CLAUDE_PLUGIN_ROOT}`
 * and `${CLAUDE_PLUGIN_DATA}` (braced or bare) written as the environment's
 * paths. The engine reads that text on the Sagax server and would put the
 * server's folder there, while the bot runs the commands in its environment,
 * where the plugin's copy lives. */
export function withEnvironmentPluginPaths(text: string, paths: PluginEnvironmentPaths): string {
  return text.replace(PLUGIN_PATH_VARIABLE, (match: string, braced?: string, bare?: string) => ((braced ?? bare) === "ROOT" ? paths.root : paths.data ?? match));
}

/** The text files (`.md`) a plugin's engine reads as skills, commands and
 * agents: these folders and the same keys of its manifest, inside the plugin
 * only, links never followed. */
export function pluginTextFiles(dir: string, keys: ReadonlyArray<"skills" | "commands" | "agents"> = ["skills", "commands", "agents"]): string[] {
  const base = resolve(dir);
  const roots = keys.map((key) => join(base, key));
  try {
    const manifest = JSON.parse(readFileSync(join(base, ".claude-plugin", "plugin.json"), "utf8")) as Record<string, unknown>;
    for (const key of keys) {
      const value = manifest[key];
      const entries = typeof value === "string" ? value.split(",") : Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
      for (const entry of entries.map((item) => item.trim()).filter(Boolean)) {
        const path = resolve(base, entry);
        if (path === base || path.startsWith(base + sep)) roots.push(path);
      }
    }
  } catch { /* no manifest, or none readable: the folders only */ }
  const out = new Set<string>();
  const walk = (path: string, depth: number) => {
    let stat;
    try { stat = lstatSync(path); } catch { return; }
    if (stat.isSymbolicLink()) return;
    if (stat.isFile()) { if (path.endsWith(".md")) out.add(path); return; }
    if (!stat.isDirectory() || depth > 4) return;
    for (const name of readdirSync(path)) walk(join(path, name), depth + 1);
  };
  for (const root of roots) walk(root, 0);
  return [...out].sort();
}

/** #4082: the plugin's text files that name its paths, rewritten for the
 * environment (relative path to new text). Empty when none does. */
export function environmentPluginRewrites(dir: string, paths: PluginEnvironmentPaths): Map<string, string> {
  const rewrites = new Map<string, string>();
  for (const file of pluginTextFiles(dir)) {
    let text: string;
    try { text = readFileSync(file, "utf8"); } catch { continue; }
    const next = withEnvironmentPluginPaths(text, paths);
    if (next !== text) rewrites.set(relative(resolve(dir), file), next);
  }
  return rewrites;
}

/** Whether a plugin content names its paths, by its digest: read once. */
const namesPluginPaths = new Map<string, boolean>();
function contentNamesPluginPaths(dir: string, digest: string): boolean {
  let known = namesPluginPaths.get(digest);
  if (known === undefined) {
    known = environmentPluginRewrites(dir, { root: "/", data: "/" }).size > 0;
    namesPluginPaths.set(digest, known);
    if (namesPluginPaths.size > 2_000) namesPluginPaths.delete(namesPluginPaths.keys().next().value!);
  }
  return known;
}
/** A plugin larger than this (compressed) is not copied. */
export const MAX_PLUGIN_ARCHIVE_BYTES = 16 * 1024 * 1024;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const CHUNK = 48 * 1024;
/** Time for one command of the copy (8 pieces). */
const COPY_STEP_SECONDS = 60;

export interface SandboxPluginExec {
  exec(input: SandboxExecInput): Promise<{ exitCode: number | null; stdout: string; stderr: string; timedOut?: boolean }>;
}

/** The plugin's content digest: every file's path, size and sha256. */
export function pluginDigest(dir: string): string {
  return manifestDigest(workspaceManifest(dir));
}

function tarFolder(dir: string): Promise<Buffer> {
  return new Promise((done, reject) => {
    execChild("tar", ["-czf", "-", "-C", dir, "."], { encoding: "buffer", maxBuffer: MAX_PLUGIN_ARCHIVE_BYTES + 1, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", COPYFILE_DISABLE: "1" } },
      (error, stdout) => (error ? reject(error) : done(stdout as unknown as Buffer)));
  });
}

/** The plugin's archive; with `paths`, its text names the environment's
 * paths (#4082), from a staged copy (the installed folder is never changed). */
async function pluginArchive(dir: string, paths?: PluginEnvironmentPaths): Promise<Buffer> {
  const rewrites = paths ? environmentPluginRewrites(dir, paths) : new Map<string, string>();
  if (!rewrites.size) return tarFolder(dir);
  const staging = mkdtempSync(join(tmpdir(), "sagax-plugin-"));
  try {
    const copy = join(staging, "plugin");
    cpSync(dir, copy, { recursive: true, dereference: false });
    for (const [path, text] of rewrites) writeFileSync(join(copy, path), text);
    return await tarFolder(copy);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/** #4082: the marker of a copy whose text names the environment's paths:
 * a copy made before that rewrite (same content) is replaced once. */
function environmentDigest(digest: string, paths: PluginEnvironmentPaths): string {
  return createHash("sha256").update(`environment-paths-1\0${digest}\0${paths.root}\0${paths.data}`).digest("hex");
}

export interface PluginSyncResult {
  copied: string[];
  unchanged: string[];
  skipped: Array<{ name: string; reason: string }>;
  /** #3440: plugins whose last copy failed and whose cause may still be
   * there: not tried again before `retryAt` (epoch ms) unless they change. */
  deferred?: Array<{ name: string; reason: string; retryAt: number }>;
}

/** First wait before a failed copy is tried again; it doubles to the cap. */
export const PLUGIN_COPY_RETRY_MS = 60_000;
export const PLUGIN_COPY_RETRY_MAX_MS = 30 * 60_000;

/** #3440: the copies that failed, per environment and plugin. A copy that
 * failed was tried again at every turn of every bot, the whole archive each
 * time, exactly while the environment was saturated: now the same content
 * waits before it is tried again (one minute, doubling up to 30), a changed
 * plugin is tried at once, and a success forgets the failure. */
export class PluginCopyFailures {
  private readonly rows = new Map<string, { digest: string; failures: number; at: number; reason: string }>();
  private readonly now: () => number;
  constructor(now: () => number = Date.now) { this.now = now; }

  private static key(scope: string, name: string): string { return `${scope}\n${name}`; }

  /** The failure that still holds this content back, or null to copy now. */
  pending(scope: string, name: string, digest: string): { reason: string; retryAt: number } | null {
    const row = this.rows.get(PluginCopyFailures.key(scope, name));
    if (!row || row.digest !== digest) return null;
    const retryAt = row.at + Math.min(PLUGIN_COPY_RETRY_MAX_MS, PLUGIN_COPY_RETRY_MS * 2 ** Math.min(10, row.failures - 1));
    return this.now() < retryAt ? { reason: row.reason, retryAt } : null;
  }

  failed(scope: string, name: string, digest: string, reason: string): { retryAt: number } {
    const key = PluginCopyFailures.key(scope, name);
    const row = this.rows.get(key);
    const failures = row && row.digest === digest ? row.failures + 1 : 1;
    this.rows.set(key, { digest, failures, at: this.now(), reason });
    if (this.rows.size > 5_000) this.rows.delete(this.rows.keys().next().value!);
    return { retryAt: this.now() + Math.min(PLUGIN_COPY_RETRY_MAX_MS, PLUGIN_COPY_RETRY_MS * 2 ** Math.min(10, failures - 1)) };
  }

  succeeded(scope: string, name: string): void { this.rows.delete(PluginCopyFailures.key(scope, name)); }

  /** Why the plugin is not in the environment, whatever its content, or null. */
  reasonFor(scope: string, name: string): string | null {
    return this.rows.get(PluginCopyFailures.key(scope, name))?.reason ?? null;
  }

  /** For a bot's command that failed: one line per plugin folder it names
   * whose copy into this person's environment failed, with the reason. */
  noteForCommand(person: string, command: string): string | null {
    const notes: string[] = [];
    for (const root of [SANDBOX_PLUGINS_DIR, SANDBOX_CAPABILITY_SKILLS_DIR]) {
      const pattern = new RegExp(`${root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/([A-Za-z0-9][A-Za-z0-9._-]{0,63})`, "g");
      for (const match of command.matchAll(pattern)) {
        const reason = this.reasonFor(`${person}\n${root}`, match[1]!);
        const line = `The plugin ${match[1]} is not up to date in this server environment: its last copy failed (${reason}).`;
        if (reason && !notes.includes(line)) notes.push(line);
      }
    }
    return notes.length ? notes.join("\n") : null;
  }
}

/** #3440: the copies that failed, per person, for the whole server: a copy
 * that failed waits before it is tried again, and a bot's failed command
 * into a plugin's folder says why the plugin is missing there. */
export const pluginCopyFailures = new PluginCopyFailures();

/** #3440: what a command of the copy answered, in a few words: its exit, the
 * time limit, or its last line of stderr (the reason was dropped before). */
export function execFailureReason(result: { exitCode: number | null; stderr: string; timedOut?: boolean }, timeoutSec: number): string {
  if (result.timedOut || result.exitCode === 124) return `no answer within ${timeoutSec} s`;
  const last = result.stderr.trim().split("\n").map((line) => line.trim()).filter(Boolean).slice(-1)[0]?.slice(0, 200);
  const exit = result.exitCode === null ? "no exit status" : `exit ${result.exitCode}`;
  return last ? `${exit}: ${last}` : exit;
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error)).slice(0, 300);

/** #3619: a confirmation older than this is read again (one command for
 * all the markers of the turn): what changes a person's /workspace outside
 * this server (another server, the provisioner, a command that does not
 * name the plugin folders) sends no signal here. */
export const PLUGIN_PRESENCE_RECONFIRM_MS = 10 * 60_000;

/** #3619: what each person's environment holds, per (environment, root,
 * plugin name): the digest last confirmed there (its marker read equal, or
 * a copy that succeeded). A turn whose plugins all match sends no command.
 * An environment is `<person>` or `<person>\n<backend>`: two bots of one
 * person share it, two people never do. Forgotten when the environment's
 * /workspace is thrown away (reset, account deletion, the deletion after a
 * sign-out; user-sandbox-manager.ts), when a bot's command names a plugin
 * folder, when a copy fails, and after a server restart (memory only). */
export class SandboxPluginPresence {
  private readonly rows = new Map<string, Map<string, { digest: string; at: number }>>();
  private readonly epochs = new Map<string, number>();
  private readonly now: () => number;
  constructor(now: () => number = Date.now) { this.now = now; }

  private static person(environment: string): string { return environment.split("\n")[0]!; }
  private static key(root: string, name: string): string { return `${root}\n${name}`; }

  /** Taken before a check: a confirmation made after the person's
   * environment was forgotten in between is not kept. */
  epoch(environment: string): number { return this.epochs.get(SandboxPluginPresence.person(environment)) ?? 0; }

  /** The digest confirmed lately in this environment for this plugin. */
  confirmed(environment: string, root: string, name: string): string | undefined {
    const row = this.rows.get(environment)?.get(SandboxPluginPresence.key(root, name));
    return row && this.now() - row.at < PLUGIN_PRESENCE_RECONFIRM_MS ? row.digest : undefined;
  }

  confirm(environment: string, root: string, name: string, digest: string, epoch: number): void {
    if (this.epoch(environment) !== epoch) return;
    let held = this.rows.get(environment);
    if (!held) {
      held = new Map();
      this.rows.set(environment, held);
      if (this.rows.size > 5_000) this.rows.delete(this.rows.keys().next().value!);
    }
    held.set(SandboxPluginPresence.key(root, name), { digest, at: this.now() });
  }

  forget(environment: string, root: string, name: string): void {
    this.rows.get(environment)?.delete(SandboxPluginPresence.key(root, name));
  }

  /** The person's /workspace may have lost or changed its plugin folders:
   * every environment of theirs is checked again at its next turn. */
  forgetPerson(person: string): void {
    this.epochs.set(person, (this.epochs.get(person) ?? 0) + 1);
    for (const environment of this.rows.keys()) {
      if (SandboxPluginPresence.person(environment) === person) this.rows.delete(environment);
    }
  }

  /** A bot's command that names a plugin folder may have changed it. */
  noteCommand(person: string, command: string): void {
    if (command.includes(SANDBOX_PLUGINS_DIR) || command.includes(SANDBOX_CAPABILITY_SKILLS_DIR)) this.forgetPerson(person);
  }
}

/** The server's one memory of what the environments hold. */
export const sandboxPluginPresence = new SandboxPluginPresence();

export interface PluginSyncOptions {
  /** Failed copies to wait on (one store per server), with the scope of
   * this environment (the person). Without it every call copies. */
  failures?: PluginCopyFailures;
  scope?: string;
  /** #3619: what the environment holds, and its name there. With both, a
   * plugin confirmed there costs no command, and the others' markers are
   * read in one command for the whole call. */
  presence?: SandboxPluginPresence;
  environment?: string;
  /** The folder digests (one store per server by default). */
  digests?: PluginFolderDigests;
}

/** Copy each changed plugin into `root/<name>` in the environment. */
export function syncPluginsToSandbox(
  plugins: ReadonlyArray<{ name: string; dir: string }>,
  target: SandboxPluginExec,
  root = SANDBOX_PLUGINS_DIR,
  options: PluginSyncOptions & { dataRoot?: string } = {},
): Promise<PluginSyncResult> {
  return syncPluginRootsToSandbox([{ root, plugins, ...(options.dataRoot ? { dataRoot: options.dataRoot } : {}) }], target, options);
}

/** {@link syncPluginsToSandbox} for several roots at once: with an
 * environment memory, the markers of every root are read in one command.
 * #4082: a root with a `dataRoot` holds plugins an engine reads: their text
 * that names `${CLAUDE_PLUGIN_ROOT}` or `${CLAUDE_PLUGIN_DATA}` lands with
 * the environment's paths, and their data folder is made there. */
export async function syncPluginRootsToSandbox(
  groups: ReadonlyArray<{ root: string; dataRoot?: string; plugins: ReadonlyArray<{ name: string; dir: string }> }>,
  target: SandboxPluginExec,
  options: PluginSyncOptions = {},
): Promise<PluginSyncResult> {
  const out: PluginSyncResult = { copied: [], unchanged: [], skipped: [] };
  const failures = options.failures;
  const digests = options.digests ?? pluginFolderDigests;
  const presence = options.presence && options.environment !== undefined ? { memory: options.presence, environment: options.environment } : null;
  const epoch = presence ? presence.memory.epoch(presence.environment) : 0;
  const pending: Array<{ plugin: { name: string; dir: string }; root: string; digest: string; scope: string; known?: string; paths?: PluginEnvironmentPaths }> = [];
  const rows = groups.flatMap(({ root, dataRoot, plugins }) => plugins.map((plugin) => ({ root, dataRoot, plugin })));
  // the folders' digests at once: each is its signature alone while the
  // folder did not change (sandbox-plugin-digests.ts)
  const computed = await Promise.allSettled(rows.map(({ plugin }) => (NAME.test(plugin.name) ? digests.digest(plugin.dir) : Promise.reject(new Error("invalid name")))));
  rows.forEach(({ root, dataRoot, plugin }, index) => {
    const scope = `${options.scope ?? ""}\n${root}`;
    const result = computed[index]!;
    if (result.status === "rejected") {
      out.skipped.push({ name: plugin.name, reason: result.reason instanceof Error ? result.reason.message : String(result.reason) });
      return;
    }
    const paths = dataRoot !== undefined && contentNamesPluginPaths(plugin.dir, result.value) ? sandboxPluginPaths(plugin.name, root, dataRoot) : undefined;
    const digest = paths ? environmentDigest(result.value, paths) : result.value;
    const held = failures?.pending(scope, plugin.name, digest);
    if (held) { (out.deferred ??= []).push({ name: plugin.name, ...held }); return; }
    const known = presence?.memory.confirmed(presence.environment, root, plugin.name);
    if (known === digest) {
      out.unchanged.push(plugin.name);
      return;
    }
    // a changed plugin whose old content was confirmed there is copied
    // without reading its marker again
    pending.push({ plugin, root, digest, scope, ...(known !== undefined ? { known } : {}), ...(paths ? { paths } : {}) });
  });
  if (!pending.length) return out;
  // #3619: the environment's markers, all in one command, when this call
  // remembers what the environment holds; else each copy reads its own
  let markers: Map<string, string> | null = null;
  let unread: string | null = null;
  const toRead = pending.filter((row) => row.known === undefined);
  if (presence && toRead.length) {
    try { markers = await readMarkers(toRead.map((row) => `${row.root}/${row.plugin.name}`), target); } catch (error) {
      unread = `copy failed: ${errorText(error)}`;
    }
  }
  for (const { plugin, root, digest, scope, known, paths } of pending) {
    const fail = (reason: string) => {
      presence?.memory.forget(presence.environment, root, plugin.name);
      const next = failures?.failed(scope, plugin.name, digest, reason);
      out.skipped.push({ name: plugin.name, reason: next ? `${reason}; tried again in ${Math.round((next.retryAt - Date.now()) / 60_000) || 1} min or when it changes` : reason });
    };
    // a command the environment did not run (busy, the transport): the
    // reason is kept, and the next plugin is still tried
    if (unread && known === undefined) { fail(unread); continue; }
    try {
      const outcome = await copyOne(plugin, digest, target, root, known ?? (markers ? markers.get(`${root}/${plugin.name}`) ?? "" : undefined), paths);
      if (outcome === "unchanged") out.unchanged.push(plugin.name);
      else if (outcome === "copied") out.copied.push(plugin.name);
      else if (outcome.permanent) {
        presence?.memory.forget(presence.environment, root, plugin.name);
        out.skipped.push({ name: plugin.name, reason: outcome.reason });
      } else { fail(outcome.reason); continue; }
      if (presence && (outcome === "unchanged" || outcome === "copied")) presence.memory.confirm(presence.environment, root, plugin.name, digest, epoch);
      failures?.succeeded(scope, plugin.name);
    } catch (error) {
      fail(`copy failed: ${errorText(error)}`);
    }
  }
  return out;
}

/** #3619: the markers of these folders, read by one command. A folder with
 * no marker reads as empty. */
async function readMarkers(dests: readonly string[], target: SandboxPluginExec): Promise<Map<string, string>> {
  const result = await target.exec({
    argv: ["sh", "-c", 'for d in "$@"; do printf "%s\\t" "$d"; cat -- "$d/.sagax-digest" 2>/dev/null; printf "\\n"; done', "sh", ...dests],
    timeoutSec: 30,
    maxOutputBytes: dests.reduce((sum, dest) => sum + dest.length + 72, 256),
  });
  if (result.exitCode !== 0) throw new Error(`reading the plugin markers: ${execFailureReason(result, 30)}`);
  const markers = new Map<string, string>();
  for (const line of result.stdout.split("\n")) {
    const tab = line.indexOf("\t");
    if (tab > 0) markers.set(line.slice(0, tab), line.slice(tab + 1).trim());
  }
  return markers;
}

type CopyOutcome = "copied" | "unchanged" | { reason: string; permanent: boolean };

/** `known`: the marker already read for this call (readMarkers). `paths`:
 * the plugin's text names them (#4082). */
async function copyOne(plugin: { name: string; dir: string }, digest: string, target: SandboxPluginExec, root: string, known?: string, paths?: PluginEnvironmentPaths): Promise<CopyOutcome> {
  const dest = `${root}/${plugin.name}`;
  const marker = known ?? (await target.exec({ argv: ["sh", "-c", 'cat -- "$SAGAX_DEST/.sagax-digest" 2>/dev/null || true'], env: { SAGAX_DEST: dest }, timeoutSec: 30, maxOutputBytes: 256 })).stdout.trim();
  if (marker === digest) return "unchanged";
  let archive: Buffer;
  try { archive = await pluginArchive(plugin.dir, paths); } catch (error) {
    return { reason: error instanceof Error ? error.message : String(error), permanent: true };
  }
  if (archive.length > MAX_PLUGIN_ARCHIVE_BYTES) return { reason: "too large", permanent: true };
  // per copy: two copies at once never write or unpack each other's files
  const nonce = randomBytes(6).toString("hex");
  const staged = `${root}/.incoming-${plugin.name}-${nonce}.tgz`;
  // Linux keeps one environment string under 128 KiB: 48 KiB pieces, 8 a call.
  const pieces: Buffer[] = [];
  for (let offset = 0; offset < archive.length; offset += CHUNK) pieces.push(archive.subarray(offset, offset + CHUNK));
  let failed: string | null = null;
  const calls = Math.ceil(pieces.length / 8);
  const discard = () => target.exec({ argv: ["sh", "-c", 'rm -f -- "$SAGAX_PATH"'], env: { SAGAX_PATH: staged }, timeoutSec: 30, maxOutputBytes: 256 }).catch(() => undefined);
  for (let first = 0; first < pieces.length; first += 8) {
    const group = pieces.slice(first, first + 8);
    const env: Record<string, string> = { SAGAX_PATH: staged, SAGAX_ROOT: root };
    group.forEach((piece, index) => { env[`SAGAX_CONTENT_B64_${index}`] = piece.toString("base64"); });
    const vars = group.map((_, index) => `"$SAGAX_CONTENT_B64_${index}"`).join(" ");
    const result = await target.exec({
      argv: ["sh", "-c", first === 0
        ? `mkdir -p -- "$SAGAX_ROOT" && printf %s ${vars} | base64 -d > "$SAGAX_PATH"`
        : `printf %s ${vars} | base64 -d >> "$SAGAX_PATH"`],
      env, timeoutSec: COPY_STEP_SECONDS,
    }).catch(async (error: unknown) => { await discard(); throw error; });
    if (result.exitCode !== 0) { failed = `part ${first / 8 + 1} of ${calls}: ${execFailureReason(result, COPY_STEP_SECONDS)}`; break; }
  }
  if (failed) {
    await discard();
    return { reason: `copy failed (${failed})`, permanent: false };
  }
  const installed = await target.exec({
    argv: ["sh", "-c", [
      "set -eu",
      'tmp="$SAGAX_ROOT/.unpack-$SAGAX_NONCE"',
      'trap \'rm -rf -- "$tmp" "$SAGAX_PATH"\' EXIT',
      'mkdir -p -- "$tmp"',
      // the archive holds regular files and folders only (no link, no device)
      'list=$(tar -tvzf "$SAGAX_PATH")',
      'if printf "%s\\n" "$list" | grep -qv "^[d-]"; then echo "the archive holds a link or a device" >&2; exit 3; fi',
      'tar -xzf "$SAGAX_PATH" -C "$tmp" --no-same-owner --no-same-permissions',
      'printf %s "$SAGAX_DIGEST" > "$tmp/.sagax-digest"',
      // the data folder its text names (#4082)
      'if [ -n "${SAGAX_DATA:-}" ]; then mkdir -p -- "$SAGAX_DATA"; fi',
      // the swap holds a lock (mkdir is atomic); a lock left by a copy
      // that died is older than two minutes and is taken over
      'lock="$SAGAX_DEST.lock"',
      'tries=0',
      'until mkdir -- "$lock" 2>/dev/null; do',
      '  if [ -n "$(find "$lock" -maxdepth 0 -mmin +2 2>/dev/null)" ]; then rm -rf -- "$lock"; continue; fi',
      '  tries=$((tries + 1)); [ "$tries" -le 300 ] || { echo "another copy holds the folder" >&2; exit 4; }',
      '  sleep 0.2',
      'done',
      'trap \'rm -rf -- "$tmp" "$SAGAX_PATH" "$lock"\' EXIT',
      // an identical copy that landed while this one unpacked is kept
      'if [ "$(cat -- "$SAGAX_DEST/.sagax-digest" 2>/dev/null)" != "$SAGAX_DIGEST" ]; then rm -rf -- "$SAGAX_DEST"; mv -- "$tmp" "$SAGAX_DEST"; fi',
    ].join("\n")],
    env: { SAGAX_DEST: dest, SAGAX_PATH: staged, SAGAX_ROOT: root, SAGAX_NONCE: nonce, SAGAX_DIGEST: digest, ...(paths ? { SAGAX_DATA: paths.data } : {}) }, timeoutSec: 120,
  });
  if (installed.exitCode !== 0) {
    const why = installed.stderr.trim().split("\n").filter(Boolean).slice(-1)[0]?.slice(0, 200);
    return { reason: why ? `unpack failed: ${why}` : `unpack failed (${execFailureReason(installed, 120)})`, permanent: false };
  }
  return "copied";
}
