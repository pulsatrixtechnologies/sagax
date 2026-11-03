import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export type TerminalAuditEvent =
  | { at: number; kind: "session.requested"; principalId: string; botId: string; threadId: string; resourceId: string; provider: string; requestId: string }
  | { at: number; kind: "session.opened"; principalId: string; sessionId: string; resourceId: string; provider: string; botId?: string; threadId?: string }
  | { at: number; kind: "session.denied"; principalId: string; requestId: string }
  /** The person picked another destination than the bot's on the card. */
  | { at: number; kind: "session.destination"; principalId: string; requestId: string; from: string; to: string }
  /** An open refused before anything ran: not allowed, unknown, unreachable. */
  | { at: number; kind: "session.refused"; principalId: string; requestId: string; resourceId: string; provider: string; reason: string }
  | { at: number; kind: "session.ended"; principalId: string; sessionId: string; reason: string; resourceId?: string; provider?: string; botId?: string; threadId?: string }
  | { at: number; kind: "session.idle"; principalId: string; sessionId: string }
  | { at: number; kind: "bot.input"; principalId: string; sessionId: string; allowed: boolean };

export function createTerminalAuditLog(dataDir: string) {
  const path = join(dataDir, "terminal-sessions.jsonl");
  mkdirSync(dataDir, { recursive: true });
  return {
    path,
    write(event: TerminalAuditEvent) {
      // The audit never stops a terminal from closing.
      try { appendFileSync(path, `${JSON.stringify(event)}\n`, { mode: 0o600 }); } catch { /* disk full, read-only */ }
    },
  };
}
