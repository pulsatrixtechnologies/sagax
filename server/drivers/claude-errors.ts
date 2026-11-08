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

/** An injected model's own server (a local one, or a computer's model
 * relayed by the org server) refused the turn's key: not Claude's sign-in,
 * so no reconnect card, and a row the chat shows. */
export function claudeInjectedModelRefused(raw: string): string {
  const said = raw.trim().slice(0, 300);
  const lead = "The server of this bot's local model refused the turn, so no reply came back. Check that the computer serving the model is on and shares it with you.";
  return said ? `${lead} It said: ${said}` : lead;
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
