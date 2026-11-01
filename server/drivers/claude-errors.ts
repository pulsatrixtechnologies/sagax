// Claude subscription refusals that need the person: an expired sign-in, or
// a model's extra-usage credits used up. Mirror Codex's CODEX_SIGN_IN_EXPIRED
// shape so the chat, routine wait and proactive waker share one typed cause.

/** Canonical sentence when Claude's own sign-in was refused. */
export const CLAUDE_SIGN_IN_EXPIRED =
  "Claude's sign-in has expired. Reconnect Claude in Settings → Model providers and accounts.";

/** Waiting reason on a routine run that pauses until Claude is reconnected. */
export const CLAUDE_NEEDS_RECONNECTING = "Claude needs reconnecting";

const CREDITS_EXHAUSTED =
  /runs on extra usage for your account, and those credits are used up/i;

/** Rewrite a raw CLI refusal into the canonical reconnect sentence. */
export function claudeSignInExpired(raw: string): string {
  const said = raw.trim().slice(0, 300);
  return said ? `${CLAUDE_SIGN_IN_EXPIRED} Claude said: ${said}` : CLAUDE_SIGN_IN_EXPIRED;
}

/** Extra-usage credits for this model are used up (plan windows still work). */
export function claudeCreditsExhausted(message: string): boolean {
  return CREDITS_EXHAUSTED.test(message);
}

/** A failure or attention line that must pause routines and never wake the bot. */
export function isClaudeReconnectCondition(message: string | undefined): boolean {
  if (!message) return false;
  return message.includes(CLAUDE_SIGN_IN_EXPIRED)
    || message === CLAUDE_NEEDS_RECONNECTING
    || message.includes(CLAUDE_NEEDS_RECONNECTING)
    || claudeCreditsExhausted(message);
}
