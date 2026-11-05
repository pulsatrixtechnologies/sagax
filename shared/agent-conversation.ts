// A conversation an outside agent holds with a bot (2026-10-29).
//
// A person's AI client attached to Perspicax (a voice assistant, a coding
// client) that prompts one of their bots over MCP (send_prompt, sagax_send)
// is another agent talking to the bot, not the person typing. Its turns go to
// a conversation of their own between that agent and the bot, drawn like a
// bot-to-bot conversation ("<agent> ⇆ <bot>"), never into the person's own
// chat with the bot:
//
//   - the thread is stamped `openedBy: { kind: "agent", botId: "agent:<slug>",
//     name: <the agent's name> }`, one per bot, person and agent, reused by
//     every prompt that names no thread;
//   - an opener that is not the bot itself makes it a bot-to-bot thread for
//     every existing rule: out of the person's stream (shared/single-stream.ts),
//     their sidebar, unread counts and typing dots;
//   - nothing in it notifies the person (push, watch, banner, sound), except
//     what only they can answer: an approval or a question
//     (`agentConversationNotifies`), on desktop, phones and watches too.
//
// The turn still runs as the person who owns the connection, with their
// rights and sign-ins: only where it is shown and who is told change.
// Pure: the server, the desktop app and the tests share these rules.

/** The opener id prefix of an outside agent: never a bot id. */
export const AGENT_OPENER_PREFIX = "agent:";

/** The name when the client sent none (an older Perspicax). */
export const AGENT_CALLER_FALLBACK = "AI client";

/** The longest name kept for an outside agent. */
export const AGENT_LABEL_MAX = 80;

/** The outside agent's name as shown: its MCP client or connection name,
 * trimmed, one line, control characters removed, at most AGENT_LABEL_MAX
 * characters; the fallback when nothing is left. */
export function agentCallerLabel(raw: unknown): string {
  if (typeof raw !== "string") return AGENT_CALLER_FALLBACK;
  // eslint-disable-next-line no-control-regex
  const clean = raw.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return AGENT_CALLER_FALLBACK;
  return [...clean].slice(0, AGENT_LABEL_MAX).join("").trim();
}

/** The opener id of an outside agent: `agent:` and its name as a slug, so
 * the same client reuses its conversation. */
export function agentOpenerId(label: string): string {
  const slug = agentCallerLabel(label).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return `${AGENT_OPENER_PREFIX}${slug || "client"}`;
}

/** Whether a thread was opened by an outside agent (not a bot). */
export function isAgentConversation(task: { openedBy?: { botId?: unknown; kind?: unknown } | null } | null | undefined): boolean {
  const opener = task?.openedBy;
  if (!opener) return false;
  return opener.kind === "agent" || (typeof opener.botId === "string" && opener.botId.startsWith(AGENT_OPENER_PREFIX));
}

/** Whether a notification of this kind reaches the person from an outside
 * agent's conversation: only what they must act on (an approval, a
 * question), which then follows Reach me like any other card. */
export function agentConversationNotifies(kind: string): boolean {
  return kind === "approval" || kind === "question";
}
