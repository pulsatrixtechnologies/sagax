// @vitest-environment happy-dom
// A company's and a contact's window (M-20261127-101, M-20261127-140),
// entered the normal way (a chip in a message): the Profile, the tabs with
// their counts, a tab with nothing that takes nothing hidden (M-20261127-143),
// a contact opened in the same window with the way back, the writes of each
// tab only after their + (M-20261127-110), and a console with no section for
// the kind drawn from the card alone.
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openExternalLink } from "@/lib/app-links";
import { setLocale } from "@/lib/i18n";
import { answer, nimbusProduct, ticketCard } from "@/lib/record-card-fixtures";
import { ACME_ID, accountCompanyCard, accountConsole, accountContactCard } from "@/lib/record-account-fixtures";
import { resetPersonProducts, seedPersonProducts } from "@/lib/person-products";
import { resetRecordCards } from "@/lib/record-cards";
import { ChatMarkdown } from "@/components/ChatMarkdown";

vi.mock("@/lib/app-links", async (original) => ({ ...(await original<typeof import("@/lib/app-links")>()), openExternalLink: vi.fn(async () => {}) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = Date.parse("2026-11-27T13:50:00-05:00");
const COMPANY = `sagax://record/nimbus_desk/company/${ACME_ID}`;
let host: HTMLDivElement;
let root: Root;
let calls: Array<{ url: string; method: string; body?: string }>;
let console_: ReturnType<typeof accountConsole>;
/** a console with no section for a company or a contact (before it serves them) */
let noSections = false;
let counts: ((kind: string) => Record<string, unknown>) | undefined;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const win = () => document.querySelector<HTMLElement>("[data-record-window]")!;
const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await vi.advanceTimersByTimeAsync(20); }); };
const tabNames = () => [...document.querySelectorAll<HTMLElement>("[data-record-window-tabs] [data-record-tab]")].map((tab) => tab.textContent);
const tab = async (name: string) => { await act(async () => document.querySelector<HTMLElement>(`[data-record-window-tabs] [data-record-tab="${name}"]`)!.click()); await settle(); };
const writes = () => calls.filter((call) => call.method === "POST").map((call) => JSON.parse(call.body!));
const setValue = (node: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const proto = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(node, value);
  node.dispatchEvent(new Event("input", { bubbles: true }));
};

async function open(link = COMPANY, label = "Acme Fabrication") {
  await act(async () => root.render(createElement(ChatMarkdown, { text: `[${label}](${link})`, botId: "bot-1", draftId: "bot:bot-1:t-1", message: { threadId: "t-1", messageId: "m-1" } })));
  await act(async () => { host.querySelector<HTMLElement>("[data-record-link]")!.click(); });
  await settle();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(NOW);
  setLocale("en");
  document.documentElement.dataset.reducedMotion = "true";
  resetRecordCards();
  resetPersonProducts();
  seedPersonProducts([nimbusProduct()]);
  calls = [];
  noSections = false;
  counts = undefined;
  console_ = accountConsole("en", NOW);
  vi.mocked(openExternalLink).mockClear();
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(String(input), "http://console.test");
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : undefined;
    calls.push({ url: String(input), method, body });
    const kind = /\/records\/nimbus_desk\/(\w+)\//.exec(url.pathname)?.[1] ?? "";
    if (url.pathname.endsWith("/detail")) {
      if (kind !== "company" && kind !== "contact") return json({ lines: [], next: null });
      if (noSections) return json({ state: "unavailable", code: "kind_unknown" }, 404);
      if (method === "POST") { console_.take(kind, JSON.parse(body!)); return json({ updated: true }); }
      const section = url.searchParams.get("section");
      if (section === "counts") return json(counts?.(kind) ?? console_.counts(kind));
      if (section === "choices") return json({ choices: console_.choices[url.searchParams.get("field") ?? ""] ?? [], next: null });
      return json({ ...console_.section(kind, section ?? ""), next: null });
    }
    if (kind === "company") return json(answer(accountCompanyCard(NOW, "en")));
    if (kind === "contact") return json(answer(accountContactCard(NOW, "en")));
    return json(answer(ticketCard(NOW, "en")));
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

describe("a company's window", () => {
  it("opens on its Profile with every tab and its count, the head's context and its four figures", async () => {
    await open();
    expect(win().getAttribute("data-record-window")).toBe("nimbus_desk/company");
    expect(tabNames()).toEqual(["Profile", "Notes4", "Contacts5", "Tickets5", "Activities4", "Projects3", "Opportunities2", "Agreements1", "Configurations6", "Attachments4", "Sites2", "Finance", "Data"]);
    const profile = win().querySelector<HTMLElement>("[data-record-profile=company]")!;
    expect(profile.querySelector("[data-record-hero-context]")!.textContent).toBe("Managed customer · Capitale-Nationale · budget of $1,500 a month · customer since March 2019");
    expect([...profile.querySelectorAll("[data-record-tile]")].map((tile) => tile.querySelector("span")!.textContent)).toEqual(["Open tickets", "Balance due", "2026 block of hours", "Managed fleet"]);
    expect(profile.querySelectorAll("[data-record-upcoming-item]")).toHaveLength(3);
    expect([...profile.querySelectorAll("[data-record-feed]")].map((row) => row.getAttribute("data-record-feed"))).toEqual(["note", "ticket", "ticket", "attachment", "invoice"]);
    expect([...profile.querySelectorAll("[data-record-key-contact]")].map((row) => row.textContent)).toEqual([
      "ALAda LindqvistOperations director · 418 555-0142Main", "LMLina MoreauController · 418 555-0144Approver", "OBOmar BelkacemForeman · 418 555-0143Technical",
    ]);
    // no "Overview", no fields column: the Profile is one column that scrolls under the tabs
    expect(win().querySelector("[data-record-ticket-side]")).toBeNull();
    expect(win().querySelector("[data-record-window-tabs] [data-record-tabs]")).not.toBeNull();
  });

  it("calls, writes and opens the site and LinkedIn from the head's round buttons", async () => {
    await open();
    const quick = (name: string) => win().querySelector<HTMLElement>(`[data-record-quick="${name}"]`)!;
    expect(quick("call").getAttribute("aria-label")).toBe("Call 418 555-0100");
    expect(quick("write").getAttribute("aria-label")).toBe("Write to Ada Lindqvist");
    for (const name of ["call", "write", "web", "linkedin"]) await act(async () => quick(name).click());
    expect(vi.mocked(openExternalLink).mock.calls.map(([url]) => url)).toEqual(["tel:4185550100", "mailto:ada@acme.example", "https://acme.example/", "https://linkedin.example/company/acme"]);
  });

  it("opens a figure's tab: the tickets in the board's grid, the next entry with who in its tooltip", async () => {
    await open();
    await act(async () => win().querySelector<HTMLElement>('[data-record-tile="tickets"]')!.click());
    await settle();
    expect(win().querySelector("[data-record-account-tab]")!.getAttribute("data-record-account-tab")).toBe("tickets");
    const heads = [...win().querySelectorAll("[data-record-grid=tickets] th")].map((head) => head.textContent);
    expect(heads).toEqual(["Priority", "Ticket", "Subject", "Status", "Type", "Next scheduled", "Owner", "Updated"]);
    expect(win().querySelectorAll("[data-ticket-row]")).toHaveLength(5);
    const next = win().querySelector<HTMLElement>('[data-ticket-row="#300124"] [data-ticket-next]')!;
    expect(next.getAttribute("title")).toBe("With Noor Haddad, Bruno Tremblay");
    expect(next.textContent).toContain("+1");
    expect(win().querySelector('[data-ticket-row="#299412"]')!.textContent).toContain("Closed");
  });

  it("hides a tab with nothing in it where nothing can be added, and keeps one the person can add to", async () => {
    counts = (kind) => ({ ...console_.counts(kind), counts: { ...(console_.counts(kind).counts as object), projects: 0, notes: 0 } });
    await open();
    expect(tabNames()).not.toContain("Projects0");
    expect(tabNames()).toContain("Notes0");
  });

  it("opens a key contact in the same window, with the way back, its tab kept for each record", async () => {
    await open();
    await tab("activities");
    await tab("sheet");
    await act(async () => win().querySelector<HTMLElement>("[data-record-key-contacts] [data-record-ref-link]")!.click());
    await settle();
    expect(win().getAttribute("data-record-window")).toBe("nimbus_desk/contact");
    expect([...win().querySelectorAll("[data-record-trail] li")].map((item) => item.textContent)).toEqual(["Acme Fabrication", "Ada Lindqvist"]);
    expect(tabNames()).toEqual(["Contact", "Tickets2", "Activities2", "Configurations1", "Attachments1", "Notes1", "History3"]);
    const profile = win().querySelector<HTMLElement>("[data-record-profile=contact]")!;
    expect(profile.querySelector("[data-record-hero-title]")!.textContent).toBe("Operations director at Acme Fabrication");
    expect([...profile.querySelectorAll("[data-record-roles] span")].map((role) => role.textContent)).toEqual(["Main", "Billing", "Decision maker"]);
    expect(profile.querySelector("[data-record-prefs]")!.textContent).toContain("French");
    await tab("history");
    expect(win().querySelectorAll("[data-record-tab-panel=history] li")).toHaveLength(3);
    await act(async () => win().querySelector<HTMLElement>("[aria-label=Back]")!.click());
    await settle();
    expect(win().getAttribute("data-record-window")).toBe("nimbus_desk/company");
    expect(win().querySelector("[data-record-account-tab]")!.getAttribute("data-record-account-tab")).toBe("sheet");
  });

  it("lists what comes then what is done, marks an activity done, and adds one only after its +", async () => {
    await open();
    await tab("activities");
    expect([...win().querySelectorAll("[data-record-activity]")].map((row) => row.getAttribute("data-record-activity"))).toEqual(["open", "open", "open", "done"]);
    expect(win().querySelector("[data-plan-form]")).toBeNull();
    await act(async () => win().querySelector<HTMLElement>('[data-record-activity="open"] [data-record-mark-done="done"]')!.click());
    await settle();
    expect(writes().at(-1)).toEqual({ action: "schedule.done", id: "601", set: { kind: "activity", done: true } });
    expect([...win().querySelectorAll("[data-record-activity]")].map((row) => row.getAttribute("data-record-activity"))).toEqual(["open", "open", "done", "done"]);
    await act(async () => win().querySelector<HTMLElement>("[data-record-add-entry=activity]")!.click());
    await settle();
    const form = win().querySelector<HTMLElement>("[data-record-plan-form=activity]")!;
    setValue(form.querySelector("input[type=text]")!, "Call the controller");
    await act(async () => form.querySelector<HTMLElement>("[data-record-form-submit]")!.click());
    await settle();
    expect(writes().at(-1)).toMatchObject({ action: "schedule.add", set: { kind: "activity", subject: "Call the controller" } });
  });

  it("adds a contact from its form and changes only what the person changed", async () => {
    await open();
    await tab("contacts");
    expect(win().querySelectorAll("[data-record-tab-panel=contacts] li")).toHaveLength(5);
    expect(win().querySelector("[data-record-contact-form]")).toBeNull();
    await act(async () => win().querySelector<HTMLElement>("[data-record-add-entry=contact]")!.click());
    const form = () => win().querySelector<HTMLElement>("[data-record-contact-form]")!;
    const inputs = () => [...form().querySelectorAll<HTMLInputElement>("input")];
    setValue(inputs()[0]!, "Mira");
    setValue(inputs()[1]!, "Novak");
    setValue(inputs()[4]!, "mira@acme.example");
    await act(async () => form().querySelector<HTMLElement>("[data-record-form-submit]")!.click());
    await settle();
    expect(writes().at(-1)).toEqual({ action: "contact.add", set: { first_name: "Mira", last_name: "Novak", email: "mira@acme.example" } });
    expect(win().querySelectorAll("[data-record-tab-panel=contacts] li")).toHaveLength(6);
    await act(async () => win().querySelector<HTMLElement>("[data-record-tab-panel=contacts] li [data-record-edit]")!.click());
    setValue(inputs()[3]!, "418 555-0199");
    await act(async () => form().querySelector<HTMLElement>("[data-record-form-submit]")!.click());
    await settle();
    expect(writes().at(-1)).toEqual({ action: "contact.update", id: "2204", set: { phone: "418 555-0199" } });
  });

  it("writes a company's note with its words only, no ticket kind", async () => {
    await open();
    await tab("notes");
    await act(async () => win().querySelector<HTMLElement>("[data-record-add-entry=note]")!.click());
    const form = win().querySelector<HTMLElement>("[data-record-note-form]")!;
    setValue(form.querySelector("textarea")!, "Renewal talk in January.");
    await act(async () => form.querySelector<HTMLElement>("[data-record-form-submit]")!.click());
    await settle();
    expect(writes().at(-1)).toEqual({ action: "note.add", set: { text: "Renewal talk in January." } });
    expect(win().querySelector("[data-record-tab-panel=notes]")!.textContent).toContain("Renewal talk in January.");
  });

  it("draws its fleet by type, its agreement's block of hours, its finance and its data", async () => {
    await open();
    await tab("configurations");
    expect([...win().querySelectorAll("[data-record-configuration-group]")].map((group) => group.getAttribute("data-record-configuration-group"))).toEqual(["Servers", "Firewalls", "Workstations", "Printers"]);
    // a company's fleet is the product's: nothing to link or unlink here
    expect(win().querySelector("[data-record-add-entry=configuration]")).toBeNull();
    await tab("agreements");
    expect(win().querySelector("[data-record-ring]")!.getAttribute("aria-label")).toBe("31 h of 50 h");
    expect(win().querySelectorAll("[data-record-agreement] [data-record-chart=columns] li")).toHaveLength(6);
    await tab("finance");
    expect(win().querySelectorAll("[data-record-tab-panel=finance] [data-record-tile]")).toHaveLength(4);
    expect(win().querySelector("[data-record-invoices]")!.textContent).toContain("27 d late");
    await tab("data");
    expect([...win().querySelectorAll("[data-record-stat]")].map((pod) => pod.getAttribute("data-record-stat"))).toEqual(["hours", "types", "resolution", "billable"]);
    expect(win().querySelector('[data-record-stat="billable"]')!.textContent).toContain("Billable 78 %");
  });
});

describe("a console with no sections for a company yet", () => {
  it("draws the Profile and the open tickets from the card alone, nothing invented", async () => {
    noSections = true;
    await open();
    expect(tabNames()).toEqual(["Profile", "Tickets3"]);
    const profile = win().querySelector<HTMLElement>("[data-record-profile=company]")!;
    expect(profile.querySelector("[data-record-hero-context]")).toBeNull();
    expect(profile.querySelectorAll("[data-record-tile]")).toHaveLength(1);
    expect(profile.querySelector("[data-record-upcoming]")).toBeNull();
    // the main contact is a key contact; the account manager is a fact
    expect([...profile.querySelectorAll("[data-record-key-contact]")].map((row) => row.textContent)).toEqual(["ALAda LindqvistMain contact"]);
    expect(profile.querySelector("[data-record-facts-pod]")!.textContent).toContain("Account manager");
    expect(profile.querySelector("[data-record-facts-pod]")!.textContent).toContain("Identifier");
    expect(profile.querySelectorAll("[data-record-quick]")).toHaveLength(1);
    await tab("tickets");
    expect([...win().querySelectorAll("[data-record-grid=tickets] th")].map((head) => head.textContent)).toEqual(["Ticket", "Subject", "Status"]);
    expect(win().querySelectorAll("[data-ticket-row]")).toHaveLength(3);
    expect(writes()).toEqual([]);
  });
});
