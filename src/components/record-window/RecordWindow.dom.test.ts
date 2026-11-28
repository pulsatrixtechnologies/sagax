// @vitest-environment happy-dom
// The one record window (M-20261127-101): moved by its head, resized by its
// edges, its size and place kept per person and per type of window
// (M-20261127-147), never past the app's window, each side scrolling on its
// own and its tabs out of what scrolls (M-20261127-124, M-20261127-134); and
// the shared blocks every kind builds with (D-20261127-009). The hovered
// tooltip is not touched. Synthetic records only (src/lib/record-card-fixtures.ts).
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { companyCard, ticketCard, COMPANY_REF, TICKET_REF } from "@/lib/record-card-fixtures";
import { RECORD_WINDOWS_KEY, recordWindowBox } from "@/lib/record-window-layout";
import { parseRecordCard, type RecordCardMiss, type RecordRef } from "../../../shared/record-cards";
import { RecordCard, type RecordCardProps } from "../RecordCard";
import { RecordAddButton, RecordEntryForm, RecordRowActions, RecordWindowTabs, recordShown } from "./RecordBlocks";
import { RecordGrid, filterRecordRows, orderedColumns, type RecordColumn } from "./RecordGrid";
import { RecordSplit, splitWidth } from "./RecordSplit";
import { movedBox, resizedBox } from "./RecordWindow";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = Date.parse("2026-11-17T14:34:00-05:00");
const product = { name: "Nimbus Desk", iconUrl: "https://desk.example/mark.svg" };
let host: HTMLDivElement;
let root: Root;
let stored: Map<string, string>;
let restoreView: Array<() => void> = [];

function view(width: number, height: number) {
  for (const [name, value] of [["innerWidth", width], ["innerHeight", height]] as const) {
    const before = Object.getOwnPropertyDescriptor(window, name);
    Object.defineProperty(window, name, { configurable: true, value });
    restoreView.push(() => (before ? Object.defineProperty(window, name, before) : delete (window as unknown as Record<string, unknown>)[name]));
  }
}

function show(over: Partial<RecordCardProps> & { raw?: Record<string, unknown>; miss?: RecordCardMiss; record?: RecordRef } = {}) {
  const { raw, miss, record, ...rest } = over;
  act(() => root.render(createElement(RecordCard, {
    record: record ?? TICKET_REF, label: "#481516", kindName: "Billet", product, now: NOW, pinned: true, onClose: () => {}, onAsk: () => {},
    read: { card: raw ? parseRecordCard(raw) : null, miss: miss ?? null, loading: !raw && !miss, at: NOW - 120_000, refresh: () => {} },
    ...rest,
  })));
}
const frame = () => host.querySelector<HTMLElement>("[data-record-window]")!;
const box = () => { const style = frame().style; return [style.left, style.top, style.width, style.height].map((value) => parseFloat(value)); };
const edge = (name: string) => host.querySelector<HTMLElement>(`[data-record-window-edge="${name}"]`)!;
const pointer = (target: Element, type: string, x: number, y: number) =>
  act(() => { target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, button: 0, clientX: x, clientY: y })); });
const drag = (target: Element, dx: number, dy = 0) => {
  pointer(target, "pointerdown", 600, 400);
  pointer(target, "pointermove", 600 + dx, 400 + dy);
  pointer(target, "pointerup", 600 + dx, 400 + dy);
};
const key = (target: Element, name: string) => act(() => { target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true })); });
const dblclick = (target: Element) => act(() => { target.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); });
const kept = () => JSON.parse(stored.get(RECORD_WINDOWS_KEY) ?? "{}");

beforeEach(() => {
  setLocale("fr");
  stored = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (name: string) => stored.get(name) ?? null,
    setItem: (name: string, value: string) => { stored.set(name, value); },
    removeItem: (name: string) => { stored.delete(name); },
  });
  view(1440, 900);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  restoreView.forEach((undo) => undo());
  restoreView = [];
  vi.unstubAllGlobals();
});

describe("the record window's size and place (M-20261127-147)", () => {
  it("opens at the mockup's size, centred, bounded by the app's window", () => {
    show({ raw: ticketCard(NOW, "fr") });
    expect(box()).toEqual([100, 32, 1240, 852]);
    expect(recordWindowBox({}, { width: 1000, height: 700 })).toEqual({ left: 16, top: 32, width: 968, height: 652 });
  });

  it("is resized by its two sides, its bottom edge and its bottom corners, never under its minimum nor past the window", () => {
    show({ raw: ticketCard(NOW, "fr") });
    drag(edge("e"), 60);
    expect(box()).toEqual([100, 32, 1300, 852]);
    drag(edge("w"), -40);
    expect(box()).toEqual([60, 32, 1340, 852]);
    drag(edge("s"), 0, -200);
    expect(box()).toEqual([60, 32, 1340, 652]);
    drag(edge("se"), -2000, -2000);
    expect(box()).toEqual([60, 32, 480, 320]);
    drag(edge("e"), 5000);
    expect(box()[2]).toBe(1440 - 16 - 60);
    expect(kept()["nimbus_desk/ticket"]).toEqual({ w: 1364, h: 320, x: 60, y: 32 });
    // pure: the right edge stays where it is when the left one moves, bounded by the window
    expect(resizedBox({ left: 100, top: 20, width: 600, height: 400 }, "sw", -500, 900, { width: 1000, height: 700 })).toEqual({ left: 16, top: 20, width: 684, height: 664 });
  });

  it("is moved by its head and stays whole inside the window; a double-click on the head puts it back in the middle", () => {
    show({ raw: ticketCard(NOW, "fr") });
    drag(edge("e"), -400);
    const head = frame().querySelector<HTMLElement>("[data-record-window-head]")!;
    drag(head, -300, 300);
    expect(box()).toEqual([16, 32, 840, 852]);
    drag(edge("s"), 0, -400);
    drag(head, 2000, 2000);
    expect(box()).toEqual([1440 - 16 - 840, 900 - 16 - 452, 840, 452]);
    dblclick(head);
    expect(box()).toEqual([300, 72, 840, 452]);
    // a press on a control of the head never drags
    expect(movedBox({ left: 100, top: 100, width: 500, height: 300 }, -1000, 50, { width: 1000, height: 700 })).toEqual({ left: 16, top: 150, width: 500, height: 300 });
  });

  it("keeps a size per type of window and opens another type at its own", () => {
    show({ raw: ticketCard(NOW, "fr") });
    drag(edge("e"), -200);
    expect(box()[2]).toBe(1040);
    show({ raw: companyCard(NOW, "fr"), record: COMPANY_REF, label: "Acme Fabrication" });
    expect(box()[2]).toBe(1240);
    show({ raw: ticketCard(NOW, "fr") });
    expect(box()[2]).toBe(1040);
    expect(Object.keys(kept())).toEqual(["nimbus_desk/ticket"]);
  });

  it("is bounded by a smaller window without overwriting what is kept, and follows the window when it changes", () => {
    stored.set(RECORD_WINDOWS_KEY, JSON.stringify({ "nimbus_desk/ticket": { w: 1300, h: 800, x: 50, y: 40 } }));
    show({ raw: ticketCard(NOW, "fr") });
    expect(box()).toEqual([50, 40, 1300, 800]);
    view(900, 600);
    act(() => { window.dispatchEvent(new Event("resize")); });
    expect(box()).toEqual([16, 16, 868, 568]);
    expect(kept()["nimbus_desk/ticket"]).toEqual({ w: 1300, h: 800, x: 50, y: 40 });
  });

  it("returns to the default size on a double-click or Enter on an edge, and answers the arrow keys on its right and bottom edges", () => {
    show({ raw: ticketCard(NOW, "fr") });
    key(edge("e"), "ArrowLeft");
    expect(box()[2]).toBe(1216);
    key(edge("s"), "ArrowUp");
    expect(box()[3]).toBe(828);
    dblclick(edge("sw"));
    expect(box()).toEqual([100, 32, 1240, 852]);
    key(edge("e"), "ArrowLeft");
    key(edge("e"), "Enter");
    expect(box()[2]).toBe(1240);
    // the right and bottom edges are the keyboard's; the others the pointer's only
    expect(edge("e").tabIndex).toBe(0);
    expect(edge("s").tabIndex).toBe(0);
    expect(edge("w").getAttribute("aria-hidden")).toBe("true");
    expect(edge("se").getAttribute("aria-hidden")).toBe("true");
  });

  it("leaves the hovered tooltip as it was: no frame, no handle", () => {
    show({ raw: ticketCard(NOW, "fr"), pinned: false });
    expect(host.querySelector("[data-record-window]")).toBeNull();
    expect(host.querySelector(".app-resize-handle")).toBeNull();
  });
});

describe("the record window reads (M-20261127-124)", () => {
  it("keeps the head, the title, the pills and the foot, at the chat's size", () => {
    const edit = { load: async () => [], save: async () => {} };
    show({ raw: ticketCard(NOW, "fr"), edits: { status: edit, priority: edit, board: edit } });
    expect(frame().className).toContain("text-[15px]");
    const text = host.textContent ?? "";
    for (const words of ["Billet", "#481516", "Imprimante de l'accueil hors ligne depuis lundi", "En cours", "Priorité 2 - Élevée", "Acme Fabrication", "Ada Lindqvist", "418 555-0142", "Noor Haddad", "L'imprimante du comptoir ne répond plus", "À jour à"]) expect(text).toContain(words);
    expect(host.querySelectorAll("[data-record-window-head] [data-pill-select]")).toHaveLength(2);
    const actions = host.querySelector("[data-record-actions]")!;
    expect(actions.querySelector("[data-record-open]")!.textContent).toBe("Ouvrir sur le Web");
    expect(actions.querySelector("[data-record-ask]")!.textContent).toBe("Demander");
    expect(actions.querySelector("[data-record-copy]")).not.toBeNull();
    expect(actions.querySelector("[data-record-refresh]")).not.toBeNull();
    expect(host.querySelector("[aria-label=Fermer]")).not.toBeNull();
  });

  it("labels every fact and scrolls each side on its own, never the window as a whole", () => {
    show({ raw: ticketCard(NOW, "fr") });
    const labels = [...host.querySelectorAll("[data-record-facts] dt")].map((node) => node.textContent);
    expect(labels).toEqual(["Entreprise", "Contact", "Responsable", "Ouverture", "Mise à jour", "Échéance", "Tableau", "Type", "Heures"]);
    const sides = [...host.querySelectorAll<HTMLElement>("[data-record-side=left], [data-record-side=right]")];
    expect(sides).toHaveLength(2);
    for (const side of sides) expect(side.className).toContain("overflow-y-auto");
    expect(host.querySelector<HTMLElement>("[data-record-window-body]")!.className).not.toContain("overflow-y-auto");
    expect(frame().className).toContain("overflow-hidden");
  });

  it("draws a record with nothing to say as its facts only, two a row, in one side that scrolls", () => {
    show({ raw: companyCard(NOW, "fr"), record: COMPANY_REF, label: "Acme Fabrication" });
    expect(host.querySelector("[data-record-pane=right]")).toBeNull();
    expect(host.querySelector("[data-record-facts]")!.className).toContain("@min-[40rem]:grid-cols-");
    expect(host.querySelector<HTMLElement>("[data-record-side=left]")!.className).toContain("overflow-y-auto");
  });

  it("takes a kind's own tabs and body inside the same frame", () => {
    show({ raw: ticketCard(NOW, "fr"), window: { tabs: createElement("div", { "data-own-tabs": "" }), body: createElement("div", { "data-own-body": "" }) } });
    expect(host.querySelector("[data-record-window-tabs] [data-own-tabs]")).not.toBeNull();
    expect(host.querySelector("[data-record-window-body] [data-own-body]")).not.toBeNull();
    expect(host.querySelector("[data-record-facts]")).toBeNull();
    expect(host.querySelector("[data-record-actions]")).not.toBeNull();
  });
});

describe("the split between the sides (M-20261127-125)", () => {
  it("keeps the fields column inside its bounds, leaving the right side its least", () => {
    expect(splitWidth(undefined, 360, 1240, 240, 360)).toBe(360);
    expect(splitWidth(100, 360, 1240, 240, 360)).toBe(240);
    expect(splitWidth(2000, 360, 1240, 240, 360)).toBe(880);
  });

  it("is dragged, kept for its type, and a double-click returns it to its default", () => {
    act(() => root.render(createElement(RecordSplit, { type: "nimbus_desk/ticket", left: "L", right: "R", rightHead: createElement("nav", { "data-head": "" }) })));
    const handle = host.querySelector<HTMLElement>("[data-record-split-handle]")!;
    drag(handle, 80);
    expect(kept()["nimbus_desk/ticket"].split).toBe(440);
    expect(host.querySelector<HTMLElement>("[data-record-side=left]")!.style.width).toBe("440px");
    // the right side's head stays out of what scrolls
    expect(host.querySelector("[data-record-side=right] [data-head]")).toBeNull();
    expect(host.querySelector("[data-record-side-head] [data-head]")).not.toBeNull();
    dblclick(handle);
    expect(kept()["nimbus_desk/ticket"]).toBeUndefined();
  });
});

describe("the shared blocks (D-20261127-009)", () => {
  it("hides an empty tab or block where nothing can be added (M-20261127-143)", () => {
    expect(recordShown(0, false)).toBe(false);
    expect(recordShown(0, true)).toBe(true);
    expect(recordShown(undefined, false)).toBe(true);
    act(() => root.render(createElement(RecordWindowTabs<string>, {
      tabs: [{ id: "a", label: "A", count: 2 }, { id: "b", label: "B", count: 0 }, { id: "c", label: "C", count: 0, canAdd: true }],
      tab: "a", onTab: () => {}, label: "Tabs", idPrefix: "t",
    })));
    expect([...host.querySelectorAll("[data-record-tab]")].map((tab) => tab.textContent)).toEqual(["A2", "C0"]);
  });

  it("opens an input zone only on a click on +, with its choices at the right (M-20261127-110, M-20261127-126)", () => {
    const add = vi.fn();
    act(() => root.render(createElement(RecordAddButton<string>, { label: "Ajouter", onAdd: add, choices: [{ id: "meeting", label: "Rencontre" }, { id: "activity", label: "Activité" }] })));
    expect(host.querySelector("[role=menu]")).toBeNull();
    act(() => host.querySelector<HTMLElement>("[data-record-add]")!.click());
    act(() => host.querySelector<HTMLElement>('[data-record-add-choice="activity"]')!.click());
    expect(add).toHaveBeenCalledWith("activity");
    expect(host.querySelector("[role=menu]")).toBeNull();
  });

  it("asks once, in place, before an entry is removed, and edits at its right", async () => {
    const remove = vi.fn(async () => {});
    const edit = vi.fn();
    act(() => root.render(createElement(RecordRowActions, { name: "la note", onEdit: edit, onRemove: remove })));
    act(() => host.querySelector<HTMLElement>("[data-record-edit]")!.click());
    expect(edit).toHaveBeenCalled();
    act(() => host.querySelector<HTMLElement>("[data-record-remove]")!.click());
    expect(remove).not.toHaveBeenCalled();
    await act(async () => host.querySelector<HTMLElement>("[data-record-row-confirm] button")!.click());
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("sends a form's values, leaves on Escape and never before its required fields are there", async () => {
    const submit = vi.fn(async () => {});
    const cancel = vi.fn();
    act(() => root.render(createElement(RecordEntryForm, { fields: [{ key: "hours", label: "Heures", kind: "number", required: true }, { key: "note", label: "Note", kind: "textarea" }], submitLabel: "Ajouter", onSubmit: submit, onCancel: cancel })));
    const send = host.querySelector<HTMLButtonElement>("[data-record-form-submit]")!;
    expect(send.disabled).toBe(true);
    const input = host.querySelector<HTMLInputElement>("input")!;
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "1.5"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(send.disabled).toBe(false);
    await act(async () => send.click());
    expect(submit).toHaveBeenCalledWith({ hours: "1.5", note: "" });
    key(input, "Escape");
    expect(cancel).toHaveBeenCalled();
  });

  it("starts a required choice on a disabled \"Choose\" so even the only choice can be picked", async () => {
    const submit = vi.fn(async () => {});
    act(() => root.render(createElement(RecordEntryForm, { fields: [{ key: "configuration", label: "Configuration", kind: "choice", required: true, choices: [{ value: "31", label: "Poste du comptoir" }] }], submitLabel: "Ajouter", onSubmit: submit, onCancel: () => {} })));
    const select = host.querySelector<HTMLSelectElement>("select")!;
    expect([...select.options].map((option) => [option.textContent, option.disabled])).toEqual([["Choisir…", true], ["Poste du comptoir", false]]);
    expect(host.querySelector<HTMLButtonElement>("[data-record-form-submit]")!.disabled).toBe(true);
    act(() => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, "31"); select.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => host.querySelector<HTMLButtonElement>("[data-record-form-submit]")!.click());
    expect(submit).toHaveBeenCalledWith({ configuration: "31" });
  });

  type Row = { id: string; who: string; when: string };
  const columns: RecordColumn<Row>[] = [
    { id: "who", label: "Qui", width: 160, text: (row) => row.who },
    { id: "when", label: "Quand", kind: "date", text: (row) => row.when },
    { id: "actions", label: "", fixed: true, width: 80, text: () => "" },
  ];
  const rows: Row[] = [{ id: "1", who: "Noor Haddad", when: "14 déc." }, { id: "2", who: "Bruno Tremblay", when: "2 déc." }];

  it("filters with the one dynamic filter, a column or all of them, accents aside (M-20261127-139)", () => {
    expect(filterRecordRows(rows, columns, { text: "noor" }).map((row) => row.id)).toEqual(["1"]);
    expect(filterRecordRows(rows, columns, { text: "dec", column: "Quand" }).map((row) => row.id)).toEqual(["1", "2"]);
    expect(filterRecordRows(rows, columns, { text: "noor", column: "Quand" })).toEqual([]);
    act(() => root.render(createElement(RecordGrid<Row>, { type: "nimbus_desk/ticket", grid: "plan", label: "Plan", columns, rows, rowKey: (row) => row.id })));
    // one filter: no checkbox column, no row of filters under the heads
    expect(host.querySelectorAll("[data-record-filter]")).toHaveLength(1);
    expect(host.querySelector("input[type=checkbox]")).toBeNull();
    expect(host.querySelectorAll("thead tr")).toHaveLength(1);
  });

  it("moves and resizes its columns, kept per type and table, the row's actions staying last", () => {
    expect(orderedColumns(columns, { order: ["when", "gone"] }).map((column) => column.id)).toEqual(["when", "who", "actions"]);
    act(() => root.render(createElement(RecordGrid<Row>, { type: "nimbus_desk/ticket", grid: "plan", label: "Plan", columns, rows, rowKey: (row) => row.id })));
    const head = (id: string) => host.querySelector<HTMLElement>(`th[data-record-column="${id}"]`)!;
    act(() => { head("when").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", altKey: true, bubbles: true })); });
    expect([...host.querySelectorAll("th")].map((th) => th.dataset.recordColumn)).toEqual(["when", "who", "actions"]);
    const grip = head("who").querySelector<HTMLElement>("[data-record-column-grip]")!;
    key(grip, "ArrowRight");
    expect(kept()["nimbus_desk/ticket"].grids.plan.order).toEqual(["when", "who"]);
    expect(kept()["nimbus_desk/ticket"].grids.plan.widths.who).toBeGreaterThanOrEqual(64);
    expect(head("actions").hasAttribute("draggable") && head("actions").getAttribute("draggable")).toBe("false");
  });
});
