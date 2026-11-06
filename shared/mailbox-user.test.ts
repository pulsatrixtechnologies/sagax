import { describe, expect, it } from "vitest";

import {
  FOREIGN_MAILBOX_REFUSAL,
  foreignMailboxRefusal,
  foreignMailboxUserId,
  isMailboxTool,
  mailboxToolArgs,
} from "./mailbox-user.ts";

describe("foreignMailboxUserId (#1943 owner mailbox)", () => {
  it("treats an omitted id and me as the owner's own mailbox", () => {
    expect(foreignMailboxUserId(undefined)).toBeNull();
    expect(foreignMailboxUserId({})).toBeNull();
    expect(foreignMailboxUserId({ query: "invoice" })).toBeNull();
    expect(foreignMailboxUserId({ userId: "me" })).toBeNull();
    expect(foreignMailboxUserId({ user_id: "ME" })).toBeNull();
    expect(foreignMailboxUserId({ userId: "  " })).toBeNull();
    expect(foreignMailboxUserId(JSON.stringify({ user_id: "me", top: 5 }))).toBeNull();
  });

  it("names another mailbox when userId or user_id is a UPN or the bot inbound address", () => {
    expect(foreignMailboxUserId({ userId: "ceo@example.com" })).toBe("ceo@example.com");
    expect(foreignMailboxUserId({ user_id: "cryptic@bots.example.org" })).toBe("cryptic@bots.example.org");
    expect(foreignMailboxUserId({ "User-Id": "Ana@Example.com" })).toBe("Ana@Example.com");
    expect(foreignMailboxUserId(JSON.stringify({ userId: "owner@contoso.com", folder: "Inbox" }))).toBe("owner@contoso.com");
  });

  it("parses permission-card JSON text the same way as an object", () => {
    expect(mailboxToolArgs('{\n  "userId": "ceo@example.com"\n}')).toEqual({ userId: "ceo@example.com" });
    expect(mailboxToolArgs("not json")).toBeNull();
  });
});

describe("isMailboxTool / foreignMailboxRefusal", () => {
  it("recognizes Outlook, Gmail and Microsoft 365 mail tools", () => {
    expect(isMailboxTool("outlook__list_messages")).toBe(true);
    expect(isMailboxTool("mcp__outlook__get_message")).toBe(true);
    expect(isMailboxTool("mcp__claude_ai_Microsoft_365__outlook_email_search")).toBe(true);
    expect(isMailboxTool("GMAIL_FETCH_EMAILS")).toBe(true);
    expect(isMailboxTool("agents__list_bots")).toBe(false);
    expect(isMailboxTool("sharepoint__get_file")).toBe(false);
  });

  it("refuses another mailbox on a mail tool or an account connector, and keeps the owner's /me", () => {
    expect(foreignMailboxRefusal("outlook__list_messages", { userId: "ceo@example.com" })).toEqual({ userId: "ceo@example.com" });
    expect(foreignMailboxRefusal("outlook__list_messages", { userId: "me" })).toBeNull();
    expect(foreignMailboxRefusal("outlook__list_messages", {})).toBeNull();
    expect(foreignMailboxRefusal("agents__list_bots", { userId: "ceo@example.com" })).toBeNull();
    expect(foreignMailboxRefusal("agents__list_bots", { userId: "ceo@example.com" }, { accountConnector: true }))
      .toEqual({ userId: "ceo@example.com" });
    expect(FOREIGN_MAILBOX_REFUSAL).toContain("/me");
    expect(FOREIGN_MAILBOX_REFUSAL).toMatch(/userId/);
    expect(FOREIGN_MAILBOX_REFUSAL).not.toMatch(/[–—]/);
  });
});
