// What the chat /feedback is typed in says about the problem (#3299): the
// person's last requests before the command, the error the last turn ended
// on, its turn id, the model it ran on, the provider request ids in the
// error and the tool calls that failed. Read from the stored thread only;
// every word is anonymized later, when the report is built (report.ts).
import { failedTurnCause } from "../../shared/failed-turn.ts";
import { isFeedbackCommand } from "../../shared/feedback.ts";
import { redactSecretsInText } from "../redact.ts";

export interface ChatMessageLike {
  role: "bot" | "user";
  kind: string;
  text?: string;
  tool?: { name?: string; ok?: boolean };
  turnId?: string;
  turnRun?: { instanceId?: string; model?: string };
  feedback?: unknown;
}

export interface ChatFacts {
  /** The person's last requests before /feedback, oldest first (raw words). */
  asks: string[];
  /** The cause the last turn failed on, when it failed. */
  error?: string;
  /** The turn that failed (or the last turn), a server-local id. */
  turnId?: string;
  /** The model the last turn ran on, when the thread recorded it. */
  model?: string;
  /** Provider request ids quoted in the error. */
  requestIds: string[];
  /** Tool calls of the last turn that failed, by tool name. */
  failedTools: string[];
}

const MAX_ASKS = 3;

/** Request and trace ids a provider puts in an error. Only plain id shapes,
 * and never anything the secret redactor would touch. */
export function requestIdsIn(text: string): string[] {
  const found = new Set<string>();
  const patterns = [
    /\b(req_[A-Za-z0-9]{8,64})\b/g,
    /\b(?:x-)?(?:request|trace|correlation)[\s_-]?id["'\s:=]+([A-Za-z0-9][A-Za-z0-9._:-]{5,80})/gi,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const id = match[1]!.replace(/[.:]+$/, "");
      if (/^[A-Za-z0-9._:-]{6,80}$/.test(id) && redactSecretsInText(id) === id) found.add(id);
    }
  }
  return [...found].slice(0, 5);
}

function failedTool(name: string | undefined): string | null {
  if (!name || failedTurnCause(name) !== null) return null;
  return /^[\w.:-]{1,80}$/.test(name) ? name : null;
}

/** The facts of one thread, read before the /feedback message is stored. */
export function chatFacts(messages: readonly ChatMessageLike[]): ChatFacts {
  const facts: ChatFacts = { asks: [], requestIds: [], failedTools: [] };
  // the person's own requests: not /feedback, not the answers to the flow
  const asks: number[] = [];
  let previousBot: ChatMessageLike | undefined;
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!;
    if (message.role === "bot") {
      previousBot = message;
      continue;
    }
    if (message.kind !== "text" || !message.text?.trim()) continue;
    if (isFeedbackCommand(message.text) || previousBot?.feedback) continue;
    asks.push(index);
  }
  facts.asks = asks.slice(-MAX_ASKS).map((index) => messages[index]!.text!.trim());
  const lastAsk = asks.at(-1) ?? -1;
  const after = messages.slice(lastAsk + 1).filter((message) => message.role === "bot" && !message.feedback);
  const tools = new Set<string>();
  for (const message of after) {
    if (message.turnId) facts.turnId = message.turnId;
    if (message.turnRun?.model) facts.model = message.turnRun.model;
    const cause = message.tool?.name ? failedTurnCause(message.tool.name) : null;
    if (cause) {
      facts.error = cause;
      continue;
    }
    if (message.kind === "activity" && message.tool?.ok === false) {
      const name = failedTool(message.tool.name);
      if (name) tools.add(name);
    }
  }
  facts.failedTools = [...tools].slice(0, 10);
  if (facts.error) facts.requestIds = requestIdsIn(facts.error);
  return facts;
}
