// @vitest-environment happy-dom
// The routine panel (2026-11-03, the owner: the reference app's routine panel). An existing
// routine opens in view mode: < its name ×, "Instruction" and the prompt as
// text, "When to run" with the trigger's icon and its details (a webhook's
// POST to, key and header rows with reveal and copy; a schedule's times and
// zone), Advanced folded with its summary, and [Pause or Resume] [Edit]
// [trash]. Edit makes the same layout editable in place: [Cancel] [Save]
// [trash]; Cancel and Save come back to the view. The trash asks first.
// Advanced is rows of the app's own controls: never a native select, never a
// "?" bubble. One field per time: the first time only in When to run, the
// extra ones only in Advanced.
import { act, createElement, type ReactNode } from "react";
import { ConfirmProvider } from "@/components/ConfirmProvider";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";
import type { Routine } from "../../shared/routines";

const fixture = vi.hoisted(() => ({ webhooks: [] as unknown[], lastUpsert: null as unknown, dispatch: null as unknown as ReturnType<typeof import("vitest").vi.fn>, calls: [] as string[] }));
vi.mock("@/hooks/use-modal-dialog", () => ({ useModalDialog: () => {} }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    api: vi.fn(async (path: string, init?: { method?: string; body?: string }) => {
      fixture.calls.push(`${init?.method ?? "GET"} ${path}`);
      if (path === "/api/routines" && init?.method === "POST" && init.body) {
        fixture.lastUpsert = JSON.parse(init.body);
        const routine = { ...(fixture.lastUpsert as object), id: "r1", createdAt: 1, updatedAt: 2 };
        return { routine };
      }
      if (path.startsWith("/api/routines/") && (init?.method === "PATCH" || init?.method === "PUT") && init.body) {
        fixture.lastUpsert = JSON.parse(init.body);
        const routine = { ...(fixture.lastUpsert as object), id: "r1", createdAt: 1, updatedAt: 2 };
        return { routine };
      }
      if (path === "/api/webhooks/w1/reveal") return { webhook: fixture.webhooks[0], credential: { token: "whsec_fullKey123" } };
      return {};
    }),
    useStore: () => ({ state: { ...original.initialState, webhooks: fixture.webhooks, webhookIngress: { available: true, baseUrl: "https://hooks.example.test" } }, dispatch: fixture.dispatch }),
  };
});
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { host: {}, dictation: { available: false } }, ready: true }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

const { setLocale } = await import("@/lib/i18n");
const { RoutineEditor } = await import("./RoutineCalendarPage");
const { timeZoneLabel } = await import("@/components/routines/HumanScheduleFields");

const bot = { id: "runner", threadId: "main", name: "Runner", color: "green", tasks: [], modelSelection: { instanceId: "t", model: "t" } } as unknown as Bot;
const routine = (schedule: Routine["schedule"]): Routine => ({
  id: "r1", name: "Weekly digest", prompt: "Summarise the week, see [the board](https://example.test/board)", target: "bot", botId: bot.id,
  runOn: "maus", enabled: true, schedule, durationMinutes: 30, nextRunAt: null, createdAt: 1, updatedAt: 1, postResults: true,
});

let host: HTMLDivElement;
let root: Root;
const hosted = (node: ReactNode) => createElement(ConfirmProvider, null, node);
const mount = (value: Routine, onClose = vi.fn(), extra: Record<string, unknown> = {}) => {
  flushSync(() => root.render(hosted(createElement(RoutineEditor, { routine: value, bots: [bot], lockedBotId: bot.id, onClose, ...extra }))));
  return onClose;
};
const button = (text: string) => [...host.querySelectorAll("button")].find((candidate) => candidate.textContent === text);
const edit = () => flushSync(() => host.querySelector<HTMLButtonElement>("[data-routine-edit-mode]")!.click());
const openAdvanced = () => {
  const more = host.querySelector<HTMLDetailsElement>("[data-routine-editor-more]")!;
  flushSync(() => {
    more.open = true;
    more.dispatchEvent(new Event("toggle", { bubbles: true }));
  });
  return more;
};
/** Choose in one of the app's pill menus (PillSelect): open it, click the option. */
const pick = (scope: ParentNode, ariaLabel: string, option: string) => {
  const trigger = scope.querySelector<HTMLButtonElement>(`button[data-pill-select][aria-label="${ariaLabel}"]`);
  expect(trigger, ariaLabel).not.toBeNull();
  flushSync(() => trigger!.click());
  const choice = [...document.querySelectorAll<HTMLElement>("[role=option]")].find((candidate) => candidate.textContent === option);
  expect(choice, option).toBeDefined();
  flushSync(() => choice!.click());
};
const setValue = (input: HTMLInputElement, value: string) => flushSync(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
});

beforeEach(() => {
  setLocale("en");
  fixture.webhooks = [];
  fixture.lastUpsert = null;
  fixture.calls = [];
  fixture.dispatch = vi.fn();
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("the routine panel, view mode", () => {
  it("opens read-only like the reference app: < name ×, Instruction as text, When to run with its icon and rows, [Pause] [Edit] [trash]", () => {
    mount(routine({ type: "cron", expression: "30 8,12,16 * * 1-5", timeZone: "America/Toronto" }), vi.fn(), { presentation: "panel" });
    expect(host.querySelector("[data-editor-back]")).not.toBeNull();
    expect(host.querySelector("[data-editor-close]")).not.toBeNull();
    expect(host.querySelector("h2[data-editor-title]")?.textContent).toBe("Weekly digest");
    expect(host.querySelector("[data-routine-editor-name]")).toBeNull();
    const what = host.querySelector("[data-routine-editor-section=what]")!;
    expect(what.querySelector("h3")?.textContent).toBe("Instruction");
    // Plain flowing text: no box, no toolbar, the link coloured.
    expect(what.querySelector("[data-markdown-editor]")).toBeNull();
    expect(what.querySelector("textarea")).toBeNull();
    expect(what.querySelector("[data-routine-instruction-text] a")?.getAttribute("href")).toBe("https://example.test/board");
    const when = host.querySelector("[data-routine-editor-section=when]")!;
    expect(when.querySelector("h3")?.textContent).toBe("When to run");
    expect(when.querySelector("[data-routine-when-sentence]")?.textContent).toBe("Weekdays, at 8:30 AM, 12:30 PM and 4:30 PM (Toronto time)");
    expect(when.querySelector("[data-when-icon]")?.getAttribute("data-when-icon")).toBe("clock");
    expect(when.querySelector("button[data-routine-when-row]")).toBeNull();
    expect([...when.querySelectorAll("[data-schedule-time-view]")].map((chip) => chip.textContent)).toEqual(["8:30 AM", "12:30 PM", "4:30 PM"]);
    expect(when.querySelector("[data-schedule-zone-view]")?.textContent).toContain("Toronto");
    // Advanced folded with its summary; its rows read their values.
    const more = host.querySelector<HTMLDetailsElement>("[data-routine-editor-more]")!;
    expect(more.open).toBe(false);
    expect(more.querySelector("[data-routine-advanced-summary]")?.textContent).toBe("· Results posted · Extra times: 2");
    openAdvanced();
    expect(more.querySelector("[data-routine-post-results] [data-panel-value]")?.textContent).toBe("On");
    expect(more.querySelector("[data-routine-only-present] [data-panel-value]")?.textContent).toBe("Off");
    expect(more.querySelector("[data-routine-overlap] [data-panel-value]")?.textContent).toBe("Skip this occurrence");
    expect(more.querySelectorAll("[role=switch]").length).toBe(0);
    expect(more.querySelectorAll("[data-pill-select]").length).toBe(0);
    expect(host.querySelectorAll("input, select, textarea").length).toBe(0);
    // The bar: [Pause] [Edit] [trash].
    const bar = host.querySelector("[data-routine-editor-actions=view]")!;
    expect([...bar.querySelectorAll("button")].map((candidate) => candidate.textContent || candidate.getAttribute("aria-label"))).toEqual(["Pause", "Edit", "Delete routine"]);
  });

  it("Pause and Resume switch the routine on and off", () => {
    mount({ ...routine({ type: "cron", expression: "0 9 * * *", timeZone: "UTC" }), enabled: false });
    const toggle = host.querySelector<HTMLButtonElement>("[data-routine-toggle]")!;
    expect(toggle.textContent).toBe("Resume");
    flushSync(() => toggle.click());
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "updateRoutine", routineId: "r1", patch: { enabled: true } });
  });

  it("shows a webhook routine's POST to, key and header rows with reveal and copy, and the hint", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    fixture.webhooks = [{ id: "w1", endpointId: "wh_abc", routineId: "r1", name: "Weekly digest", prompt: "", botId: bot.id, runOn: "maus", enabled: true, createdAt: 1, updatedAt: 1, deliveryCount: 2, tokenLast4: "k3Yz", tokenPending: true }];
    mount(routine({ type: "webhook" }));
    const when = host.querySelector("[data-routine-editor-section=when]")!;
    expect(when.querySelector("[data-routine-when-sentence]")?.textContent).toBe("When a webhook fires");
    expect(when.querySelector("[data-when-icon]")?.getAttribute("data-when-icon")).toBe("globe");
    const section = host.querySelector("[data-routine-editor-section=webhook]")!;
    expect(section.querySelector("h3")?.textContent).toBe("Webhook");
    expect(section.querySelector("[data-webhook-url]")?.textContent).toBe("https://hooks.example.test/hooks/wh_abc");
    expect(section.querySelector("[data-webhook-key]")?.textContent).toBe("whsec_••••k3Yz");
    expect(section.querySelector("[data-webhook-header]")?.textContent).toBe("Authorization: Bearer whsec_••••k3Yz");
    for (const kind of ["url", "key", "header"]) expect(section.querySelector(`[data-copy=${kind}]`), kind).not.toBeNull();
    expect(section.querySelector("[data-show-key=key]")).not.toBeNull();
    expect(section.querySelector("[data-show-key=header]")).not.toBeNull();
    expect(section.querySelector("[data-webhook-hint]")?.textContent).toBe("POST JSON with this header to start a run. The body is passed to the routine.");
    expect(section.textContent).toContain("Copy a curl example");
    // Copy the address as it is.
    await act(async () => { section.querySelector<HTMLButtonElement>("[data-copy=url]")!.click(); });
    expect(writeText).toHaveBeenLastCalledWith("https://hooks.example.test/hooks/wh_abc");
    // Reveal shows the key on both rows.
    await act(async () => { section.querySelector<HTMLButtonElement>("[data-show-key=header]")!.click(); });
    expect(fixture.calls).toContain("POST /api/webhooks/w1/reveal");
    expect(section.querySelector("[data-webhook-key]")?.textContent).toBe("whsec_fullKey123");
    expect(section.querySelector("[data-webhook-header]")?.textContent).toBe("Authorization: Bearer whsec_fullKey123");
    await act(async () => { section.querySelector<HTMLButtonElement>("[data-copy=header]")!.click(); });
    expect(writeText).toHaveBeenLastCalledWith("Authorization: Bearer whsec_fullKey123");
  });

  it("Delete asks through the app's confirmation, then deletes", async () => {
    const onClose = mount(routine({ type: "cron", expression: "0 9 * * *", timeZone: "UTC" }));
    const trash = host.querySelector<HTMLButtonElement>("[data-routine-delete]")!;
    await act(async () => { trash.click(); });
    expect(document.getElementById("confirm-dialog-title")?.textContent).toBe("Delete “Weekly digest”?");
    await act(async () => { [...document.querySelectorAll("button")].find((candidate) => candidate.textContent === "Cancel" && candidate.closest("[role=alertdialog]"))!.click(); });
    expect(fixture.dispatch).not.toHaveBeenCalledWith({ type: "deleteRoutine", routineId: "r1" });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { trash.click(); });
    await act(async () => { (document.querySelector("[data-confirm-action]") as HTMLButtonElement).click(); });
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "deleteRoutine", routineId: "r1" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("opens read-only for a routine the person cannot change: no Edit, no trash, its owner named", () => {
    mount({ ...routine({ type: "cron", expression: "0 9 * * *", timeZone: "UTC" }), canEdit: false, owner: { id: "pr_other", name: "Alex" } } as Routine);
    expect(host.querySelector("[data-editor-title]")?.textContent).toBe("Weekly digest");
    expect(host.querySelector("[data-routine-editor-readonly]")).not.toBeNull();
    expect(host.querySelector("[data-routine-editor-owner]")?.textContent).toBe("Owner: Alex");
    const labels = [...host.querySelectorAll("[data-routine-editor-actions] button")].map((candidate) => candidate.textContent);
    expect(labels).toEqual(["Close"]);
    expect(host.querySelector("[data-routine-delete]")).toBeNull();
    expect(host.querySelectorAll("input, select, textarea").length).toBe(0);
  });
});

describe("Format with AI (2026-11-03)", () => {
  it("opens the routine owner's chat and fills its composer with the request and the routine's reference, sending nothing", async () => {
    const { getDraft } = await import("@/lib/drafts");
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => { callback(); return 0; });
    const onClose = mount(routine({ type: "cron", expression: "0 9 * * *", timeZone: "UTC" }), vi.fn(), { presentation: "panel" });
    const button = host.querySelector<HTMLButtonElement>("[data-routine-editor-section=what] [data-routine-format-ai]");
    expect(button).not.toBeNull();
    expect(button!.textContent).toBe("Format with AI");
    expect(button!.querySelector("svg.lucide-sparkles")).not.toBeNull();
    flushSync(() => button!.click());
    const draft = getDraft(localStorage, "bot:runner:main");
    expect(draft).toContain("reformat the instruction of my routine “Weekly digest” (id r1)");
    expect(draft).toContain("Keep every rule, fact, date and decision exactly");
    expect(draft).toContain("propose_routine_action, action update");
    expect(draft).toContain("show me the before and after");
    // The chat opens; nothing is sent, nothing closes.
    expect(fixture.dispatch).toHaveBeenCalled();
    expect(fixture.dispatch.mock.calls.some(([action]) => ["send", "sendGroup"].includes((action as { type: string }).type))).toBe(false);
    expect(fixture.calls.some((call) => call.includes("/messages"))).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
    expect(host.querySelector("[data-routine-editor-presentation=panel]")).not.toBeNull();
  });

  // 2026-11-03 (audit N-1): in edit mode the form keeps its copy of the
  // instruction; a reformat approved meanwhile was overwritten by Save.
  it("is offered in view mode only, never while the form holds its own copy of the instruction", () => {
    mount(routine({ type: "cron", expression: "0 9 * * *", timeZone: "UTC" }), vi.fn(), { presentation: "panel" });
    expect(host.querySelector("[data-routine-format-ai]")).not.toBeNull();
    edit();
    expect(host.querySelector("[data-routine-editor-section=what]")).not.toBeNull();
    expect(host.querySelector("[data-routine-format-ai]")).toBeNull();
  });

  it("shows the whole instruction in view mode, folding a long one behind Show more", () => {
    mount({ ...routine({ type: "cron", expression: "0 9 * * *", timeZone: "UTC" }), prompt: "Line.\n\n".repeat(200) });
    const text = host.querySelector<HTMLElement>("[data-routine-instruction-text]")!;
    expect(text.className).toContain("max-h-[35vh]");
    expect(text.querySelector("textarea")).toBeNull();
  });
});

describe("the routine panel, edit mode", () => {
  it("view to edit to cancel: the same layout editable in place, Cancel back to the view without saving", async () => {
    const onClose = mount(routine({ type: "cron", expression: "30 8,12,16 * * 1-5", timeZone: "America/Toronto" }));
    edit();
    const name = host.querySelector<HTMLInputElement>("[data-routine-editor-name]")!;
    expect(name.value).toBe("Weekly digest");
    expect([...host.querySelectorAll("[data-routine-editor-actions=edit] button")].map((candidate) => candidate.textContent || candidate.getAttribute("aria-label"))).toEqual(["Cancel", "Save", "Delete routine"]);
    setValue(name, "Renamed");
    expect(host.querySelector("[data-editor-dirty]")?.textContent).toBe("Not saved");
    // Cancel over a change asks first; keeping the change stays in edit mode.
    await act(async () => { button("Cancel")!.click(); });
    expect(document.getElementById("confirm-dialog-body")?.textContent).toBe("Close without saving your changes?");
    await act(async () => { [...document.querySelectorAll("button")].find((candidate) => candidate.textContent === "Cancel" && candidate.closest("[role=alertdialog]"))!.click(); });
    expect(host.querySelector("[data-routine-editor-name]")).not.toBeNull();
    await act(async () => { button("Cancel")!.click(); });
    await act(async () => { (document.querySelector("[data-confirm-action]") as HTMLButtonElement).click(); });
    // Back in view mode, the name as it was, nothing sent, the panel still open.
    expect(host.querySelector("h2[data-editor-title]")?.textContent).toBe("Weekly digest");
    expect(host.querySelector("[data-routine-editor-actions=view]")).not.toBeNull();
    expect(fixture.lastUpsert).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows only the essentials: name, prompt, one When to run row; Advanced folded with its summary", () => {
    mount(routine({ type: "cron", expression: "30 8,12,16 * * 1-5", timeZone: "America/Toronto" }));
    edit();
    expect(host.querySelector<HTMLInputElement>("[data-routine-editor-name]")?.value).toBe("Weekly digest");
    const sections = [...host.querySelectorAll("[data-routine-editor-section]")].map((section) => section.getAttribute("data-routine-editor-section"));
    expect(sections).toEqual(["what", "when"]);
    const when = host.querySelector("[data-routine-editor-section=when]")!;
    expect(when.querySelector("[data-routine-when-sentence]")?.textContent).toBe("Weekdays, at 8:30 AM, 12:30 PM and 4:30 PM (Toronto time)");
    // The picker stays closed on an existing routine until the row is clicked.
    const row = when.querySelector<HTMLButtonElement>("[data-routine-when-row]")!;
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(when.querySelector("[data-human-schedule]")).toBeNull();
    flushSync(() => row.click());
    expect(when.querySelector("[data-human-schedule=essentials]")).not.toBeNull();
    expect(when.querySelector("[data-schedule-more-times]")?.textContent).toBe("+2 more in Advanced");
    // Nothing but the essentials outside Advanced.
    const more = host.querySelector<HTMLDetailsElement>("[data-routine-editor-more]")!;
    expect(more.open).toBe(false);
    expect(more.querySelector("[data-routine-advanced-summary]")?.textContent).toBe("· Results posted · Extra times: 2");
    for (const selector of ["[data-run-as-field]", "[data-routine-post-results]", "[data-routine-attachments]", "[data-schedule-zone]", "[data-schedule-add-time]", "[data-routine-timing]", "[data-routine-auto-pause]", "[data-routine-only-present]", "[data-routine-mail-alias]", "[data-testid=routine-watch]"]) {
      for (const found of host.querySelectorAll(selector)) expect(more.contains(found)).toBe(true);
    }
    expect(more.textContent).toContain("If the previous run is still working");
    expect(more.textContent).toContain("Only when I'm here");
    // A short hint under the label, the long text on its tooltip, no "?" bubble.
    const postRow = more.querySelector("[data-routine-post-results]")!;
    expect(postRow.textContent).toContain("Off keeps each run in the background.");
    expect(postRow.querySelector("[title]")?.getAttribute("title")).toContain("When on, this routine posts its result");
    expect(more.textContent).toContain("Passed to each local run.");
    expect([...more.querySelectorAll("button")].some((candidate) => candidate.textContent === "?")).toBe(false);
    // The prompt reads as text: no box and no toolbar until the person edits it.
    const editor = host.querySelector<HTMLElement>("[data-markdown-editor]")!;
    expect(editor.getAttribute("data-md-compact")).toBe("");
    expect(editor.className).toContain("border-transparent");
    expect(editor.querySelector("[data-md-toolbar]")).toBeNull();
    flushSync(() => editor.dispatchEvent(new FocusEvent("focusin", { bubbles: true })));
    expect(editor.querySelector("[data-md-toolbar] [data-md-full]")).not.toBeNull();
    expect(host.textContent).not.toMatch(/cron/i);
    expect(host.querySelector("[data-editor-dirty]")).toBeNull();
  });

  it("Advanced uses no native select: rows of the app's pill menus, switches at the right, times as pills", () => {
    mount({ ...routine({ type: "cron", expression: "30 8,12 * * 1-5", timeZone: "America/Toronto" }), precheck: { kind: "watch", source: { type: "command", command: "git status" }, condition: { test: "json_path", path: "$.n", op: "gt", value: 1 } } } as unknown as Routine);
    edit();
    flushSync(() => host.querySelector<HTMLButtonElement>("[data-routine-when-row]")!.click());
    const more = openAdvanced();
    expect(more.querySelector("[data-testid=routine-watch] [role=switch]")?.getAttribute("aria-checked")).toBe("true");
    expect(host.querySelectorAll("select").length).toBe(0);
    for (const label of ["Time zone", "Timing", "Routine safety limit", "If the previous run is still working", "Pause automatically", "Condition"]) {
      expect(more.querySelector(`button[data-pill-select][aria-label="${label}"]`), label).not.toBeNull();
    }
    // Each row: the label at the left, the control at the right.
    for (const selector of ["[data-routine-post-results]", "[data-routine-only-present]", "[data-routine-continuity]"]) {
      const row = more.querySelector(selector)!;
      expect(row.getAttribute("data-panel-row"), selector).toBe("");
      expect(row.querySelector(":scope > div > span:last-child [role=switch]"), selector).not.toBeNull();
    }
    // "Also at": a time pill with its ×, then "+ Add a time" as a text action.
    const also = more.querySelector("[data-schedule-extra-times]")!;
    expect(also.querySelectorAll("[data-schedule-time-pill]").length).toBe(1);
    expect(also.querySelector("[data-schedule-time-pill] button[aria-label='Remove this time']")).not.toBeNull();
    expect(also.querySelector("[data-schedule-add-time]")?.textContent).toBe("Add a time");
    expect(more.querySelector("[data-routine-attachments] [data-routine-attach]")?.textContent).toBe("Add");
    // An interval routine's days, hours and end are pill menus too.
    flushSync(() => root.unmount());
    root = createRoot(host);
    mount(routine({ type: "interval", everyMinutes: 30, anchorAt: Date.now() }));
    edit();
    flushSync(() => host.querySelector<HTMLButtonElement>("[data-routine-when-row]")!.click());
    openAdvanced();
    expect(host.querySelectorAll("select").length).toBe(0);
    for (const label of ["How often this routine runs", "Days this interval runs", "Hours this interval runs", "When this interval ends"]) {
      expect(host.querySelector(`button[data-pill-select][aria-label="${label}"]`), label).not.toBeNull();
    }
  });

  it("has one field per time: the first time only in When to run, the extra ones only in Advanced", () => {
    mount(routine({ type: "cron", expression: "30 8,12,16 * * 1-5", timeZone: "America/Toronto" }));
    edit();
    flushSync(() => host.querySelector<HTMLButtonElement>("[data-routine-when-row]")!.click());
    const more = openAdvanced();
    const labels = [...host.querySelectorAll<HTMLInputElement>("input[data-schedule-time]")].map((input) => input.getAttribute("aria-label"));
    expect(labels).toEqual(["Time 1", "Time 2", "Time 3"]);
    expect(host.querySelector("[data-routine-editor-section=when] input[aria-label='Time 1']")).not.toBeNull();
    expect(more.querySelector("input[aria-label='Time 1']")).toBeNull();
    expect(more.querySelector("[data-schedule-extra-times]")?.textContent).toContain("Also at");
  });

  it("saves every field as it was (round trip), then comes back to the view; and the changes made in both places", async () => {
    const attachment = { id: "a1", kind: "file" as const, name: "brief.md", path: "/tmp/brief.md", size: 12 };
    const onClose = vi.fn();
    mount({
      ...routine({ type: "cron", expression: "30 8,12 * * 1-5", timeZone: "America/Toronto", timing: "flexible", windowEarlyMinutes: 10, windowLateMinutes: 5 } as Routine["schedule"]),
      timeoutMinutes: 45, overlap: "queue", autoPauseAfter: 3, continuity: true, onlyWhenPresent: true, postResults: false, mailAlias: "reports", attachments: [attachment],
      requires: { skills: ["inbox-review"], mcpServers: ["outlook"], computer: true },
    } as Routine, onClose);
    const summary = host.querySelector("[data-routine-advanced-summary]")?.textContent ?? "";
    for (const part of ["Attachments: 1", "Extra times: 1", "Flexible timing", "Stops if still running after 45 min", "Queue one run", "Remember the last run", "Only when I'm here", "Mail tag +reports", "Required skills", "Required MCP servers", "Computer required"]) expect(summary).toContain(part);
    edit();
    flushSync(() => button("Save")!.click());
    await vi.waitFor(() => expect(fixture.lastUpsert).not.toBeNull());
    expect(fixture.lastUpsert).toMatchObject({
      name: "Weekly digest", prompt: "Summarise the week, see [the board](https://example.test/board)", botId: bot.id, runOn: "maus",
      schedule: { type: "cron", expression: "30 8,12 * * 1-5", timeZone: "America/Toronto", timing: "flexible", windowEarlyMinutes: 10, windowLateMinutes: 5 },
      timeoutMinutes: 45, overlap: "queue", autoPauseAfter: 3, continuity: true, onlyWhenPresent: true, postResults: false, mailAlias: "reports", attachments: [attachment],
      requires: { skills: ["inbox-review"], mcpServers: ["outlook"], computer: true },
    });
    await vi.waitFor(() => expect(host.querySelector("[data-routine-editor-actions=view]")).not.toBeNull());
    expect(onClose).not.toHaveBeenCalled();

    // Changed: the first time in When to run, an extra time and a switch in Advanced.
    fixture.lastUpsert = null;
    flushSync(() => root.unmount());
    root = createRoot(host);
    mount(routine({ type: "cron", expression: "30 8,12 * * 1-5", timeZone: "America/Toronto" }));
    edit();
    flushSync(() => host.querySelector<HTMLButtonElement>("[data-routine-when-row]")!.click());
    setValue(host.querySelector<HTMLInputElement>("input[aria-label='Time 1']")!, "07:15");
    setValue(host.querySelector<HTMLInputElement>("input[aria-label='Time 2']")!, "13:15");
    const present = host.querySelector("[data-routine-only-present] [role=switch]") as HTMLButtonElement;
    flushSync(() => present.click());
    expect(host.querySelector("[data-routine-advanced-summary]")?.textContent).toContain("Only when I'm here");
    flushSync(() => button("Save")!.click());
    await vi.waitFor(() => expect(fixture.lastUpsert).not.toBeNull());
    expect(fixture.lastUpsert).toMatchObject({ schedule: { expression: "15 7,13 * * 1-5", timeZone: "America/Toronto" }, onlyWhenPresent: true });
  });

  it("#2272 always opens with Advanced collapsed, even after the person unfolded it", () => {
    // An old persisted choice must not reopen it either.
    localStorage.setItem("sagax.routineEditorMore.v1", "1");
    mount(routine({ type: "cron", expression: "0 9 * * *", timeZone: "UTC" }));
    const more = host.querySelector<HTMLDetailsElement>("[data-routine-editor-more]")!;
    expect(more.open).toBe(false);
    openAdvanced();
    expect(host.querySelector<HTMLDetailsElement>("[data-routine-editor-more]")!.open).toBe(true);
    // Opening Edit opens the editor again: folded.
    edit();
    expect(host.querySelector<HTMLDetailsElement>("[data-routine-editor-more]")!.open).toBe(false);
    flushSync(() => root.unmount());
    host.remove();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    mount(routine({ type: "cron", expression: "0 9 * * *", timeZone: "UTC" }));
    expect(host.querySelector<HTMLDetailsElement>("[data-routine-editor-more]")!.open).toBe(false);
    localStorage.removeItem("sagax.routineEditorMore.v1");
  });

  it("puts timezone, extra times, timing and overlap under Advanced, and saves them", async () => {
    mount(routine({ type: "cron", expression: "30 8 * * 1-5", timeZone: "America/Toronto" }));
    edit();
    const more = openAdvanced();
    expect(more.querySelector("[data-human-schedule=advanced]")).not.toBeNull();
    expect(more.querySelector("[data-schedule-zone]")).not.toBeNull();
    expect(more.querySelector("[data-schedule-add-time]")).not.toBeNull();
    expect(more.querySelector("[data-routine-timing]")).not.toBeNull();
    expect(host.querySelector("[data-routine-editor-section=when] [data-schedule-zone]")).toBeNull();
    expect(host.querySelector("[data-routine-editor-section=when] [data-schedule-add-time]")).toBeNull();
    expect(host.querySelector("[data-routine-editor-section=when] [data-routine-timing]")).toBeNull();

    pick(more, "Time zone", timeZoneLabel("America/New_York"));
    pick(more, "If the previous run is still working", "Queue one run");
    pick(more, "Timing", "Flexible");

    expect(host.querySelector("[data-editor-dirty]")).not.toBeNull();
    const save = button("Save")!;
    expect(save.disabled).toBe(false);
    flushSync(() => save.click());
    await vi.waitFor(() => expect(fixture.lastUpsert).not.toBeNull());
    const body = fixture.lastUpsert as { schedule?: { timeZone?: string; timing?: string }; overlap?: string };
    expect(body.schedule?.timeZone).toBe("America/New_York");
    expect(body.schedule?.timing).toBe("flexible");
    expect(body.overlap).toBe("queue");
  });

  it("panel presentation edits in place with Back, without a modal overlay", () => {
    mount(routine({ type: "cron", expression: "0 9 * * *", timeZone: "UTC" }), vi.fn(), { presentation: "panel", mode: "edit" });
    expect(host.querySelector("[data-routine-editor-presentation=panel]")).not.toBeNull();
    expect(host.querySelector("[data-editor-back]")).not.toBeNull();
    expect(host.querySelector(".fixed.inset-0.z-50")).toBeNull();
    // An explicit Edit opens editable at once.
    expect(host.querySelector<HTMLInputElement>("[data-routine-editor-name]")?.value).toBe("Weekly digest");
  });

  it("panel Back asks before discarding unsaved changes; × closes the whole panel", async () => {
    const onClose = vi.fn();
    const onDismiss = vi.fn();
    mount(routine({ type: "cron", expression: "0 9 * * *", timeZone: "UTC" }), onClose, { presentation: "panel", onDismiss });
    edit();
    setValue(host.querySelector<HTMLInputElement>("[data-routine-editor-name]")!, "Renamed");
    expect(host.querySelector("[data-editor-dirty]")).not.toBeNull();
    await act(async () => { host.querySelector<HTMLButtonElement>("[data-editor-back]")!.click(); });
    expect(document.getElementById("confirm-dialog-body")?.textContent).toBe("Close without saving your changes?");
    await act(async () => { [...document.querySelectorAll("button")].find((candidate) => candidate.textContent === "Cancel" && candidate.closest("[role=alertdialog]"))!.click(); });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { host.querySelector<HTMLButtonElement>("[data-editor-back]")!.click(); });
    await act(async () => { (document.querySelector("[data-confirm-action]") as HTMLButtonElement).click(); });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
    // In view mode, × closes at once.
    flushSync(() => root.unmount());
    root = createRoot(host);
    mount(routine({ type: "cron", expression: "0 9 * * *", timeZone: "UTC" }), onClose, { presentation: "panel", onDismiss });
    await act(async () => { host.querySelector<HTMLButtonElement>("[data-editor-close]")!.click(); });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("a new routine opens editable, with no trash", () => {
    flushSync(() => root.render(hosted(createElement(RoutineEditor, { bots: [bot], lockedBotId: bot.id, presentation: "panel", onClose: vi.fn() }))));
    expect(host.querySelector("[data-routine-editor-name]")).not.toBeNull();
    expect(host.querySelector("[data-routine-delete]")).toBeNull();
    expect(button("Schedule routine")).toBeDefined();
  });
});

describe("the routine panel page layout (2026-11-06, the owner)", () => {
  const pageSlots = () => ({
    status: createElement("div", { "data-test-status": "" }),
    runs: createElement("section", { "data-routine-runs": "" }),
    runAs: createElement("div", { "data-test-run-as": "" }, "Runs as"),
    badge: createElement("span", { "data-routine-state-badge": "warning" }, "Failing"),
  });
  const mountPage = () => mount(routine({ type: "cron", expression: "30 8 * * 1-5", timeZone: "America/Toronto" }), vi.fn(), { presentation: "panel", page: pageSlots(), onDuplicate: vi.fn() });

  it("puts Runs as inside Advanced only, Runs before Advanced, the state badge in the header", () => {
    mountPage();
    const advanced = host.querySelector("[data-routine-editor-more]")!;
    const runAs = host.querySelectorAll("[data-test-run-as]");
    expect(runAs.length).toBe(1);
    expect(advanced.contains(runAs[0]!)).toBe(true);
    const runs = host.querySelector("[data-routine-runs]")!;
    expect(runs.compareDocumentPosition(advanced) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(advanced.contains(runs)).toBe(false);
    expect(host.querySelector("[data-routine-state-badge]")?.textContent).toBe("Failing");
  });

  it("gives Instruction at least 45% of the panel height, the scroll area being a size container", () => {
    mountPage();
    const instruction = host.querySelector("[data-routine-instruction-fill]")!;
    expect(instruction.className).toContain("min-h-[45cqh]");
    expect(host.querySelector("[data-routine-editor-scroll]")!.className).toContain("[container-type:size]");
  });

  it("drops Next runs, folds Required skills, MCP, Mail tag, Duplicate and the server note under More in Advanced", () => {
    mountPage();
    expect(host.textContent).not.toContain("Next runs");
    expect(host.textContent).not.toContain("Clock changes");
    const advanced = openAdvanced();
    const more = advanced.querySelector("[data-routine-advanced-more]")!;
    expect(more).not.toBeNull();
    expect(more.tagName).toBe("DETAILS");
    expect(more.querySelector("[data-routine-mail-alias]")).not.toBeNull();
    expect(more.querySelector("[data-routine-duplicate]")).not.toBeNull();
    expect(more.textContent).toContain("Required skills");
    expect(more.textContent).toContain("Required MCP servers");
    expect(host.querySelectorAll("[data-routine-mail-alias]").length).toBe(1);
    expect(host.querySelectorAll("[data-routine-duplicate]").length).toBe(1);
  });

  it("keeps the old layout outside the page (no More fold)", () => {
    mount(routine({ type: "cron", expression: "30 8 * * 1-5", timeZone: "America/Toronto" }), vi.fn(), { presentation: "panel", onDuplicate: vi.fn() });
    openAdvanced();
    expect(host.querySelector("[data-routine-advanced-more]")).toBeNull();
    expect(host.querySelector("[data-routine-instruction-fill]")).toBeNull();
  });
});
