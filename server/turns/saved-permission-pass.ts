// One allow for the exact step a person already answered. The card on the
// transcript is the durable ask (#4528). This pass stops the follow-up call
// from asking again. #4528: it is kept on disk under the data folder, so a
// restart between the answer and that call does not ask the person a second
// time. The file holds the conversation, the tool and a hash of the step,
// never its words. It is not a rule and not an Always allow.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "../atomic.ts";

export interface SavedPermissionPass {
  threadId: string;
  tool: string;
  summary: string;
}

/** What one pass keeps: the step's words are a hash only. */
interface StoredPass {
  threadId: string;
  tool: string;
}

type PassHost = { savedPermissionPasses?: Map<string, StoredPass>; DATA_DIR?: unknown };

const PASS_FILE = "permission-passes.json";

function passFile(host: PassHost): string | null {
  return typeof host.DATA_DIR === "string" && host.DATA_DIR ? join(host.DATA_DIR, PASS_FILE) : null;
}

function passes(host: PassHost): Map<string, StoredPass> {
  if (host.savedPermissionPasses) return host.savedPermissionPasses;
  const map = new Map<string, StoredPass>();
  const file = passFile(host);
  if (file) {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as { passes?: unknown };
      const rows = parsed.passes && typeof parsed.passes === "object" ? Object.entries(parsed.passes as Record<string, unknown>) : [];
      for (const [key, row] of rows) {
        const value = row as { threadId?: unknown; tool?: unknown };
        if (/^[0-9a-f]{64}$/.test(key) && typeof value?.threadId === "string" && typeof value?.tool === "string") {
          map.set(key, { threadId: value.threadId, tool: value.tool });
        }
      }
    } catch {
      // no file yet, or unreadable: no pass kept
    }
  }
  host.savedPermissionPasses = map;
  return map;
}

function save(host: PassHost): void {
  const file = passFile(host);
  if (!file || !host.savedPermissionPasses) return;
  try {
    mkdirSync(join(file, ".."), { recursive: true, mode: 0o700 });
    writeFileAtomic(file, JSON.stringify({ version: 1, passes: Object.fromEntries(host.savedPermissionPasses) }), { mode: 0o600 });
  } catch {
    // kept in memory: a restart before the follow-up call may ask once more
  }
}

function passKey(threadId: string, tool: string, summary: string): string {
  return createHash("sha256").update(`${threadId}\0${tool}\0${summary.trim()}`).digest("hex");
}

/** Remember one allow. A later take of the same thread, tool and summary
 * returns it once. */
export function savePermissionPass(host: PassHost, pass: SavedPermissionPass): void {
  const tool = pass.tool.trim();
  if (!tool) return;
  passes(host).set(passKey(pass.threadId, tool, pass.summary), { threadId: pass.threadId, tool });
  save(host);
}

/** The first saved allow whose tool is one of `tools` and whose summary
 * matches. A second take finds nothing. */
export function takeMatchingPermissionPass(host: PassHost, threadId: string, tools: readonly string[], summary: string): SavedPermissionPass | null {
  const map = passes(host);
  if (!map.size) return null;
  for (const tool of tools) {
    const name = tool.trim();
    if (!name) continue;
    const key = passKey(threadId, name, summary);
    const hit = map.get(key);
    if (!hit) continue;
    map.delete(key);
    save(host);
    return { threadId: hit.threadId, tool: hit.tool, summary: summary.trim() };
  }
  return null;
}

/** What a follow-up permission does with a saved allow.
 * `allow`: this call is the one the person already allowed; the caller
 * answers it and shows no card.
 * `spent`: something else already approved this call; the pass is used up
 * so a later identical call still asks.
 * `keep`: a safety stop or hold, or no engine to answer, leaves the pass
 * where it is. A stop never spends it. */
export function allowSavedPermission(host: PassHost, input: {
  threadId: string;
  tools: readonly (string | undefined)[];
  summary: string;
  safety: "stop" | "hold" | "ok";
  alreadyApproved: boolean;
  canRespond: boolean;
}): "allow" | "spent" | "keep" {
  if (input.safety === "stop" || input.safety === "hold") return "keep";
  const tools = input.tools.filter((tool): tool is string => typeof tool === "string");
  if (input.alreadyApproved) {
    takeMatchingPermissionPass(host, input.threadId, tools, input.summary);
    return "spent";
  }
  if (!input.canRespond) return "keep";
  return takeMatchingPermissionPass(host, input.threadId, tools, input.summary) ? "allow" : "keep";
}
