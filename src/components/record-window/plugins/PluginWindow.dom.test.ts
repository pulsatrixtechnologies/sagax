// @vitest-environment happy-dom
// The record windows of the other plugins (M-20261127-141, M-20261127-146),
// entered the normal way (click the chip in a message): each kind's tabs, an
// empty tab without an add hidden (M-20261127-143), the writes the console
// lists and only those, and a console that serves the card only leaving the
// card's facts (nothing invented).
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { resetPersonProducts, seedPersonProducts } from "@/lib/person-products";
import { PLUGIN_PRODUCTS, pluginConsole, type PluginScene } from "@/lib/record-plugin-fixtures";
import { resetRecordCards } from "@/lib/record-cards";
import { ChatMarkdown } from "@/components/ChatMarkdown";
import { parsePersonProduct, type PersonProduct } from "../../../../shared/person-products";

vi.mock("@/lib/app-links", async (original) => ({ ...(await original<typeof import("@/lib/app-links")>()), openExternalLink: vi.fn(async () => {}) }));
vi.mock("@/lib/diagram-view", async (original) => ({ ...(await original<typeof import("@/lib/diagram-view")>()), downloadBlob: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let calls: Array<{ url: string; method: string; body?: string }>;
let stand: ReturnType<typeof pluginConsole>;
/** a change of the console's answer to one section (null: it refuses it) */
let override: (section: string) => unknown | null | undefined = () => undefined;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await vi.advanceTimersByTimeAsync(20); }); };
const windowTabs = () => [...document.querySelectorAll<HTMLElement>("[data-record-tab]")].map((one) => one.dataset.recordTab);
const tab = async (name: string) => { await act(async () => document.querySelector<HTMLElement>(`[data-record-tab="${name}"]`)!.click()); await settle(); };
const writes = () => calls.filter((call) => call.method === "POST").map((call) => JSON.parse(call.body!));
const button = (words: string) => [...document.querySelectorAll<HTMLButtonElement>("[data-record-window] button")].find((one) => one.textContent?.trim() === words);
const setValue = (node: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  Object.getOwnPropertyDescriptor(node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(node, value);
  node.dispatchEvent(new Event("input", { bubbles: true }));
};

async function open(scene: PluginScene, cardOnly = false) {
  stand = pluginConsole("en", cardOnly);
  seedPersonProducts(stand.products.map((raw) => parsePersonProduct(raw)).filter((one): one is PersonProduct => Boolean(one)));
  const p = PLUGIN_PRODUCTS[scene];
  await act(async () => root.render(createElement(ChatMarkdown, { text: `[${p.record}](sagax://record/${p.id}/${p.kind}/${p.record})`, botId: "bot-1", draftId: "bot:bot-1:t-1", message: { threadId: "t-1", messageId: "m-1" } })));
  await act(async () => { host.querySelector<HTMLElement>("[data-record-link]")!.click(); });
  await settle();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(new Date("2026-11-27T18:50:00Z"));
  setLocale("en");
  document.documentElement.dataset.reducedMotion = "true";
  resetRecordCards();
  resetPersonProducts();
  calls = [];
  override = () => undefined;
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(String(input), "http://console.test");
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : undefined;
    calls.push({ url: String(input), method, body });
    const match = /\/api\/me\/records\/([^/]+)\/([^/]+)\/([^/]+?)(\/detail)?$/.exec(url.pathname);
    if (!match) return json({ products: stand.products });
    const [product, kind, id] = [decodeURIComponent(match[1]!), decodeURIComponent(match[2]!), decodeURIComponent(match[3]!)];
    if (!match[4]) return json({ card: stand.card(product, kind, id) });
    if (method === "POST") return stand.write(JSON.parse(body!)) ? json({ updated: true }) : json({ code: "action_unknown" }, 400);
    const section = url.searchParams.get("section") ?? "";
    const changed = override(section);
    const answer = changed === undefined ? stand.section(product, kind, id, section, Number(url.searchParams.get("page") ?? 1)) : changed;
    return answer ? json(answer) : json({ state: "unavailable", code: "kind_unknown" }, 404);
  }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  delete document.documentElement.dataset.reducedMotion;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("a SentinelOne threat", () => {
  it("shows its verdict, chain, file and endpoint; Exclusions is hidden while it has none", async () => {
    await open("threat");
    expect(windowTabs()).toEqual(["overview", "timeline", "device", "notes"]);
    const body = document.querySelector("[data-record-plugin=threat]")!;
    expect(body.querySelector("[data-record-threat-verdict]")!.textContent).toContain("Malicious");
    expect(body.querySelector("[data-record-threat-done]")!.textContent).toMatch(/Quarantined.*Process killed/);
    expect(body.querySelectorAll("[data-record-threat-tree] li")).toHaveLength(4);
    expect(body.querySelector("[data-record-threat-file]")!.textContent).toContain("invoice_oct.pdf.exe");
    expect(body.querySelector("[data-record-threat-device] [data-record-ref-link]")!.textContent).toBe("ACME-PC-014");
  });

  it("isolates the endpoint as one checked write, then offers to reconnect it", async () => {
    await open("threat");
    await act(async () => button("Isolate from the network")!.click());
    await settle();
    expect(writes()).toEqual([{ action: "threat.isolate" }]);
    expect(button("Reconnect to the network")).toBeTruthy();
    expect(document.querySelector("[data-record-threat-device]")!.textContent).toContain("Isolated from the network");
  });

  it("offers only the writes the console lists for the record", async () => {
    override = (section) => section === "counts" ? { counts: { timeline: 7, notes: 0 }, actions: ["threat.verdict"] } : undefined;
    await open("threat");
    expect(button("True threat")).toBeTruthy();
    expect(button("Undo the changes")).toBeUndefined();
    expect(button("Isolate from the network")).toBeUndefined();
    // no note to show and none to write: the tab is hidden
    expect(windowTabs()).toEqual(["overview", "timeline", "device"]);
  });

  it("draws the card's list as the timeline when the console serves no timeline", async () => {
    override = (section) => section === "timeline" ? null : undefined;
    await open("threat");
    await tab("timeline");
    expect(document.querySelectorAll("[data-record-step]")).toHaveLength(6);
  });

  it("leaves a console that serves the card only to the frame's own view of the card: its facts, its list, no tab, no write", async () => {
    await open("threat", true);
    expect(document.querySelector("[data-record-plugin]")).toBeNull();
    expect(windowTabs()).toEqual([]);
    expect(document.querySelector('[data-record-pane="left"]')!.textContent).toContain("Trojan");
    expect(document.querySelector('[data-record-pane="right"]')!.textContent).toContain("Static AI detection");
    expect(document.querySelector("[data-record-write]")).toBeNull();
    expect(document.querySelector("[data-record-threat-verdict]")).toBeNull();
    expect(calls.filter((call) => call.url.includes("/detail")).map((call) => new URL(call.url, "http://x").searchParams.get("section"))).toEqual(["counts"]);
  });

  it("leaves the frame's own view too when the console refuses the kind's main section", async () => {
    override = (section) => section === "view" ? null : undefined;
    await open("threat");
    expect(document.querySelector("[data-record-plugin]")).toBeNull();
    expect(document.querySelector('[data-record-pane="left"]')!.textContent).toContain("Trojan");
  });

  it("offers no write when the console lists none (a console that sends no list)", async () => {
    override = (section) => section === "counts" ? { counts: { timeline: 7, notes: 1 } } : undefined;
    await open("threat");
    expect(document.querySelector("[data-record-threat-verdict]")).toBeTruthy();
    expect(document.querySelector("[data-record-write]")).toBeNull();
    expect(document.querySelector("[data-record-plugin-notes] [data-record-add]")).toBeNull();
  });

  it("writes a note after its +, never before (M-20261127-110)", async () => {
    await open("threat");
    await tab("notes");
    expect(document.querySelector("[data-record-note-form]")).toBeNull();
    await act(async () => document.querySelector<HTMLElement>("[data-record-plugin-notes] [data-record-add]")!.click());
    setValue(document.querySelector<HTMLTextAreaElement>("[data-record-note-form] textarea")!, "Checked the other mailboxes.");
    await act(async () => document.querySelector<HTMLElement>("[data-record-note-form] [data-record-form-submit]")!.click());
    await settle();
    expect(writes()).toEqual([{ action: "note.add", set: { text: "Checked the other mailboxes.", kind: "discussion" } }]);
    expect(document.querySelectorAll("[data-record-note]")).toHaveLength(2);
  });
});

describe("an Axcient protected system", () => {
  it("shows its tiles, last days, volumes and vault, and runs a backup", async () => {
    await open("backup");
    expect(windowTabs()).toEqual(["overview", "points", "volumes"]);
    expect(document.querySelectorAll("[data-record-tile]")).toHaveLength(4);
    expect(document.querySelectorAll("[data-record-day]")).toHaveLength(30);
    expect(document.querySelectorAll('[data-record-day="alert"]')).toHaveLength(1);
    expect(document.querySelectorAll("[data-record-volume]")).toHaveLength(2);
    await act(async () => button("Run a backup now")!.click());
    await settle();
    expect(writes()).toEqual([{ action: "backup.run" }]);
  });

  it("reads every page of its restore points", async () => {
    await open("backup");
    await tab("points");
    expect(document.querySelectorAll("[data-record-list] li")).toHaveLength(214);
  });
});

describe("a BookStack page", () => {
  it("draws the page with its headings beside its book, facts and tags", async () => {
    await open("page");
    expect(windowTabs()).toEqual(["page", "revisions", "attachments"]);
    const page = document.querySelector("[data-record-page]")!;
    expect(page.querySelector("h2")!.textContent).toBe("Backup procedure");
    expect([...page.querySelectorAll("[data-record-markdown] [role=heading]")].map((one) => one.textContent?.trim())).toEqual(["Every week", "When a backup fails"]);
    expect(page.querySelector("pre, code")).toBeTruthy();
    expect(document.querySelector('[data-record-book-entry="current"]')!.textContent).toBe("Backup procedure");
    expect([...document.querySelectorAll("[data-record-tag]")].map((one) => one.textContent)).toEqual(["backup", "x360"]);
    expect(button("Edit")).toBeTruthy();
    expect(button("Ask the bot")).toBeTruthy();
  });
});

describe("a Twilio conversation", () => {
  it("opens on the record's own message, its error with its cause and fix; Media is hidden while empty", async () => {
    await open("conversation");
    expect(windowTabs()).toEqual(["conversation", "log", "calls", "number"]);
    expect(document.querySelectorAll("[data-record-sms]")).toHaveLength(6);
    expect(document.querySelectorAll("[data-record-sms-day]")).toHaveLength(2);
    const chosen = document.querySelector("[data-record-sms-chosen]")!;
    expect(chosen.getAttribute("data-record-sms-chosen")).toBe("SM6f3e12d0");
    expect(chosen.querySelector('[data-record-sms-error="30007"]')!.textContent).toContain("Send the reminder without the link");
    // another message chosen: its own facts
    await act(async () => document.querySelectorAll<HTMLElement>("[data-record-sms]")[0]!.click());
    expect(document.querySelector("[data-record-sms-chosen]")!.getAttribute("data-record-sms-chosen")).toBe("SM8c2fa41d");
  });

  it("writes an SMS after + Message, its segments counted", async () => {
    await open("conversation");
    expect(document.querySelector("[data-record-sms-compose]")).toBeNull();
    await act(async () => document.querySelector<HTMLElement>("[data-record-sms-new]")!.click());
    setValue(document.querySelector<HTMLTextAreaElement>("[data-record-sms-compose] textarea")!, "Yes, 3:30 PM works.");
    expect(document.querySelector("[data-record-sms-count]")!.textContent).toBe("19 of 160 characters · segments: 1 · GSM-7");
    await act(async () => document.querySelector<HTMLFormElement>("[data-record-sms-compose]")!.requestSubmit());
    await settle();
    expect(writes()).toEqual([{ action: "message.send", set: { text: "Yes, 3:30 PM works." } }]);
    expect(document.querySelectorAll("[data-record-sms]")).toHaveLength(7);
  });

  it("lists the number's log in the grid and its calls with their recordings", async () => {
    await open("conversation");
    await tab("log");
    expect(document.querySelectorAll("[data-record-grid] tbody tr")).toHaveLength(9);
    await tab("calls");
    expect(document.querySelectorAll("[data-record-call]")).toHaveLength(2);
    expect(document.querySelectorAll("[data-record-listen]")).toHaveLength(2);
  });

  it("plays one recording at a time and lets none go on, or leak, once the tab closes", async () => {
    const players: Array<{ paused: boolean; src: string }> = [];
    class FakeAudio { paused = true; onended: (() => void) | null = null; constructor(public src: string) { players.push(this); } play() { this.paused = false; return Promise.resolve(); } pause() { this.paused = true; } }
    vi.stubGlobal("Audio", FakeAudio);
    let made = 0;
    const revoked: string[] = [];
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => `blob:${++made}`, revokeObjectURL: (url: string) => { revoked.push(url); } }));
    await open("conversation");
    await tab("calls");
    const listen = () => [...document.querySelectorAll<HTMLElement>("[data-record-listen]")];
    await act(async () => listen()[0]!.click());
    await settle();
    expect(players.map((one) => one.paused)).toEqual([false]);
    await act(async () => listen()[1]!.click());
    await settle();
    expect(players.map((one) => one.paused)).toEqual([true, false]);
    expect(revoked).toEqual(["blob:1"]);
    // another one, then the tab closes: nothing plays on, every address is dropped
    await act(async () => listen()[0]!.click());
    await settle();
    await tab("number");
    expect(players.filter((one) => !one.paused)).toHaveLength(0);
    expect(revoked).toEqual(["blob:1", "blob:2", "blob:3"]);
  });
});

describe("an X post", () => {
  it("draws the post with the chat's X card, bookmarks it, and deletes it only after asking", async () => {
    await open("post");
    expect(windowTabs()).toEqual(["post", "replies", "stats"]);
    const post = document.querySelector("[data-x-post]")!;
    expect(post.textContent).toContain("@nimbus_msp");
    expect([...post.querySelectorAll("[data-x-metric]")].map((one) => one.getAttribute("data-x-metric"))).toEqual(["replies", "reposts", "likes", "views", "bookmark", "share"]);
    await act(async () => post.querySelector<HTMLElement>('button[data-x-metric="bookmark"]')!.click());
    await settle();
    expect(writes()).toEqual([{ action: "post.bookmark" }]);
    expect(document.querySelector('[data-x-post] button[data-x-metric="bookmark"]')!.getAttribute("aria-pressed")).toBe("true");
    calls = [];
    await act(async () => document.querySelector<HTMLElement>("[data-record-post-remove]")!.click());
    expect(writes()).toEqual([]);
    await act(async () => button("Yes, delete")!.click());
    await settle();
    expect(writes()).toEqual([{ action: "post.remove" }]);
  });

  it("replies to a reply after its Reply button", async () => {
    await open("post");
    await tab("replies");
    expect(document.querySelectorAll("[data-x-reply]")).toHaveLength(2);
    await act(async () => document.querySelector<HTMLElement>("[data-x-reply-open]")!.click());
    setValue(document.querySelector<HTMLTextAreaElement>("[data-x-reply-form] textarea")!, "Thanks!");
    await act(async () => document.querySelector<HTMLElement>("[data-x-reply-form] [data-record-form-submit]")!.click());
    await settle();
    expect(writes()).toEqual([{ action: "post.reply", set: { text: "Thanks!", to: "1861500000001" } }]);
  });
});

describe("a folder of files", () => {
  it("looks like the Finder: no tabs, three views, the one filter of words and a tag", async () => {
    await open("folder");
    expect(windowTabs()).toEqual([]);
    expect(document.querySelectorAll("[data-finder-icons] [data-finder-item]")).toHaveLength(8);
    const search = document.querySelector<HTMLInputElement>("[data-finder-search] input")!;
    await act(async () => setValue(search, "pdf"));
    expect([...document.querySelectorAll("[data-finder-item]")].map((one) => one.getAttribute("title"))).toEqual(["contrat-adhesion.pdf"]);
    await act(async () => setValue(search, ""));
    await act(async () => [...document.querySelectorAll<HTMLElement>('[data-finder-place="tag"]')].find((one) => one.textContent === "Urgent")!.click());
    expect([...document.querySelectorAll("[data-finder-item]")].map((one) => one.getAttribute("title"))).toEqual(["photo-imprimante.png"]);
    await act(async () => document.querySelector<HTMLElement>('[data-finder-view="list"]')!.click());
    expect(document.querySelectorAll("[data-finder-row]")).toHaveLength(1);
    await act(async () => document.querySelector<HTMLElement>('[data-finder-view="columns"]')!.click());
    expect(document.querySelector("[data-finder-preview]")!.textContent).toContain("photo-imprimante.png");
  });

  it("downloads a file through the record's route, and opens a folder in the same window", async () => {
    await open("folder");
    const file = [...document.querySelectorAll<HTMLElement>("[data-finder-item]")].find((one) => one.textContent?.includes("grille-tarifaire"))!;
    await act(async () => { file.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); });
    await settle();
    expect(calls.some((call) => call.url.includes("section=download") && call.url.includes("field=f2"))).toBe(true);
    const folder = [...document.querySelectorAll<HTMLElement>("[data-finder-item]")].find((one) => one.textContent?.includes("Contracts"))!;
    await act(async () => { folder.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); });
    await settle();
    expect(document.querySelector('[data-record-window="files/folder"] [data-finder]')).toBeTruthy();
    expect(document.querySelector("[data-record-window-head]")!.textContent).toContain("Contracts");
    // back to the customer's folder, then forward again (the Finder's ‹ and ›)
    expect(document.querySelector<HTMLButtonElement>("[data-finder-forward]")!.disabled).toBe(true);
    await act(async () => document.querySelector<HTMLElement>("[data-finder-back]")!.click());
    await settle();
    expect(document.querySelector("[data-record-window-head]")!.textContent).toContain("Acme Fabrication");
    await act(async () => document.querySelector<HTMLElement>("[data-finder-forward]")!.click());
    await settle();
    expect(document.querySelector("[data-record-window-head]")!.textContent).toContain("Contracts");
  });
});

describe("the UUID screen rule", () => {
  it("puts no GUID on screen in any of the windows, even when the console sends one as a fact", async () => {
    const guid = "6f1c2a52-3b7e-4f0a-9d51-0c7a8e1b2d34";
    for (const scene of Object.keys(PLUGIN_PRODUCTS) as PluginScene[]) {
      override = (section) => section === "view" && scene === "threat" ? { view: { verdict: { label: "Malicious", tone: "alert" }, file: [{ label: "Id", value: guid }, { label: "Name", value: "a.exe" }] } } : undefined;
      await open(scene);
      expect(document.querySelector("[data-record-window]")!.textContent, scene).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      act(() => root.unmount());
      root = createRoot(host);
      resetRecordCards();
    }
  });
});

describe("the looks of X and the Finder", () => {
  it("write no colour in the components: their inks are the stylesheet's tokens", () => {
    const dir = join(__dirname);
    for (const file of readdirSync(dir).filter((name) => name.endsWith(".tsx"))) {
      const text = readFileSync(join(dir, file), "utf8");
      expect(text, file).not.toMatch(/#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?\b|rgba?\(|hsla?\(/);
    }
  });
});
