// Owner mailbox identity for engine connectors and mail MCP tools (#1943).
//
// Delegated Graph tokens (Mail.Read without .All) open the signed-in person's
// own mailbox through /me. Passing userId / user_id as another UPN, or as the
// bot's inbound address, makes Graph answer 403. The call still goes through:
// Full access, Ask and Deny decide it like any other tool. When the vendor
// answers 403 on that other mailbox, the engine hears one retry sentence.
// The connector prompt tells the bot to omit those fields (or pass "me") for
// the person's own mail.

/** Values that mean the signed-in person's own mailbox (Graph /me). */
const OWN = new Set(["", "me"]);

function keyOf(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, "");
}

/** Tool arguments as an object: a record, or the JSON text of one (permission
 * cards and activity rows carry the latter). */
export function mailboxToolArgs(input: unknown): Record<string, unknown> | null {
  if (input && typeof input === "object" && !Array.isArray(input)) return input as Record<string, unknown>;
  if (typeof input !== "string") return null;
  const text = input.trim();
  if (!text.startsWith("{")) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/** The mailbox userId / user_id a call names when it is not the signed-in
 * person's own (/me). Null when the call omits it, names "me", or is not an
 * object. Nested message.userId is not read: connectors put the mailbox id
 * at the top level (the send pass already treats any extra top-level field
 * as another mailbox). */
export function foreignMailboxUserId(input: unknown): string | null {
  const args = mailboxToolArgs(input);
  if (!args) return null;
  for (const [rawKey, value] of Object.entries(args)) {
    if (keyOf(rawKey) !== "userid") continue;
    if (typeof value !== "string") return String(value);
    const trimmed = value.trim();
    if (OWN.has(trimmed.toLowerCase())) return null;
    return trimmed;
  }
  return null;
}

/** A mail / Outlook / Gmail / Microsoft 365 tool name (engine connector or
 * MCP), including gateway spellings. */
export function isMailboxTool(name: string | undefined): boolean {
  if (!name) return false;
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
  if (!words.length) return false;
  const set = new Set(words);
  if (set.has("OUTLOOK") || set.has("GMAIL") || set.has("EXCHANGE") || set.has("MAILBOX")) return true;
  if (set.has("MAIL") || set.has("EMAIL") || set.has("INBOX")) return true;
  if (set.has("MICROSOFT") && (set.has("365") || set.has("M365") || set.has("OFFICE"))) return true;
  return false;
}

/** What the engine reads when a mail call named another mailbox and the
 * vendor answered 403. No pre-emptive refusal: the call runs, and only this
 * answer is rewritten. */
export const MAILBOX_ACCESS_DENIED =
  "Access denied for that mailbox; for your own mail retry with /me";

const STATUS_KEYS = ["status", "statusCode", "httpStatus", "httpStatusCode"] as const;

/** A vendor failure is HTTP 403 (a status field, Graph ErrorAccessDenied, or
 * the words "403 Forbidden"). A bare number is not enough: an id or a count
 * can be 403. */
function isVendorForbidden(value: unknown, depth = 0): boolean {
  if (depth > 6 || value == null || typeof value === "number" || typeof value === "boolean") return false;
  if (typeof value === "string") {
    const text = value.trim();
    if (text === "403") return true;
    if (/\b403\b/.test(text) && /forbidden|access is denied|erroraccessdenied|graph api error/i.test(text)) return true;
    if ((text.startsWith("{") || text.startsWith("[")) && text.length < 20_000) {
      try {
        return isVendorForbidden(JSON.parse(text), depth + 1);
      } catch {
        return false;
      }
    }
    return false;
  }
  if (Array.isArray(value)) return value.slice(0, 16).some((item) => isVendorForbidden(item, depth + 1));
  if (typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  for (const key of STATUS_KEYS) {
    const status = record[key];
    if (status === 403 || status === "403") return true;
  }
  const code = record.code ?? record.errorCode ?? record.error_code;
  if (code === "ErrorAccessDenied") return true;
  if (typeof record.text === "string" && isVendorForbidden(record.text, depth + 1)) return true;
  for (const nested of [record.error, record.message, record.content, record.output, record.body, record.result, record.structuredContent, record.data]) {
    if (nested !== undefined && isVendorForbidden(nested, depth + 1)) return true;
  }
  return false;
}

/** The retry sentence when this mail call named another mailbox and the
 * vendor answered 403. Null for the owner's own /me, for any other status,
 * and for a tool that is not mail: those keep the vendor's own words. */
export function foreignMailboxAccessDenied(tool: string | undefined, input: unknown, vendor: unknown): string | null {
  if (!foreignMailboxUserId(input) || !isMailboxTool(tool) || !isVendorForbidden(vendor)) return null;
  return MAILBOX_ACCESS_DENIED;
}
