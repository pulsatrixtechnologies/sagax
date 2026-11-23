// #5157: Grok writes an MCP result over 20 000 bytes into its session
// folder, whole, as JSON. For a connector file that JSON is the file's
// base64, and the same bytes stay in the session's jsonl. The model
// already has its excerpt. After the turn, on an organization server,
// those bytes are removed. The sessions folder may be a link to the
// person's real GROK_HOME (grok-mcp-isolation.ts); that one link is
// followed, and no other link is.
import { lstatSync, readdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

/** A JSON string long enough to be a spilled file, not a short token. */
const LONG_B64 = /"([A-Za-z0-9+/]{256,}={0,2})"/g;
const CALL_FILE = /^call_\d+\.json$/;
const TRANSCRIPT = new Set(["updates.jsonl", "chat_history.jsonl"]);

function sessionRoot(home: string): string | null {
  const sessions = join(home, "sessions");
  try {
    const stat = lstatSync(sessions);
    if (stat.isSymbolicLink()) {
      const target = realpathSync(sessions);
      if (!lstatSync(target).isDirectory()) return null;
      return target;
    }
    return stat.isDirectory() ? sessions : null;
  } catch {
    return null;
  }
}

function scrubTranscript(path: string): boolean {
  let text: string;
  try { text = readFileSync(path, "utf8"); } catch { return false; }
  const next = text.replace(LONG_B64, '"[removed]"');
  if (next === text) return false;
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, next, { mode: 0o600 });
  renameSync(temporary, path);
  return true;
}

/** Remove spilled connector bytes under `home`. Returns how many files
 * were deleted or rewritten. */
export function clearGrokConnectorSpill(home: string): number {
  const root = sessionRoot(home);
  if (!root) return 0;
  let changed = 0;
  const pending = [root];
  while (pending.length) {
    const dir = pending.pop()!;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        pending.push(path);
        continue;
      }
      if (!entry.isFile()) continue;
      if (TRANSCRIPT.has(entry.name)) {
        if (scrubTranscript(path)) changed += 1;
        continue;
      }
      if (basename(dir) === "mcp" && CALL_FILE.test(entry.name)) {
        try { unlinkSync(path); changed += 1; } catch { /* already gone */ }
      }
    }
  }
  return changed;
}
