// End to end: an email draft's "Envoyer" writes an approval card, Deny sends
// nothing, Allow sends once through the server's mail. The mail connector is
// mocked: SAGAX_MAIL_CAPTURE_FILE makes the fixture append each message it
// would send as one JSON line instead of sending it.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

import { launchVerificationServer, runControlOmb } from "../../scripts/control-omb.ts";
import { emailDraftKey } from "../../shared/email-draft-send.ts";
import type { WireMessage } from "../../shared/wire.ts";

it("sends an email draft only after its approval card is allowed, once", async () => {
  const mailDir = mkdtempSync(join(tmpdir(), "sagax-draft-mail-"));
  const captureFile = join(mailDir, "mail.jsonl");
  const fixture = await launchVerificationServer({ ...process.env, SAGAX_MAIL_CAPTURE_FILE: captureFile });
  const control = async (args: string[]) => await runControlOmb([...args, "--url", fixture.info.url]) as any;
  const api = async (path: string, init?: { method?: string; body?: unknown }) => {
    const response = await fetch(`${fixture.info.url}${path}`, {
      method: init?.method ?? "GET",
      headers: init?.body === undefined ? {} : { "content-type": "application/json" },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    });
    return { status: response.status, body: await response.json() as any };
  };
  const captured = () => existsSync(captureFile)
    ? readFileSync(captureFile, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
    : [];
  const messages = async (threadId: string): Promise<WireMessage[]> =>
    (await api(`/api/threads/${threadId}/messages?limit=80`)).body.messages;
  try {
    const bot = (await control(["new-bot", "--name", "Courrielleur"])).bot;
    const threadId: string = bot.activeTaskId;
    const draft = { to: ["marie@example.com"], cc: ["luc@example.com"], bcc: [], subject: "Suivi du billet 48213", body: "Bonjour Marie,\n\nC'est réglé." };
    const draftKey = emailDraftKey(draft);

    // a bad draft is refused before any card
    expect((await api(`/api/threads/${threadId}/email-drafts`, { method: "POST", body: { draft: { ...draft, to: ["pas une adresse"] } } })).body.code).toBe("invalid_draft");
    expect((await api(`/api/threads/${threadId}/email-drafts/${draftKey}`)).body.send).toBeNull();

    // a Bcc address never shows in the card's arguments
    const hidden = await api(`/api/threads/${threadId}/email-drafts`, { method: "POST", body: { draft: { ...draft, bcc: ["archive@example.com"] }, draftKey: "bcc-draft" } });
    expect(hidden.status).toBe(201);
    const hiddenCard = (await messages(threadId)).find((row) => row.card?.requestId === hidden.body.requestId)?.card;
    expect(hiddenCard?.toolInput).not.toContain("archive@example.com");
    expect(JSON.parse(hiddenCard!.toolInput!)).toMatchObject({ bccCount: 1 });
    expect((await api(`/api/threads/${threadId}/respond`, { method: "POST", body: { requestId: hidden.body.requestId, behavior: "deny" } })).status).toBe(200);

    // Envoyer: a card, nothing sent
    const asked = await api(`/api/threads/${threadId}/email-drafts`, { method: "POST", body: { draft, draftKey } });
    expect(asked.status).toBe(201);
    expect(asked.body).toMatchObject({ status: "pending", connector: { kind: "smtp" } });
    const card = (await messages(threadId)).find((row) => row.card?.requestId === asked.body.requestId)?.card;
    expect(card).toMatchObject({ requestType: "permission", tool: "send_email_draft", options: ["Allow", "Deny"] });
    expect(card?.emailSendRequest).toMatchObject({ status: "pending", draftKey, draft });
    expect((await api(`/api/threads/${threadId}/email-drafts/${draftKey}`)).body.send).toMatchObject({ status: "pending" });
    expect(captured()).toEqual([]);

    // Deny: nothing sent, the draft says so
    const denied = await api(`/api/threads/${threadId}/respond`, { method: "POST", body: { requestId: asked.body.requestId, behavior: "deny" } });
    expect(denied).toMatchObject({ status: 200, body: { outcome: "rejected" } });
    expect((await api(`/api/threads/${threadId}/email-drafts/${draftKey}`)).body.send).toMatchObject({ status: "denied" });
    expect(captured()).toEqual([]);

    // Retry asks again; Allow sends once
    const again = await api(`/api/threads/${threadId}/email-drafts`, { method: "POST", body: { draft, draftKey } });
    expect(again.status).toBe(201);
    const allowed = await api(`/api/threads/${threadId}/respond`, { method: "POST", body: { requestId: again.body.requestId, behavior: "allow" } });
    expect(allowed).toMatchObject({ status: 200, body: { outcome: "allowed-once", send: "sent" } });
    const mail = captured();
    expect(mail).toHaveLength(1);
    expect(mail[0]).toMatchObject({ to: "marie@example.com", cc: ["luc@example.com"], subject: "Suivi du billet 48213", text: draft.body });
    expect((await api(`/api/threads/${threadId}/email-drafts/${draftKey}`)).body.send).toMatchObject({ status: "sent" });
    // a settled card is never answered twice
    expect((await api(`/api/threads/${threadId}/respond`, { method: "POST", body: { requestId: again.body.requestId, behavior: "allow" } })).status).toBe(409);
    expect(captured()).toHaveLength(1);

    // the decision log has the card and both answers
    const decisions = readFileSync(join(fixture.info.dataDir, "decisions", `${new Date().toISOString().slice(0, 7)}.ndjson`), "utf8");
    expect(decisions).toContain('"tool":"send_email_draft"');
    expect(decisions).toContain('"decision":"user-denied"');
    expect(decisions).toContain('"decision":"user-approved"');
  } finally {
    await fixture.close();
    rmSync(mailDir, { recursive: true, force: true });
  }
}, 90_000);
