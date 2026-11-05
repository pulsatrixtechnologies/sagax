// Outbound actions: the calls that reach a person outside the app, or move
// money. Sending an email, replying in a thread, posting to a channel,
// publishing, inviting, sharing, refunding, charging. Below Full access they
// get their own confirmation, or spend an optional daily allowance per bot;
// at Full access they run. A read-and-draft routine run never reaches them:
// the relay refuses every send there. Shared by the harness (which enforces
// it) and the app (which shows the setting), so both agree on what
// "outbound" means.

import { connectorWriteKind } from "./engine-connectors.ts";

export type OutboundPolicy = {
  /** ask: every outbound call waits for a tap. allow: up to dailyCap a day. */
  policy: "ask" | "allow";
  dailyCap: number;
};

export const OUTBOUND_DEFAULT_CAP = 25;
const OUTBOUND_MAX_CAP = 1_000;

/** Tools whose action is one of these words send something somewhere. */
const SEND_VERBS = new Set([
  "SEND",
  "SENDS",
  "REPLY",
  "RESPOND",
  "FORWARD",
  "POST",
  "PUBLISH",
  "TWEET",
  "RETWEET",
  "BROADCAST",
  "INVITE",
  "SHARE",
  "REFUND",
  "CHARGE",
  "PAY",
  "PAYOUT",
  "TRANSFER",
]);

/** Creating one of these is sending it: a created comment is a comment
 * someone reads, a created invoice is one someone receives. */
const CREATE_VERBS = new Set(["CREATE", "CREATION", "ADD", "NEW"]);
const SENT_NOUNS = new Set(["MESSAGE", "COMMENT", "POST", "EMAIL", "MAIL", "INVOICE", "PAYMENT", "REFUND", "REPLY", "TWEET", "DM"]);

/** A read verb first means the rest of the name is what is being read:
 * REDDIT_GET_POST fetches a post, it does not post. */
const READ_VERBS = new Set(["GET", "LIST", "FETCH", "SEARCH", "READ", "FIND", "RETRIEVE", "LOOKUP", "DOWNLOAD", "VIEW", "CHECK", "COUNT"]);

/** Connected-app reads known by slug, since some put the noun first
 * (GOOGLECALENDAR_EVENTS_LIST lists events). */
export const KNOWN_READ_SLUGS: ReadonlySet<string> = new Set([
  "GMAIL_FETCH_EMAILS",
  "GMAIL_GET_PROFILE",
  "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID",
  "GMAIL_FETCH_MESSAGE_BY_THREAD_ID",
  "GOOGLECALENDAR_EVENTS_LIST",
  "GOOGLECALENDAR_EVENTS_GET",
  "GOOGLECALENDAR_FIND_EVENT",
  "GOOGLECALENDAR_LIST_CALENDARS",
]);

/** The action part of a tool name, as upper-case word tokens. An MCP
 * server's mcp__server__action drops its server; an engine connector slug
 * like TOOLKIT_ACTION drops its toolkit; a bare built-in like Bash stays as
 * it is. */
function actionTokens(name: string): string[] {
  let action = name;
  if (name.startsWith("mcp__")) {
    const [, , ...rest] = name.split("__");
    action = rest.join("_");
  } else if (/^[A-Z][A-Z0-9]*_[A-Z0-9_]+$/.test(name)) {
    action = name.slice(name.indexOf("_") + 1);
  }
  return action
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
}

/** 2026-10-28: Perspicax Voice's `voice_sms` texts a number: the same send,
 * card and allowed recipients as a Twilio Messages create. Its name has no
 * send verb, so it is named here. */
function isVoiceSms(tokens: readonly string[]): boolean {
  return tokens.length >= 2 && tokens[tokens.length - 2] === "VOICE" && tokens[tokens.length - 1] === "SMS";
}

/** 2026-11-02: placing a phone call reaches a real person and costs money,
 * like a text: it is held the same way below Full. A strict allow list,
 * never the word "call" in a name (calls_query, call recordings and
 * call_tool place nothing):
 *   - `voice_call` (Perspicax Voice) and `create_call` (a Twilio toolkit's
 *     Calls create), with or without a server prefix;
 *   - a Twilio write of the Calls resource (`twilio_api_write`,
 *     `twilio_api__write`, `twilio_api_Calls_write`, a bare `api_write`)
 *     that creates and names a `To`;
 *   - any of these run through an MCP directory's call_tool or a gateway's
 *     use_tool.
 * Perspicax Voice's voice_line (a read) and voice_number (search, buy,
 * adopt, verify by text, confirm, directive, menu) never dial out. Sagax's
 * own place_phone_call keeps its card (shared/outbound-call.ts) and is not
 * matched here. */
const CALL_TAILS: ReadonlyArray<readonly [string, string]> = [["VOICE", "CALL"], ["CREATE", "CALL"]];
const META_TAILS: ReadonlyArray<readonly [string, string]> = [["CALL", "TOOL"], ["USE", "TOOL"]];

function endsWith(tokens: readonly string[], tail: readonly [string, string]): boolean {
  return tokens.length >= 2 && tokens[tokens.length - 2] === tail[0] && tokens[tokens.length - 1] === tail[1];
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

/** "Calls", "Calls.json", "Accounts_Calls", "/2010-04-01/Accounts/AC1/Calls.json" all read "calls". */
function callResourceKey(raw: string): string {
  const last = raw.trim().replace(/\.json$/i, "").split("/").filter(Boolean).pop() ?? "";
  return last.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/^accounts?(?=.)/, "");
}

function namesTo(args: Record<string, unknown>): boolean {
  const places = [args.set, args.params, args.body, args.data, args];
  return places.some((place) => {
    const fields = asRecord(place);
    if (!fields) return false;
    return ["To", "to"].some((key) => typeof fields[key] === "string" ? (fields[key] as string).trim() !== "" : fields[key] !== undefined && fields[key] !== null);
  });
}

function twilioCallsCreate(name: string, tokens: readonly string[], args: Record<string, unknown>): boolean {
  const last = tokens[tokens.length - 1];
  if (last !== "WRITE" && last !== "CREATE") return false;
  const server = name.startsWith("mcp__") ? (name.split("__")[1] ?? "").toUpperCase() : "";
  const twilio = tokens.includes("TWILIO") || /TWILIO/.test(server) || (tokens.length === 2 && tokens[0] === "API");
  if (!twilio) return false;
  const fromName = tokens.slice(0, -1).filter((token) => token !== "TWILIO" && token !== "API" && token !== "ACCOUNTS" && token !== "ACCOUNT").join("_");
  const resource = typeof args.resource === "string" && args.resource.trim()
    ? args.resource
    : typeof args.path === "string" && args.path.trim() ? args.path : fromName;
  if (callResourceKey(resource) !== "calls") return false;
  const action = typeof args.action === "string" ? args.action.trim().toLowerCase() : "";
  if (action && action !== "create") return false;
  return namesTo(args);
}

/** Does this call place a phone call? `args` are the call's arguments when
 * the caller has them: a Twilio Calls write is only read with them. */
export function isPhoneCallTool(name: string, args?: unknown, depth = 0): boolean {
  const tokens = actionTokens(name);
  if (tokens.length < 2) return false;
  if (CALL_TAILS.some((tail) => endsWith(tokens, tail))) return true;
  const input = asRecord(args);
  if (!input) return false;
  if (META_TAILS.some((tail) => endsWith(tokens, tail))) {
    if (depth > 2) return false;
    const target = [input.name, input.tool_name, input.tool].find((value): value is string => typeof value === "string" && value.trim() !== "");
    if (!target) return false;
    let inner: unknown = input.arguments ?? input.tool_input ?? input.args;
    if (typeof inner === "string") {
      try { inner = JSON.parse(inner); } catch { inner = undefined; }
    }
    return isPhoneCallTool(target, inner, depth + 1);
  }
  return twilioCallsCreate(name, tokens, input);
}

/** Does the tool name describe a read-only action? This is deliberately
 * narrower than "not outbound": updates, deletes and other writes do not
 * become reads merely because they send nothing to another person. */
export function isReadOnlyTool(name: string): boolean {
  if (KNOWN_READ_SLUGS.has(name.replace(/^mcp__composio__/, ""))) return true;
  const tokens = actionTokens(name);
  return tokens.length > 0 && READ_VERBS.has(tokens[0]);
}

/** Sagax agents tools that talk to another bot or room inside the app.
 * Their names contain SEND/POST, so the verb heuristic would treat them as
 * outbound; peer contact is gated by approvePeerComms instead (#1905). */
const IN_APP_AGENTS_PEER_TOOLS = new Set([
  "send_to_bot",
  "post_to_room",
  "coordinate_bots",
  "ask_bot",
  "delegate_bot",
]);

/** Bare agents tool name when `name` is an agents peer tool, else null. */
function inAppAgentsPeerTool(name: string): string | null {
  const trimmed = name.trim();
  const prefixed = /^(?:mcp__)?agents__(.+)$/i.exec(trimmed);
  const tool = (prefixed ? prefixed[1]! : trimmed).toLowerCase();
  return IN_APP_AGENTS_PEER_TOOLS.has(tool) ? tool : null;
}

/** Does this tool send something to someone, or move money? `args`, when
 * the caller has them, let a Twilio Calls write read as the call it places. */
export function isOutboundTool(name: string, args?: unknown): boolean {
  // In-app peer tools stay inside Sagax; approvePeerComms is their card.
  if (inAppAgentsPeerTool(name)) return false;
  // A raw API call from the workbench can do anything an app tool can, and
  // nothing here can read which; it is treated as a send.
  if (name === "COMPOSIO_PROXY_EXECUTE") return true;
  const tokens = actionTokens(name);
  if (tokens.length === 0) return false;
  if (isVoiceSms(tokens)) return true;
  if (isPhoneCallTool(name, args)) return true;
  if (isReadOnlyTool(name)) return false;
  // A draft, a reply draft included, sends nothing until it is sent.
  if (tokens.includes("DRAFT") && !tokens.includes("SEND") && !tokens.includes("SENDS")) return false;
  if (tokens.some((token) => SEND_VERBS.has(token))) return true;
  // A known outward connector action reaches other people (an invitation,
  // a Teams post, a shared-file write). An unclassified connector write is
  // not evidence of a send: moving, labeling or deleting owned mail also
  // returns other-write. Its approval still follows the bot's level and
  // rules; it must never become an outbound draft/send hold.
  const connector = connectorWriteKind(name);
  if (connector && connector !== "other-write") return true;
  if (tokens.includes("DRAFT")) return false;
  return tokens.some((token) => CREATE_VERBS.has(token)) && tokens.some((token) => SENT_NOUNS.has(token));
}

/** What a plain message send is called: an email, a mail, a text, a DM. */
const MESSAGE_NOUNS = new Set(["EMAIL", "EMAILS", "MAIL", "GMAIL", "OUTLOOK", "SMS", "MMS", "TEXT", "MESSAGE", "MESSAGES", "IMESSAGE", "DM"]);
const MESSAGE_VERBS = new Set(["SEND", "SENDS", "CREATE", "NEW"]);
/** Verbs and nouns of an outbound call that is not a plain message: money,
 * invitations, shares, public posts, comments, replies and forwards (they
 * reach whoever is on the original thread). A bot's allowed recipients
 * (shared/allowed-recipients.ts) never answer these. */
const NOT_A_MESSAGE = new Set([
  "REFUND", "CHARGE", "PAY", "PAYOUT", "TRANSFER", "INVOICE", "PAYMENT", "INVITE", "SHARE", "PUBLISH", "TWEET", "RETWEET",
  "BROADCAST", "POST", "COMMENT", "ISSUE", "TASK", "EVENT", "CALENDAR", "REPLY", "RESPOND", "FORWARD", "GRANT", "ASSIGN",
]);

/** An outbound call that sends a message (an email, a text) to people it
 * names, and nothing else. An allow list: a send verb and a message noun,
 * and none of the words of money, invitations, shares, posts or replies. No
 * raw API call. */
export function isMessageSendTool(name: string): boolean {
  if (!isOutboundTool(name)) return false;
  // a phone call is not a text: allowed recipients never answer it
  if (isPhoneCallTool(name)) return false;
  const tokens = actionTokens(name);
  if (isVoiceSms(tokens)) return true;
  if (tokens.some((token) => NOT_A_MESSAGE.has(token))) return false;
  const server = name.startsWith("mcp__") ? (name.split("__")[1] ?? "").toUpperCase() : "";
  const toolkit = /^[A-Z][A-Z0-9]*_/.test(name) ? name.slice(0, name.indexOf("_")) : "";
  const nouns = [...tokens, ...server.split(/[^A-Z0-9]+/), toolkit];
  return tokens.some((token) => MESSAGE_VERBS.has(token)) && nouns.some((token) => MESSAGE_NOUNS.has(token));
}

/** The stored shape, or null when the value is not one. */
export function normalizeOutboundPolicy(value: unknown): OutboundPolicy | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { policy, dailyCap } = value as { policy?: unknown; dailyCap?: unknown };
  if (policy !== "ask" && policy !== "allow") return null;
  if (dailyCap === undefined) return { policy, dailyCap: OUTBOUND_DEFAULT_CAP };
  if (typeof dailyCap !== "number" || !Number.isInteger(dailyCap) || dailyCap < 1 || dailyCap > OUTBOUND_MAX_CAP) return null;
  return { policy, dailyCap };
}

/** What a bot without a stored policy does: ask, every time. */
export const DEFAULT_OUTBOUND_POLICY: OutboundPolicy = { policy: "ask", dailyCap: OUTBOUND_DEFAULT_CAP };

/** One app tool a connector request would run, with its arguments when the
 * request carries them. */
export interface ConnectorCall {
  slug: string;
  arguments?: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** Connected-apps session meta tools run the app tools inside them: a
 * multi-execute call carries a list of slugs with arguments. Arbitrary
 * workbench/bash code is opaque: it requires an explicit unrestricted
 * approval, never an inferred app or send count. Search, schema lookup,
 * and connection management run no app tools. */
export function connectorCallsIn(name: string, args: unknown): ConnectorCall[] {
  if (name === "COMPOSIO_MULTI_EXECUTE_TOOL") {
    const tools = isRecord(args) && Array.isArray(args.tools) ? args.tools
      : isRecord(args) && typeof args.tool_slug === "string" ? [args] : [];
    if (!tools.length) return [{ slug: "COMPOSIO_PROXY_EXECUTE", arguments: args }];
    const calls: ConnectorCall[] = [];
    for (const item of tools) {
      if (!isRecord(item)) return [{ slug: "COMPOSIO_PROXY_EXECUTE", arguments: args }];
      const slug = [item.tool_slug, item.slug, item.name, item.tool].find((value) => typeof value === "string" && value);
      if (typeof slug !== "string") return [{ slug: "COMPOSIO_PROXY_EXECUTE", arguments: args }];
      calls.push({ slug, ...(item.arguments !== undefined ? { arguments: item.arguments } : {}) });
    }
    return calls;
  }
  if (name === "COMPOSIO_REMOTE_WORKBENCH" || name === "COMPOSIO_REMOTE_BASH_TOOL") {
    // Arbitrary code can compute tool names and repeat calls. Its app and
    // outbound count cannot be inferred from literals in the source.
    return [{ slug: "COMPOSIO_PROXY_EXECUTE", arguments: args }];
  }
  if (["COMPOSIO_SEARCH_TOOLS", "COMPOSIO_GET_TOOL_SCHEMAS", "COMPOSIO_MANAGE_CONNECTIONS", "COMPOSIO_WAIT_FOR_CONNECTIONS"].includes(name)) return [];
  if (name.startsWith("COMPOSIO_")) return [{ slug: "COMPOSIO_PROXY_EXECUTE", arguments: args }];
  return [{ slug: name, ...(args !== undefined ? { arguments: args } : {}) }];
}

/** The subset of a request's app tools that would send something. */
export function outboundCallsIn(name: string, args: unknown): ConnectorCall[] {
  return connectorCallsIn(name, args).filter((call) => isOutboundTool(call.slug, call.arguments));
}
