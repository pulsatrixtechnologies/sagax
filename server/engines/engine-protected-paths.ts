// Folders no engine must ever read, whatever tools it is given. The one that
// matters here is the remote-support folder (server/remote-support/remote-support-local.ts):
// on an organization server the engines run in the Sagax container, as the
// same user, so the per-session technician keys and the session addresses sit
// on their filesystem. Tool withholding already keeps the built-in engines
// away; these deny rules are the second layer, and the only one on a solo
// desktop. A key is made for one session only and deleted when it closes or
// ends, and the helper admits it only under a short grant Perspicax signs, so
// a key read anyway is worth one session for at most an hour.
import { join } from "node:path";

import { DATA_DIR } from "../config.ts";

/** Absolute path of the folder the deny rules below protect. */
export function remoteSupportDir(): string {
  return join(DATA_DIR, "remote-support");
}

/** Every protected absolute directory. */
export function protectedEnginePaths(): string[] {
  return [remoteSupportDir()];
}

/** The key files inside it, named on their own as well: each session's key,
 * a key still pending its code, and the old shared key (deleted when found). */
export function protectedEngineKeyFiles(): string[] {
  const dir = remoteSupportDir();
  return [
    join(dir, "sessions", "*", "technician.private.json"),
    join(dir, "sessions", "*", "technician.nodekey"),
    join(dir, "pending", "**"),
    join(dir, "technician.private.json"),
    join(dir, "technician.nodekey"),
  ];
}

/** Claude Code permission rules: an absolute path takes a leading slash inside
 * the pattern (as in `Read(//proc/**)`). */
export function claudeProtectedDenyRules(): string[] {
  const rules: string[] = [];
  const patterns = [...protectedEnginePaths().map((dir) => `/${dir}/**`), ...protectedEngineKeyFiles().map((file) => `/${file}`)];
  for (const pattern of patterns) {
    rules.push(`Read(${pattern})`, `Glob(${pattern})`, `Grep(${pattern})`);
  }
  return rules;
}
