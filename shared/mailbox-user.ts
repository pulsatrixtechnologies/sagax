// Owner mailbox identity for engine connectors and mail MCP tools (#1943).
//
// Delegated Graph tokens (Mail.Read without .All) open the signed-in person's
// own mailbox through /me. Passing userId / user_id as another UPN, or as the
// bot's inbound address, makes Graph answer 403. Send already refuses another
// mailbox on the one-shot draft pass (shared/email-draft-send.ts); reads did
// not. The primary bot acts on the owner's own mailbox with the owner's
// credentials: omit those fields (or pass "me") so the call stays on /me.

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

/** Whether a permission ask must be refused so the bot retries on /me with
 * the owner's own credentials (#1943). Account-connector reads and any mail
 * tool that names another mailbox. */
export function foreignMailboxRefusal(
  tool: string | undefined,
  input: unknown,
  opts?: { accountConnector?: boolean },
): { userId: string } | null {
  const userId = foreignMailboxUserId(input);
  if (!userId) return null;
  if (opts?.accountConnector || isMailboxTool(tool)) return { userId };
  return null;
}

/** What the engine hears when Sagax refuses a foreign-mailbox call. */
export const FOREIGN_MAILBOX_REFUSAL =
  "This call targeted another mailbox through userId. The person's own mail uses their own credentials under /me: omit userId and user_id (or pass \"me\"), then try again.";
