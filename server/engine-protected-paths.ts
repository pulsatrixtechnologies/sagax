// Folders no engine must ever read, whatever tools it is given. The one that
// matters here is the remote-support folder (server/remote-support-local.ts):
// on an organization server the engines run in the Sagax container, as the
// same user, so the technician private key and the session addresses sit on
// their filesystem. Tool withholding already keeps the built-in engines away;
// these deny rules are the second layer, and the only one on a solo desktop.
// The robust fix (keep the key off the engine host entirely) is tracked as a
// JC decision in the PR body; this closes the read path meanwhile.
import { join } from "node:path";

import { DATA_DIR } from "./config.ts";

/** Absolute path of the folder the deny rules below protect. */
export function remoteSupportDir(): string {
  return join(DATA_DIR, "remote-support");
}

/** Every protected absolute directory. */
export function protectedEnginePaths(): string[] {
  return [remoteSupportDir()];
}

/** Claude Code permission rules: an absolute path takes a leading slash inside
 * the pattern (as in `Read(//proc/**)`). */
export function claudeProtectedDenyRules(): string[] {
  const rules: string[] = [];
  for (const dir of protectedEnginePaths()) {
    const pattern = `/${dir}/**`;
    rules.push(`Read(${pattern})`, `Glob(${pattern})`, `Grep(${pattern})`);
  }
  return rules;
}
