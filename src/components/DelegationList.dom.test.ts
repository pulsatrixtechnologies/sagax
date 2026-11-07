// @vitest-environment happy-dom
// The teammates a run handed work to, as Grok Bot's sub-agent list (owner,
// 2026-11-06): one intro line, a light row per teammate (mark, task in ink,
// model in grey, state under it), "Waiting for ..." with the sheen while any
// still runs, and the row's click unchanged: it opens that bot's work.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";
import { DelegationList, delegationState, type DelegationEntry } from "./DelegationList";

const bot = (id: string, name: string, tasks: Bot["tasks"] = []): Bot => ({
  id, name, threadId: `${id}-main`, title: "", description: "", color: "green", unread: false, notifications: true,
  messages: [], modelSelection: { instanceId: "fake", model: "test" }, tasks,
});

const entries: DelegationEntry[] = [
  { botId: "harrie", threadId: "harrie-work", name: "Harrie", status: "completed", task: "Reconcile the bank sheet", finishedAt: Date.UTC(2026, 10, 6, 14), note: "Sheet balanced" },
  { botId: "orla", threadId: "orla-work", name: "Orla", status: "running", task: "Draft the client summary", startedAt: Date.UTC(2026, 10, 6, 13) },
];

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
});

function render(props: Parameters<typeof DelegationList>[0]) {
  flushSync(() => root.render(createElement(DelegationList, props)));
}

describe("DelegationList", () => {
  it("groups every hand-off under one intro line, task in ink, name and model in grey, no label lost", () => {
    render({ entries, modelOf: (id) => (id === "harrie" ? "Opus High" : "Sonnet") });
    const intro = host.querySelector("[data-delegation-intro]");
    expect(intro?.textContent).toBe("Sent work to Harrie, Orla");
    const rows = host.querySelectorAll("[data-run-handed-to] > li");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.getAttribute("data-run-handoff")).toBe("harrie");
    expect(rows[0]!.querySelector("[data-delegation-title]")?.textContent).toBe("Reconcile the bank sheet");
    expect(rows[0]!.querySelector("[data-delegation-meta]")?.textContent).toBe("Harrie · Opus High");
    expect(rows[0]!.querySelector("[data-run-handoff-status]")?.textContent).toBe("Completed");
    // status, time and the result note stay reachable in the tooltip
    const tip = rows[0]!.querySelector("[title]")?.getAttribute("title") ?? "";
    expect(tip).toContain("Harrie");
    expect(tip).toContain("Completed");
    expect(tip).toContain("Sheet balanced");
    // no box: no border on the list or its rows
    expect(host.querySelector("[data-delegation-list]")?.className).not.toMatch(/\bborder\b/);
  });

  it("a running row spins and shimmers Planning next moves, and the list says Waiting for that bot", () => {
    render({ entries });
    const running = host.querySelector('[data-delegation-state="running"]')!;
    expect(running.querySelector("[data-run-handoff-status]")?.textContent).toBe("Planning next moves");
    expect(running.querySelector("[data-run-handoff-status] .thinking-shimmer")).not.toBeNull();
    expect(host.querySelector('[data-delegation-state="completed"] .thinking-shimmer')).toBeNull();
    expect(host.querySelector("[data-delegation-waiting] .thinking-shimmer")).not.toBeNull();
    expect(host.querySelector('[data-delegation-state="completed"]')).not.toBeNull();
    expect(host.querySelector("[data-delegation-waiting]")?.textContent).toBe("Waiting for Orla");
  });

  it("counts teammates still running, and drops the waiting line once all are done", () => {
    render({ entries: entries.map((entry) => ({ ...entry, status: "running" })) });
    expect(host.querySelector("[data-delegation-waiting]")?.textContent).toBe("Waiting for 2 teammates");
    render({ entries: entries.map((entry) => ({ ...entry, status: "completed" })) });
    expect(host.querySelector("[data-delegation-waiting]")).toBeNull();
  });

  it("a click opens the same thing as before: onOpen with the teammate and its conversation", () => {
    const onOpen = vi.fn();
    render({ entries, onOpen });
    const button = host.querySelector<HTMLButtonElement>('[data-run-teammate-thread="orla-work"]')!;
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("aria-label")).toBe("See Orla's work, Planning next moves");
    button.click();
    expect(onOpen).toHaveBeenCalledWith("orla", "orla-work");
    expect(host.textContent).not.toMatch(/Open thread/i);
  });

  it("without onOpen the rows are not buttons", () => {
    render({ entries });
    expect(host.querySelector("button")).toBeNull();
    expect(host.querySelector("[data-run-teammate-thread]")).toBeNull();
  });

  it("the teammate's live conversation corrects a stale Running", () => {
    const entry = entries[1]!;
    expect(delegationState(entry)).toBe("running");
    expect(delegationState(entry, bot("orla", "Orla", [{ threadId: "orla-work", title: "", createdAt: 1, busy: true }]))).toBe("running");
    expect(delegationState(entry, bot("orla", "Orla", [{ threadId: "orla-work", title: "", createdAt: 1, busy: false }]))).toBe("ended");
    expect(delegationState(entry, bot("orla", "Orla", [{ threadId: "orla-work", title: "", createdAt: 1, activity: "waiting-on-you" }]))).toBe("waiting");
    expect(delegationState({ ...entry, status: "needs_input" })).toBe("waiting");
    expect(delegationState({ ...entry, status: "cancelled" })).toBe("failed");
  });
});
