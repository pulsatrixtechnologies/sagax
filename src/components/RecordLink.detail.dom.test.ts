// @vitest-environment happy-dom
// A ticket chip's card, entered the normal way (click the chip in a message),
// gains the related tabs and the editable fields through the record's detail
// route; a server without that route leaves the original card.
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { answer, companyCard, nimbusProduct, ticketCard } from "@/lib/record-card-fixtures";
import { resetPersonProducts, seedPersonProducts } from "@/lib/person-products";
import { resetRecordCards } from "@/lib/record-cards";
import { ChatMarkdown } from "./ChatMarkdown";

vi.mock("@/lib/app-links", async (original) => ({ ...(await original<typeof import("@/lib/app-links")>()), openExternalLink: vi.fn(async () => {}) }));
vi.mock("@/lib/diagram-view", async (original) => ({ ...(await original<typeof import("@/lib/diagram-view")>()), downloadBlob: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LINK = "sagax://record/nimbus_desk/ticket/481516";
let host: HTMLDivElement;
let root: Root;
let calls: Array<{ url: string; method: string; body?: string }>;
let detail: (url: URL, method: string, body?: string) => Response;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const FIELDS = ["status", "priority", "board", "type", "subtype", "item", "owner", "team", "agreement", "contact"];

const chip = () => host.querySelector<HTMLElement>("[data-record-link]")!;
const card = () => document.querySelector<HTMLElement>("[data-record-card]");
const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await vi.advanceTimersByTimeAsync(20); }); };
const tabs = () => [...document.querySelectorAll<HTMLElement>('[role="tab"]')];
const detailCalls = (section: string) => calls.filter((call) => call.url.includes("/detail") && call.url.includes(`section=${section}`));

async function open(link = LINK, label = "#481516") {
  await act(async () => root.render(createElement(ChatMarkdown, { text: `[${label}](${link})`, botId: "bot-1", draftId: "bot:bot-1:t-1", message: { threadId: "t-1", messageId: "m-1" } })));
  await act(async () => { chip().click(); });
  await settle();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  setLocale("en");
  document.documentElement.dataset.reducedMotion = "true";
  resetRecordCards();
  resetPersonProducts();
  seedPersonProducts([nimbusProduct()]);
  calls = [];
  detail = (url) => {
    const section = url.searchParams.get("section");
    if (section === "counts") return json({ counts: { time: 3, attachments: 1 }, fields: FIELDS });
    if (section === "time") {
      return url.searchParams.get("page") === "2"
        ? json({ lines: [{ date: "Nov 16", member: "Support", hours: "1 h", note: "Second page" }], next: null, totalHours: "3 h" })
        : json({ lines: [{ date: "Nov 18", member: "Support", hours: "1 h", note: "First page" }, { date: "Nov 17", member: "Support", hours: "1 h", note: "Also first" }], next: 2, totalHours: "3 h" });
    }
    if (section === "attachments") return json({ lines: [{ name: "print-test.txt", size: "10 B", date: "Nov 18", id: "77" }], next: null });
    if (section === "choices") {
      return url.searchParams.get("page") === "2"
        ? json({ choices: [{ value: "5", label: "Billing" }], next: null })
        : json({ choices: [{ value: "3", label: "Service desk" }], next: 2 });
    }
    return json({ lines: [], next: null });
  };
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(String(input), "http://console.test");
    const method = init?.method ?? "GET";
    calls.push({ url: String(input), method, body: typeof init?.body === "string" ? init.body : undefined });
    if (url.pathname.endsWith("/detail")) return detail(url, method, typeof init?.body === "string" ? init.body : undefined);
    return json(answer(url.pathname.includes("/company/") ? companyCard(Date.now(), "en") : ticketCard(Date.now(), "en")));
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

describe("a ticket card through its chip", () => {
  it("shows the tabs with their counts, follows every page and keeps the tab order", async () => {
    await open();
    expect(tabs().map((tab) => tab.textContent)).toEqual(["Notes0", "Time3", "Configurations", "Expenses", "Activities", "Attachments1", "Discussion0", "Internal0", "Resolution0", "All0"]);
    expect(tabs().at(-1)?.getAttribute("aria-selected")).toBe("true");
    await act(async () => tabs()[1]!.click());
    await settle();
    expect(detailCalls("time").map((call) => new URL(call.url, "http://x").searchParams.get("page"))).toEqual(["1", "2"]);
    expect(document.querySelectorAll("tbody tr")).toHaveLength(3);
    expect(card()!.textContent).toContain("Total: 3 h");
    // a tab read once is not read again on return
    await act(async () => tabs()[5]!.click());
    await settle();
    await act(async () => tabs()[1]!.click());
    await settle();
    expect(detailCalls("time")).toHaveLength(2);
  });

  it("keeps the schedule in its pane and filters complete notes newest first", async () => {
    detail = ((base) => (url, method, body) => {
      const section = url.searchParams.get("section");
      if (section === "schedule") return json({ lines: [{ member: "Dispatch", where: "Remote", doneFlag: false }] });
      if (section === "notes") return json({ lines: [
        { author: "Support", kind: "discussion", date: "2026-10-01", text: "First reply" },
        { author: "Dispatch", kind: "internal", date: "2026-10-03", text: "Staff note" },
        { author: "Support", kind: "discussion", date: "2026-10-02", text: "Latest reply" },
      ] });
      return base(url, method, body);
    })(detail);
    await open();
    const pane = card()!.querySelector('[data-record-pane="right"]')!;
    expect(pane.textContent).toContain("Not scheduled · Remote");
    expect(pane.textContent).toContain("Open");
    expect(tabs().find(tab => tab.textContent === "Discussion2")?.getAttribute("aria-selected")).toBe("true");
    const bodies = () => [...card()!.querySelectorAll('[role="tabpanel"] li [data-record-markdown]')].map(p => p.textContent);
    expect(bodies()).toEqual(["Latest reply", "First reply"]);
    await act(async () => tabs().find(tab => tab.textContent === "All3")!.click());
    expect(bodies()).toEqual(["Staff note", "Latest reply", "First reply"]);
    await act(async () => tabs()[1]!.click());
    await settle();
    expect(pane.textContent).toContain("Dispatch");
  });

  it("downloads an attachment through the authenticated detail path", async () => {
    const { downloadBlob } = await import("@/lib/diagram-view");
    detail = (url) => url.searchParams.get("section") === "download" && url.searchParams.get("field") === "77"
      ? json({ name: "print-test.txt", base64: btoa("Print test"), contentType: "text/plain" })
      : url.searchParams.get("section") === "counts" ? json({ counts: { attachments: 1 }, fields: [] })
        : json({ lines: [{ name: "print-test.txt", size: "10 B", date: "Nov 18", id: "77" }], next: null });
    await open();
    await act(async () => tabs()[5]!.click());
    await settle();
    await act(async () => document.querySelector<HTMLButtonElement>("tbody button")!.click());
    await settle();
    expect(calls.some((call) => call.url.includes("section=download") && call.url.includes("field=77"))).toBe(true);
    expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), "print-test.txt");
  });

  it("offers a dropdown for every allowed field, an absent value included, and writes the choice", async () => {
    detail = ((base) => (url, method, body) => {
      if (method === "POST") return json({ updated: true });
      return base(url, method, body);
    })(detail);
    await open();
    const board = document.querySelector<HTMLElement>('[aria-label="Board"]');
    expect(board).not.toBeNull();
    expect(board!.textContent).toBe("Not set");
    await act(async () => board!.click());
    await settle();
    // both pages of choices are joined
    const options = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')];
    expect(options.map((option) => option.textContent)).toEqual(["Service desk", "Billing"]);
    const cardReadsBefore = calls.filter((call) => !call.url.includes("/detail")).length;
    await act(async () => {
      options[1]!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      options[1]!.click();
    });
    await settle();
    const write = calls.find((call) => call.method === "POST")!;
    expect(write.url).toContain("/api/me/records/nimbus_desk/ticket/481516/detail");
    expect(JSON.parse(write.body!)).toEqual({ field: "board", value: "5" });
    expect(document.querySelector('[aria-label="Board"]')!.textContent).toBe("Billing");
    // the card and the visible tab are read again, fresh
    expect(calls.filter((call) => !call.url.includes("/detail")).length).toBeGreaterThan(cardReadsBefore);
    expect(calls.some((call) => call.url.includes("/detail") && call.url.includes("section=notes") && call.url.includes("fresh=1"))).toBe(true);
  });

  it("keeps the value and says so when the write is refused", async () => {
    detail = ((base) => (url, method, body) => method === "POST" ? json({ state: "org_refused" }, 403) : base(url, method, body))(detail);
    await open();
    const board = document.querySelector<HTMLElement>('[aria-label="Board"]')!;
    await act(async () => board.click());
    await settle();
    await act(async () => document.body.querySelectorAll<HTMLElement>('[role="option"]')[0]!.click());
    await settle();
    expect(document.querySelector('[aria-label="Board"]')!.textContent).toBe("Not set");
    expect(card()!.querySelector('[role="alert"]')?.textContent).toBe("The change could not be saved.");
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
  });

  it("shows the original card, with no tab and no dropdown, when the server has no detail route", async () => {
    detail = () => json({ error: "no route" }, 404);
    await open();
    expect(card()!.textContent).toContain("481516");
    expect(tabs()).toHaveLength(0);
    expect(document.querySelector('[aria-label="Board"]')).toBeNull();
    expect(card()!.querySelector("[data-record-refresh]")).not.toBeNull();
  });

  // M-20261119-084: the console answered the Attachments tab 404 `record_unknown` (its documents read was
  // refused); the app read any 404 as "no detail route" and dropped every tab and field: the card came apart.
  it("keeps every tab and field when one section is refused, and says so in that tab only", async () => {
    detail = ((base) => (url, method, body) => url.searchParams.get("section") === "attachments"
      ? json({ state: "unavailable", code: "record_unknown" }, 404)
      : base(url, method, body))(detail);
    await open();
    const frame = card()!.querySelector<HTMLElement>("[data-record-card-body] > div")!;
    const height = frame.className;
    await act(async () => tabs()[5]!.click());
    await settle();
    expect(tabs().slice(0, 6).map((tab) => tab.textContent?.replace(/\d+$/, ""))).toEqual(["Notes", "Time", "Configurations", "Expenses", "Activities", "Attachments"]);
    expect(tabs()[5]!.getAttribute("aria-selected")).toBe("true");
    expect(card()!.querySelector('[role="tabpanel"]')!.textContent).toBe("The related records could not be loaded.");
    expect(document.querySelector('[aria-label="Board"]')).not.toBeNull();
    expect(card()!.querySelector<HTMLElement>("[data-record-card-body] > div")!.className).toBe(height);
    // another tab still reads
    await act(async () => tabs()[1]!.click());
    await settle();
    expect(document.querySelectorAll("tbody tr").length).toBeGreaterThan(0);
  });

  it("draws a note's Markdown, its images read as the person through the detail route, never from the product", async () => {
    const vendor = "https://desk.example.test/v4_6_release/api/inlineimages/acme";
    const shot = `${vendor}/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d`;
    const icon = `${vendor}/1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e`;
    const text = [
      `![\\[image\\]](${shot})`,
      "**Est-ce que ce courriel est légitime?** Merci \\(urgent\\)",
      "Ada Lindqvist | [418 555-0142](tel:4185550142)",
      `[![\\[image\\]](${icon})](https://social.example.test/acme)`,
    ].join("\n");
    detail = ((base) => (url, method, body) => {
      const section = url.searchParams.get("section");
      if (section === "notes") return json({ lines: [{ author: "Ada Lindqvist", kind: "discussion", date: "2026-11-19", text }] });
      if (section === "image") return json({ contentType: "image/png", base64: btoa("png bytes") });
      return base(url, method, body);
    })(detail);
    const created: Blob[] = [];
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: (blob: Blob) => { created.push(blob); return `blob:note-${created.length}`; }, revokeObjectURL: () => {} }));
    await open();
    await settle();
    const note = card()!.querySelector<HTMLElement>('[role="tabpanel"] [data-record-markdown]')!;
    expect(note.querySelector("strong")?.textContent).toBe("Est-ce que ce courriel est légitime?");
    expect(note.textContent).toContain("Merci (urgent)");
    expect(note.textContent).not.toMatch(/!\[|\*\*|\\\(|inlineimages/);
    const shown = note.querySelector<HTMLImageElement>('[data-record-note-image="shown"]')!;
    expect(shown.getAttribute("src")).toMatch(/^blob:note-/);
    expect(shown.getAttribute("alt")).toBe("Image");
    // the signature's icon stays small, its link kept
    const linked = note.querySelector<HTMLElement>('[data-record-note-image="linked"]')!;
    expect(linked.getAttribute("title")).toBe("https://social.example.test/acme");
    expect(linked.querySelector("img")!.className).toContain("h-4");
    // both images through the card's route, with their own address; the product is never called
    const images = detailCalls("image").map((call) => new URL(call.url, "http://x").searchParams.get("field"));
    expect(images.sort()).toEqual([icon, shot].sort());
    expect(calls.every((call) => !call.url.startsWith("https://desk.example.test"))).toBe(true);
    expect(created.every((blob) => blob.type === "image/png")).toBe(true);
  });

  it("keeps a note readable whatever its Markdown or HTML, and an image the console refuses is its words", async () => {
    const text = "<div><b>unclosed **bold [half link](\n\n![logo](https://cdn.example.test/logo.png) costs 50$ and 60$\n\n| a |\n|---";
    detail = ((base) => (url, method, body) => {
      const section = url.searchParams.get("section");
      if (section === "notes") return json({ lines: [{ author: "Support", kind: "discussion", date: "2026-11-19", text }] });
      if (section === "image") return json({ state: "unavailable", code: "detail_invalid" }, 400);
      return base(url, method, body);
    })(detail);
    await open();
    await settle();
    const note = card()!.querySelector<HTMLElement>('[role="tabpanel"] [data-record-markdown]')!;
    expect(note.textContent).toContain("unclosed");
    // a price is words, never a formula
    expect(note.textContent).toContain("costs 50$ and 60$");
    expect(note.querySelector('[data-record-note-image="missing"]')?.textContent).toBe("logo");
    expect(tabs()).not.toHaveLength(0);
    expect(calls.every((call) => !call.url.startsWith("https://cdn.example.test"))).toBe(true);
  });

  it("changes the title in place through the card's write path, Escape leaving it as it was", async () => {
    detail = ((base) => (url, method, body) => {
      if (method === "POST") return json({ updated: true });
      if (url.searchParams.get("section") === "counts") return json({ counts: { time: 3 }, fields: [...FIELDS, "summary"] });
      return base(url, method, body);
    })(detail);
    await open();
    const title = () => card()!.querySelector<HTMLElement>("[data-record-title]");
    const input = () => card()!.querySelector<HTMLTextAreaElement>("[data-record-title-input]");
    expect(title()).not.toBeNull();
    const before = title()!.textContent;
    // Escape leaves the field, the card stays open
    await act(async () => title()!.click());
    expect(input()).not.toBeNull();
    await act(async () => { input()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
    expect(input()).toBeNull();
    expect(card()).not.toBeNull();
    expect(title()!.textContent).toBe(before);
    // a text of several lines is never sent
    await act(async () => title()!.click());
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    await act(async () => { setValue.call(input()!, "   "); input()!.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { input()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
    expect(card()!.querySelector('[role="alert"]')?.textContent).toBe("The title is one line of 1 to 100 characters.");
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(0);
    await act(async () => { setValue.call(input()!, "  Printer replaced  "); input()!.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { input()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
    await settle();
    const writes = calls.filter((call) => call.method === "POST");
    expect(writes).toHaveLength(1);
    expect(writes[0]!.url).toContain("/api/me/records/nimbus_desk/ticket/481516/detail");
    expect(JSON.parse(writes[0]!.body!)).toEqual({ field: "summary", value: "Printer replaced" });
    expect(title()!.textContent).toBe("Printer replaced");
  });

  it("offers no title field when the console does not list the title as editable", async () => {
    await open();
    expect(card()!.querySelector("[data-record-title]")).toBeNull();
  });

  it("names the way back above the head and keeps the window's size from the ticket to its company", async () => {
    await open();
    const frame = () => card()!.querySelector<HTMLElement>("[data-record-card-body] > div")!;
    const height = frame().className;
    expect(height).toContain("h-[min(var(--record-card-h)");
    expect(card()!.querySelector("[data-record-trail]")).toBeNull();
    await act(async () => card()!.querySelector<HTMLElement>("[data-record-company-link]")!.click());
    await settle();
    const trail = card()!.querySelector<HTMLElement>("[data-record-trail]")!;
    expect([...trail.querySelectorAll("li")].map((item) => item.textContent)).toEqual(["Ticket #481516", "Acme Fabrication"]);
    expect(trail.querySelector('[aria-current="page"]')?.textContent).toBe("Acme Fabrication");
    expect(frame().className).toBe(height);
    await act(async () => trail.querySelector<HTMLElement>("[data-record-trail-step]")!.click());
    await settle();
    expect(card()!.querySelector("[data-record-trail]")).toBeNull();
    expect(card()!.textContent).toContain("481516");
    expect(frame().className).toBe(height);
  });

  it("opens the record on the web with plain words, never the product's name", async () => {
    await open();
    const action = card()!.querySelector<HTMLElement>("[data-record-open]")!;
    expect(action.textContent).toBe("Open on the web");
    expect(action.querySelector("svg")).toBeNull();
  });

  it("asks nothing of the detail route for a record that is not a ticket", async () => {
    await open("sagax://record/nimbus_desk/company/7310", "Acme");
    expect(card()).not.toBeNull();
    expect(calls.some((call) => call.url.includes("/detail"))).toBe(false);
  });
});
