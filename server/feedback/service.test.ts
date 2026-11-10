import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { failedTurnTool } from "../../shared/failed-turn.ts";
import { createFeedbackService, feedbackLanguageFor, platformFromUserAgent, type FeedbackStore, type StoredMessage } from "./service.ts";

interface FakeBot { id: string; name: string; threadId: string; systemBot?: string }

function fakeStore(): FeedbackStore & { threads: Map<string, StoredMessage[]>; bots: FakeBot[]; deleted: string[] } {
  const threads = new Map<string, StoredMessage[]>();
  const bots: FakeBot[] = [{ id: "b-main", name: "Atlas", threadId: "t-main" }];
  const deleted: string[] = [];
  let seq = 0;
  return {
    threads,
    bots,
    deleted,
    bot: (id) => bots.find((bot) => bot.id === id),
    deleteBot: (id) => {
      const index = bots.findIndex((bot) => bot.id === id);
      if (index < 0) return false;
      const [gone] = bots.splice(index, 1);
      threads.delete(gone!.threadId);
      deleted.push(id);
      return true;
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

const NAMES = {
  people: ["Ada Lovelace", "ada.lovelace", "Grace Hopper"],
  orgs: ["Nimbus Plumbing"],
  bots: ["Atlas"],
  hosts: ["ada-studio"],
  other: ["adalove"],
};

function setup(options: { token?: string; language?: (person: string | null) => string; now?: () => number; records?: unknown[] } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "fb-service-"));
  dirs.push(dataDir);
  if (options.records) {
    mkdirSync(join(dataDir, "feedback"), { recursive: true });
    writeFileSync(join(dataDir, "feedback", "reports.json"), JSON.stringify(options.records));
  }
  // the server's recent log: a test can add lines between two steps
  const logs = ["2026-11-10T14:02:11.000Z warn [engines] Ada Lovelace hit a 502 at 10.0.0.4 on SRV-DC01"];
  const store = fakeStore();
  const calls: Array<{ method: string; url: string; body?: { title?: string; body?: string; labels?: string[] } }> = [];
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
    names: () => NAMES,
    serverLines: () => [...logs],
    spans: () => [{ name: "tool.read", ms: 120, ok: false }],
    serverVersion: () => "0.8.80",
    engine: () => ({ engine: "claude", model: "claude-test-model" }),
    fetch,
    ...(options.language ? { language: options.language } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
  return { service, store, calls, dataDir, logs };
}

const say = (service: ReturnType<typeof setup>["service"], text: string, threadId = "t-main", extra: Record<string, unknown> = {}) =>
  service.handleMessage({ botId: "b-main", threadId, text, principalId: "p1", ...extra });

const thread = (store: ReturnType<typeof setup>["store"], id = "t-main") => store.threads.get(id) ?? [];
const filed = (calls: ReturnType<typeof setup>["calls"]) => calls.find((call) => call.method === "POST" && call.url.endsWith("/issues"))?.body;

/** A chat where a turn failed: the person's request, a failed tool, the error row. */
function failedChat(store: ReturnType<typeof setup>["store"], ask = "Show the open routines for this week") {
  store.appendMessage("t-main", { role: "user", kind: "text", text: ask });
  store.appendMessage("t-main", { role: "bot", kind: "activity", text: "", tool: { name: "routines_list", ok: false }, turnId: "turn-7f3a" } as never);
  store.appendMessage("t-main", {
    role: "bot", kind: "activity", text: "", turnId: "turn-7f3a", turnRun: { instanceId: "claude", model: "claude-test-model" },
    tool: failedTurnTool("Provider returned 529 overloaded (request_id: req_011CVa7bQx9KmZ3)"),
  } as never);
}

describe("/feedback, with no Feedback bot (#3299)", () => {
  it("never creates a bot: the report is drafted, previewed and filed in the chat it is typed in", async () => {
    const { service, store, calls } = setup({ token: "server-token" });
    failedChat(store);
    const app = { platform: "desktop" as const, appVersion: "0.8.80", os: "macOS 27.0", page: "chat", locale: "en" as const, clientLogs: ["console warn retry"] };
    expect(say(service, "/feedback the routine list never loads, I expected this week's routines", "t-main", { app })).not.toBeNull();
    expect(store.bots.map((bot) => bot.id)).toEqual(["b-main"]);
    const card = thread(store).at(-1)!;
    // the error and the words say what went wrong: no question, straight to the preview
    expect(card.feedback?.step).toBe("preview");
    expect(card.card?.options).toEqual(["Send", "Cancel"]);
    expect(say(service, "Send")).not.toBeNull();
    await service.flush();
    const issue = filed(calls)!;
    expect(issue.labels).toEqual(["feedback", "feedback:untriaged", "bug"]);
    for (const part of [
      "## Summary", "## Steps to reproduce", "## Expected", "## Actual", "## What the person was doing", "## Context", "## Error",
      "| App version | 0.8.80 |", "| Server version | 0.8.80 |", "| Surface | desktop |", "| Page | chat |", "| Engine | claude |", "| Model | claude-test-model |",
      "| Turn id | turn-7f3a |", "| Request ids | req_011CVa7bQx9KmZ3 |", "| Failed tool calls | routines_list |", "| Opened from | /feedback |",
      'Send: "Show the open routines for this week"', "Provider returned 529 overloaded", "this week's routines", "on the desktop app",
    ]) expect(issue.body).toContain(part);
    expect(JSON.stringify(issue)).not.toContain("server-token");
    expect(thread(store).at(-1)?.feedback?.step).toBe("status");
    expect(thread(store).at(-1)?.text).toContain("#42");
    expect(service.list("p1")[0]).toMatchObject({ status: "sent", issueNumber: 42, kind: "bug" });
    expect(service.list("someone-else")).toEqual([]);
    await service.tick();
    expect(service.list("p1")[0]?.status).toBe("in_progress");
  });

  it("shows the person the exact text that is filed, even when the server log moves before Send", async () => {
    const { service, store, calls, logs } = setup({ token: "server-token" });
    failedChat(store);
    say(service, "/feedback nothing loads");
    const preview = thread(store).at(-2)!.text ?? "";
    // the log changes between the preview and Send: what leaves is still what was shown
    logs.push("2026-11-10T14:05:00.000Z error [routes] a later line the person never saw");
    say(service, "Send");
    await service.flush();
    const issue = filed(calls)!;
    expect(preview.endsWith(`**${issue.title}**\n\n${issue.body}`)).toBe(true);
    expect(issue.body).not.toContain("a later line the person never saw");
  });

  it("builds the preview again, with the newer log, when the person adds a detail", async () => {
    const { service, store, calls, logs } = setup({ token: "server-token" });
    failedChat(store);
    say(service, "/feedback nothing loads");
    logs.push("2026-11-10T14:05:00.000Z error [routes] a later line");
    say(service, "It started after the last update");
    const preview = thread(store).at(-2)!.text ?? "";
    expect(preview).toContain("a later line");
    say(service, "Send");
    await service.flush();
    const issue = filed(calls)!;
    expect(preview.endsWith(`**${issue.title}**\n\n${issue.body}`)).toBe(true);
  });

  it("asks one question only when nothing says what went wrong, then previews", () => {
    const { service, store } = setup();
    say(service, "/feedback");
    expect(thread(store).at(-1)?.feedback?.step).toBe("detail");
    expect(thread(store).at(-1)?.text).toMatch(/What happened, and what did you expect instead\?|Qu'est-ce qui s'est passé/);
    say(service, "ok");
    // a vague answer gets no second question
    expect(thread(store).at(-1)?.feedback?.step).toBe("preview");
  });

  it("asks nothing when the chat holds the error, even for a bare /feedback", () => {
    const { service, store } = setup();
    failedChat(store);
    say(service, "/feedback");
    expect(thread(store).filter((message) => message.feedback?.step === "detail")).toHaveLength(0);
    expect(thread(store).at(-1)?.feedback?.step).toBe("preview");
  });

  it("asks its question in French with tu, from the catalog, for a French reader", () => {
    const { service, store } = setup({ language: () => "fr-CA" });
    say(service, "/feedback");
    expect(thread(store).at(-1)?.text).toBe("Qu'est-ce qui s'est passé, et qu'est-ce que tu attendais à la place? Une phrase suffit.");
    say(service, "Le bouton Enregistrer ne fait rien du tout quand je clique");
    expect(thread(store).at(-2)?.text).toMatch(/^Voici le texte exact qui sera envoyé à l'équipe, anonymisé :/);
  });

  it("names the surface from the request when the app attached nothing (a phone)", () => {
    expect(platformFromUserAgent("Sagax/145 CFNetwork/3826 Darwin/25.0.0")).toBe("ios");
    expect(platformFromUserAgent("Mozilla/5.0 (Macintosh) Electron/38")).toBe("desktop");
    expect(platformFromUserAgent("Mozilla/5.0 (X11; Linux x86_64)")).toBe("web");
    expect(platformFromUserAgent(undefined)).toBeUndefined();
  });

  it("leaves ordinary messages alone and takes no answer once the bot talked on", () => {
    const { service, store } = setup();
    expect(say(service, "Quelle heure est-il?")).toBeNull();
    say(service, "/feedback");
    store.appendMessage("t-main", { role: "bot", kind: "text", text: "Something else" });
    expect(say(service, "a later message")).toBeNull();
  });

  it("keeps the report in a local queue when no token is set, names the variable and offers a filled GitHub link (#3201, #3218)", async () => {
    const { service, store, calls, dataDir } = setup();
    say(service, "/feedback the routine list never loads at all");
    say(service, "Send");
    await service.flush();
    expect(calls).toHaveLength(0);
    expect(service.list("p1")[0]?.status).toBe("queued");
    const text = thread(store).at(-1)?.text ?? "";
    expect(text).toContain("SAGAX_FEEDBACK_GITHUB_TOKEN");
    expect(text).toContain("https://github.com/acme/app/issues/new?title=");
    expect(text).not.toMatch(/retry every 5 minutes/);
    expect(existsSync(join(dataDir, "feedback", "reports.json"))).toBe(true);
  });

  it("exposes the Send card as an answerable question card, even with progress rows after it (#2955)", async () => {
    const { service, store } = setup();
    say(service, "/feedback the routine list never loads at all");
    const card = thread(store).at(-1)!;
    expect(card.card?.requestId).toMatch(/^fb-/);
    expect(card.card?.requestType).toBe("question");
    store.appendMessage("t-main", { role: "bot", kind: "text", text: "Pulling it together" });
    expect(service.answerCard("t-main", card.card!.requestId!, "Send", "p1")?.ok).toBe(true);
    await service.flush();
    expect(card.card?.answered).toBe("answer");
    expect(service.list("p1")[0]?.status).toBe("queued");
    expect(service.answerCard("t-main", "not-a-fb", "Send", "p1")).toBeNull();
  });

  it("recognizes a free confirmation at the preview step", async () => {
    const { service, store } = setup({ language: () => "fr" });
    say(service, "/feedback la liste des routines ne charge jamais");
    say(service, "Oui, envoie-le");
    await service.flush();
    expect(service.list("p1")[0]?.status).toBe("queued");
    expect(thread(store).at(-1)?.text).toMatch(/En file d'attente/);
  });

  it("adds a detail typed at the preview and shows the preview again", () => {
    const { service, store } = setup();
    say(service, "/feedback the routine list never loads at all");
    say(service, "It started after the last update");
    expect(thread(store).at(-2)?.text).toContain("## Added details\n\n- It started after the last update");
    expect(thread(store).at(-1)?.feedback?.step).toBe("preview");
  });

  it("cancels without sending anything", async () => {
    const { service, store, calls } = setup({ token: "server-token", language: () => "en" });
    say(service, "/feedback an idea: let me pin a conversation to the top");
    say(service, "Cancel");
    await service.flush();
    expect(calls).toHaveLength(0);
    expect(thread(store).at(-1)?.text).toMatch(/nothing was sent/i);
  });
});

describe("anonymization of a /feedback report (#3299)", () => {
  const IDENTIFYING = [
    "Ada Lovelace", "Lovelace", "Grace Hopper", "ada.lovelace", "Nimbus Plumbing", "Atlas", "ada-studio", "adalove",
    "ada@nimbus-plumbing.ca", "billing@nimbus-plumbing.ca", "nimbus-plumbing.ca", "portal.nimbus-plumbing.ca",
    "48213", "Printer down at the north office", "SRV-DC01", "Ada's MacBook Pro", "ada-iphone",
    "ghp_abcdefghijklmnopqrstuvwxyz0123456789AB", "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789", "xoxb-1234567890-abcdefghij",
    "/Users/ada", "Clients/Nimbus", "C:\\Users\\Ada", "\\\\FS01\\Clients", "/Volumes/Shared/Nimbus",
    "514-555-0199", "10.0.0.4", "192.168.1.20", "3f2a9c1e-8b7d-4e6f-9a0b-1c2d3e4f5a6b", "@gracehopper",
    // names the server does not know, with no quotes around them, in the
    // error, the server log, the app log and a connector's tool name
    "Northwind", "Traders", "Bob Tremblay", "Tremblay", "Fabrikam", "Jean Dupont", "Dupont", "Alice Smith", "Smith",
  ];

  it("feeds identifying text everywhere a report reads from and none of it reaches the issue", async () => {
    const { service, store, calls, logs } = setup({ token: "server-token" });
    store.appendMessage("t-main", { role: "user", kind: "text", text: "Atlas, open ticket #48213 \"Printer down at the north office\" for Nimbus Plumbing and mail ada@nimbus-plumbing.ca" });
    store.appendMessage("t-main", { role: "bot", kind: "text", text: "Done, Ada Lovelace. I wrote to billing@nimbus-plumbing.ca." });
    store.appendMessage("t-main", { role: "user", kind: "text", text: "Now save the report in /Users/ada/Clients/Nimbus/q3.xlsx and on \\\\FS01\\Clients\\Nimbus, call Grace Hopper at 514-555-0199" });
    store.appendMessage("t-main", { role: "bot", kind: "activity", text: "", tool: { name: "mcp__northwind_crm__get_agreement", ok: false }, turnId: "turn-1" } as never);
    store.appendMessage("t-main", {
      role: "bot", kind: "activity", text: "", turnId: "turn-1",
      tool: failedTurnTool("No agreement found for company Northwind Traders (contact Bob Tremblay)\nCould not reach SRV-DC01 (10.0.0.4) from Ada's MacBook Pro with token ghp_abcdefghijklmnopqrstuvwxyz0123456789AB for portal.nimbus-plumbing.ca; thread 3f2a9c1e-8b7d-4e6f-9a0b-1c2d3e4f5a6b"),
    } as never);
    const words = "/feedback Ada Lovelace here from Nimbus Plumbing: case 48213 failed, I expected the file in C:\\Users\\Ada\\Documents and /Volumes/Shared/Nimbus but ada-iphone and ada-studio show nothing. Key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789, slack xoxb-1234567890-abcdefghij, ping @gracehopper, my login adalove, ada.lovelace, from 192.168.1.20";
    logs.push("2026-11-10T14:03:40.000Z warn [connectors] company Fabrikam Inc has no site; user Jean Dupont");
    say(service, words, "t-main", {
      app: { platform: "desktop", appVersion: "0.8.80", page: "chat", locale: "en", clientLogs: ["fetch failed for ada@nimbus-plumbing.ca at /Users/ada/Library/Logs/sagax.log", "render failed for Alice Smith"] },
    });
    const preview = thread(store).at(-2)!.text ?? "";
    say(service, "Send");
    await service.flush();
    const issue = filed(calls)!;
    const published = `${issue.title}\n${issue.body}`;
    for (const leak of IDENTIFYING) {
      expect(published.toLowerCase(), leak).not.toContain(leak.toLowerCase());
      expect(preview.toLowerCase(), leak).not.toContain(leak.toLowerCase());
    }
    // the neutral words stand in, so the report still reads
    // the technical facts stay readable around the masks
    expect(published).toContain("No agreement found for company [name] (contact [name])");
    expect(published).toContain("render failed for [name]");
    expect(published).toContain("[connector]");
    expect(published).toContain("get_agreement");
    for (const mark of ["[person]", "[org]", "[email]", "[ticket]", "[ticket text]", "[path]", "[host]", "[ip]", "[phone]", "[id]", "[domain]", "[handle]", "[name]"]) {
      expect(published).toContain(mark);
    }
    // the repository's own term scan finds nothing in what is published
    const termsModule = "../../scripts/npm-package-terms.mjs";
    const terms = (await import(termsModule)) as { scanText: (text: string, allowlist?: unknown[], file?: string) => Array<{ term: string }> };
    expect(terms.scanText(published, [], "feedback-issue.md")).toEqual([]);
  });
});

describe("/feedback masks names the server does not know (#3299)", () => {
  it("an unknown person and an unknown company in the words and the chat requests never reach the issue nor the preview", async () => {
    const { service, store, calls } = setup({ token: "server-token" });
    store.appendMessage("t-main", { role: "user", kind: "text", text: "Prépare la facture de Fabrikam pour Bob Tremblay" });
    store.appendMessage("t-main", { role: "bot", kind: "text", text: "C'est fait." });
    store.appendMessage("t-main", { role: "user", kind: "text", text: "Now check the open tickets for Northwind Traders and the client wingtip" });
    store.appendMessage("t-main", {
      role: "bot", kind: "activity", text: "", turnId: "turn-2",
      tool: failedTurnTool("Company \"Northwind Traders\" not found"),
    } as never);
    say(service, "/feedback Bob Tremblay de Fabrikam m'a demandé la facture, je m'attendais à un PDF mais rien", "t-main", {
      app: { platform: "desktop", appVersion: "0.8.80", page: "chat", locale: "fr" },
    });
    const preview = thread(store).at(-2)!.text ?? "";
    say(service, "Send");
    await service.flush();
    const issue = filed(calls)!;
    const published = `${issue.title}\n${issue.body}`;
    for (const leak of ["Bob", "Tremblay", "Fabrikam", "Northwind", "Traders", "wingtip"]) {
      expect(published, leak).not.toContain(leak);
      expect(preview, leak).not.toContain(leak);
    }
    expect(published).toContain("[name]");
    expect(published).toContain("## What the person was doing");
  });
});

describe("the Feedback bot of older versions is retired (#3299)", () => {
  it("removes the empty system bot and its unfinished reports, once", () => {
    const { service, store } = setup();
    store.bots.push({ id: "b-feedback", name: "Feedback", threadId: "t-feedback", systemBot: "feedback" });
    store.appendMessage("t-feedback", { role: "bot", kind: "text", text: "old" });
    expect(service.retireFeedbackBot()).toBe(1);
    expect(store.bots.map((bot) => bot.id)).toEqual(["b-main"]);
    expect(store.deleted).toEqual(["b-feedback"]);
    expect(service.retireFeedbackBot()).toBe(0);
    // ordinary bots are never touched
    expect(store.bot("b-main")).toBeDefined();
  });
});

describe("the language of a /feedback report", () => {
  it("guesses from the words only when the person's language is unknown", () => {
    expect(feedbackLanguageFor("", "ça marche pas")).toBe("fr");
    expect(feedbackLanguageFor(undefined, "it broke again")).toBe("en");
    expect(feedbackLanguageFor("fr_CA", "it broke again")).toBe("fr");
    expect(feedbackLanguageFor("de", "ça marche pas")).toBe("en");
  });
});

describe("feedback cards never stay pending once their source is dead (#3018)", () => {
  const open = (messages: StoredMessage[]) => messages.filter((message) => message.card?.requestId && !message.card.answered && !message.card.dismissed);

  it("typing /feedback several times leaves one open card in the chat", () => {
    const { service, store } = setup();
    for (let index = 0; index < 5; index += 1) say(service, "/feedback the routine list never loads at all");
    const cards = open(thread(store));
    expect(cards).toHaveLength(1);
    expect(cards[0]).toBe(thread(store).at(-1));
  });

  it("retires the cards of a cancelled report", () => {
    const { service, store } = setup();
    say(service, "/feedback the routine list never loads at all");
    say(service, "Cancel");
    expect(open(thread(store))).toEqual([]);
  });

  it("retires a report card older versions offered on their own, and it files nothing (#3299)", async () => {
    const legacy = { id: "fbold", owner: "p1", botId: "b-main", threadId: "t-main", lang: "fr", createdAt: 1, updatedAt: Date.now(), status: "draft", said: "ça marche pas", context: { source: "offer" }, offer: true };
    const { service, store, calls } = setup({ token: "server-token", records: [legacy] });
    store.appendMessage("t-main", { role: "bot", kind: "options", feedback: { step: "offer", reportId: "fbold" }, card: { title: "On dirait que quelque chose ne marche pas.", subtitle: "", options: ["Envoyer le signalement", "Non merci"], requestId: "fb-fbold-offer-1", requestType: "question" } } as Omit<StoredMessage, "id" | "at">);
    // its old option, typed or clicked, opens nothing and sends nothing
    expect(say(service, "Envoyer le signalement")).toBeNull();
    await service.flush();
    expect(calls.filter((call) => call.method === "POST")).toEqual([]);
    await service.tick();
    expect(open(thread(store))).toEqual([]);
    expect(service.list("p1")).toEqual([]);
  });

  it("sweeps cards left behind by older versions and expires untouched drafts", async () => {
    let clock = 1_000_000;
    const { service, store } = setup({ now: () => clock });
    say(service, "/feedback the routine list never loads at all");
    store.appendMessage("t-main", { role: "bot", kind: "options", feedback: { step: "preview", reportId: "gone" }, card: { title: "Send this report?", subtitle: "", options: ["Send"], requestId: "fb-gone-preview-1" } } as Omit<StoredMessage, "id" | "at">);
    expect(open(thread(store))).toHaveLength(2);
    await service.tick();
    expect(open(thread(store))).toHaveLength(1);
    clock += 8 * 24 * 60 * 60_000;
    await service.tick();
    expect(open(thread(store))).toEqual([]);
  });
});
