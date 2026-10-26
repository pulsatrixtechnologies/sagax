// One reviewer on Approve for me, whatever the engine (Grok Bot parity A13).
//
// At Approve for me Codex (`approvalsReviewer: auto_review`), Qwen
// (`--approval-mode auto`) and Cursor (`--auto-review`) run their own
// reviewer, which lets through what it judges safe before Sagax sees the
// call: the person's rules, the owner's setup (#820), the member rules and
// the security keys never apply to those calls (docs/approval-levels.md,
// "What Sagax does not see"). Grok Bot has a single reviewer.
//
// With this switch on for a bot, Approve for me on those three engines
// decides through Sagax, as on Claude since #797 and Grok since #827: the
// engine starts at its edits level (Qwen `auto-edit`) or asks (Codex and
// Cursor have no edits level; Codex's Ask already writes the workspace), and
// every other call reaches Sagax's approval path, where the person's rules
// and saved commands may answer it without a card (auto-approve.ts).
//
// Off by default: each engine needs a real bench before the default changes,
// and none could run where this was written (decision for JC). Opt in per bot
// or for all: DATA_DIR/sagax-reviewer.json {"bots": ["<botId>", ...]} or
// {"bots": "all"}. A missing, empty or invalid file means off. Read when a
// turn starts its engine, like grok-approval-gate.json, so no deploy is
// needed either way.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../config.ts";

export const SAGAX_REVIEWER_FILE = "sagax-reviewer.json";

/** Whether this bot's Approve for me turns on Codex, Qwen or Cursor decide
 * through Sagax instead of the engine's own reviewer. */
export function sagaxReviewsAuto(botId: string | undefined, dataDir: string = DATA_DIR): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(dataDir, SAGAX_REVIEWER_FILE), "utf8"));
  } catch {
    return false;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  const bots = (parsed as { bots?: unknown }).bots;
  if (bots === "all") return true;
  if (!botId || !Array.isArray(bots)) return false;
  return bots.some((id) => typeof id === "string" && id === botId);
}
