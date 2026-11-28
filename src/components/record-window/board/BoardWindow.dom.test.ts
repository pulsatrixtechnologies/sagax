// @vitest-environment happy-dom
// A board a bot names opens in the record window like a ticket
// (M-20261127-101) and shows its active tickets: the four tiles that filter,
// the filters All, My tickets, Urgent, Not scheduled, Waiting, the owner and
// the one dynamic filter (M-20261127-140, M-20261127-139); List as one grid,
// never grouped by status (M-20261127-145), with the next scheduling and who
// is planned on it (M-20261127-129); Columns by status; Data
// (D-20261127-010); a ticket opened in the same window with a way back.
// The stand-in console is src/lib/record-board-invoice-fixtures.ts.
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { answer, nimbusProduct, ticketCard } from "@/lib/record-card-fixtures";
import { boardInvoiceConsole } from "@/lib/record-board-invoice-fixtures";
import { resetPersonProducts, seedPersonProducts } from "@/lib/person-products";
import { resetRecordCards } from "@/lib/record-cards";
import { ChatMarkdown } from "../../ChatMarkdown";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = Date.parse("2026-11-27T13:50:00-05:00");
let host: HTMLDivElement;
let root: Root;
let noBoardDetail = false;
/** the console sends no priority level, next scheduling, status tone nor owner flag */
let bare = false;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await vi.advanceTimersByTimeAsync(20); }); };
const q = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T & HTMLElement>(selector);
const all = (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)];
const rows = () => all("[data-board-list] [data-ticket-row]").map((row) => row.dataset.ticketRow);
const click = async (node: HTMLElement | null) => { await act(async () => { node!.click(); }); await settle(); };

async function open() {
  await act(async () => root.render(createElement(ChatMarkdown, { text: "[Support](sagax://record/nimbus_desk/board/41)", botId: "bot-1", draftId: "bot:bot-1:t-1", message: { threadId: "t-1", messageId: "m-1" } })));
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
  noBoardDetail = false;
  bare = false;
  const console = boardInvoiceConsole("en", NOW, "board");
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    if (noBoardDetail && url.includes("/board/41/detail")) return json({ state: "unavailable", code: "kind_unknown" }, 404);
    const detail = console.detail(url, init);
    if (detail && bare && url.includes("section=tickets")) {
      const body = await detail.json() as { lines: Array<Record<string, unknown>> };
      return json({ ...body, lines: body.lines.map(({ priority_level: _level, next: _next, status_tone: _tone, mine: _mine, ...row }) => row) });
    }
    if (detail) return detail;
    if (url.includes("/detail")) return url.includes("section=counts") ? json({ counts: {}, fields: [] }) : json({ lines: [], next: null });
    const match = /\/api\/me\/records\/nimbus_desk\/(\w+)\/([^?/]+)/.exec(url);
    const card = match && console.card(match[1]!, match[2]!);
    if (card) return json(answer(card));
    return json(answer({ ...ticketCard(NOW, "en"), id: match?.[2] ?? "300124", number: `#${match?.[2] ?? "300124"}` }));
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

describe("the board window", () => {
  it("opens in the record window with its tabs, its tiles and one grid of the active tickets", async () => {
    await open();
    expect(q("[data-record-window]")!.dataset.recordWindow).toBe("nimbus_desk/board");
    expect(all("[data-record-tab]").map((tab) => tab.dataset.recordTab)).toEqual(["list", "columns", "data"]);
    expect(all("[data-record-tile]").map((tile) => [tile.dataset.recordTile, tile.querySelector("[data-record-tile-value]")!.textContent])).toEqual([["all", "8"], ["urgent", "3"], ["unscheduled", "2"], ["waiting", "2"]]);
    expect(q('[data-record-tile="all"]')!.textContent).toContain("Closed this week: 12");
    expect(q('[data-record-tile="urgent"]')!.textContent).toContain("Since this morning: 3");
    // one plain grid, never grouped by status (M-20261127-145)
    expect(all("[data-board-list] table")).toHaveLength(1);
    expect(rows()).toHaveLength(8);
    expect(all("[data-board-list] th").map((th) => th.textContent)).toEqual(["Ticket", "Subject", "Status", "Type", "Next scheduling", "Owner", "Opened"]);
    const row = q('[data-ticket-row="300124"]')!;
    expect(row.querySelector("[data-ticket-priority]")!.getAttribute("aria-label")).toBe("3: Medium");
    expect(row.querySelector("[data-ticket-subject]")!.textContent).toBe("Acme Fabrication partnershipAcme Fabrication");
    expect(row.querySelector("[data-ticket-next]")!.textContent).toMatch(/Dec 14.*\+1/);
    expect(q('[data-ticket-row="299871"] [data-ticket-next="none"]')!.textContent).toBe("Not scheduled");
    expect(q('[data-ticket-row="300110"] [data-ticket-next="ongoing"]')!.textContent).toBe("In progress");
    expect(q('[data-ticket-row="299840"] [data-ticket-owner]')!.getAttribute("aria-label")).toBe("Unassigned");
  });

  it("filters by a tile, a quick filter, the owner and the words, together", async () => {
    await open();
    await click(q('[data-record-tile="urgent"]'));
    expect(q('[data-record-tile="urgent"]')!.getAttribute("aria-pressed")).toBe("true");
    expect(rows()).toEqual(["300187", "299871", "299840"]);
    await click(q('[data-board-quick="waiting"]'));
    expect(rows()).toEqual(["300124", "299702"]);
    // Escape in the owner menu closes the menu, never the window
    await click(q("[data-board-owner-menu]"));
    await act(async () => { q("[data-board-owner-menu]")!.focus(); q("[data-board-owner-menu]")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
    await settle();
    expect(q("[data-board-owner]")).toBeNull();
    expect(q("[data-record-window]")).not.toBeNull();
    await click(q("[data-board-owner-menu]"));
    await click(all("[data-board-owner]").find((one) => one.textContent?.startsWith("Bruno Tremblay"))!);
    expect(rows()).toEqual(["299702"]);
    expect(q("[data-board-owner-menu]")!.textContent).toContain("Owner: Bruno Tremblay");
    await click(q('[data-board-quick="all"]'));
    expect(rows()).toEqual(["300187", "300110", "299702"]);
    await click(q("[data-board-owner-menu]"));
    await click(q('[data-board-owner=""]'));
    await click(q('[data-board-quick="mine"]'));
    expect(rows()).toEqual(["299871", "299655", "300124"]);
  });

  it("says who is planned on the next scheduling, when, and whether they saw it (M-20261127-129)", async () => {
    await open();
    await act(async () => { q('[data-ticket-row="300124"] [data-ticket-next]')!.focus(); });
    await settle();
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    const tip = q("[data-ticket-next-tip]")!;
    expect(all("[data-ticket-next-person]").map((one) => [one.textContent?.includes("Noor Haddad") ? "Noor" : "Bruno", one.querySelector("[data-ticket-seen]")!.getAttribute("data-ticket-seen")])).toEqual([["Noor", "yes"], ["Bruno", "no"]]);
    expect(tip.textContent).toContain("Not seen yet");
  });

  it("lays the tickets in one column per status, and counts the Data tab from its rows and the console's figures", async () => {
    await open();
    await click(q('[data-record-tab="columns"]'));
    expect(all("[data-board-column]").map((column) => [column.dataset.boardColumn, column.querySelectorAll("[data-ticket-row]").length])).toEqual([["New", 3], ["In progress", 3], ["Waiting", 2]]);
    await click(q('[data-record-tab="data"]'));
    expect(q("[data-board-filters]")).toBeNull();
    expect(all("[data-board-owner-row]").map((one) => one.textContent)).toEqual(["BTBruno Tremblay3", "NHNoor Haddad3", "MCMaya Chen1", "Unassigned1"]);
    expect(all("[data-board-age]").map((one) => one.textContent)).toEqual(["Under 2 days · 4", "2 to 7 days · 3", "Over 7 days · 1"]);
    expect(q('[data-board-data="weeks"] svg')).not.toBeNull();
    expect(q('[data-board-data="first-response"]')!.textContent).toContain("38 min");
    // a tile in Data opens the list with its filter
    await click(q('[data-record-tile="unscheduled"]'));
    expect(q('[data-record-tab="list"]')!.getAttribute("aria-selected")).toBe("true");
    expect(rows()).toEqual(["299871", "299840"]);
  });

  it("opens a ticket in the same window, and the way back finds the board as it was left (M-20261127-101)", async () => {
    await open();
    await click(q('[data-record-tile="waiting"]'));
    await click(q('[data-ticket-row="300124"] [data-ticket-subject] > [data-record-ref-link]'));
    expect(all("[data-record-window]")).toHaveLength(1);
    expect(q("[data-record-window]")!.dataset.recordWindow).toBe("nimbus_desk/ticket");
    await click(q("[aria-label=Back]"));
    expect(q("[data-record-window]")!.dataset.recordWindow).toBe("nimbus_desk/board");
    expect(q('[data-record-tile="waiting"]')!.getAttribute("aria-pressed")).toBe("true");
    expect(rows()).toEqual(["300124", "299702"]);
  });

  it("shows a tile and its quick filter only when the console sends what they count, never a 0 made of a missing field", async () => {
    bare = true;
    await open();
    expect(all("[data-record-tile]").map((tile) => tile.dataset.recordTile)).toEqual(["all"]);
    expect(all("[data-board-quick]").map((pill) => pill.dataset.boardQuick)).toEqual(["all"]);
    expect(rows()).toHaveLength(8);
    // the status still reads, in the quiet tone
    expect(q('[data-ticket-row="300124"]')!.textContent).toContain("Waiting");
  });

  it("stays the original card when the console serves no detail for boards", async () => {
    noBoardDetail = true;
    await open();
    expect(q("[data-record-window]")!.dataset.recordWindow).toBe("nimbus_desk/board");
    expect(q("[data-record-tiles]")).toBeNull();
    expect(q("[data-record-tabs]")).toBeNull();
  });
});
