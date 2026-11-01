// Grok without its per-call auto-mode wait: Sagax gates MCP writes itself.
//
// In `--permission-mode auto` Grok runs its safety classifier before every
// MCP tool call, 4-9 s each, and allow rules do not skip it over ACP
// (measured 2026-10-11 on grok 1.0.46 and 1.0.50, docs/grok-approval-gate.md).
// In `default` mode Grok runs client-supplied MCP tools with no prompt at
// all, so with this gate on Sagax:
// - starts Grok in `default` mode (its own built-in tools still prompt, and
//   their cards are unchanged);
// - mounts EVERY MCP server through the MCP gate with an approval socket;
// - lets only reviewed read-only tools through unasked (below), and holds
//   every other call, unknown, new and third-party ones included, until the
//   person approves its card. Declining, no answer, a closed channel or no
//   running turn all mean the call never reaches the server.
//
// On by default since 2026-10-19 (engine parity, Decision: whatever the
// provider, everything must work the same): Approve for me on Grok decides
// through Sagax, like Claude since #797, so the owner's setup (#820), the
// member rules (#776-#812) and the person's cards apply the same way on both
// engines, and no MCP call waits 4-9 s on Grok's classifier.
// Opt-out, per bot or for all: DATA_DIR/grok-approval-gate.json
// {"off": ["<botId>", ...]} or {"bots": "none"}. Those bots' Auto turns run
// Grok's own auto mode, as before the gate. The earlier opt-in list
// ({"bots": [...]}) no longer narrows anything; a missing, empty or invalid
// file means on. Read on every turn: the next turn of each bot respawns Grok
// in the new mode.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../../config.ts";
import type { McpServerSpec } from "../../contracts.ts";
import { READ_ONLY_AGENT_TOOL_NAMES } from "../../agent-tool-policy.ts";
import { isPerspicaxBridge, PERSPICAX_READ_ONLY_TOOLS } from "./grok-read-only-tools.ts";
import { AUTO_COMPUTER_MCP_NAME } from "../../auto-computer.ts";
import { cloudOnlyBot } from "../../cloud-only-bots.ts";

export const GROK_APPROVAL_GATE_FILE = "grok-approval-gate.json";

/** Whether this bot's Grok Auto turns run with the Sagax approval gate:
 * yes unless the flag file opts this bot (or every bot) out. */
export function grokApprovalGateEnabled(botId: string | undefined, dataDir: string = DATA_DIR): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(dataDir, GROK_APPROVAL_GATE_FILE), "utf8"));
  } catch {
    return true;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return true;
  const flag = parsed as { bots?: unknown; off?: unknown };
  if (flag.bots === "none") return false;
  if (!botId || !Array.isArray(flag.off)) return true;
  return !flag.off.some((id) => typeof id === "string" && id === botId);
}

/** The reviewed read-only tools of one mounted server, by upstream name.
 * Only Sagax's own agents server (its reviewed catalog, the same one that
 * sets its readOnlyHint) and harness-spawned Perspicax bridges (an explicit
 * reviewed list) have any, plus computer_select for a cloud-only bot (a
 * no-op there). Everything else, including every third-party
 * server and any annotation it sends, gets none: all its calls ask. */
export function gateReadOnlyTools(server: { name: string; builtin: boolean; spec?: McpServerSpec }, botId?: string, dataDir: string = DATA_DIR): string[] {
  if (server.builtin && server.name === "agents") return [...READ_ONLY_AGENT_TOOL_NAMES];
  // The Data tools and the owner's own environment are NOT here
  // (2026-10-16 security review): the gate holds them like any other call
  // and Sagax's approval path (request.opened) decides, with the person's
  // rules, the safety review and the security keys; what may run unasked is
  // answered there without a card (auto-approve.ts).
  // A cloud-only bot's Works on is forced to fixed cloud (cloud-only-bots.ts,
  // turnWorksOn), so computer_select only reports ("you already work on the
  // cloud") or refuses: it can never switch computers. Every other bot's
  // computer_select can move the turn to the person's machine and still asks.
  if (server.builtin && server.name === AUTO_COMPUTER_MCP_NAME && cloudOnlyBot(botId, dataDir)) return ["computer_select"];
  if (!server.builtin && server.name !== "agents" && isPerspicaxBridge(server.spec)) return [...PERSPICAX_READ_ONLY_TOOLS];
  return [];
}
