// Outbound actions: the calls that reach a person outside the app, or move
// money. Sending an email, replying in a thread, posting to a channel,
// publishing, inviting, sharing, refunding, charging. These get their own
// confirmation regardless of approval level, and an optional daily
// allowance per bot, because the cost of one wrong send is paid by someone
// who never saw the bot.
//
// Shared between the harness (which enforces it) and the app (which shows
// the setting), so both agree on what "outbound" means.

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

/** Does the tool name describe a read-only action? This is deliberately
 * narrower than "not outbound": updates, deletes and other writes do not
 * become reads merely because they send nothing to another person. */
export function isReadOnlyTool(name: string): boolean {
  const tokens = actionTokens(name);
  return tokens.length > 0 && READ_VERBS.has(tokens[0]);
}

/** Does this tool send something to someone, or move money? */
export function isOutboundTool(name: string): boolean {
  const tokens = actionTokens(name);
  if (tokens.length === 0) return false;
  if (isReadOnlyTool(name)) return false;
  // A draft, a reply draft included, sends nothing until it is sent.
  if (tokens.includes("DRAFT") && !tokens.includes("SEND") && !tokens.includes("SENDS")) return false;
  if (tokens.some((token) => SEND_VERBS.has(token))) return true;
  // A mail, Teams, calendar or file connector acts as the person outside the
  // app: an event mails its attendees, a SharePoint write lands in a shared
  // site, and an engine's own connector server fails closed on any call that
  // is not a read or a draft (shared/engine-connectors.ts). Same reading for
  // an MCP tool and an engine connector slug (GOOGLECALENDAR_CREATE_EVENT).
  if (connectorWriteKind(name)) return true;
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
  const tokens = actionTokens(name);
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
