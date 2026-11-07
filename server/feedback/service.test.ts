import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFeedbackService, type FeedbackStore, type StoredMessage } from "./service.ts";

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
  };
}

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function setup(options: { token?: string } = {}) {
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

  it("cancels without sending anything", async () => {
    const { service, store, calls } = setup({ token: "server-token" });
    const started = service.start("p1", { source: "shortcut", platform: "desktop", locale: "en" });
    for (const answer of ["An idea", "Let me pin a conversation to the top of the list", "Minor", "Cancel"]) say(service, started.botId, started.threadId, answer);
    await service.flush();
    expect(calls).toHaveLength(0);
    expect(store.threads.get(started.threadId)!.at(-1)?.text).toMatch(/nothing was sent/i);
  });
});
