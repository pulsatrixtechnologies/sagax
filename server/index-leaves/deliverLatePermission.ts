// @ts-nocheck
/** A permission card answered after its engine is gone (#4528).
 * The card stays the ask. One ordinary turn in the same session carries
 * the verdict. A second answer does not start a second turn. */
import { createHash } from "node:crypto";
import { personLanguageCode, personWord } from "../people/person-words.ts";
import { savePermissionPass, takeMatchingPermissionPass } from "../turns/saved-permission-pass.ts";

export type Host = Record<string, any>;

function verdictText(host: Host, owner: { id: string }, behavior: "allow" | "deny", tool: string, detail: string): string {
  const person = host.effectiveBotOwner?.(host.store?.bot?.(owner.id) ?? owner)
    ?? host.recordedBotOwner?.(host.store?.bot?.(owner.id) ?? owner);
  const language = personLanguageCode(host.languageOfPerson?.(person));
  const key = behavior === "allow" ? "chat.approval.lateAllow" : "chat.approval.lateDeny";
  return personWord(language, key, { tool, detail });
}

/** Starts or queues the one turn through the late answer's own delivery
 * (deliverLateQuestionAnswer.ts `deliverLateCardTurn`: the sequenced send,
 * the budget, who speaks, the room checks, the card put back on a failed
 * start). Returns false when this answer cannot (no auth, no delivery), so
 * the caller keeps today's unavailable path. */
export async function deliverLatePermission(host: Host, input: {
  auth?: RequestAuth;
  threadId: string;
  requestId: string;
  behavior: "allow" | "deny";
  message?: string;
  cardMessage: { id: string; card: Record<string, any> };
  owner: { id: string; name: string };
}): Promise<boolean> {
  const { auth, threadId, requestId, behavior, message, cardMessage, owner } = input;
  const card = cardMessage.card;
  if (!card || card.answered || card.dismissed) return true;
  if (!auth || typeof host.deliverLateCardTurn !== "function") return false;

  const namedTool = typeof card.tool === "string" ? card.tool.trim() : "";
  const tool = namedTool || "this step";
  const noted = [card.subtitle, message].map((part) => (typeof part === "string" ? part.trim() : "")).filter(Boolean).join(" ");
  const detail = noted || tool;
  const verdict = verdictText(host, owner, behavior, tool, detail);
  const text = host.store.groupByThread?.(threadId) ? `@${owner.name}: ${verdict}` : verdict;
  const sendId = `late-permission-${createHash("sha256").update(`${threadId}:${requestId}`).digest("hex").slice(0, 32)}`;

  // the pass is there before the turn it starts asks again
  const pass = behavior === "allow" && namedTool
    ? { threadId, tool: namedTool, summary: typeof card.subtitle === "string" ? card.subtitle : "" }
    : null;
  if (pass) savePermissionPass(host, pass);
  try {
    await host.deliverLateCardTurn(auth, { threadId, requestId, text, cardMessage, owner, sendId, answered: behavior, ...(message ? { answeredText: message } : {}) });
  } catch (error) {
    if (pass) takeMatchingPermissionPass(host, pass.threadId, [pass.tool], pass.summary);
    throw error;
  }
  host.askMessageByRequest?.delete(`${threadId}:${requestId}`);
  try {
    host.appendDecision?.(host.DATA_DIR, {
      threadId,
      requestId,
      botId: owner.id,
      botName: owner.name,
      tool: card.tool,
      summary: card.subtitle,
      decision: behavior === "allow" ? "user-approved" : "user-denied",
      source: "user",
    });
  } catch {
    // The turn still carries the verdict. The audit row is the record of it.
  }
  return true;
}
