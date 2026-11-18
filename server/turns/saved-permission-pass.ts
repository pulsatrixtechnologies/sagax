// One allow for the exact step a person already answered, kept only in this
// process. The card on the transcript is the durable ask (#4528). This pass
// stops the follow-up call from asking again. A second restart before that
// call drops the pass, and the engine may ask once more. It is not a rule
// and not an Always allow.

export interface SavedPermissionPass {
  threadId: string;
  tool: string;
  summary: string;
}

type PassHost = { savedPermissionPasses?: Map<string, SavedPermissionPass> };

function passes(host: PassHost): Map<string, SavedPermissionPass> {
  if (!host.savedPermissionPasses) host.savedPermissionPasses = new Map();
  return host.savedPermissionPasses;
}

function passKey(threadId: string, tool: string, summary: string): string {
  return `${threadId}\0${tool}\0${summary.trim()}`;
}

/** Remember one allow. A later take of the same thread, tool and summary
 * returns it once. */
export function savePermissionPass(host: PassHost, pass: SavedPermissionPass): void {
  const tool = pass.tool.trim();
  if (!tool) return;
  const saved = { threadId: pass.threadId, tool, summary: pass.summary.trim() };
  passes(host).set(passKey(saved.threadId, saved.tool, saved.summary), saved);
}

/** The first saved allow whose tool is one of `tools` and whose summary
 * matches. A second take finds nothing. */
export function takeMatchingPermissionPass(host: PassHost, threadId: string, tools: readonly string[], summary: string): SavedPermissionPass | null {
  const map = host.savedPermissionPasses;
  if (!map) return null;
  for (const tool of tools) {
    const name = tool.trim();
    if (!name) continue;
    const key = passKey(threadId, name, summary);
    const hit = map.get(key);
    if (!hit) continue;
    map.delete(key);
    return hit;
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
