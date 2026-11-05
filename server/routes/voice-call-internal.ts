// POST /api/internal/voice-call/end — the bot hangs up
// (server/voice/voice-call-session.ts). The capability check and the session
// live in the internal block of server/index.ts; that block calls this
// matcher so index.ts does not gain another path === "/ guard.
// The path stays a string literal here so route-inventory still lists
// the live route (a `path === PATH` alias drops it from the catalogue).

/** True when this request is the bot's hang-up. */
export function isInternalVoiceCallEnd(method: string, path: string): boolean {
  return method === "POST" && path === "/api/internal/voice-call/end";
}
