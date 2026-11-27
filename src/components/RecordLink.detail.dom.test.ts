// @vitest-environment happy-dom
// A ticket chip's card, entered the normal way (click the chip in a message),
// becomes the ticket window (M-20261127-101) through the record's detail
// route: the fields column at the left in every tab, the tabs over the right
// side, each tab's reads and writes; a server without that route leaves the
// original card.
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
const windowTabs = () => [...document.querySelectorAll<HTMLElement>("[data-record-tab]")];
const tab = (name: string) => document.querySelector<HTMLElement>(`[data-record-tab="${name}"]`)!;
const writes = () => calls.filter((call) => call.method === "POST").map((call) => JSON.parse(call.body!));
const setValue = (node: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) => {
  const proto = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(node, value);
  node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
};
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

describe("the ticket window through its chip", () => {
  it("shows its tabs in their order with their counts, follows every page and reads a tab once", async () => {
    await open();
    // a console that lists no actions takes what it takes: every tab is offered, a count it does not send is no number
    expect(windowTabs().map((one) => one.textContent)).toEqual(["Notes0", "Schedule0", "Time & expenses3", "Configurations", "Attachments1"]);
    expect(tab("notes").getAttribute("aria-selected")).toBe("true");
    // no Overview tab, no "Mark done" in the head, no "Customer notified"
    expect(card()!.textContent).not.toMatch(/Overview|Customer notified/);
    expect(card()!.querySelector("[data-record-window-head]")!.textContent).not.toContain("Mark done");
    await act(async () => tab("time").click());
    await settle();
    expect(detailCalls("time").map((call) => new URL(call.url, "http://x").searchParams.get("page"))).toEqual(["1", "2"]);
    expect(document.querySelectorAll("[data-record-entry]")).toHaveLength(3);
    await act(async () => tab("attachments").click());
    await settle();
    await act(async () => tab("time").click());
    await settle();
    expect(detailCalls("time")).toHaveLength(2);
  });

  it("hides an empty tab where nothing can be added, and shows it where something can (M-20261127-143)", async () => {
    detail = ((base) => (url, method, body) => url.searchParams.get("section") === "counts"
      ? json({ counts: { time: 0, configurations: 0, attachments: 0 }, fields: FIELDS, actions: ["note.add", "configuration.add"] })
      : base(url, method, body))(detail);
    await open();
    expect(windowTabs().map((one) => one.dataset.recordTab)).toEqual(["notes", "configurations"]);
  });

  it("keeps the fields column beside every tab, the tabs over the right side only (M-20261127-105, M-20261127-106)", async () => {
    await open();
    for (const name of ["notes", "plan", "time", "attachments"]) {
      if (!document.querySelector(`[data-record-tab="${name}"]`)) continue;
      await act(async () => tab(name).click());
      await settle();
      const left = card()!.querySelector('[data-record-side="left"]')!;
      expect(left.querySelector("[data-record-ticket-side]"), name).not.toBeNull();
      expect(left.querySelector("[data-record-tabs]"), name).toBeNull();
      expect(card()!.querySelector('[data-record-side-head] [data-record-tabs]'), name).not.toBeNull();
    }
    // version A: the company card on top, then the named fields, Type > Subtype > Item on one line
    const side = card()!.querySelector("[data-record-ticket-side]")!;
    expect(side.querySelector("[data-record-company-card]")!.textContent).toContain("Acme Fabrication");
    expect(side.querySelector("[data-record-company-card]")!.textContent).toContain("418 555-0142");
    const labels = [...side.querySelectorAll("[data-record-facts] dt")].map((one) => one.textContent);
    expect(labels.slice(0, 6)).toEqual(["Owner", "Team", "Board", "Type", "Time", "Agreement"]);
    expect(side.querySelector("[data-record-type-line]")!.querySelectorAll('[aria-label="Type"], [aria-label="Subtype"], [aria-label="Item"]')).toHaveLength(3);
    expect(side.querySelector("[data-record-dates]")!.textContent).toMatch(/Opened/);
  });

  it("filters the notes by kind with their counts, all of them first, newest first, and writes a new one only from its zone", async () => {
    detail = ((base) => (url, method, body) => {
      if (method === "POST") return json({ updated: true });
      if (url.searchParams.get("section") === "notes") return json({ lines: [
        { id: "1", author: "Support", kind: "discussion", timestamp: "2026-10-01T10:00:00Z", text: "First reply" },
        { id: "2", author: "Dispatch", kind: "internal", timestamp: "2026-10-03T10:00:00Z", text: "Staff note" },
        { id: "3", author: "Support", kind: "discussion", timestamp: "2026-10-02T10:00:00Z", text: "Latest reply" },
      ] });
      return base(url, method, body);
    })(detail);
    await open();
    const filters = () => [...card()!.querySelectorAll<HTMLElement>("[data-record-note-filters] [role=tab]")];
    expect(filters().map((one) => one.textContent)).toEqual(["Discussion2", "Internal1", "Resolution0", "All3"]);
    expect(filters()[3]!.getAttribute("aria-selected")).toBe("true");
    const bodies = () => [...card()!.querySelectorAll("[data-record-note] [data-record-markdown]")].map((one) => one.textContent);
    expect(bodies()).toEqual(["Staff note", "Latest reply", "First reply"]);
    await act(async () => filters()[0]!.click());
    expect(bodies()).toEqual(["Latest reply", "First reply"]);
    // the zone opens on the click only, on the row of the filters
    expect(card()!.querySelector("[data-record-composer]")).toBeNull();
    expect(card()!.querySelector("[data-record-note-filters]")!.parentElement!.querySelector("[data-record-note-new]")).not.toBeNull();
    await act(async () => card()!.querySelector<HTMLElement>("[data-record-note-new]")!.click());
    const zone = card()!.querySelector<HTMLFormElement>("[data-record-composer]")!;
    await act(async () => setValue(zone.querySelector("select")!, "internal"));
    await act(async () => setValue(zone.querySelector("textarea")!, "  Roller replaced  "));
    await act(async () => zone.querySelector<HTMLElement>("[data-record-composer-send]")!.click());
    await settle();
    expect(writes()).toEqual([{ action: "note.add", set: { kind: "internal", text: "  Roller replaced  " } }]);
    // the notes are read again, fresh
    expect(detailCalls("notes").some((call) => call.url.includes("fresh=1"))).toBe(true);
    expect(card()!.querySelector("[data-record-composer]")).toBeNull();
    // an existing note is removed at its right, asked once in place
    await act(async () => card()!.querySelector<HTMLElement>("[data-record-note] [data-record-remove]")!.click());
    await act(async () => card()!.querySelector<HTMLElement>("[data-record-row-confirm] button")!.click());
    await settle();
    expect(writes().at(-1)).toEqual({ action: "note.remove", id: "3" });
  });

  it("plans meetings, resources and activities together: open first, newest first, the done ones on demand, each marked done in place", async () => {
    detail = ((base) => (url, method, body) => {
      const section = url.searchParams.get("section");
      if (method === "POST") return json({ updated: true });
      if (section === "schedule") return json({ lines: [
        { id: "10", kind: "resource", member: "Noor Haddad", startTimestamp: "2026-11-26T21:30:00Z", endTimestamp: "2026-11-26T22:00:00Z", where: "Remote", doneFlag: false },
        { id: "11", kind: "meeting", member: "Bruno Tremblay", startTimestamp: "2026-12-14T19:30:00Z", endTimestamp: "2026-12-14T20:30:00Z", where: "Remote", doneFlag: false },
        { id: "12", kind: "resource", member: "Noor Haddad", startTimestamp: "2026-10-22T13:00:00Z", endTimestamp: "2026-10-22T13:20:00Z", where: "Remote", doneFlag: true },
      ] });
      if (section === "activities") return json({ lines: [{ id: "20", subject: "Call the customer back", type: "Task", date: "Dec 2", dateStart: "2026-12-02T14:00:00Z", assigned: "Noor Haddad", done: false }] });
      return base(url, method, body);
    })(detail);
    await open();
    expect(tab("plan").textContent).toBe("Schedule3");
    await act(async () => tab("plan").click());
    await settle();
    const rows = () => [...card()!.querySelectorAll<HTMLElement>("[data-plan-row]")];
    expect(rows().map((row) => row.dataset.planRow)).toEqual(["meeting", "activity", "resource"]);
    expect(rows().map((row) => row.querySelector("[data-schedule-kind]")!.textContent)).toEqual(["Meeting", "Activity", "Resource"]);
    // no Team and Location row: the fields column has them
    expect(card()!.querySelector("[data-record-plan]")!.textContent).not.toMatch(/Team/);
    await act(async () => card()!.querySelector<HTMLElement>("[data-record-show-done]")!.click());
    expect(rows()).toHaveLength(4);
    expect(rows()[3]!.hasAttribute("data-plan-done")).toBe(true);
    await act(async () => rows()[1]!.querySelector<HTMLElement>('[data-record-mark-done="done"]')!.click());
    await settle();
    expect(writes()).toEqual([{ action: "schedule.done", id: "20", set: { kind: "activity", done: true } }]);
    // the + opens Meeting, Resource, Activity, at the right of the block
    await act(async () => card()!.querySelector<HTMLElement>("[data-record-plan] [data-record-add]")!.click());
    expect([...card()!.querySelectorAll("[data-record-add-choice]")].map((one) => one.textContent)).toEqual(["Meeting", "Resource", "Activity"]);
    // no "Assign me"
    expect(card()!.textContent).not.toContain("Assign me");
  });

  it("lists time and expenses by day with their totals and billing, the billing changed in place (M-20261127-138)", async () => {
    detail = ((base) => (url, method, body) => {
      const section = url.searchParams.get("section");
      if (method === "POST") return json({ updated: true });
      if (section === "time") return json({ totalHours: "1.5 h", lines: [
        { id: "81", start: "2026-11-26T21:10:00Z", member: "Noor Haddad", hours: "0.5 h", hours_value: 0.5, work_type: "Management", billing: "B", note: "Invitation sent" },
        { id: "82", start: "2026-11-23T20:05:00Z", member: "Noor Haddad", hours: "1 h", hours_value: 1, work_type: "Meeting", billing: "NC", note: "Follow-up" },
      ], next: null });
      if (section === "expenses") return json({ lines: [{ id: "91", start: "2026-11-26T17:00:00Z", member: "Noor Haddad", type: "Mileage", amount: "$86.40", amount_value: 86.4, billing: "B", note: "Round trip" }] });
      return base(url, method, body);
    })(detail);
    await open();
    await act(async () => tab("time").click());
    await settle();
    const totals = card()!.querySelector("[data-record-time-totals]")!;
    expect(totals.querySelector("[data-record-total-hours]")!.textContent).toBe("1.50 h");
    expect(totals.textContent).toContain("of which 0.50 h billable");
    expect(totals.querySelector("[data-record-total-expenses]")!.textContent).toMatch(/86\.40/);
    expect(totals.textContent).toMatch(/Billable · 0\.50 h.*No charge · 1\.00 h.*Do not bill · 0\.00 h/);
    const days = [...card()!.querySelectorAll<HTMLElement>("[data-record-day]")];
    expect(days.map((day) => day.querySelectorAll("[data-record-entry]").length)).toEqual([2, 1]);
    expect(days[0]!.textContent).toContain("Invitation sent");
    expect(days[0]!.textContent).toContain("Management");
    await act(async () => days[0]!.querySelector<HTMLElement>('[data-record-entry="time"] [data-billing]')!.click());
    await act(async () => card()!.querySelector<HTMLElement>('[data-billing-choice="DNB"]')!.click());
    await settle();
    expect(writes()).toEqual([{ action: "time.update", id: "81", set: { billing: "DNB" } }]);
    // + Time opens its form only on the click
    expect(card()!.querySelector("[data-record-time-form]")).toBeNull();
    await act(async () => card()!.querySelector<HTMLElement>("[data-record-add-time]")!.click());
    expect(card()!.querySelector('[data-record-time-form="time"]')).not.toBeNull();
  });

  it("says in words that the console does not take a write yet, and keeps the zone open", async () => {
    detail = ((base) => (url, method, body) => method === "POST" ? json({ state: "unavailable", code: "action_unknown" }, 400) : base(url, method, body))(detail);
    await open();
    await act(async () => card()!.querySelector<HTMLElement>("[data-record-note-new]")!.click());
    const zone = card()!.querySelector<HTMLFormElement>("[data-record-composer]")!;
    await act(async () => setValue(zone.querySelector("textarea")!, "Hello"));
    await act(async () => zone.querySelector<HTMLElement>("[data-record-composer-send]")!.click());
    await settle();
    expect(zone.querySelector('[role="alert"]')!.textContent).toBe("Your console does not take this change yet.");
    expect(card()!.querySelector("[data-record-composer]")).not.toBeNull();
  });

  it("downloads an attachment through the authenticated detail path", async () => {
    const { downloadBlob } = await import("@/lib/diagram-view");
    detail = (url) => url.searchParams.get("section") === "download" && url.searchParams.get("field") === "77"
      ? json({ name: "print-test.txt", base64: btoa("Print test"), contentType: "text/plain" })
      : url.searchParams.get("section") === "counts" ? json({ counts: { attachments: 1 }, fields: [] })
        : json({ lines: url.searchParams.get("section") === "attachments" ? [{ name: "print-test.txt", size: "10 B", date: "Nov 18", id: "77" }] : [], next: null });
    await open();
    await act(async () => tab("attachments").click());
    await settle();
    await act(async () => document.querySelector<HTMLButtonElement>("[data-record-attachment]")!.click());
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
    // the card is read again
    expect(calls.filter((call) => !call.url.includes("/detail")).length).toBeGreaterThan(cardReadsBefore);
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

  // M-20261119-084: a section the console refused never takes the window's tabs and fields away
  it("keeps every tab and field when one section is refused, and says so in that tab only", async () => {
    detail = ((base) => (url, method, body) => url.searchParams.get("section") === "attachments"
      ? json({ state: "unavailable", code: "record_unknown" }, 404)
      : base(url, method, body))(detail);
    await open();
    await act(async () => tab("attachments").click());
    await settle();
    expect(windowTabs().map((one) => one.dataset.recordTab)).toEqual(["notes", "plan", "time", "configurations", "attachments"]);
    expect(tab("attachments").getAttribute("aria-selected")).toBe("true");
    expect(card()!.querySelector('[data-record-tab-panel="attachments"]')!.textContent).toBe("The related records could not be loaded.");
    expect(document.querySelector('[aria-label="Board"]')).not.toBeNull();
    await act(async () => tab("time").click());
    await settle();
    expect(document.querySelectorAll("[data-record-entry]").length).toBeGreaterThan(0);
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
    const note = card()!.querySelector<HTMLElement>("[data-record-note] [data-record-markdown]")!;
    expect(note.querySelector("strong")?.textContent).toBe("Est-ce que ce courriel est légitime?");
    expect(note.textContent).toContain("Merci (urgent)");
    expect(note.textContent).not.toMatch(/!\[|\*\*|\\\(|inlineimages/);
    const shown = note.querySelector<HTMLImageElement>('[data-record-note-image="shown"]')!;
    expect(shown.getAttribute("src")).toMatch(/^blob:note-/);
    const linked = note.querySelector<HTMLElement>('[data-record-note-image="linked"]')!;
    expect(linked.getAttribute("title")).toBe("https://social.example.test/acme");
    const images = detailCalls("image").map((call) => new URL(call.url, "http://x").searchParams.get("field"));
    expect(images.sort()).toEqual([icon, shot].sort());
    expect(calls.every((call) => !call.url.startsWith("https://desk.example.test"))).toBe(true);
    expect(created.every((blob) => blob.type === "image/png")).toBe(true);
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
    const before = title()!.textContent;
    await act(async () => title()!.click());
    await act(async () => { input()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
    expect(input()).toBeNull();
    expect(card()).not.toBeNull();
    expect(title()!.textContent).toBe(before);
    await act(async () => title()!.click());
    await act(async () => setValue(input()!, "  Printer replaced  "));
    await act(async () => { input()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
    await settle();
    expect(writes()).toEqual([{ field: "summary", value: "Printer replaced" }]);
    expect(title()!.textContent).toBe("Printer replaced");
  });

  it("offers no title field when the console does not list the title as editable", async () => {
    await open();
    expect(card()!.querySelector("[data-record-title]")).toBeNull();
  });

  it("opens the company in the same window with the way back named above the head", async () => {
    await open();
    expect(card()!.querySelector("[data-record-trail]")).toBeNull();
    await act(async () => card()!.querySelector<HTMLElement>("[data-record-company-card] [data-record-company-link]")!.click());
    await settle();
    const trail = card()!.querySelector<HTMLElement>("[data-record-trail]")!;
    expect([...trail.querySelectorAll("li")].map((item) => item.textContent)).toEqual(["Ticket #481516", "Acme Fabrication"]);
    expect(card()!.querySelector("[data-record-window]")!.getAttribute("data-record-window")).toBe("nimbus_desk/company");
    await act(async () => trail.querySelector<HTMLElement>("[data-record-trail-step]")!.click());
    await settle();
    expect(card()!.querySelector("[data-record-trail]")).toBeNull();
    expect(card()!.querySelector("[data-record-ticket-side]")).not.toBeNull();
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
