// @vitest-environment happy-dom
// "Edit routine" (2026-11-02, JC: Cursor-simple): the simple view is the name,
// the prompt (toolbar only while editing), one "When to run" row whose picker
// opens on click, the trigger details when needed, Save and Cancel. Every
// other setting is under Advanced, folded by default (remembered per person)
// with a summary of what differs from the defaults. One field per time: the
// first time only in When to run, the extra ones only in Advanced.
import { act, createElement, type ReactNode } from "react";
import { ConfirmProvider } from "@/components/ConfirmProvider";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";
import type { Routine } from "../../shared/routines";
import { ROUTINE_EDITOR_MORE_KEY } from "@/lib/routine-editor-more-pref";

const fixture = vi.hoisted(() => ({ webhooks: [] as unknown[], lastUpsert: null as unknown }));
vi.mock("@/hooks/use-modal-dialog", () => ({ useModalDialog: () => {} }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    api: vi.fn(async (path: string, init?: { method?: string; body?: string }) => {
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
      return {};
    }),
    useStore: () => ({ state: { ...original.initialState, webhooks: fixture.webhooks, webhookIngress: { available: true, baseUrl: "https://hooks.example.test" } }, dispatch: vi.fn() }),
  };
});
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { host: {}, dictation: { available: false } }, ready: true }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

const { setLocale } = await import("@/lib/i18n");
const { RoutineEditor } = await import("./RoutineCalendarPage");

const bot = { id: "runner", threadId: "main", name: "Runner", color: "green", tasks: [], modelSelection: { instanceId: "t", model: "t" } } as unknown as Bot;
const routine = (schedule: Routine["schedule"]): Routine => ({
  id: "r1", name: "Weekly digest", prompt: "Summarise the week", target: "bot", botId: bot.id,
  runOn: "maus", enabled: true, schedule, durationMinutes: 30, nextRunAt: null, createdAt: 1, updatedAt: 1, postResults: true,
});

let host: HTMLDivElement;
let root: Root;
const hosted = (node: ReactNode) => createElement(ConfirmProvider, null, node);
const mount = (value: Routine, onClose = vi.fn()) => {
  flushSync(() => root.render(hosted(createElement(RoutineEditor, { routine: value, bots: [bot], lockedBotId: bot.id, onClose }))));
  return onClose;
};

beforeEach(() => {
  setLocale("en");
  fixture.webhooks = [];
  fixture.lastUpsert = null;
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

describe("Edit routine", () => {
  it("shows only the essentials: name, prompt, one When to run row; Advanced folded with its summary", () => {
    mount(routine({ type: "cron", expression: "30 8,12,16 * * 1-5", timeZone: "America/Toronto" }));
    expect(host.querySelector("[data-editor-title]")?.textContent).toBe("Edit routine");
    expect(host.querySelector<HTMLInputElement>("[data-routine-editor-name]")?.value).toBe("Weekly digest");
    expect(host.querySelector("[data-routine-editor-summary]")).toBeNull();
    const sections = [...host.querySelectorAll("[data-routine-editor-section]")].map((section) => section.getAttribute("data-routine-editor-section"));
    expect(sections).toEqual(["what", "when"]);
    const when = host.querySelector("[data-routine-editor-section=when]")!;
    expect(when.querySelector("h3")?.textContent).toBe("When to run");
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
    expect(more.querySelector("[data-routine-post-results]")?.textContent).toContain("Off keeps each run in the background.");
    expect(more.textContent).toContain("Passed to each local run.");
    // The long explanation is behind a "?" button, not a paragraph under the toggle.
    const postRow = more.querySelector("[data-routine-post-results]")!;
    expect([...postRow.querySelectorAll("button")].some((button) => /Post results in the conversation/.test(button.getAttribute("aria-label") ?? ""))).toBe(true);
    expect([...postRow.querySelectorAll("span.block")].map((span) => span.textContent)).toEqual(["Off keeps each run in the background."]);
    // The prompt reads as text: no toolbar until the person edits it.
    const editor = host.querySelector<HTMLElement>("[data-markdown-editor]")!;
    expect(editor.getAttribute("data-md-compact")).toBe("");
    expect(editor.querySelector("[data-md-toolbar]")).toBeNull();
    expect(host.querySelector("[data-markdown-count]")).toBeNull();
    flushSync(() => editor.dispatchEvent(new FocusEvent("focusin", { bubbles: true })));
    expect(editor.querySelector("[data-md-toolbar] [data-md-full]")).not.toBeNull();
    expect(host.textContent).not.toMatch(/cron/i);
    expect(host.querySelector("[data-editor-dirty]")).toBeNull();
  });

  it("says Default settings when nothing differs, and names each non-default", () => {
    mount({ ...routine({ type: "cron", expression: "0 9 * * *", timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }), postResults: false });
    expect(host.querySelector("[data-routine-advanced-summary]")?.textContent).toBe("· Default settings");
  });

  it("has one field per time: the first time only in When to run, the extra ones only in Advanced", () => {
    mount(routine({ type: "cron", expression: "30 8,12,16 * * 1-5", timeZone: "America/Toronto" }));
    flushSync(() => host.querySelector<HTMLButtonElement>("[data-routine-when-row]")!.click());
    const more = host.querySelector<HTMLDetailsElement>("[data-routine-editor-more]")!;
    flushSync(() => {
      more.open = true;
      more.dispatchEvent(new Event("toggle", { bubbles: true }));
    });
    const labels = [...host.querySelectorAll<HTMLInputElement>("input[data-schedule-time]")].map((input) => input.getAttribute("aria-label"));
    expect(labels).toEqual(["Time 1", "Time 2", "Time 3"]);
    expect(host.querySelector("[data-routine-editor-section=when] input[aria-label='Time 1']")).not.toBeNull();
    expect(more.querySelector("input[aria-label='Time 1']")).toBeNull();
    expect(more.querySelector("[data-schedule-extra-times]")?.textContent).toContain("Also at");
  });

  it("saves every field as it was (round trip) and the changes made in both views", async () => {
    const attachment = { id: "a1", kind: "file" as const, name: "brief.md", path: "/tmp/brief.md", size: 12 };
    const onClose = vi.fn();
    mount({
      ...routine({ type: "cron", expression: "30 8,12 * * 1-5", timeZone: "America/Toronto", timing: "flexible", windowEarlyMinutes: 10, windowLateMinutes: 5 } as Routine["schedule"]),
      timeoutMinutes: 45, overlap: "queue", autoPauseAfter: 3, continuity: true, onlyWhenPresent: true, postResults: false, mailAlias: "reports", attachments: [attachment],
    } as Routine, onClose);
    const summary = host.querySelector("[data-routine-advanced-summary]")?.textContent ?? "";
    for (const part of ["Attachments: 1", "Extra times: 1", "Flexible timing", "Stops if still running after 45 min", "Queue one run", "Remember the last run", "Only when I'm here", "Mail tag +reports"]) expect(summary).toContain(part);
    const save = [...host.querySelectorAll("button")].find((button) => button.textContent === "Save")!;
    flushSync(() => save.click());
    await vi.waitFor(() => expect(fixture.lastUpsert).not.toBeNull());
    expect(fixture.lastUpsert).toMatchObject({
      name: "Weekly digest", prompt: "Summarise the week", botId: bot.id, runOn: "maus",
      schedule: { type: "cron", expression: "30 8,12 * * 1-5", timeZone: "America/Toronto", timing: "flexible", windowEarlyMinutes: 10, windowLateMinutes: 5 },
      timeoutMinutes: 45, overlap: "queue", autoPauseAfter: 3, continuity: true, onlyWhenPresent: true, postResults: false, mailAlias: "reports", attachments: [attachment],
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    // Changed: the first time in When to run, an extra time and a switch in Advanced.
    fixture.lastUpsert = null;
    flushSync(() => root.unmount());
    root = createRoot(host);
    mount(routine({ type: "cron", expression: "30 8,12 * * 1-5", timeZone: "America/Toronto" }));
    flushSync(() => host.querySelector<HTMLButtonElement>("[data-routine-when-row]")!.click());
    const setValue = (input: HTMLInputElement, value: string) => flushSync(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    setValue(host.querySelector<HTMLInputElement>("input[aria-label='Time 1']")!, "07:15");
    setValue(host.querySelector<HTMLInputElement>("input[aria-label='Time 2']")!, "13:15");
    const present = host.querySelector("[data-routine-only-present] [role=switch]") as HTMLButtonElement;
    flushSync(() => present.click());
    expect(host.querySelector("[data-routine-advanced-summary]")?.textContent).toContain("Only when I'm here");
    flushSync(() => [...host.querySelectorAll("button")].find((button) => button.textContent === "Save")!.click());
    await vi.waitFor(() => expect(fixture.lastUpsert).not.toBeNull());
    expect(fixture.lastUpsert).toMatchObject({ schedule: { expression: "15 7,13 * * 1-5", timeZone: "America/Toronto" }, onlyWhenPresent: true });
  });

  it("keeps Advanced collapsed by default and remembers the person's choice", () => {
    mount(routine({ type: "cron", expression: "0 9 * * *", timeZone: "UTC" }));
    const more = host.querySelector<HTMLDetailsElement>("[data-routine-editor-more]")!;
    expect(more.open).toBe(false);
    expect(localStorage.getItem(ROUTINE_EDITOR_MORE_KEY)).toBeNull();
    flushSync(() => {
      more.open = true;
      more.dispatchEvent(new Event("toggle", { bubbles: true }));
    });
    expect(localStorage.getItem(ROUTINE_EDITOR_MORE_KEY)).toBe("1");
    flushSync(() => root.unmount());
    host.remove();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    mount(routine({ type: "cron", expression: "0 9 * * *", timeZone: "UTC" }));
    expect(host.querySelector<HTMLDetailsElement>("[data-routine-editor-more]")!.open).toBe(true);
  });

  it("puts timezone, extra times, timing and overlap under Advanced, and saves them", async () => {
    const onClose = vi.fn();
    mount(routine({ type: "cron", expression: "30 8 * * 1-5", timeZone: "America/Toronto" }), onClose);
    const more = host.querySelector<HTMLDetailsElement>("[data-routine-editor-more]")!;
    flushSync(() => {
      more.open = true;
      more.dispatchEvent(new Event("toggle", { bubbles: true }));
    });
    expect(more.querySelector("[data-human-schedule=advanced]")).not.toBeNull();
    expect(more.querySelector("[data-schedule-zone]")).not.toBeNull();
    expect(more.querySelector("[data-schedule-add-time]")).not.toBeNull();
    expect(more.querySelector("[data-routine-timing]")).not.toBeNull();
    expect(host.querySelector("[data-routine-editor-section=when] [data-schedule-zone]")).toBeNull();
    expect(host.querySelector("[data-routine-editor-section=when] [data-schedule-add-time]")).toBeNull();
    expect(host.querySelector("[data-routine-editor-section=when] [data-routine-timing]")).toBeNull();

    const zone = more.querySelector<HTMLSelectElement>("[data-schedule-zone]")!;
    flushSync(() => {
      zone.value = "America/New_York";
      zone.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const overlap = more.querySelector<HTMLSelectElement>('select[aria-label="If the previous run is still working"]')!;
    flushSync(() => {
      overlap.value = "queue";
      overlap.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const timing = more.querySelector<HTMLSelectElement>('select[aria-label="Timing"]')!;
    flushSync(() => {
      timing.value = "flexible";
      timing.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(host.querySelector("[data-editor-dirty]")).not.toBeNull();
    const save = [...host.querySelectorAll("button")].find((button) => button.textContent === "Save")!;
    expect(save.disabled).toBe(false);
    flushSync(() => save.click());
    await vi.waitFor(() => expect(fixture.lastUpsert).not.toBeNull());
    const body = fixture.lastUpsert as { schedule?: { timeZone?: string; timing?: string }; overlap?: string };
    expect(body.schedule?.timeZone).toBe("America/New_York");
    expect(body.schedule?.timing).toBe("flexible");
    expect(body.overlap).toBe("queue");
    expect(onClose).toHaveBeenCalled();
  });

  it("panel presentation edits in place with Back, without a modal overlay", () => {
    flushSync(() => root.render(hosted(createElement(RoutineEditor, {
      routine: routine({ type: "cron", expression: "0 9 * * *", timeZone: "UTC" }),
      bots: [bot],
      lockedBotId: bot.id,
      presentation: "panel",
      onClose: vi.fn(),
    }))));
    expect(host.querySelector("[data-routine-editor-presentation=panel]")).not.toBeNull();
    expect(host.querySelector("[data-editor-back]")).not.toBeNull();
    expect(host.querySelector(".fixed.inset-0.z-50")).toBeNull();
    expect(host.querySelector("[data-editor-title]")?.textContent).toBe("Edit routine");
  });

  it("panel Back asks before discarding unsaved changes", async () => {
    const onClose = vi.fn();
    flushSync(() => root.render(hosted(createElement(RoutineEditor, {
      routine: routine({ type: "cron", expression: "0 9 * * *", timeZone: "UTC" }),
      bots: [bot],
      lockedBotId: bot.id,
      presentation: "panel",
      onClose,
    }))));
    const name = host.querySelector<HTMLInputElement>("[data-routine-editor-name]")!;
    flushSync(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "Renamed");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.querySelector("[data-editor-dirty]")).not.toBeNull();
    await act(async () => { host.querySelector<HTMLButtonElement>("[data-editor-back]")!.click(); });
    expect(document.getElementById("confirm-dialog-body")?.textContent).toBe("Close without saving your changes?");
    await act(async () => { [...document.querySelectorAll("button")].find((button) => button.textContent === "Cancel")!.click(); });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { host.querySelector<HTMLButtonElement>("[data-editor-back]")!.click(); });
    await act(async () => { (document.querySelector("[data-confirm-action]") as HTMLButtonElement).click(); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("says a change is not saved and asks before closing over it", async () => {
    const onClose = mount(routine({ type: "cron", expression: "0 9 * * *", timeZone: "UTC" }));
    const name = host.querySelector<HTMLInputElement>("[data-routine-editor-name]")!;
    flushSync(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "Daily digest");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.querySelector("[data-editor-dirty]")?.textContent).toBe("Not saved");
    const cancel = [...host.querySelectorAll("button")].find((button) => button.textContent === "Cancel")!;
    await act(async () => { cancel.click(); });
    expect(document.getElementById("confirm-dialog-body")?.textContent).toBe("Close without saving your changes?");
    await act(async () => { [...document.querySelectorAll("button")].find((button) => button.textContent === "Cancel" && button.closest("[role=alertdialog]"))!.click(); });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { cancel.click(); });
    await act(async () => { (document.querySelector("[data-confirm-action]") as HTMLButtonElement).click(); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("manages a webhook routine's webhook in When", () => {
    fixture.webhooks = [{ id: "w1", endpointId: "wh_abc", routineId: "r1", name: "Weekly digest", prompt: "", botId: bot.id, runOn: "maus", enabled: true, createdAt: 1, updatedAt: 1, deliveryCount: 2, tokenLast4: "k3Yz" }];
    mount(routine({ type: "webhook" }));
    const when = host.querySelector("[data-routine-editor-section=when]")!;
    // The trigger details show without opening the picker.
    expect(when.querySelector("[data-schedule-frequency]")).toBeNull();
    expect(when.querySelector("[data-webhook-url]")?.textContent).toBe("https://hooks.example.test/hooks/wh_abc");
    expect(when.textContent).toContain("whsec_••••k3Yz");
    expect(when.textContent).toContain("Copy a curl example");
    expect(when.querySelector("[data-routine-when-sentence]")?.textContent).toBe("When a webhook fires");
    flushSync(() => when.querySelector<HTMLButtonElement>("[data-routine-when-row]")!.click());
    expect(when.querySelector("[data-schedule-frequency]")?.getAttribute("data-schedule-frequency")).toBe("webhook");
  });

  it("opens read-only for a routine the person cannot change: fields off, no Save, its owner named", () => {
    mount({ ...routine({ type: "cron", expression: "0 9 * * *", timeZone: "UTC" }), canEdit: false, owner: { id: "pr_other", name: "Alex" } } as Routine);
    expect(host.querySelector("[data-editor-title]")?.textContent).toBe("Routine");
    expect(host.querySelector("[data-routine-editor-readonly]")).not.toBeNull();
    expect(host.querySelector("[data-routine-editor-owner]")?.textContent).toBe("Owner: Alex");
    expect(host.querySelector<HTMLFieldSetElement>("fieldset")?.disabled).toBe(true);
    const labels = [...host.querySelectorAll("button")].map((button) => button.textContent);
    expect(labels).toContain("Close");
    expect(labels).not.toContain("Save");
  });
});
