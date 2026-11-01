// @vitest-environment happy-dom
// "Edit routine" (2026-11-01 Grok-simple): titled for a routine, the name up
// top with a one-line summary, What / When / Where results go in that order,
// More options folded (remembered per person), Save and Cancel always there,
// unsaved changes said and confirmed before closing. Advanced schedule,
// timing, overlap and auto-pause live under More and still save. A webhook
// routine picks "When a webhook arrives" and manages its webhook in When.
import { createElement } from "react";
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
const mount = (value: Routine, onClose = vi.fn()) => {
  flushSync(() => root.render(createElement(RoutineEditor, { routine: value, bots: [bot], lockedBotId: bot.id, onClose })));
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
  it("reads as a routine: title, name, summary, then What, When, Where it runs, More options", () => {
    mount(routine({ type: "cron", expression: "30 8,12,16 * * 1-5", timeZone: "America/Toronto" }));
    expect(host.querySelector("[data-editor-title]")?.textContent).toBe("Edit routine");
    expect(host.querySelector<HTMLInputElement>("[data-routine-editor-name]")?.value).toBe("Weekly digest");
    expect(host.querySelector("[data-routine-editor-summary]")?.textContent).toBe("Weekdays, at 8:30 AM, 12:30 PM and 4:30 PM (Toronto time) · Results in the conversation");
    const sections = [...host.querySelectorAll("[data-routine-editor-section]")].map((section) => section.getAttribute("data-routine-editor-section"));
    expect(sections).toEqual(["what", "when", "where"]);
    expect(host.querySelector("[data-human-schedule=essentials]")).not.toBeNull();
    expect(host.querySelector("[data-schedule-more-times]")?.textContent).toMatch(/\+2 more/);
    const more = host.querySelector<HTMLDetailsElement>("[data-routine-editor-more]")!;
    expect(more.open).toBe(false);
    expect(more.textContent).toContain("If the previous run is still working");
    expect(more.textContent).toContain("Only when I'm here");
    expect(host.querySelector("[data-routine-editor-section=where] [data-routine-post-results]")).not.toBeNull();
    expect(host.querySelector("[data-markdown-editor]")?.querySelector("[data-md-full]")).not.toBeNull();
    expect(host.textContent).not.toMatch(/cron/i);
    expect(host.querySelector("[data-editor-dirty]")).toBeNull();
  });

  it("keeps More options collapsed by default and remembers the person's choice", () => {
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

  it("puts timezone, extra times, timing and overlap under More, and saves them", async () => {
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
    flushSync(() => root.render(createElement(RoutineEditor, {
      routine: routine({ type: "cron", expression: "0 9 * * *", timeZone: "UTC" }),
      bots: [bot],
      lockedBotId: bot.id,
      presentation: "panel",
      onClose: vi.fn(),
    })));
    expect(host.querySelector("[data-routine-editor-presentation=panel]")).not.toBeNull();
    expect(host.querySelector("[data-editor-back]")).not.toBeNull();
    expect(host.querySelector(".fixed.inset-0.z-50")).toBeNull();
    expect(host.querySelector("[data-editor-title]")?.textContent).toBe("Edit routine");
  });

  it("panel Back asks before discarding unsaved changes", () => {
    const onClose = vi.fn();
    flushSync(() => root.render(createElement(RoutineEditor, {
      routine: routine({ type: "cron", expression: "0 9 * * *", timeZone: "UTC" }),
      bots: [bot],
      lockedBotId: bot.id,
      presentation: "panel",
      onClose,
    })));
    const name = host.querySelector<HTMLInputElement>("[data-routine-editor-name]")!;
    flushSync(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "Renamed");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.querySelector("[data-editor-dirty]")).not.toBeNull();
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    flushSync(() => host.querySelector<HTMLButtonElement>("[data-editor-back]")!.click());
    expect(confirm).toHaveBeenCalledWith("Close without saving your changes?");
    expect(onClose).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    flushSync(() => host.querySelector<HTMLButtonElement>("[data-editor-back]")!.click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("says a change is not saved and asks before closing over it", () => {
    const onClose = mount(routine({ type: "cron", expression: "0 9 * * *", timeZone: "UTC" }));
    const name = host.querySelector<HTMLInputElement>("[data-routine-editor-name]")!;
    flushSync(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "Daily digest");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.querySelector("[data-editor-dirty]")?.textContent).toBe("Not saved");
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    const cancel = [...host.querySelectorAll("button")].find((button) => button.textContent === "Cancel")!;
    flushSync(() => cancel.click());
    expect(confirm).toHaveBeenCalledWith("Close without saving your changes?");
    expect(onClose).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    flushSync(() => cancel.click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("manages a webhook routine's webhook in When", () => {
    fixture.webhooks = [{ id: "w1", endpointId: "wh_abc", routineId: "r1", name: "Weekly digest", prompt: "", botId: bot.id, runOn: "maus", enabled: true, createdAt: 1, updatedAt: 1, deliveryCount: 2, tokenLast4: "k3Yz" }];
    mount(routine({ type: "webhook" }));
    expect(host.querySelector<HTMLSelectElement>("[data-schedule-frequency]")?.value).toBe("webhook");
    const when = host.querySelector("[data-routine-editor-section=when]")!;
    expect(when.querySelector("[data-webhook-url]")?.textContent).toBe("https://hooks.example.test/hooks/wh_abc");
    expect(when.textContent).toContain("whsec_••••k3Yz");
    expect(when.textContent).toContain("Copy a curl example");
    expect(host.querySelector("[data-routine-editor-summary]")?.textContent).toContain("When a webhook fires");
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
