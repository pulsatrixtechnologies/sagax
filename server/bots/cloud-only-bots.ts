// Bots that work in the cloud only: their turns run on the person's server
// environment and never on the person's own computer or Local VM, whatever
// the bot's Works on or a conversation's pin says. For bots whose work the
// server can do whole (ConnectWise and other connector bots): the owner's
// computer stays the last resort and is never reached for that work, and the
// bot is not offered a choice it would spend a model round (and, on Grok, a
// safety check of 10-30 s) making on every turn.
//
// DATA_DIR/cloud-only-bots.json: {"bots": ["<botId>", ...]} or {"bots": "all"}.
// Missing, empty or invalid = none (Works on applies as before). Read on
// every turn, so it is a file edit, no restart.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../config.ts";

export const CLOUD_ONLY_BOTS_FILE = "cloud-only-bots.json";

export function cloudOnlyBot(botId: string | undefined, dataDir: string = DATA_DIR): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(dataDir, CLOUD_ONLY_BOTS_FILE), "utf8"));
  } catch {
    return false;
  }
  const bots = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as { bots?: unknown }).bots : undefined;
  if (bots === "all") return true;
  if (!botId || !Array.isArray(bots)) return false;
  return bots.some((id) => typeof id === "string" && id === botId);
}
