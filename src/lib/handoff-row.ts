// A bot-to-bot hand-off in the unified chat (threads off, 2026-11-09).
// The "Sent to <teammate>" receipt and the "<teammate> replied" result are
// thread receipts: with threads off they used to draw nothing, so a handoff
// (its brief, its failure, the teammate's verdict) was invisible. Here they
// read as one row: "Asked <teammate>" with the brief folded, and the
// teammate's verdict under it once the result is in, live.
import type { Message } from "@/state/store";

/** The request a "Sent to" receipt opened (server: coordinate-bots route). */
export function handoffRequestId(message: Pick<Message, "kind" | "threadRef" | "tool" | "roomRequest">): string | undefined {
  if (message.kind !== "activity" || !message.threadRef || message.roomRequest) return undefined;
  return message.tool?.handoffId || undefined;
}

/** The request a "<teammate> replied" result answers. */
export function handoffResultId(message: Pick<Message, "kind" | "roomRequest">): string | undefined {
  if (message.kind !== "activity" || message.roomRequest?.phase !== "result") return undefined;
  return message.roomRequest.id;
}

/** A teammate's hand-off in a direct conversation: the "Sent to" receipt or
 * the result it brought back. */
export function isHandoff(message: Pick<Message, "kind" | "threadRef" | "tool" | "roomRequest">): boolean {
  if (!message.threadRef) return false;
  if (handoffRequestId(message) || handoffResultId(message)) return true;
  // receipts written before they carried their request id
  return message.kind === "activity" && !message.roomRequest && (message.tool?.name ?? "").startsWith("Sent to ");
}

/** The result in this transcript that answers request `id`. */
export function handoffResultIn(messages: readonly Message[], id: string | undefined): Message | undefined {
  if (!id) return undefined;
  return messages.find((message) => handoffResultId(message) === id);
}

/** Whether the receipt that opened request `id` is in this transcript: the
 * result then shows under it, not as a row of its own. */
export function handoffReceiptIn(messages: readonly Message[], id: string | undefined): boolean {
  if (!id) return false;
  return messages.some((message) => handoffRequestId(message) === id);
}

export type HandoffVerdict = "PASS" | "FAIL";

/** A reviewer's PASS or FAIL, when its reply leads with one. */
export function handoffVerdict(text: string | undefined): HandoffVerdict | undefined {
  if (!text) return undefined;
  const head = text.replace(/[*_`#>]/g, " ").trim().split("\n", 1)[0]!.slice(0, 160);
  const word = /\b(PASS(?:ED)?|FAIL(?:ED)?)\b/.exec(head)?.[1];
  if (!word) return undefined;
  return word.startsWith("PASS") ? "PASS" : "FAIL";
}

/** The brief on one line, for the row's target. */
export function briefLine(text: string | undefined, max = 120): string | undefined {
  const line = text?.replace(/\s+/g, " ").trim();
  if (!line) return undefined;
  const points = Array.from(line);
  return points.length > max ? `${points.slice(0, max - 1).join("").trimEnd()}…` : line;
}

export type HandoffPhase = "running" | "done" | "failed";

/** Where the hand-off stands: waiting on the teammate, answered, or failed. */
export function handoffPhase(receipt: Pick<Message, "tool">, result: Pick<Message, "tool"> | undefined): HandoffPhase {
  if (receipt.tool?.ok === false) return "failed";
  // a receipt written before it carried its request id cannot wait on one
  if (!receipt.tool?.handoffId) return "done";
  if (!result) return "running";
  return result.tool?.ok === false ? "failed" : "done";
}
