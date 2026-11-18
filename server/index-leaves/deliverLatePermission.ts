// @ts-nocheck
/** A permission card answered after its engine is gone (#4528).
 * The card stays the ask. One ordinary turn in the same session carries
 * the verdict. A second answer does not start a second turn. */
import { createHash } from "node:crypto";
import { personLanguageCode, personWord } from "../people/person-words.ts";
import { queueChannelMessage } from "../rooms/channel-queue.ts";
import { savePermissionPass } from "../turns/saved-permission-pass.ts";

export type Host = Record<string, any>;

function verdictText(host: Host, owner: { id: string }, behavior: "allow" | "deny", tool: string, detail: string): string {
  const person = host.effectiveBotOwner?.(host.store?.bot?.(owner.id) ?? owner)
    ?? host.recordedBotOwner?.(host.store?.bot?.(owner.id) ?? owner);
  const language = personLanguageCode(host.languageOfPerson?.(person));
  const key = behavior === "allow" ? "chat.approval.lateAllow" : "chat.approval.lateDeny";
  return personWord(language, key, { tool, detail });
}

/** Starts the one turn. Returns false when this answer cannot (no owner
 * thread to speak in), so the caller keeps today's unavailable path. */
export async function deliverLatePermission(host: Host, input: {
  threadId: string;
  requestId: string;
  behavior: "allow" | "deny";
  message?: string;
  cardMessage: { id: string; card: Record<string, any> };
  owner: { id: string; name: string };
}): Promise<boolean> {
  const { threadId, requestId, behavior, message, cardMessage, owner } = input;
  const card = cardMessage.card;
  if (!card || card.answered || card.dismissed) return true;
  if (typeof host.startOrQueueDirectMessage !== "function" && typeof host.startGroupTurn !== "function") return false;

  const namedTool = typeof card.tool === "string" ? card.tool.trim() : "";
  const tool = namedTool || "this step";
  const noted = [card.subtitle, message].map((part) => (typeof part === "string" ? part.trim() : "")).filter(Boolean).join(" ");
  const detail = noted || tool;
  const text = verdictText(host, owner, behavior, tool, detail);
  const sendId = `late-permission-${createHash("sha256").update(`${threadId}:${requestId}`).digest("hex").slice(0, 32)}`;
  const group = host.store.groupByThread?.(threadId) ?? null;

  const already = host.store.messagesFor(threadId).some((row) => row.sendId === sendId);
  if (already) return true;

  host.store.patchMessage(threadId, cardMessage.id, {
    card: { ...card, answered: behavior, ...(message ? { answeredText: message } : {}), dismissed: false },
  });
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

  const reopen = () => {
    const now = host.store.messagesFor(threadId).find((row) => row.id === cardMessage.id)?.card;
    if (now && now.answered === behavior) {
      const { answered: _answered, answeredText: _text, ...rest } = now;
      host.store.patchMessage(threadId, cardMessage.id, { card: rest });
    }
  };

  try {
    if (group && typeof host.startGroupTurn === "function") {
      const spoken = `@${owner.name}: ${text}`;
      if (host.groupThreadIsWorking?.(group.id, threadId)) {
        queueChannelMessage(group.id, threadId, spoken, { replyToId: cardMessage.id, sendId, mode: "chat" });
      } else {
        host.startGroupTurn(group.id, spoken, cardMessage, sendId, "chat", undefined, { threadId });
      }
    } else if (typeof host.startOrQueueDirectMessage === "function") {
      await host.startOrQueueDirectMessage(owner.id, threadId, text, cardMessage, sendId);
    } else {
      reopen();
      return false;
    }
  } catch (error) {
    reopen();
    throw error;
  }
  if (behavior === "allow" && namedTool) {
    savePermissionPass(host, { threadId, tool: namedTool, summary: typeof card.subtitle === "string" ? card.subtitle : "" });
  }
  host.cardTurnSettled?.(threadId, cardMessage.id);
  return true;
}
