// The one list of technical status rows the chat never draws (the maintainer,
// 2026-10-26: "dans le chat, n'affiche que ce que la personne a besoin de
// voir"). The chat shows messages, approval cards, real errors the person
// can act on, and questions. A note about the plumbing (an MCP server
// skipped, a session rebuilt, Auto's pick, the Workspace a turn ran on, an
// automatic recovery, a connector switch, a model fallback) goes to the
// server log and the conversation's Events lens, never inline in the chat.
//
// Desktop (src/lib/activity-runs.ts isHiddenStatusActivity) and iOS
// (ios/Sources/CompanionCore/ChatNotices.swift) read the same rules: the
// iOS copy is checked against ios/Tests/CompanionCoreTests/Fixtures/
// chat-notices.json, which shared/chat-notices.test.ts keeps in step with
// this file. The server may keep writing these rows (it reads the
// Workspace line back, shared/workspace-line.ts); stored ones from older
// builds stay hidden too.
import { ONE_PASSWORD_WAITING } from "./credential-vault.ts";
import { SANDBOX_WAKE_NOTICE, SANDBOX_WAKE_TIMEOUT_NOTICE } from "./sandbox-wake.ts";
import { HOST_CONTROL_NOTICE } from "./host-control.ts";

export const CHAT_NOTICE_RULES = {
  /** Every activity row whose name starts with one of these is technical. */
  hiddenPrefixes: ["notice:", "recovery: Automatic recovery:"],
  /** Except these, which ask something of the person: approve in
   * 1Password, send the message again, see that a bot now controls this
   * computer (and can be stopped), and wait for a cold environment (QA
   * 0.8.66 F1: hidden, a 458 s start read as a silent chat). */
  shown: [ONE_PASSWORD_WAITING, SANDBOX_WAKE_NOTICE, SANDBOX_WAKE_TIMEOUT_NOTICE, HOST_CONTROL_NOTICE],
} as const;

/** True for an activity row name the chat leaves out. */
export function isTechnicalNoticeName(name: string | undefined | null): boolean {
  if (!name) return false;
  if ((CHAT_NOTICE_RULES.shown as readonly string[]).includes(name)) return false;
  return CHAT_NOTICE_RULES.hiddenPrefixes.some((prefix) => name.startsWith(prefix));
}
