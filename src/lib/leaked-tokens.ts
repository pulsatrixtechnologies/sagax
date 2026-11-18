import { stripChatSpecialTokens } from "../../shared/chat-special-tokens";
import { failedTurnCause } from "../../shared/failed-turn";
import { isProactiveWakePrompt } from "../../shared/proactive-wake-marker";

type ShownRun = { status: string; summary?: string; error?: string; problems?: string; attention?: string; goalStatus?: string; handedTo?: readonly unknown[] };
type ShownMessage = { role: string; kind: string; text?: string; attachments?: readonly unknown[]; routineRun?: ShownRun; tool?: { name?: string } };

/** A routine run's message as shown (2026-11-06, Wren's "New Outlook
 * email" webhook runs: six bubbles that read "<|eos|>"). A completed run
 * whose report was nothing but control tokens had nothing for the person:
 * it does not show. Null hides it; the same message when nothing changes. */
function shownRun<T extends ShownMessage>(m: T): T | null {
  const run = m.routineRun;
  if (!run?.summary || !run.summary.includes("<")) return m;
  const summary = stripChatSpecialTokens(run.summary);
  if (summary === run.summary) return m;
  if (summary.trim()) return { ...m, routineRun: { ...run, summary }, ...(typeof m.text === "string" ? { text: stripChatSpecialTokens(m.text) } : {}) };
  const saysMore = run.status !== "completed" || run.error || run.problems || run.attention || (run.goalStatus && run.goalStatus !== "completed") || run.handedTo?.length || m.attachments?.length;
  return saysMore ? { ...m, routineRun: { ...run, summary: undefined } } : null;
}

/** A conversation as shown: a bot's reply already stored with a control token
 * a model wrote as text (`<|eos|>`, 2026-11-06) shows without it, and one that
 * was nothing but tokens does not show; a routine run's report likewise. The
 * stored rows stay as they were. The same array comes back when no reply
 * carries one.
 * #4711: a proactive wake's prompt (internal instructions and fenced event
 * data, shared/proactive-wake-marker.ts) is never a bubble, and neither is the
 * failed-turn row of that wake pass: only the bot's own reply, if any, shows. */
export function withoutLeakedTokens<T extends ShownMessage>(messages: T[]): T[] {
  let out: T[] | null = null;
  let inWake = false;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    let shown: T | null = m;
    if (m.role === "user") inWake = isProactiveWakePrompt(m.text);
    if (inWake && (m.role === "user" || (m.kind === "activity" && failedTurnCause(m.tool?.name ?? "") !== null))) shown = null;
    else if (m.role === "bot" && m.kind === "routine.run") shown = shownRun(m);
    else if (m.role === "bot" && m.kind === "text" && typeof m.text === "string" && m.text.includes("<")) {
      const text = stripChatSpecialTokens(m.text);
      if (text !== m.text) shown = text.trim() || m.attachments?.length ? { ...m, text } : null;
    }
    if (shown === m) {
      out?.push(m);
      continue;
    }
    out ??= messages.slice(0, i);
    if (shown) out.push(shown);
  }
  return out ?? messages;
}
