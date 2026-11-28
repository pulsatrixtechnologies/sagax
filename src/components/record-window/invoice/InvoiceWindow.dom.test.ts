// @vitest-environment happy-dom
// The invoice window (M-20261127-101, M-20261127-140): the invoice as a
// document (number, dates, billed to, the records it comes from, its lines,
// subtotal, each tax, total, paid), beside it the balance due and how late it
// is, Send a reminder, Record a payment and PDF, the timeline and the
// company's summary; the Payments and History tabs. A console that serves no
// detail for invoices leaves the card's facts in the same layout, nothing
// made up. The stand-in console is src/lib/record-board-invoice-fixtures.ts.
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadBlob } from "@/lib/diagram-view";
import { setLocale } from "@/lib/i18n";
import { answer, nimbusProduct } from "@/lib/record-card-fixtures";
import { boardInvoiceConsole } from "@/lib/record-board-invoice-fixtures";
import { resetPersonProducts, seedPersonProducts } from "@/lib/person-products";
import { resetRecordCards } from "@/lib/record-cards";
import { parseRecordCard } from "../../../../shared/record-cards";
import { ChatMarkdown } from "../../ChatMarkdown";
import { RecordCard } from "../../RecordCard";
import { invoiceWindow } from "./InvoiceWindow";

vi.mock("@/lib/diagram-view", async (original) => ({ ...(await original<typeof import("@/lib/diagram-view")>()), downloadBlob: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = Date.parse("2026-11-27T13:50:00-05:00");
let host: HTMLDivElement;
let root: Root;
let calls: Array<{ url: string; method: string; body?: string }>;
let scene = "invoice";
/** the counts answer waits for this */
let countsGate: Promise<void> | null = null;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await vi.advanceTimersByTimeAsync(20); }); };
const q = (selector: string) => document.querySelector<HTMLElement>(selector);
const all = (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)];
const click = async (node: HTMLElement | null) => { await act(async () => { node!.click(); }); await settle(); };
const setValue = (node: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(node, value);
  node.dispatchEvent(new Event("input", { bubbles: true }));
};

async function open() {
  await act(async () => root.render(createElement(ChatMarkdown, { text: "[F-10391](sagax://record/nimbus_desk/invoice/10391)", botId: "bot-1", draftId: "bot:bot-1:t-1", message: { threadId: "t-1", messageId: "m-1" } })));
  await click(q("[data-record-link]"));
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
  scene = "invoice";
  countsGate = null;
  vi.mocked(downloadBlob).mockClear();
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : undefined });
    const console = stand;
    if (countsGate && url.includes("section=counts")) await countsGate;
    const detail = console.detail(url, init);
    if (detail) return detail;
    if (url.includes("/detail")) return json({ state: "unavailable" }, 404);
    const match = /\/api\/me\/records\/nimbus_desk\/(\w+)\/([^?/]+)/.exec(url);
    const card = match && console.card(match[1]!, match[2]!);
    return card ? json(answer(card)) : json({ state: "unknown" });
  }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
let stand = boardInvoiceConsole("en", NOW, "invoice");
beforeEach(() => { stand = boardInvoiceConsole("en", NOW, scene); });
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  delete document.documentElement.dataset.reducedMotion;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the invoice window", () => {
  it("draws the invoice as a document beside its balance, its timeline and the company's summary", async () => {
    await open();
    expect(q("[data-record-window]")!.dataset.recordWindow).toBe("nimbus_desk/invoice");
    expect(all("[data-record-tab]").map((tab) => tab.dataset.recordTab)).toEqual(["invoice", "payments", "history"]);
    const doc = q("[data-invoice-document]")!;
    expect(doc.querySelector("[data-invoice-number]")!.textContent).toBe("F-10391");
    expect(doc.querySelector("[data-invoice-issued]")!.textContent).toMatch(/^Issued .*Oct 1, 2026/);
    expect(doc.querySelector("[data-invoice-due]")!.textContent).toMatch(/^Due .*Oct 31, 2026 · Net 30$/);
    expect(doc.querySelector("[data-invoice-billed-to]")!.textContent).toContain("Attention: Ada Lindqvist");
    expect([...doc.querySelectorAll("[data-invoice-links] [data-record-ref-link]")].map((one) => one.textContent)).toEqual(["#299950", "#300124", "2026 block of hours agreement"]);
    expect(all("[data-invoice-line]")).toHaveLength(3);
    expect(all("[data-invoice-line]")[0]!.textContent).toBe("Technical support, October 20266.50 h at $135.00 · tickets #299950 and #300124$877.50");
    expect(all("[data-invoice-total]").map((row) => row.textContent)).toEqual(["Subtotal$1,236.50", "GST 5%$61.83", "QST 9.975%$123.34", "Total$1,421.67", "Paid$0.00"]);
    const balance = q("[data-invoice-balance]")!;
    expect(balance.textContent).toContain("Balance due$1,421.67");
    expect(balance.textContent).toContain("27 days late");
    // the lateness is also a pill of the head, after the card's own (the mockup's)
    expect(q("[data-record-window-head]")!.textContent).toContain("27 days late");
    expect(q("[data-invoice-pdf]")).not.toBeNull();
    expect(all("[data-invoice-step]").map((step) => [step.dataset.invoiceStep, step.dataset.tone])).toEqual([["issued", "done"], ["sent", "done"], ["due", "alert"], ["reminder", "done"], ["next_reminder", "next"]]);
    expect(q('[data-invoice-step="sent"]')!.textContent).toContain("Sent to Ada Lindqvist");
    expect(q('[data-invoice-step="due"]')!.textContent).toContain("Past due");
    expect(q("[data-invoice-client]")!.textContent).toContain("Total balance$4,820.15");
    // nothing here asks a bot without a conversation to ask in
    expect(q("[data-invoice-remind]")).toBeNull();
  });

  it("records a payment as one checked action, then reads the payments again", async () => {
    await open();
    await click(q("[data-invoice-side] [data-invoice-pay]"));
    const form = q("[data-invoice-payment-form]")!;
    const [amount, date] = [...form.querySelectorAll<HTMLInputElement>("input")];
    expect(date!.value).toBe("2026-11-27");
    await act(async () => setValue(amount!, "200"));
    expect(form.querySelector<HTMLButtonElement>("[data-record-form-submit]")!.disabled).toBe(false);
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await settle();
    const written = calls.filter((call) => call.method === "POST").map((call) => JSON.parse(call.body!));
    expect(written).toEqual([{ action: "payment.add", set: { amount: "200", date: "2026-11-27" } }]);
    expect(q("[data-invoice-payment-form]")).toBeNull();
    await click(q('[data-record-tab="payments"]'));
    const payments = all("[data-invoice-payment]");
    expect(payments).toHaveLength(1);
    expect(payments[0]!.textContent).toMatch(/^Transfer.*today · Noor Haddad\$200\.00$/);
    expect(q('[data-record-tab="payments"]')!.textContent).toBe("Payments1");
  });

  it("offers Payments, History and Record a payment only once the counts answered", async () => {
    let release!: () => void;
    countsGate = new Promise((done) => { release = done; });
    await open();
    expect(q("[data-invoice-document]")).not.toBeNull();
    expect(all("[data-record-tab]").map((tab) => tab.dataset.recordTab)).toEqual(["invoice"]);
    expect(q("[data-invoice-pay]")).toBeNull();
    expect(calls.some((call) => call.url.includes("section=payments") || call.url.includes("section=history"))).toBe(false);
    await act(async () => { release(); });
    await settle();
    expect(all("[data-record-tab]").map((tab) => tab.dataset.recordTab)).toEqual(["invoice", "payments", "history"]);
    expect(q("[data-invoice-side] [data-invoice-pay]")).not.toBeNull();
  });

  it("downloads the PDF through the detail route", async () => {
    await open();
    await click(q("[data-invoice-pdf]"));
    expect(calls.some((call) => call.url.includes("/invoice/10391/detail?") && call.url.includes("section=download") && call.url.includes("field=pdf"))).toBe(true);
    expect(downloadBlob).toHaveBeenCalledTimes(1);
  });

  it("lists no payment with what is still owed, and the history newest first", async () => {
    await open();
    await click(q('[data-record-tab="payments"]'));
    expect(q("[data-invoice-payments]")!.textContent).toMatch(/No payment received.*The balance of \$1,421\.67 is still due since .*Oct 31, 2026\./);
    await click(q('[data-record-tab="history"]'));
    const events = all("[data-invoice-event]").map((row) => row.textContent ?? "");
    expect(["Reminder sent automatically to ada@acme.example", "Invoice sent by Bruno Tremblay", "Invoice created from 2 tickets and 1 agreement"].map((text, index) => events[index]!.startsWith(text))).toEqual([true, true, true]);
    expect(all("[data-invoice-event]")).toHaveLength(3);
  });

  it("keeps the card's facts in the same layout when the console serves no detail for invoices, nothing made up", async () => {
    scene = "invoice-card";
    stand = boardInvoiceConsole("en", NOW, scene);
    await open();
    expect(all("[data-record-tab]").map((tab) => tab.dataset.recordTab)).toEqual(["invoice"]);
    const doc = q("[data-invoice-document]")!;
    expect(doc.querySelector("[data-invoice-billed-to]")!.textContent).toBe("Billed toAcme Fabrication inc.");
    expect([...doc.querySelectorAll("[data-invoice-links] [data-record-ref-link]")].map((one) => one.textContent)).toEqual(["#300124", "2026 block of hours"]);
    expect(doc.querySelector("[data-invoice-facts]")!.textContent).toContain("TermsNet 30");
    expect(all("[data-invoice-total]").map((row) => row.textContent)).toEqual(["Total$1,421.67", "Balance$1,421.67", "Tax$185.17"]);
    expect(all("[data-invoice-line]")).toHaveLength(3);
    expect(doc.querySelector("[data-invoice-issued]")).toBeNull();
    // the balance is not guessed from the card's amounts; how late it is follows the card's own rule
    const balance = q("[data-invoice-balance]")!;
    expect(balance.textContent).not.toContain("Balance due");
    expect(balance.textContent).toContain("27 days late");
    expect(q("[data-invoice-pay]")).toBeNull();
    expect(q("[data-invoice-pdf]")).toBeNull();
    expect(q("[data-invoice-steps]")).toBeNull();
    expect(calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("hands Send a reminder to a bot in the chat and says so", async () => {
    const onRemind = vi.fn();
    const card = parseRecordCard(stand.card("invoice", "10391"))!;
    const record = { product: "nimbus_desk", kind: "invoice", id: "10391" };
    const layout = invoiceWindow({ card, record, type: "nimbus_desk/invoice", now: NOW, onView: () => {}, onRemind });
    await act(async () => root.render(createElement(RecordCard, {
      record, label: "F-10391", kindName: "Invoice", pinned: true, onClose: () => {}, now: NOW, window: layout,
      read: { card, miss: null, loading: false, at: NOW, refresh: () => {} },
    })));
    await click(q("[data-invoice-remind]"));
    expect(onRemind).toHaveBeenCalledTimes(1);
    expect(q("[data-record-bot-asked]")!.textContent).toBe("Asked in the chat: the bot writes the reminder there.");
  });
});
