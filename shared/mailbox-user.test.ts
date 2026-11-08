import { describe, expect, it } from "vitest";

import {
  MAILBOX_ACCESS_DENIED,
  foreignMailboxAccessDenied,
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
    expect(foreignMailboxUserId({ user_id: "nimbus@bots.example.org" })).toBe("nimbus@bots.example.org");
    expect(foreignMailboxUserId({ "User-Id": "Ana@Example.com" })).toBe("Ana@Example.com");
    expect(foreignMailboxUserId(JSON.stringify({ userId: "owner@contoso.com", folder: "Inbox" }))).toBe("owner@contoso.com");
  });

  it("parses permission-card JSON text the same way as an object", () => {
    expect(mailboxToolArgs('{\n  "userId": "ceo@example.com"\n}')).toEqual({ userId: "ceo@example.com" });
    expect(mailboxToolArgs("not json")).toBeNull();
  });
});

const GRAPH_403 = "Managed MCP gateway tool call failed: Microsoft Graph API error: 403 Forbidden: {\"error\":{\"code\":\"ErrorAccessDenied\",\"message\":\"Access is denied. Check credentials and try again.\"}}";

describe("isMailboxTool / foreignMailboxAccessDenied", () => {
  it("recognizes Outlook, Gmail and Microsoft 365 mail tools", () => {
    expect(isMailboxTool("outlook__list_messages")).toBe(true);
    expect(isMailboxTool("mcp__outlook__get_message")).toBe(true);
    expect(isMailboxTool("mcp__claude_ai_Microsoft_365__outlook_email_search")).toBe(true);
    expect(isMailboxTool("GMAIL_FETCH_EMAILS")).toBe(true);
    expect(isMailboxTool("agents__list_bots")).toBe(false);
    expect(isMailboxTool("sharepoint__get_file")).toBe(false);
  });

  it("maps a vendor 403 on another mailbox to the /me retry, and leaves the owner's mail and other errors alone", () => {
    expect(foreignMailboxAccessDenied("outlook__list_messages", { userId: "ceo@example.com" }, GRAPH_403)).toBe(MAILBOX_ACCESS_DENIED);
    expect(foreignMailboxAccessDenied("outlook__list_messages", { user_id: "nimbus@bots.example.org" }, { status: 403, error: { code: "ErrorAccessDenied" } })).toBe(MAILBOX_ACCESS_DENIED);
    expect(foreignMailboxAccessDenied("mcp__claude_ai_Microsoft_365__outlook_email_search", JSON.stringify({ userId: "owner@contoso.com" }), { content: [{ type: "text", text: GRAPH_403 }], isError: true })).toBe(MAILBOX_ACCESS_DENIED);
    expect(foreignMailboxAccessDenied("outlook__list_messages", { userId: "me" }, GRAPH_403)).toBeNull();
    expect(foreignMailboxAccessDenied("outlook__list_messages", {}, { status: 403 })).toBeNull();
    expect(foreignMailboxAccessDenied("outlook__list_messages", { userId: "ceo@example.com" }, "Microsoft Graph API error: 404 Not Found")).toBeNull();
    expect(foreignMailboxAccessDenied("agents__list_bots", { userId: "ceo@example.com" }, { status: 403 })).toBeNull();
    expect(MAILBOX_ACCESS_DENIED).toBe("Access denied for that mailbox; for your own mail retry with /me");
    expect(MAILBOX_ACCESS_DENIED).not.toMatch(/[–—]/);
  });
});
