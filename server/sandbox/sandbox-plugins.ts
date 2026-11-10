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
//   - The folder is replaced whole, a digest marker says what is there, and
//     an unchanged plugin costs one read of the marker.
//   - Copies may run at once into one environment (2026-11-04, an organization server: every
//     bot of a person resynced a refreshed Flow on its next turn): each copy
//     stages and unpacks under its own name, and the swap that loses a race
//     to an identical copy counts as copied.
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";

import type { SandboxExecInput } from "./sandboxd-core.ts";
import { workspaceManifest } from "./sandbox-workspace-copy.ts";

/** Where the plugins land in the person's environment (/workspace persists). */
export const SANDBOX_PLUGINS_DIR = "/workspace/sagax-plugins";
/** Where the person's own skills land (syncPluginFoldersForTurn). */
export const SANDBOX_CAPABILITY_SKILLS_DIR = "/workspace/sagax-capability-skills";
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
  const hash = createHash("sha256");
  for (const file of workspaceManifest(dir).files) hash.update(`${file.path}\0${file.size}\0${file.sha256}\n`);
  return hash.digest("hex");
}

function pluginArchive(dir: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile("tar", ["-czf", "-", "-C", dir, "."], { encoding: "buffer", maxBuffer: MAX_PLUGIN_ARCHIVE_BYTES + 1, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", COPYFILE_DISABLE: "1" } },
      (error, stdout) => (error ? reject(error) : resolve(stdout)));
  });
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

export interface PluginSyncOptions {
  /** Failed copies to wait on (one store per server), with the scope of
   * this environment (the person). Without it every call copies. */
  failures?: PluginCopyFailures;
  scope?: string;
}

/** Copy each changed plugin into `root/<name>` in the environment. */
export async function syncPluginsToSandbox(
  plugins: ReadonlyArray<{ name: string; dir: string }>,
  target: SandboxPluginExec,
  root = SANDBOX_PLUGINS_DIR,
  options: PluginSyncOptions = {},
): Promise<PluginSyncResult> {
  const out: PluginSyncResult = { copied: [], unchanged: [], skipped: [] };
  const scope = `${options.scope ?? ""}\n${root}`;
  const failures = options.failures;
  for (const plugin of plugins) {
    if (!NAME.test(plugin.name)) { out.skipped.push({ name: plugin.name, reason: "invalid name" }); continue; }
    let digest: string;
    try { digest = pluginDigest(plugin.dir); } catch (error) {
      out.skipped.push({ name: plugin.name, reason: error instanceof Error ? error.message : String(error) });
      continue;
    }
    const held = failures?.pending(scope, plugin.name, digest);
    if (held) { (out.deferred ??= []).push({ name: plugin.name, ...held }); continue; }
    const fail = (reason: string) => {
      const next = failures?.failed(scope, plugin.name, digest, reason);
      out.skipped.push({ name: plugin.name, reason: next ? `${reason}; tried again in ${Math.round((next.retryAt - Date.now()) / 60_000) || 1} min or when it changes` : reason });
    };
    try {
      const outcome = await copyOne(plugin, digest, target, root);
      if (outcome === "unchanged") out.unchanged.push(plugin.name);
      else if (outcome === "copied") out.copied.push(plugin.name);
      else if (outcome.permanent) out.skipped.push({ name: plugin.name, reason: outcome.reason });
      else { fail(outcome.reason); continue; }
      failures?.succeeded(scope, plugin.name);
    } catch (error) {
      // a command the environment did not run (busy, the transport): the
      // reason is kept, and the next plugin is still tried
      fail(`copy failed: ${errorText(error)}`);
    }
  }
  return out;
}

type CopyOutcome = "copied" | "unchanged" | { reason: string; permanent: boolean };

async function copyOne(plugin: { name: string; dir: string }, digest: string, target: SandboxPluginExec, root: string): Promise<CopyOutcome> {
  const dest = `${root}/${plugin.name}`;
  const marker = await target.exec({ argv: ["sh", "-c", 'cat -- "$SAGAX_DEST/.sagax-digest" 2>/dev/null || true'], env: { SAGAX_DEST: dest }, timeoutSec: 30, maxOutputBytes: 256 });
  if (marker.stdout.trim() === digest) return "unchanged";
  let archive: Buffer;
  try { archive = await pluginArchive(plugin.dir); } catch (error) {
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
    env: { SAGAX_DEST: dest, SAGAX_PATH: staged, SAGAX_ROOT: root, SAGAX_NONCE: nonce, SAGAX_DIGEST: digest }, timeoutSec: 120,
  });
  if (installed.exitCode !== 0) {
    const why = installed.stderr.trim().split("\n").filter(Boolean).slice(-1)[0]?.slice(0, 200);
    return { reason: why ? `unpack failed: ${why}` : `unpack failed (${execFailureReason(installed, 120)})`, permanent: false };
  }
  return "copied";
}
