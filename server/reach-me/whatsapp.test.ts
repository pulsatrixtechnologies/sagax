// "Me joindre" by WhatsApp (2026-10-27): the person's own WhatsApp Business
// number, their own number proven by a code, replies only through Meta's
// signed webhook from that number. No network: fetch is a mock; nothing is
// ever sent for real.
import { createHmac } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createWebhookIngressHandler } from "../triggers/webhook-ingress.ts";
import type { WebhookManager } from "../triggers/webhooks.ts";
import type { ReachOutbound } from "./channel.ts";
import { ReachMeSecrets } from "./secrets.ts";
import { ReachMe, type ReachAuditRow, type ReachCard } from "./service.ts";
import { createReachCodeStore, createReachMeStore } from "./store.ts";
import { ReachWhatsApp, templateParameter, WHATSAPP_WINDOW_MS } from "./whatsapp.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

// Every value below is fake test data.
const ACCESS_TOKEN = "FAKEACCESSTOKENFORTESTS0123456789abcdef";
const APP_SECRET = "0123456789abcdef0123456789abcdef";
const PHONE_NUMBER_ID = "106540352242922";
const PERSON_NUMBER = "+15145550123";
const OTHER_NUMBER = "+15145559876";

type Call = { url: string; method: string; body?: Record<string, unknown>; authorization?: string };

const WABA_ID = "102290129340398";
const APPROVED = { name: "sagax_card", language: "fr", status: "APPROVED", category: "UTILITY", components: [{ type: "BODY", text: "Sagax : {{1}}" }] };

type TemplatesAnswer = { status: number; body: unknown };

function setup(options: { publicWebhook?: boolean; refuse?: number; replyOutcome?: { handled: boolean; outcome: "allowed" | "unknown_code" | "no_code" }; templates?: TemplatesAnswer; sendRefusal?: { status: number; code: number } } = {}) {
  let templates: TemplatesAnswer = options.templates ?? { status: 200, body: { data: [APPROVED] } };
  let sendRefusal = options.sendRefusal;
  const dir = mkdtempSync(join(tmpdir(), "sagax-reach-wa-"));
  dirs.push(dir);
  let now = Date.parse("2026-10-27T13:00:00Z");
  const settings = createReachMeStore(dir, () => now);
  const secrets = new ReachMeSecrets(dir, () => ({ kind: "key", key: Buffer.alloc(32, 9) }));
  const calls: Call[] = [];
  const fetch = (async (url: string, init: { method: string; body?: string; headers?: Record<string, string> }) => {
    calls.push({ url, method: init.method, ...(init.body ? { body: JSON.parse(init.body) as Record<string, unknown> } : {}), ...(init.headers?.authorization ? { authorization: init.headers.authorization } : {}) });
    if (options.refuse) return new Response(JSON.stringify({ error: { message: "refused" } }), { status: options.refuse });
    if (init.method === "GET" && url.includes("/message_templates?")) return new Response(JSON.stringify(templates.body), { status: templates.status });
    if (init.method === "POST" && sendRefusal && (JSON.parse(init.body ?? "{}") as { type?: string }).type === "template") return new Response(JSON.stringify({ error: { code: sendRefusal.code, message: "template refused" } }), { status: sendRefusal.status });
    if (init.method === "GET") return new Response(JSON.stringify({ display_phone_number: "+1 555-010-0000", verified_name: "Example Shop", id: PHONE_NUMBER_ID }), { status: 200 });
    return new Response(JSON.stringify({ messages: [{ id: "wamid.fake" }] }), { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  const replies: Array<{ text: string; from: string }> = [];
  const logs: string[] = [];
  const whatsapp = new ReachWhatsApp({
    settings,
    secrets,
    onReply: async (_person, text, from) => { replies.push({ text, from }); return options.replyOutcome ?? { handled: true, outcome: "allowed" }; },
    language: () => "fr",
    webhookBase: () => ({ url: "https://bots.example.test", public: options.publicWebhook ?? true }),
    fetch,
    now: () => now,
    log: (line) => logs.push(line),
  });
  const sends = () => calls.filter((call) => call.method === "POST");
  return {
    dir, whatsapp, settings, secrets, calls, sends, replies, logs, setNow: (next: number) => { now = next; }, now: () => now,
    setTemplates: (next: TemplatesAnswer) => { templates = next; }, setSendRefusal: (next?: { status: number; code: number }) => { sendRefusal = next; },
  };
}

const OUT: ReachOutbound = { person: "pr_a", botId: "b1", botName: "Nimbus", code: "KM3X", kind: "approval", title: "Run a command?", line: "npm test", confidential: false, needsKey: false, language: "fr" };

function signed(body: unknown, secret = APP_SECRET) {
  const rawBody = JSON.stringify(body);
  return { rawBody, headers: { "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}` } };
}

function inbound(from: string, text: string, phoneNumberId = PHONE_NUMBER_ID) {
  return { object: "whatsapp_business_account", entry: [{ id: "1", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: phoneNumberId }, messages: [{ from: from.replace("+", ""), id: "wamid.in", timestamp: "1", type: "text", text: { body: text } }] } }] }] };
}

async function connect(env: ReturnType<typeof setup>, extra: Record<string, string> = {}) {
  expect(await env.whatsapp.connect("pr_a", "b1", { accessToken: ACCESS_TOKEN, phoneNumberId: PHONE_NUMBER_ID, appSecret: APP_SECRET, ...extra })).toEqual({ ok: true });
  return env.settings.whatsapp("pr_a", "b1")!;
}

async function post(env: ReturnType<typeof setup>, endpointId: string, body: unknown, secret?: string) {
  const request = signed(body, secret);
  const answer = await env.whatsapp.webhook(endpointId, { method: "POST", query: new URLSearchParams(), headers: request.headers, rawBody: request.rawBody });
  await env.whatsapp.drain();
  return answer;
}

describe("Reach me by WhatsApp", () => {
  it("connects with the person's own token and Phone Number ID, sealed, never in the view", async () => {
    const env = setup();
    const link = await connect(env);
    expect(env.calls[0]).toMatchObject({ method: "GET", url: `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}?fields=display_phone_number,verified_name`, authorization: `Bearer ${ACCESS_TOKEN}` });
    const view = env.whatsapp.view("pr_a", "b1");
    expect(view).toMatchObject({ connected: false, linking: true, displayNumber: "+1 555-010-0000", verifiedName: "Example Shop", webhookPublic: true, replies: true, hasAppSecret: true });
    expect(view.linkUrl).toBe(`https://wa.me/15550100000?text=${encodeURIComponent(`SAGAX ${link.linkCode}`)}`);
    expect(view.webhookUrl).toBe(`https://bots.example.test/reach-me/whatsapp/${link.endpointId}`);
    const shown = JSON.stringify(view);
    expect(shown).not.toContain(ACCESS_TOKEN);
    expect(shown).not.toContain(APP_SECRET);
    expect(shown).not.toContain(PHONE_NUMBER_ID);
    // sealed on disk, never in clear
    for (const file of readdirSync(env.dir)) {
      const content = readFileSync(join(env.dir, file), "utf8");
      expect(content).not.toContain(ACCESS_TOKEN);
      expect(content).not.toContain(APP_SECRET);
    }
    expect(env.whatsapp.channel().status("pr_a", "b1").ready).toBe(false);
  });

  it("a refused token or a bad Phone Number ID is said plainly and nothing is kept", async () => {
    const env = setup({ refuse: 401 });
    expect(await env.whatsapp.connect("pr_a", "b1", { accessToken: ACCESS_TOKEN, phoneNumberId: PHONE_NUMBER_ID })).toMatchObject({ ok: false, status: 400 });
    expect(await env.whatsapp.connect("pr_a", "b1", { accessToken: ACCESS_TOKEN, phoneNumberId: "+15145550123" })).toMatchObject({ ok: false, status: 400 });
    expect(env.secrets.whatsApp("pr_a", "b1")).toBeUndefined();
    expect(env.settings.whatsapp("pr_a", "b1")).toBeUndefined();
  });

  it("answers Meta's subscription check with the verify token only", async () => {
    const env = setup();
    const link = await connect(env);
    const check = (token: string) => env.whatsapp.webhook(link.endpointId, { method: "GET", query: new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": token, "hub.challenge": "1158201444" }), headers: {}, rawBody: "" });
    expect(await check(link.verifyToken)).toMatchObject({ status: 200, body: "1158201444" });
    expect(await check("wrong")).toMatchObject({ status: 403 });
    expect(await env.whatsapp.webhook("rmwa_unknownunknownunknown", { method: "GET", query: new URLSearchParams(), headers: {}, rawBody: "" })).toMatchObject({ status: 404 });
  });

  it("proves the person's number by `SAGAX <code>` from WhatsApp, then sends there as plain text inside the window", async () => {
    const env = setup();
    const link = await connect(env);
    // a wrong code, another business number, a bad signature: nothing linked
    expect(await post(env, link.endpointId, inbound(OTHER_NUMBER, "SAGAX AAAAAA"))).toMatchObject({ status: 200 });
    expect(await post(env, link.endpointId, inbound(OTHER_NUMBER, `SAGAX ${link.linkCode}`, "999999999"))).toMatchObject({ status: 200 });
    expect(await post(env, link.endpointId, inbound(OTHER_NUMBER, `SAGAX ${link.linkCode}`), "f".repeat(32))).toMatchObject({ status: 401 });
    expect(env.whatsapp.view("pr_a", "b1").connected).toBe(false);
    expect(await post(env, link.endpointId, inbound(PERSON_NUMBER, `sagax ${link.linkCode}`))).toMatchObject({ status: 200 });
    expect(env.whatsapp.view("pr_a", "b1")).toMatchObject({ connected: true, number: "***0123", windowOpen: true });
    expect(env.sends().at(-1)!.body).toMatchObject({ to: "15145550123", type: "text" });
    // a later code from another number never moves the link
    expect(await post(env, link.endpointId, inbound(OTHER_NUMBER, `SAGAX ${link.linkCode}`))).toMatchObject({ status: 200 });
    expect(env.settings.whatsapp("pr_a", "b1")!.number).toBe(PERSON_NUMBER);

    const sent = await env.whatsapp.channel().send(OUT);
    expect(sent).toEqual({ ok: true, detail: { to: PERSON_NUMBER } });
    const message = env.sends().at(-1)!;
    expect(message.url).toBe(`https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`);
    expect(message.body).toMatchObject({ messaging_product: "whatsapp", to: "15145550123", type: "text", text: { body: expect.stringContaining("KM3X oui") } });
    // nothing logged carries the number in full
    expect(env.logs.join("\n")).not.toContain("5145550123");
  });

  it("outside the 24 hour window: the person's template, else no send", async () => {
    const env = setup();
    const link = await connect(env);
    await post(env, link.endpointId, inbound(PERSON_NUMBER, `SAGAX ${link.linkCode}`));
    env.setNow(env.now() + WHATSAPP_WINDOW_MS + 1);
    expect(env.whatsapp.channel().status("pr_a", "b1").ready).toBe(false);
    expect(await env.whatsapp.channel().send(OUT)).toMatchObject({ ok: false });
    expect(await env.whatsapp.update("pr_a", "b1", { templateName: "sagax_card", templateLanguage: "French" })).toMatchObject({ ok: false, status: 400 });
    expect(await env.whatsapp.update("pr_a", "b1", { templateName: "sagax_card", templateLanguage: "fr", businessAccountId: WABA_ID })).toEqual({ ok: true });
    expect(env.whatsapp.channel().status("pr_a", "b1").ready).toBe(true);
    expect(await env.whatsapp.channel().send(OUT)).toEqual({ ok: true, detail: { to: PERSON_NUMBER } });
    const message = env.sends().at(-1)!.body as { type: string; template: { name: string; language: { code: string }; components: Array<{ parameters: Array<{ text: string }> }> } };
    expect(message.type).toBe("template");
    expect(message.template.name).toBe("sagax_card");
    expect(message.template.language.code).toBe("fr");
    const parameter = message.template.components[0]!.parameters[0]!.text;
    expect(parameter).not.toMatch(/\n|\t| {2,}/);
    expect(parameter).toContain("KM3X oui");
  });

  it("reads the template at Meta (free, nothing sent) and keeps its status, category and parameters", async () => {
    const env = setup();
    await connect(env, { templateName: "sagax_card", templateLanguage: "fr", businessAccountId: WABA_ID });
    const read = env.calls.find((call) => call.url.includes("/message_templates?"))!;
    expect(read).toMatchObject({ method: "GET", url: `https://graph.facebook.com/v21.0/${WABA_ID}/message_templates?name=sagax_card&fields=name,language,status,category,components&limit=100`, authorization: `Bearer ${ACCESS_TOKEN}` });
    expect(env.sends()).toEqual([]);
    expect(env.settings.whatsapp("pr_a", "b1")!.templateCheck).toMatchObject({ state: "approved", name: "sagax_card", language: "fr", status: "APPROVED", category: "UTILITY", parameters: 1 });
    expect(env.whatsapp.view("pr_a", "b1")).toMatchObject({ hasBusinessAccount: true, templateCheck: { state: "approved", status: "APPROVED", category: "UTILITY", parameters: 1 } });
    expect(JSON.stringify(env.whatsapp.view("pr_a", "b1"))).not.toContain(WABA_ID);
  });

  it.each([
    ["missing_account", undefined, { status: 200, body: { data: [APPROVED] } }, /WhatsApp Business Account ID/],
    ["not_found", WABA_ID, { status: 200, body: { data: [] } }, /no template named sagax_card/],
    ["wrong_language", WABA_ID, { status: 200, body: { data: [{ ...APPROVED, language: "en_US" }] } }, /no fr version \(Meta has en_US\)/],
    ["not_approved", WABA_ID, { status: 200, body: { data: [{ ...APPROVED, status: "PENDING" }] } }, /is PENDING at Meta/],
    ["wrong_parameters", WABA_ID, { status: 200, body: { data: [{ ...APPROVED, components: [{ type: "BODY", text: "{{1}} et {{2}}" }] }] } }, /asks for 2 parameters/],
    ["forbidden", WABA_ID, { status: 403, body: { error: { code: 200, message: "no permission" } } }, /whatsapp_business_management/],
    ["wrong_account", WABA_ID, { status: 400, body: { error: { code: 100, message: "bad id" } } }, /does not know this WhatsApp Business Account ID/],
    ["unreachable", WABA_ID, { status: 500, body: {} }, /could not check your template/],
  ] as Array<[string, string | undefined, TemplatesAnswer, RegExp]>)("a template that does not hold (%s): never ready, the reason says what to do", async (state, businessAccountId, templates, reason) => {
    const env = setup({ templates });
    const link = await connect(env, { templateName: "sagax_card", templateLanguage: "fr", ...(businessAccountId ? { businessAccountId } : {}) });
    // linked, and inside the window: still not ready while the template is wrong
    await post(env, link.endpointId, inbound(PERSON_NUMBER, `SAGAX ${link.linkCode}`));
    expect(env.whatsapp.view("pr_a", "b1")).toMatchObject({ connected: true, windowOpen: true, templateCheck: { state } });
    const status = env.whatsapp.channel().status("pr_a", "b1");
    expect(status.ready).toBe(false);
    expect(status.reason).toMatch(reason);
    // fixed at Meta, checked again from the page: ready
    env.setTemplates({ status: 200, body: { data: [APPROVED] } });
    await env.whatsapp.update("pr_a", "b1", { businessAccountId: WABA_ID });
    expect(env.whatsapp.channel().status("pr_a", "b1")).toEqual({ ready: true });
  });

  it("a template message refused by Meta for its template checks it again: the channel is then not ready", async () => {
    const env = setup();
    const link = await connect(env, { templateName: "sagax_card", templateLanguage: "fr", businessAccountId: WABA_ID });
    await post(env, link.endpointId, inbound(PERSON_NUMBER, `SAGAX ${link.linkCode}`));
    env.setNow(env.now() + WHATSAPP_WINDOW_MS + 1);
    expect(env.whatsapp.channel().status("pr_a", "b1").ready).toBe(true);
    env.setTemplates({ status: 200, body: { data: [{ ...APPROVED, status: "PAUSED" }] } });
    env.setSendRefusal({ status: 400, code: 132015 });
    const reads = () => env.calls.filter((call) => call.url.includes("/message_templates?")).length;
    const before = reads();
    expect(await env.whatsapp.channel().send(OUT)).toMatchObject({ ok: false });
    expect(reads()).toBe(before + 1);
    expect(env.whatsapp.channel().status("pr_a", "b1")).toMatchObject({ ready: false, reason: expect.stringMatching(/is PAUSED at Meta/) });
    // a refusal for another cause reads nothing again
    env.setSendRefusal({ status: 400, code: 131026 });
    await env.whatsapp.channel().send(OUT);
    expect(reads()).toBe(before + 1);
  });

  it("the code by template waits for an approved template", async () => {
    const env = setup({ templates: { status: 200, body: { data: [{ ...APPROVED, status: "REJECTED" }] } } });
    await connect(env, { templateName: "sagax_card", templateLanguage: "fr", businessAccountId: WABA_ID });
    expect(await env.whatsapp.sendCode("pr_a", "b1", PERSON_NUMBER)).toMatchObject({ ok: false, status: 409, error: expect.stringMatching(/is REJECTED at Meta/) });
    expect(env.sends()).toEqual([]);
  });

  it("proves the number by a code sent with the template and typed back, with few tries", async () => {
    const env = setup({ publicWebhook: false });
    await connect(env);
    expect(await env.whatsapp.sendCode("pr_a", "b1", PERSON_NUMBER)).toMatchObject({ ok: false, status: 400 });
    await env.whatsapp.update("pr_a", "b1", { templateName: "sagax_card", businessAccountId: WABA_ID });
    expect(await env.whatsapp.sendCode("pr_a", "b1", "+1 514 555 0123")).toEqual({ ok: true });
    const code = env.settings.whatsapp("pr_a", "b1")!.linkCode!;
    expect(env.sends().at(-1)!.body).toMatchObject({ to: "15145550123", type: "template" });
    expect(env.whatsapp.view("pr_a", "b1")).toMatchObject({ linking: true, codeSentTo: "***0123", webhookPublic: false, replies: false });
    expect(env.whatsapp.view("pr_a", "b1").linkUrl).toBeUndefined();
    expect(env.whatsapp.confirm("pr_a", "b1", "WRONG1")).toMatchObject({ ok: false, status: 400 });
    expect(env.whatsapp.confirm("pr_a", "b1", code.toLowerCase())).toEqual({ ok: true });
    expect(env.whatsapp.view("pr_a", "b1")).toMatchObject({ connected: true, number: "***0123", windowOpen: false });

    // five wrong codes drop it
    const again = setup();
    await connect(again);
    await again.whatsapp.update("pr_a", "b1", { templateName: "sagax_card", businessAccountId: WABA_ID });
    await again.whatsapp.sendCode("pr_a", "b1", PERSON_NUMBER);
    const right = again.settings.whatsapp("pr_a", "b1")!.linkCode!;
    for (let i = 0; i < 5; i += 1) again.whatsapp.confirm("pr_a", "b1", "WRONG1");
    expect(again.whatsapp.confirm("pr_a", "b1", right)).toMatchObject({ ok: false, status: 409 });
  });

  it("hands on the proven number's messages only, and acknowledges a reply", async () => {
    const env = setup();
    const link = await connect(env);
    await post(env, link.endpointId, inbound(PERSON_NUMBER, `SAGAX ${link.linkCode}`));
    await post(env, link.endpointId, inbound(OTHER_NUMBER, "KM3X oui"));
    expect(env.replies).toEqual([]);
    await post(env, link.endpointId, inbound(PERSON_NUMBER, "KM3X oui"));
    expect(env.replies).toEqual([{ text: "KM3X oui", from: PERSON_NUMBER }]);
    expect(env.sends().at(-1)!.body).toMatchObject({ to: "15145550123", type: "text", text: { body: "Autorisé. Le bot reprend." } });
    // no app secret: the webhook refuses every message
    await env.whatsapp.update("pr_a", "b1", { appSecret: "" });
    expect(await post(env, link.endpointId, inbound(PERSON_NUMBER, "KM3X oui"))).toMatchObject({ status: 401 });
  });

  it("disconnect forgets the token, the app secret and the number", async () => {
    const env = setup();
    await connect(env);
    env.whatsapp.disconnect("pr_a", "b1");
    expect(env.secrets.whatsApp("pr_a", "b1")).toBeUndefined();
    expect(env.settings.whatsapp("pr_a", "b1")).toBeUndefined();
    expect(env.whatsapp.view("pr_a", "b1").connected).toBe(false);
  });

  it("a template parameter has no new lines, tabs or runs of spaces", () => {
    expect(templateParameter("Nimbus asks:\nRun   a command?\n\tnpm test")).toBe("Nimbus asks: / Run a command? / npm test");
    expect(templateParameter("x".repeat(2_000)).length).toBe(1_000);
  });
});

describe("Reach me by WhatsApp with the reach-me service", () => {
  const CARD: ReachCard = { threadId: "t1", requestId: "r1", botId: "b1", botName: "Nimbus", kind: "approval", title: "Run a command?", line: "npm test", confidential: false, needsKey: false };

  it("a card goes out on WhatsApp and only the number it went to answers it, through the click", async () => {
    const env = setup();
    const link = await connect(env);
    await post(env, link.endpointId, inbound(PERSON_NUMBER, `SAGAX ${link.linkCode}`));
    env.settings.set("pr_a", "b1", { channels: ["whatsapp"], hours: { always: true } });
    const codes = createReachCodeStore(env.dir, env.now);
    const responses: unknown[] = [];
    const audit: ReachAuditRow[] = [];
    let card: ReachCard | null = CARD;
    const reach = new ReachMe({
      settings: env.settings, codes, channels: { whatsapp: env.whatsapp.channel() },
      card: () => card, answerer: () => "pr_a",
      respond: async (_person, _card, body) => { responses.push(body); card = null; return { status: 200, body: {} }; },
      push: () => {}, language: () => "fr", audit: (row) => audit.push(row), now: env.now, log: () => {},
    });
    reach.cardRaised({ kind: "approval", personId: "pr_a", title: "Nimbus", body: "Run a command?", threadId: "t1", botId: "b1", requestId: "r1", prompt: "approval", at: 1 });
    await reach.drain();
    const code = codes.forCard("t1", "r1")!;
    expect(code).toMatchObject({ channels: ["whatsapp"], whatsappTo: PERSON_NUMBER });
    // another number with the right code answers nothing
    expect(await reach.handleReply({ channel: "whatsapp", person: "pr_a", text: `${code.code} oui`, from: OTHER_NUMBER })).toMatchObject({ handled: false });
    expect(responses).toEqual([]);
    expect(await reach.handleReply({ channel: "whatsapp", person: "pr_a", text: `${code.code} oui`, from: PERSON_NUMBER })).toEqual({ handled: true, outcome: "allowed" });
    expect(responses).toEqual([{ behavior: "allow" }]);
    // the journal has the channel and the outcome, never the text or the number
    expect(JSON.stringify(audit)).not.toContain("5145550123");
    expect(JSON.stringify(audit)).not.toContain(`${code.code} oui`);
  });

  it("a confidential card's words never leave on WhatsApp", async () => {
    const env = setup();
    const link = await connect(env);
    await post(env, link.endpointId, inbound(PERSON_NUMBER, `SAGAX ${link.linkCode}`));
    await env.whatsapp.channel().send({ ...OUT, confidential: true, title: "Secret plan", line: "do the secret thing" });
    const body = JSON.stringify(env.sends().at(-1)!.body);
    expect(body).not.toContain("Secret plan");
    expect(body).not.toContain("secret thing");
  });
});

describe("the webhook receiver's WhatsApp path", () => {
  it("routes /reach-me/whatsapp/<endpoint> to the channel and counts refusals", async () => {
    const seen: string[] = [];
    const handler = createWebhookIngressHandler({} as WebhookManager, undefined, undefined, {
      reachMeWhatsApp: async (endpointId, request) => { seen.push(`${request.method} ${endpointId} ${request.rawBody}`); return { status: 200, contentType: "text/plain", body: "OK" }; },
    });
    const { createServer } = await import("node:http");
    const server = createServer(handler);
    await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
    try {
      const port = (server.address() as { port: number }).port;
      const endpoint = "rmwa_abcdefghijklmnopqrstuvwx";
      const answer = await fetch(`http://127.0.0.1:${port}/reach-me/whatsapp/${endpoint}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      expect(answer.status).toBe(200);
      expect(seen).toEqual([`POST ${endpoint} {}`]);
      expect((await fetch(`http://127.0.0.1:${port}/reach-me/whatsapp/not-an-endpoint`)).status).toBe(404);
    } finally {
      await new Promise((done) => server.close(done));
    }
  });
});
