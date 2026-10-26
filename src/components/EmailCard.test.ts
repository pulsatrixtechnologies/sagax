// 2026-10-16: an email draft can be edited and sent, and Send only ever asks
// for an approval card (server/email-draft-send.ts).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EmailCard, emailSendErrorText } from "./EmailCard";
import { ApiError } from "@/state/store";

const draft = { to: ["marie@example.com"], cc: [], bcc: [], subject: "Suivi", body: "Bonjour" };

describe("EmailCard", () => {
  it("offers Edit and Send in a conversation, and keeps Copy and Open", () => {
    const html = renderToStaticMarkup(createElement(EmailCard, { draft, threadId: "t1", botId: "b1" }));
    expect(html).toContain("data-email-send");
    expect(html).toContain("data-email-edit");
    expect(html).toContain("Open in mail app");
    expect(html).toContain("Sends only after you approve it on the approval card");
    expect(html).toContain("Draft created for marie@example.com");
  });

  it("keeps the card and hides Send when drafts are off for the bot", () => {
    const html = renderToStaticMarkup(createElement(EmailCard, { draft, threadId: "t1", botId: "b1", draftsEnabled: false }));
    expect(html).toContain("data-email-drafts-off");
    expect(html).not.toContain("data-email-send");
  });

  it("offers no Send outside a conversation, while the bot is still writing, or without a recipient", () => {
    expect(renderToStaticMarkup(createElement(EmailCard, { draft }))).not.toContain("data-email-send");
    expect(renderToStaticMarkup(createElement(EmailCard, { draft, threadId: "t1", pending: true }))).not.toContain("data-email-send");
    expect(renderToStaticMarkup(createElement(EmailCard, { draft: { ...draft, to: [] }, threadId: "t1" }))).not.toContain("data-email-send");
  });

  it("says why a send cannot start, in the person's words", () => {
    expect(emailSendErrorText(new ApiError("x", 409, { code: "no_mail_connector" }))).toMatch(/Connect Microsoft 365, Outlook or Gmail/);
    expect(emailSendErrorText(new ApiError("to needs at least one address", 400, { code: "invalid_draft" }))).toBe("Check the draft: to needs at least one address");
    expect(emailSendErrorText(new Error("offline"))).toBe("offline");
  });
});
