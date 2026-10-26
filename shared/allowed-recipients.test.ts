import { describe, expect, it } from "vitest";

import {
  botRecipientAllowed,
  normalizeAllowedRecipients,
  normalizePhone,
  parseRecipientEntry,
  sendRecipients,
  sendRecipientsAllowed,
} from "./allowed-recipients.ts";

describe("allowed recipient entries", () => {
  it("reads typed and bare entries the same way", () => {
    expect(parseRecipientEntry("Email: Ana@Example.COM ")).toEqual({ kind: "email", value: "ana@example.com" });
    expect(parseRecipientEntry("ana@example.com")).toEqual({ kind: "email", value: "ana@example.com" });
    expect(parseRecipientEntry("(514) 555-1234")).toEqual({ kind: "phone", value: "+15145551234" });
    expect(parseRecipientEntry("phone:+33 6 12 34 56 78")).toEqual({ kind: "phone", value: "+33612345678" });
    expect(parseRecipientEntry("bot:bot_123")).toEqual({ kind: "bot", value: "bot_123" });
    expect(parseRecipientEntry("bot:../x")).toBeNull();
    expect(parseRecipientEntry("not a recipient")).toBeNull();
    expect(parseRecipientEntry(42)).toBeNull();
  });

  it("normalizes and deduplicates a list, refusing one bad entry", () => {
    expect(normalizeAllowedRecipients(["a@b.co", "email:A@B.CO", "514-555-1234"])).toEqual(["email:a@b.co", "phone:+15145551234"]);
    expect(normalizeAllowedRecipients(["a@b.co", "nope"])).toBeNull();
    expect(normalizeAllowedRecipients("a@b.co")).toBeNull();
    expect(normalizeAllowedRecipients(Array.from({ length: 201 }, (_, i) => `p${i}@b.co`))).toBeNull();
  });

  it("refuses what is not a phone number", () => {
    expect(normalizePhone("12")).toBeNull();
    expect(normalizePhone("+1 (514) 555-1234")).toBe("+15145551234");
  });

  it("names bots by id", () => {
    expect(botRecipientAllowed(["bot:b1"], "b1")).toBe(true);
    expect(botRecipientAllowed(["bot:b1"], "b2")).toBe(false);
    expect(botRecipientAllowed(undefined, "b1")).toBe(false);
  });
});

describe("a send's recipients", () => {
  const list = ["email:ana@example.com", "email:bob@example.com", "phone:+15145551234"];

  it("reads Gmail, Graph and text arguments", () => {
    expect(sendRecipients("mcp__composio__GMAIL_SEND_EMAIL", { recipient_email: "Ana@example.com", cc: ["bob@example.com"], user_id: "me", subject: "Hi", body: "x" }))
      .toEqual({ emails: ["ana@example.com", "bob@example.com"], phones: [] });
    expect(sendRecipients("mcp__outlook__send_mail", JSON.stringify({ message: { toRecipients: [{ emailAddress: { address: "ana@example.com", name: "Ana" } }] } })))
      .toEqual({ emails: ["ana@example.com"], phones: [] });
    expect(sendRecipients("mcp__messages__send_message", { to: "514 555 1234", text: "hello" }))
      .toEqual({ emails: [], phones: ["+15145551234"] });
    expect(sendRecipients("mcp__mail__send_email", { to: "Ana <ana@example.com>; bob@example.com" }))
      .toEqual({ emails: ["ana@example.com", "bob@example.com"], phones: [] });
  });

  it("sends with no card only when every recipient is listed", () => {
    expect(sendRecipientsAllowed(list, "mcp__composio__GMAIL_SEND_EMAIL", { recipient_email: "ana@example.com" })).toBe(true);
    expect(sendRecipientsAllowed(list, "mcp__composio__GMAIL_SEND_EMAIL", { recipient_email: "ana@example.com", bcc: ["eve@example.com"] })).toBe(false);
    expect(sendRecipientsAllowed([], "mcp__composio__GMAIL_SEND_EMAIL", { recipient_email: "ana@example.com" })).toBe(false);
  });

  it("keeps the card for what the list cannot vouch for", () => {
    // not a message send at all
    expect(sendRecipients("mcp__stripe__create_refund", { email: "ana@example.com" })).toBeNull();
    expect(sendRecipients("mcp__paypal__send_payment", { to: "ana@example.com" })).toBeNull();
    expect(sendRecipients("mcp__drive__share_file", { email: "ana@example.com" })).toBeNull();
    expect(sendRecipients("COMPOSIO_PROXY_EXECUTE", { to: "ana@example.com" })).toBeNull();
    expect(sendRecipients("mcp__fs__read_file", { to: "ana@example.com" })).toBeNull();
    // a channel, a guest list, an id that is not an address
    expect(sendRecipients("mcp__slack__send_message", { channel: "C123", to: "ana@example.com" })).toBeNull();
    expect(sendRecipients("mcp__slack__send_message", { to: "U123" })).toBeNull();
    expect(sendRecipients("mcp__mail__send_email", { to: "ana@example.com", attendees: ["eve@example.com"] })).toBeNull();
    // a reply whose recipients come from the thread
    expect(sendRecipients("mcp__outlook__reply_to_message", { messageId: "m1", comment: "ok" })).toBeNull();
    // a recipient field spelled another way is still read (review 1C)
    expect(sendRecipientsAllowed(list, "OUTLOOK_SEND_EMAIL", { to_email: "ana@example.com", to_name: "Ana", bcc_emails: "eve@example.com" })).toBe(false);
    expect(sendRecipientsAllowed(list, "OUTLOOK_SEND_EMAIL", { to_email: "ana@example.com", to_name: "Ana", cc_emails: ["bob@example.com"] })).toBe(true);
    expect(sendRecipients("mcp__mail__send_email", { to: "ana@example.com", sendTo: ["eve@example.com"] })).toEqual({ emails: ["ana@example.com", "eve@example.com"], phones: [] });
    expect(sendRecipients("mcp__mail__send_email", { to: "ana@example.com", meta: { extra: "eve@example.com" } })).toBeNull();
    // too deep to read
    expect(sendRecipients("mcp__mail__send_email", { a: { b: { c: { d: { e: { f: { g: { to: "eve@example.com" } } } } } } }, to: "ana@example.com" })).toBeNull();
    // comments, posts and forwards are not plain messages
    expect(sendRecipients("mcp__linear__create_comment", { email: "ana@example.com" })).toBeNull();
    expect(sendRecipients("mcp__mail__forward_email", { to: "ana@example.com" })).toBeNull();
    expect(sendRecipients("mcp__mail__send_email", { to: "ana@example.com", thread_id: "t1" })).toBeNull();
    // arguments that cannot be read
    expect(sendRecipients("mcp__mail__send_email", "{not json")).toBeNull();
  });
});
