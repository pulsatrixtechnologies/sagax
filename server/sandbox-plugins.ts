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
//     servers, bin/) and no symlink (workspaceManifest refuses them).
//   - The folder is replaced whole, a digest marker says what is there, and
//     an unchanged plugin costs one read of the marker.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";

import type { SandboxExecInput } from "./sandboxd-core.ts";
import { workspaceManifest } from "./sandbox-workspace-copy.ts";

/** Where the plugins land in the person's environment (/workspace persists). */
export const SANDBOX_PLUGINS_DIR = "/workspace/sagax-plugins";
/** A plugin larger than this (compressed) is not copied. */
export const MAX_PLUGIN_ARCHIVE_BYTES = 16 * 1024 * 1024;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const CHUNK = 48 * 1024;

export interface SandboxPluginExec {
  exec(input: SandboxExecInput): Promise<{ exitCode: number | null; stdout: string; stderr: string }>;
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

export interface PluginSyncResult { copied: string[]; unchanged: string[]; skipped: Array<{ name: string; reason: string }> }

/** Copy each changed plugin into `root/<name>` in the environment. */
export async function syncPluginsToSandbox(
  plugins: ReadonlyArray<{ name: string; dir: string }>,
  target: SandboxPluginExec,
  root = SANDBOX_PLUGINS_DIR,
): Promise<PluginSyncResult> {
  const out: PluginSyncResult = { copied: [], unchanged: [], skipped: [] };
  for (const plugin of plugins) {
    if (!NAME.test(plugin.name)) { out.skipped.push({ name: plugin.name, reason: "invalid name" }); continue; }
    let digest: string;
    try { digest = pluginDigest(plugin.dir); } catch (error) {
      out.skipped.push({ name: plugin.name, reason: error instanceof Error ? error.message : String(error) });
      continue;
    }
    const dest = `${root}/${plugin.name}`;
    const marker = await target.exec({ argv: ["sh", "-c", 'cat -- "$SAGAX_DEST/.sagax-digest" 2>/dev/null || true'], env: { SAGAX_DEST: dest }, timeoutSec: 30, maxOutputBytes: 256 });
    if (marker.stdout.trim() === digest) { out.unchanged.push(plugin.name); continue; }
    let archive: Buffer;
    try { archive = await pluginArchive(plugin.dir); } catch (error) {
      out.skipped.push({ name: plugin.name, reason: error instanceof Error ? error.message : String(error) });
      continue;
    }
    if (archive.length > MAX_PLUGIN_ARCHIVE_BYTES) { out.skipped.push({ name: plugin.name, reason: "too large" }); continue; }
    const staged = `${root}/.incoming-${plugin.name}.tgz`;
    // Linux keeps one environment string under 128 KiB: 48 KiB pieces, 8 a call.
    const pieces: Buffer[] = [];
    for (let offset = 0; offset < archive.length; offset += CHUNK) pieces.push(archive.subarray(offset, offset + CHUNK));
    let ok = true;
    for (let first = 0; first < pieces.length; first += 8) {
      const group = pieces.slice(first, first + 8);
      const env: Record<string, string> = { SAGAX_PATH: staged, SAGAX_ROOT: root };
      group.forEach((piece, index) => { env[`SAGAX_CONTENT_B64_${index}`] = piece.toString("base64"); });
      const vars = group.map((_, index) => `"$SAGAX_CONTENT_B64_${index}"`).join(" ");
      const result = await target.exec({
        argv: ["sh", "-c", first === 0
          ? `mkdir -p -- "$SAGAX_ROOT" && printf %s ${vars} | base64 -d > "$SAGAX_PATH"`
          : `printf %s ${vars} | base64 -d >> "$SAGAX_PATH"`],
        env, timeoutSec: 60,
      });
      if (result.exitCode !== 0) { ok = false; break; }
    }
    if (!ok) { out.skipped.push({ name: plugin.name, reason: "copy failed" }); continue; }
    const installed = await target.exec({
      argv: ["sh", "-c", [
        "set -eu",
        'tmp="$SAGAX_DEST.incoming"',
        'rm -rf -- "$tmp"',
        'mkdir -p -- "$tmp"',
        // the archive holds regular files and folders only (no link, no device)
        'if tar -tvzf "$SAGAX_PATH" | grep -qv "^[d-]"; then rm -f -- "$SAGAX_PATH"; exit 3; fi',
        'tar -xzf "$SAGAX_PATH" -C "$tmp" --no-same-owner --no-same-permissions',
        'rm -f -- "$SAGAX_PATH"',
        'printf %s "$SAGAX_DIGEST" > "$tmp/.sagax-digest"',
        'rm -rf -- "$SAGAX_DEST"',
        'mv -- "$tmp" "$SAGAX_DEST"',
      ].join("\n")],
      env: { SAGAX_DEST: dest, SAGAX_PATH: staged, SAGAX_DIGEST: digest }, timeoutSec: 120,
    });
    if (installed.exitCode !== 0) { out.skipped.push({ name: plugin.name, reason: "unpack failed" }); continue; }
    out.copied.push(plugin.name);
  }
  return out;
}
