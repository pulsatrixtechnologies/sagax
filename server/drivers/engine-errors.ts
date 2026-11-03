// Plain words for an engine's failure, shared by every driver: an account out of credits, a usage or rate limit, an
// overloaded or failing service, or any other HTTP refusal names the provider and keeps its own short reason. Each
// sentence keeps the words classifyError (retry.ts) reads, so retries, account switching and health codes are unchanged.
import { redactSecretsInText } from "../redact.ts";
import { USAGE_LIMIT } from "./retry.ts";
import { contextFullMessage, isContextFullText } from "../context/context-renewal.ts";

export type EngineFailureKind = "credits" | "usage_limit" | "context_full" | "rate_limit" | "overloaded" | "server" | "refused";

/** A provider refusing for want of credit or payment, in its own words (402 is read from the status). */
const OUT_OF_CREDITS = /\bpayment required\b|\binsufficient (?:account )?(?:funds|balance|credits?)\b|\b(?:credit|account) balance is too low\b|\bout of credits?\b|\bno credits? (?:left|remaining)\b|\bused all (?:available |of (?:your|its) )?credits\b/i;

/** Grok Build's "API error (status 402 Payment Required): …" (inside ACP's "Internal error: …"), the chat-completions
 * drivers' "xAI HTTP 402: …", and Claude Code's "API Error: 529 …". */
const STATUS = /\(status (\d{3})\b[^)]*\)|\bHTTP (\d{3})\b|^API Error:? (\d{3})\b/i;

const WRAPPERS = [
  /^provider returned a(?: streaming)? completion error:\s*/i,
  /^internal error:\s*/i,
  /^API error \(status \d{3}[^)]*\):?\s*/i,
  /^API Error:?\s*(?:\d{3}\b:?\s*)?/i,
  /^[\w.-]+ HTTP \d{3}:?\s*/i,
];
/** acpRpcError's method context: "(session/prompt, service: session, APIError)". */
const ACP_CONTEXT = /\s*\([a-z_]+\/[\w/.-]+(?:, [^()]*)?\)$/i;
const REASON_CHARS = 160;

export function httpStatusOf(text: string): number | null {
  const match = STATUS.exec(text.trim());
  const status = Number(match?.[1] ?? match?.[2] ?? match?.[3]);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : null;
}

function jsonMessage(body: string): string | null {
  try {
    const value = JSON.parse(body);
    const message = value?.error?.message ?? value?.message ?? (typeof value?.error === "string" ? value.error : undefined);
    return typeof message === "string" ? message : null;
  } catch {
    return null;
  }
}

/** A status line's own phrase ("Payment Required", "Overloaded"): it says nothing the sentence does not. */
const STATUS_PHRASE = /^(?:[A-Z][a-z]+ ?){1,4}$|^\S+$/;

/** The provider's own short reason inside a raw error, without the RPC wrapper, status line or method context: its
 * first sentence, redacted, and null for a bare status phrase, a raw body or nothing at all. */
export function providerReason(text: string): string | null {
  let reason = text.replace(/\s+/g, " ").trim();
  for (const wrapper of WRAPPERS) reason = reason.replace(wrapper, "");
  reason = reason.replace(ACP_CONTEXT, "").trim();
  if (/^[{[]/.test(reason)) reason = jsonMessage(reason)?.replace(/\s+/g, " ").trim() ?? "";
  if (!reason || reason.startsWith("<")) return null;
  const first = /^(.{20,}?[.!?])\s/.exec(reason)?.[1];
  if (first) {
    // A later sentence naming the reset ("Your plan resets at ...") is what a limit's backup reads, so it stays.
    const reset = /(?:^|[.!?]\s+)([^.!?]*\bresets?\b[^\s]*(?:\s[^\s]+){0,8})\s*$/i.exec(reason.slice(first.length))?.[1];
    reason = reset ? `${first} ${reset.trim()}` : first;
  }
  if (reason.length > REASON_CHARS) reason = `${reason.slice(0, REASON_CHARS - 1).replace(/\s+\S*$/, "")}…`;
  reason = redactSecretsInText(reason).replaceAll('"', "'").replace(/[.\s]+$/, "");
  return reason && !STATUS_PHRASE.test(reason) ? reason : null;
}

/** What a raw engine failure is, from its HTTP status or its words; null when it is none of these. */
export function engineFailureKind(text: string, status = httpStatusOf(text)): EngineFailureKind | null {
  if (status === 402 || OUT_OF_CREDITS.test(text)) return "credits";
  if (USAGE_LIMIT.test(text)) return "usage_limit";
  // The engine's context filled up (Claude Code's compaction breaker, an API's 400 for a prompt past the window):
  // a fresh session continues, so the person never reads the engine's own advice to type /clear.
  if (isContextFullText(text)) return "context_full";
  if (status === 529 || /\boverloaded\b/i.test(text)) return "overloaded";
  if (status === 429) return "rate_limit";
  if (status !== null) return status >= 500 ? "server" : "refused";
  return null;
}

/** `text` in plain words naming `provider`, or null when it is no failure this knows (the caller keeps the text). */
export function engineFailureMessage(
  provider: string,
  text: string,
  { kind, status }: { kind?: EngineFailureKind | null; status?: number | null } = {},
): string | null {
  const http = status === undefined ? httpStatusOf(text) : status;
  const what = kind ?? engineFailureKind(text, http);
  if (!what) return null;
  const reason = providerReason(text);
  const says = reason ? `${provider} says: "${reason}"` : null;
  const detail = (...parts: Array<string | null>) => parts.some(Boolean) ? ` (${parts.filter(Boolean).join("; ")})` : "";
  const code = http ? `HTTP ${http}` : null;
  switch (what) {
    case "credits": return `Your ${provider} account is out of credits${detail(says)}. Add credits with ${provider}, then run it again.`;
    case "context_full": return contextFullMessage(provider);
    case "usage_limit": return `This ${provider} account has reached its usage limit${detail(says)}. Wait for it to reset, or switch this bot to another engine.`;
    case "rate_limit": return `${provider} hit a rate limit${detail(code, says)}. Wait a minute, then run it again.`;
    case "overloaded": return `${provider} is overloaded right now${detail(code, says)}. This is usually temporary, so try again in a few minutes.`;
    case "server": return `${provider} had a temporary server problem${detail(code, says)}. Try again in a few minutes.`;
    case "refused": return `${provider} stopped with an error${detail(code, says)}.`;
  }
}

/** Only an out-of-credits failure in plain words; any other text stays as it is. */
export function outOfCreditsMessage(provider: string, text: string): string {
  return engineFailureKind(text) === "credits" ? engineFailureMessage(provider, text, { kind: "credits" })! : text;
}

/** Known stop tokens with plain words. Person cancel, engine empty and harness
 * cut stay distinct: never "stopped by user" unless the person cancelled. */
const STOP_CAUSE_LABELS: Record<string, string> = {
  interrupted: "The person stopped this turn.",
  cancelled: "The person stopped this turn.",
  reasoning_only: "The model returned only its reasoning and no final answer.",
  empty_turn: "The engine ended the turn with no reply, image, or tool result.",
  // Quiet / idle cut: the harness ended the turn, not the person.
  stuck: "The harness ended the turn after the engine went quiet with no tool running.",
};

/** A failed turn's stop reason as its cause: a bare provider token ("stop_sequence", "rpc_error") is never the whole
 * message, and the token stays in it so its class still reads. Known tokens get a plain label. */
export function stopCause(stopReason: string | null | undefined): string | undefined {
  const reason = stopReason?.trim();
  if (!reason) return undefined;
  const labeled = STOP_CAUSE_LABELS[reason];
  if (labeled) return labeled;
  return /^[a-z][a-z0-9_]*$/i.test(reason) ? `The engine stopped without saying why (stop reason: ${reason}).` : reason;
}

/** A local or computer-shared model failing, in plain words with what to do
 * (2026-10-27): it has no usage limit, so its errors never read as one. Null
 * when the text is none of these (the caller keeps it). */
export function localModelFailureMessage(text: string): string | null {
  const raw = text.replace(/\s+/g, " ").trim();
  if (!raw) return null;
  const leading = Number(/^(\d{3})\b/.exec(raw)?.[1]);
  const status = httpStatusOf(raw) ?? (Number.isInteger(leading) ? leading : null);
  if (/\btoo large to send to the local model\b/i.test(raw)) return null; // already says what to do
  if (/\bcontext (?:length|window)\b|\bmaximum context\b|\btoo many tokens\b|\bprompt is too long\b|\bexceeds? (?:the )?(?:model'?s? )?context\b/i.test(raw)) {
    return "This conversation is too long for the local model's context. Start a new conversation or compact this one, then try again.";
  }
  if (status === 401 || (status === 403 && !/\blocal model is unavailable\b/i.test(raw)) || /\bapi key (?:required|invalid|missing)\b|\binvalid api key\b|\bunauthorized\b/i.test(raw)) {
    return "The local model server refused the request: its API key is missing or wrong. Check the key set for that server, then try again.";
  }
  if (/\bmodel (?:not found|not loaded|is not loaded)\b|\bno model (?:is )?loaded\b|\bunknown model\b/i.test(raw) || status === 404) {
    return "The local model server does not have this model loaded. Load it there, or pick another model, then try again.";
  }
  if (status === 429 || /\btoo many requests\b|\bserver is busy\b/i.test(raw)) {
    return "The local model server is busy with another request. Try again in a moment.";
  }
  if (/\blocal model is unavailable\b|\bcomputer is offline\b|\blocal model request failed\b|\bconnection (?:error|refused|reset)\b|\bECONN(?:REFUSED|RESET)\b|\bETIMEDOUT\b|\bfetch failed\b|\bsocket hang up\b|\btimed? ?out\b|\binjoignable\b/i.test(raw) || (status !== null && status >= 500)) {
    return "The local model is not answering: the computer that serves it is offline or asleep, or its model server is stopped. Check that Sagax is open on that computer and the model server runs, then try again.";
  }
  return null;
}
