import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFeedbackService, feedbackLanguageFor, type FeedbackStore, type StoredMessage } from "./service.ts";

interface FakeBot { id: string; name: string; threadId: string; systemBot?: "feedback" }

function fakeStore(): FeedbackStore & { threads: Map<string, StoredMessage[]>; bots: FakeBot[] } {
  const threads = new Map<string, StoredMessage[]>();
  const bots: FakeBot[] = [{ id: "b-main", name: "Ember", threadId: "t-main" }];
  let seq = 0;
  return {
    threads,
    bots,
    bot: (id) => bots.find((bot) => bot.id === id),
    createBot: (profile) => {
      const bot = { id: `b${++seq}`, name: profile.name ?? "Bot", threadId: `t${seq}` };
      bots.push(bot);
      return bot;
    },
    patchBot: (id, patch) => {
      const bot = bots.find((entry) => entry.id === id);
      if (bot) Object.assign(bot, patch);
      return bot ?? null;
    },
    activePath: (threadId) => threads.get(threadId) ?? [],
    appendMessage: (threadId, message) => {
      const full = { id: `m${++seq}`, at: Date.now(), ...message } as StoredMessage;
      const list = threads.get(threadId) ?? [];
      list.push(full);
      threads.set(threadId, list);
      return full;
    },
    patchMessage: (threadId, messageId, patch) => {
      const msg = (threads.get(threadId) ?? []).find((entry) => entry.id === messageId);
      if (msg) Object.assign(msg, patch);
    },
  };
}

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function setup(options: { token?: string; language?: (person: string | null) => string } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "fb-service-"));
  dirs.push(dataDir);
  const store = fakeStore();
  const calls: Array<{ method: string; url: string; body?: unknown }> = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ method: init.method ?? "GET", url, ...(init.body ? { body: JSON.parse(String(init.body)) } : {}) });
    const method = init.method ?? "GET";
    if (method === "GET" && url.includes("/labels/")) return new Response("{}", { status: 200 });
    if (method === "GET" && url.includes("/issues?")) return new Response("[]", { status: 200 });
    if (method === "POST" && url.endsWith("/issues")) return new Response(JSON.stringify({ number: 42, html_url: "https://github.com/acme/app/issues/42" }), { status: 201 });
    if (method === "GET" && url.endsWith("/issues/42")) return new Response(JSON.stringify({ state: "open", labels: [{ name: "feedback:in-progress" }], assignees: [] }), { status: 200 });
    return new Response("{}", { status: 404 });
  }) as unknown as typeof globalThis.fetch;
  const service = createFeedbackService({
    dataDir,
    store,
    config: () => ({ repo: "acme/app", source: options.token ? "file" : null, ...(options.token ? { token: options.token } : {}) }),
    threadFor: (bot) => bot.threadId,
    names: () => ({ people: ["Alice Tremblay"], orgs: ["Acme Plomberie"], bots: ["Ember"] }),
    serverLines: () => ["warn [engines] Alice Tremblay hit a 502 at 10.0.0.4"],
    spans: () => [{ name: "tool.read", ms: 120, ok: false }],
    serverVersion: () => "0.8.70",
    fetch,
    ...(options.language ? { language: options.language } : {}),
  });
  return { service, store, calls, dataDir };
}

const say = (service: ReturnType<typeof setup>["service"], botId: string, threadId: string, text: string) =>
  service.handleMessage({ botId, threadId, text, principalId: "p1" });

describe("feedback service (#2618)", () => {
  it("creates one shared Feedback bot and walks a bug report to a filed issue", async () => {
    const { service, store, calls } = setup({ token: "server-token" });
    const started = service.start("p1", { source: "sidebar", platform: "desktop", appVersion: "0.8.70", page: "chat", locale: "en", screenshot: "data:image/png;base64,iVBORw0KGgo=" });
    expect(service.ensureBot().id).toBe(started.botId);
    expect(store.bots.filter((bot) => bot.systemBot === "feedback")).toHaveLength(1);
    const thread = () => store.threads.get(started.threadId)!;
    expect(thread().at(-1)?.feedback?.step).toBe("kind");
    for (const answer of ["A bug", "Open settings, then click Save on the profile tab", "The new name is kept after a restart", "Nothing happens and the spinner never stops", "Blocking"]) {
      expect(say(service, started.botId, started.threadId, answer)).not.toBeNull();
    }
    const card = thread().at(-1)!;
    expect(card.feedback?.step).toBe("preview");
    expect(card.card?.options).toEqual(["Send", "Cancel"]);
    const preview = thread().at(-2)!.text ?? "";
    expect(preview).toContain("## Steps to reproduce");
    expect(preview).not.toContain("Alice Tremblay");
    expect(preview).not.toContain("10.0.0.4");
    say(service, started.botId, started.threadId, "Send");
    await service.flush();
    const created = calls.find((call) => call.method === "POST" && call.url.endsWith("/issues"));
    expect(created?.body).toMatchObject({ labels: ["feedback", "feedback:untriaged", "bug"] });
    expect(JSON.stringify(created?.body)).not.toContain("server-token");
    expect(thread().at(-1)?.feedback?.step).toBe("status");
    expect(thread().at(-1)?.text).toContain("#42");
    expect(service.list("p1")[0]).toMatchObject({ status: "sent", issueNumber: 42, kind: "bug" });
    expect(service.list("someone-else")).toEqual([]);
    await service.tick();
    expect(service.list("p1")[0]?.status).toBe("in_progress");
    expect(thread().at(-1)?.text).toContain("#42");
  });

  it("keeps the report in a local queue when no token is set, with a visible status", async () => {
    const { service, store, calls, dataDir } = setup();
    const started = service.start("p1", { source: "menu", platform: "web", locale: "fr" });
    for (const answer of ["Une question", "Comment partager un bot avec mon équipe au complet?", "Envoyer"]) say(service, started.botId, started.threadId, answer);
    await service.flush();
    expect(calls).toHaveLength(0);
    expect(service.list("p1")[0]?.status).toBe("queued");
    expect(store.threads.get(started.threadId)!.at(-1)?.text).toMatch(/gardé ici/);
    expect(existsSync(join(dataDir, "feedback", "reports.json"))).toBe(true);
  });

  it("exposes the Send card as an answerable question card and settles it", async () => {
    const { service, store } = setup();
    const started = service.start("p1", { source: "menu", platform: "web", locale: "fr" });
    for (const answer of ["Une question", "Comment partager un bot avec mon équipe au complet?"]) say(service, started.botId, started.threadId, answer);
    const card = store.threads.get(started.threadId)!.at(-1)!;
    expect(card.card?.requestId).toMatch(/^fb-/);
    expect(card.card?.requestType).toBe("question");
    const done = service.answerCard(started.threadId, card.card!.requestId!, "Envoyer", "p1");
    expect(done?.ok).toBe(true);
    await service.flush();
    expect(card.card?.answered).toBe("answer");
    expect(service.list("p1")[0]?.status).toBe("queued");
    expect(service.answerCard(started.threadId, "pas-un-fb", "Envoyer", "p1")).toBeNull();
  });

  it("takes a card answer in a busy chat even when progress rows follow the card (#2955)", () => {
    const { service, store } = setup();
    say(service, "b-main", "t-main", "/feedback");
    const card = store.threads.get("t-main")!.at(-1)!;
    expect(card.card?.requestId).toMatch(/^fb-/);
    // the running turn keeps adding rows after the card
    store.appendMessage("t-main", { role: "bot", text: "Pulling it together" } as never);
    const done = service.answerCard("t-main", card.card!.requestId!, "A bug", "p1");
    expect(done?.ok).toBe(true);
    const last = store.threads.get("t-main")!.at(-1)!;
    expect(last.feedback).toBeTruthy();
    expect(last.id).not.toBe(card.id);
  });

  it("starts a /feedback report from the words typed after the command (#2955)", () => {
    const { service, store } = setup();
    const started = service.start("p1", { source: "slash", platform: "web", locale: "en", text: "bug I cannot see my routines in the sidebar" });
    // the typed words answered the first question: the flow is already past it
    const lastOf = () => store.threads.get(started.threadId)!.at(-1)!;
    expect(lastOf().card?.options ?? []).toEqual([]);
    expect(lastOf().text ?? "").not.toBe("");
    // a bare /feedback still opens on the kind card
    service.start("p1", { source: "slash", platform: "web", locale: "en" });
    expect(lastOf().card?.options?.join("|")).toMatch(/bug/i);
  });

  it("recognizes a free confirmation at the preview step and says the report is queued", async () => {
    const { service, store } = setup();
    const started = service.start("p1", { source: "menu", platform: "web", locale: "fr" });
    for (const answer of ["Une question", "Comment partager un bot avec mon équipe au complet?", "Oui, envoie-le"]) say(service, started.botId, started.threadId, answer);
    await service.flush();
    expect(service.list("p1")[0]?.status).toBe("queued");
    expect(store.threads.get(started.threadId)!.at(-1)?.text).toMatch(/En file d'attente/);
  });

  it("runs /feedback inline in another bot's chat and leaves ordinary messages alone", () => {
    const { service, store } = setup();
    expect(say(service, "b-main", "t-main", "Quelle heure est-il?")).toBeNull();
    expect(say(service, "b-main", "t-main", "/feedback le bouton Enregistrer ne fait rien du tout")).not.toBeNull();
    const last = store.threads.get("t-main")!.at(-1)!;
    expect(last.feedback).toBeTruthy();
    expect(say(service, "b-main", "t-main", "Un bogue")).not.toBeNull();
  });

  it("offers a pre-drafted report on frustration once per conversation, sent in one click", async () => {
    const { service, store, calls } = setup({ token: "server-token" });
    service.maybeOffer({ botId: "b-main", threadId: "t-main", text: "ça marche toujours pas, tabarnak", principalId: "p1" });
    const offer = store.threads.get("t-main")!.at(-1)!;
    expect(offer.feedback?.step).toBe("offer");
    expect(offer.card?.options).toEqual(["Envoyer le signalement", "Non merci"]);
    service.maybeOffer({ botId: "b-main", threadId: "t-main", text: "fuck", principalId: "p1" });
    expect(store.threads.get("t-main")!.filter((message) => message.feedback?.step === "offer")).toHaveLength(1);
    store.appendMessage("t-main", { role: "bot", kind: "text", text: "Désolé, je regarde." });
    expect(say(service, "b-main", "t-main", "Envoyer le signalement")).not.toBeNull();
    await service.flush();
    expect(calls.some((call) => call.method === "POST" && call.url.endsWith("/issues"))).toBe(true);
    service.maybeOffer({ botId: "b-main", threadId: "t-other", text: "Merci, parfait", principalId: "p1" });
    expect(store.threads.get("t-other")).toBeUndefined();
  });

  it("words the offer and the /feedback flow in the person's app language, not the guessed language of the message", () => {
    const french = setup({ language: () => "fr-CA" });
    french.service.maybeOffer({ botId: "b-main", threadId: "t-main", text: "fuck, nothing works again", principalId: "p1" });
    const offer = french.store.threads.get("t-main")!.at(-1)!;
    expect(offer.card?.title).toBe("On dirait que quelque chose ne marche pas.");
    expect(offer.card?.options).toEqual(["Envoyer le signalement", "Non merci"]);
    expect(say(french.service, "b-main", "t-other", "/feedback")).not.toBeNull();
    expect(french.store.threads.get("t-other")!.at(-1)!.card?.title).toBe("Qu'est-ce qu'on signale?");

    const english = setup({ language: () => "en-US" });
    english.service.maybeOffer({ botId: "b-main", threadId: "t-main", text: "ça marche toujours pas, tabarnak", principalId: "p1" });
    expect(english.store.threads.get("t-main")!.at(-1)!.card?.title).toBe("Looks like something isn't working.");
  });

  it("guesses from the words only when the person's language is unknown", () => {
    expect(feedbackLanguageFor("", "ça marche pas")).toBe("fr");
    expect(feedbackLanguageFor(undefined, "it broke again")).toBe("en");
    expect(feedbackLanguageFor("fr_CA", "it broke again")).toBe("fr");
    expect(feedbackLanguageFor("de", "ça marche pas")).toBe("en");
  });

  it("cancels without sending anything", async () => {
    const { service, store, calls } = setup({ token: "server-token" });
    const started = service.start("p1", { source: "shortcut", platform: "desktop", locale: "en" });
    for (const answer of ["An idea", "Let me pin a conversation to the top of the list", "Minor", "Cancel"]) say(service, started.botId, started.threadId, answer);
    await service.flush();
    expect(calls).toHaveLength(0);
    expect(store.threads.get(started.threadId)!.at(-1)?.text).toMatch(/nothing was sent/i);
  });
});

describe("feedback cards never stay pending once their source is dead (#3018)", () => {
  const open = (messages: StoredMessage[]) => messages.filter((message) => message.card?.requestId && !message.card.answered && !message.card.dismissed);

  it("reopening the flow several times leaves one open card in the thread", () => {
    const { service, store } = setup();
    let started = service.start("p1", { source: "sidebar", platform: "desktop", locale: "en" });
    for (let index = 0; index < 8; index += 1) started = service.start("p1", { source: "sidebar", platform: "desktop", locale: "en" });
    const thread = store.threads.get(started.threadId)!;
    const cards = open(thread);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toBe(thread.at(-1));
  });

  it("retires cards of a cancelled or sent report", () => {
    const { service, store } = setup();
    const started = service.start("p1", { source: "sidebar", platform: "desktop", locale: "en" });
    for (const answer of ["A bug", "Open settings, then click Save on the profile tab", "The new name is kept after a restart", "Nothing happens and the spinner never stops", "Blocking"]) {
      say(service, started.botId, started.threadId, answer);
    }
    say(service, started.botId, started.threadId, "Cancel");
    expect(open(store.threads.get(started.threadId)!)).toEqual([]);
  });

  it("sweeps cards left behind by older versions and expires untouched drafts", async () => {
    let clock = 1_000_000;
    const { store } = setup();
    const dataDir = mkdtempSync(join(tmpdir(), "fb-sweep-"));
    dirs.push(dataDir);
    const service = createFeedbackService({
      dataDir, store, now: () => clock,
      config: () => ({ repo: "acme/app", source: null }),
      threadFor: (bot) => bot.threadId,
      names: () => ({ people: [], orgs: [], bots: [] }),
      serverLines: () => [], spans: () => [], serverVersion: () => "0.8.70",
    });
    const started = service.start("p1", { source: "sidebar", platform: "desktop", locale: "en" });
    // a stale card from an older build: its report is long gone
    store.appendMessage(started.threadId, { role: "bot", kind: "options", feedback: { step: "kind", reportId: "gone" }, card: { title: "What would you like to report?", subtitle: "", options: ["A bug"], requestId: "fb-gone-kind-1" } } as Omit<StoredMessage, "id" | "at">);
    const live = open(store.threads.get(started.threadId)!)[0]!.feedback?.reportId;
    expect(open(store.threads.get(started.threadId)!)).toHaveLength(2);
    await service.tick();
    expect(open(store.threads.get(started.threadId)!).map((message) => message.feedback?.reportId)).toEqual([live]);
    clock += 8 * 24 * 60 * 60_000;
    await service.tick();
    expect(open(store.threads.get(started.threadId)!)).toEqual([]);
  });
});
