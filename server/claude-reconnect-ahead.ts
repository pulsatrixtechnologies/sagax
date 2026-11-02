// Ahead of scheduled Claude routines: thin re-export of the general
// engine reconnect ahead scan (server/engine-reconnect-ahead.ts).
export {
  CLAUDE_NEEDS_RECONNECTING,
  CLAUDE_RECONNECT_AHEAD_DETAIL,
  CLAUDE_RECONNECT_AHEAD_MS,
  CLAUDE_SIGN_IN_EXPIRED,
  claudeReconnectAhead,
  type ClaudeReconnectAheadInput,
  type ClaudeReconnectAheadResult,
  type ClaudeReconnectAheadRoutine,
} from "./engine-reconnect-ahead.ts";
