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
    expect(tabs().map((tab) => tab.textContent)).toEqual(["Time3", "Configurations", "Expenses", "Activities", "Attachments1"]);
    expect(detailCalls("time").map((call) => new URL(call.url, "http://x").searchParams.get("page"))).toEqual(["1", "2"]);
    expect(document.querySelectorAll("tbody tr")).toHaveLength(3);
    expect(card()!.textContent).toContain("Total: 3 h");
    // a tab read once is not read again on return
    await act(async () => tabs()[4]!.click());
    await settle();
    await act(async () => tabs()[0]!.click());
    await settle();
    expect(detailCalls("time")).toHaveLength(2);
  });

  it("downloads an attachment through the authenticated detail path", async () => {
    const { downloadBlob } = await import("@/lib/diagram-view");
    detail = (url) => url.searchParams.get("section") === "download" && url.searchParams.get("field") === "77"
      ? json({ name: "print-test.txt", base64: btoa("Print test"), contentType: "text/plain" })
      : url.searchParams.get("section") === "counts" ? json({ counts: { attachments: 1 }, fields: [] })
        : json({ lines: [{ name: "print-test.txt", size: "10 B", date: "Nov 18", id: "77" }], next: null });
    await open();
    await act(async () => tabs()[4]!.click());
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
    expect(calls.some((call) => call.url.includes("/detail") && call.url.includes("section=time") && call.url.includes("fresh=1"))).toBe(true);
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

  it("asks nothing of the detail route for a record that is not a ticket", async () => {
    await open("sagax://record/nimbus_desk/company/7310", "Acme");
    expect(card()).not.toBeNull();
    expect(calls.some((call) => call.url.includes("/detail"))).toBe(false);
  });
});
