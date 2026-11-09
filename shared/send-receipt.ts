// send_to_bot receipts (#3246): what became of a one-way send, read by the
// sending bot (send_status) and drawn in the sender's chat as « Sent to
// <Bot> » with the thread's state. The send stays one-way unless the sender
// asked reply "resume": then the recipient's settled turn wakes the sender
// with a short return line.

/** How far a send got, in the sender's words. */
export type SendState = "queued" | "read" | "waiting" | "done" | "failed";

/** The receipt a send_to_bot leaves on its chip in the sender's conversation. */
export interface SendReceipt {
  /** The runtime id of the send (delegationId). */
  id: string;
  /** The sending bot. */
  senderId: string;
  /** The recipient and its new thread. */
  botId: string;
  threadId: string;
  state: SendState;
  /** A short summary of the recipient's reply, once it settled. */
  summary?: string;
  /** The sender asked to be resumed when the recipient finishes. */
  resume?: true;
  /** Set once the return line resumed the sender. */
  resumed?: true;
}

export const SEND_SUMMARY_MAX = 280;

/** The runtime status of a send (HandoffStatus) as a receipt state. A send
 * that started was read; one parked on a question waits on the person. */
export function sendStateOf(status: string | undefined, opts: { question?: boolean; started?: boolean } = {}): SendState {
  switch (status) {
    case "completed": return "done";
    case "failed":
    case "cancelled":
    case "expired": return "failed";
    case "waiting": return opts.question ? "waiting" : "read";
    case "running":
    case "resume": return "read";
    case "queued":
    case "source":
    case undefined:
    default: return opts.started ? "read" : "queued";
  }
}

/** One line, at most SEND_SUMMARY_MAX characters. */
export function sendSummary(text: string | undefined): string | undefined {
  const line = (text ?? "").replace(/\s+/g, " ").trim();
  if (!line) return undefined;
  return line.length > SEND_SUMMARY_MAX ? `${line.slice(0, SEND_SUMMARY_MAX - 1)}…` : line;
}

/** The return line that resumes a sender who asked reply "resume". */
export function sendReturnLine(botName: string, state: SendState, summary: string | undefined, threadId: string): string {
  const head = state === "done"
    ? `${botName} finished what you sent with send_to_bot (thread ${threadId}).`
    : `${botName} could not finish what you sent with send_to_bot (thread ${threadId}).`;
  const body = summary ? `\nIts reply: ${summary}` : "";
  return `${head}${body}\nRead the full exchange with send_status if you need more. Continue the person's request with this.`;
}

export function isSettledSend(state: SendState): boolean {
  return state === "done" || state === "failed";
}
