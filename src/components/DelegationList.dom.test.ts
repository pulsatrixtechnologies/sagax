// @vitest-environment happy-dom
// The work a bot handed to teammates, as one card of the coding job family
// (#2719, owner 2026-11-08: "it should be in a card, otherwise it looks weird
// in the chat"): a provenance line (Teammates · time · status with its
// icon), one bubble with the "Sent work to ..." title and a row per
// teammate (task, bot · model readable, state with its icon), folded once
// every teammate finished, and a click on a row that opens that teammate's
// work right there under the card (no conversation switch, no "Open thread").
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";
import { DelegationList, delegationState, type DelegationEntry } from "./DelegationList";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The teammate's live conversation is the real one (ActivityConversation);
// here a stub that only shows which conversation it was given.
vi.mock("./bot-settings/ActivityConversation", async () => {
  const { createElement: h } = await import("react");
  return {
    default: (props: { botId: string; threadId: string; title: string; onClose?: () => void }) =>
      h("div", { "data-test-conversation": props.threadId, "data-test-title": props.title },
        h("button", { type: "button", "data-test-close": "", onClick: props.onClose }, "close")),
  };
});

const bot = (id: string, name: string, tasks: Bot["tasks"] = []): Bot => ({
  id, name, threadId: `${id}-main`, title: "", description: "", color: "green", unread: false, notifications: true,
  messages: [], modelSelection: { instanceId: "fake", model: "test" }, tasks,
});

const entries: DelegationEntry[] = [
  { botId: "harrie", threadId: "harrie-work", name: "Hollis", status: "completed", task: "Reconcile the bank sheet", finishedAt: Date.UTC(2026, 10, 6, 14), note: "Sheet balanced" },
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
  act(() => root.unmount());
  host.remove();
});

/** A different key mounts a fresh card (its folded/open state starts over). */
function render(props: Parameters<typeof DelegationList>[0], key = "card") {
  act(() => { root.render(createElement(DelegationList, { key, ...props })); });
}
const click = (selector: string) => act(async () => { host.querySelector<HTMLButtonElement>(selector)!.click(); });
const settle = () => act(async () => { await new Promise((done) => setTimeout(done, 0)); });

describe("DelegationList", () => {
  it("is one card of the coding job family: Teammates · status above one bubble with the title and every row", () => {
    render({ entries, modelOf: (id) => (id === "harrie" ? "Opus High" : "Sonnet") });
    const card = host.querySelector("[data-delegation-card]")!;
    expect(card.tagName).toBe("SECTION");
    expect(card.getAttribute("data-delegation-card-state")).toBe("running");
    const provenance = card.querySelector("[data-delegation-provenance]")!;
    expect(provenance.textContent).toContain("Teammates");
    expect(provenance.querySelector("svg")).not.toBeNull();
    expect(card.querySelector("[data-delegation-card-status]")?.textContent).toBe("Waiting for Orla");
    const bubble = card.querySelector("[data-delegation-bubble]")!;
    expect(bubble.className).toMatch(/\bbg-bubble-bot\b/);
    expect(bubble.className).toMatch(/rounded-\[18px\]/);
    expect(bubble.querySelector("[data-delegation-intro]")?.textContent).toBe("Sent work to Hollis, Orla");
    const rows = bubble.querySelectorAll("[data-run-handed-to] > li");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.getAttribute("data-run-handoff")).toBe("harrie");
    expect(rows[0]!.querySelector("[data-delegation-title]")?.textContent).toBe("Reconcile the bank sheet");
    expect(rows[0]!.querySelector("[data-delegation-meta]")?.textContent).toBe("Hollis · Opus High");
    expect(rows[0]!.querySelector("[data-run-handoff-status]")?.textContent).toBe("Completed");
    // the result note reads in the row, and the tooltip keeps everything
    expect(rows[0]!.querySelector("[data-delegation-note]")?.textContent).toBe("Sheet balanced");
    const tip = rows[0]!.querySelector("[title]")?.getAttribute("title") ?? "";
    expect(tip).toContain("Hollis");
    expect(tip).toContain("Completed");
    expect(tip).toContain("Sheet balanced");
    // one card depth: no box inside the bubble
    expect(bubble.querySelector("[data-run-handed-to]")?.className).not.toMatch(/\bborder\b/);
  });

  it("never truncates the task or the bot · model sub-label (no more 'Grok ...')", () => {
    render({ entries, modelOf: () => "Grok 4 Fast Reasoning" });
    for (const selector of ["[data-delegation-title]", "[data-delegation-meta]"]) {
      const nodes = host.querySelectorAll(selector);
      expect(nodes.length).toBeGreaterThan(0);
      for (const node of nodes) expect(node.className).not.toMatch(/\btruncate\b/);
    }
  });

  it("a running row spins and shimmers Planning next moves, and the card status says Waiting for that bot", () => {
    render({ entries });
    const running = host.querySelector('[data-delegation-state="running"]')!;
    expect(running.querySelector("[data-run-handoff-status]")?.textContent).toBe("Planning next moves");
    expect(running.querySelector("[data-run-handoff-status] .thinking-shimmer")).not.toBeNull();
    expect(running.querySelector("[data-coding-spinner]")).not.toBeNull();
    expect(host.querySelector('[data-delegation-state="completed"] .thinking-shimmer')).toBeNull();
    expect(host.querySelector('[data-delegation-state="completed"]')).not.toBeNull();
    expect(host.querySelector("[data-delegation-waiting] .thinking-shimmer")).not.toBeNull();
    expect(host.querySelector("[data-delegation-waiting]")?.textContent).toBe("Waiting for Orla");
  });

  it("counts teammates still running, and the status settles once all are done, failed or waiting", () => {
    render({ entries: entries.map((entry) => ({ ...entry, status: "running" })) });
    expect(host.querySelector("[data-delegation-waiting]")?.textContent).toBe("Waiting for 2 teammates");
    render({ entries: entries.map((entry) => ({ ...entry, status: "completed" })) });
    expect(host.querySelector("[data-delegation-waiting]")).toBeNull();
    expect(host.querySelector("[data-delegation-card]")?.getAttribute("data-delegation-card-state")).toBe("done");
    expect(host.querySelector("[data-delegation-card-status]")?.textContent).toBe("Completed");
    render({ entries: [entries[0]!, { ...entries[1]!, status: "cancelled" }] });
    expect(host.querySelector("[data-delegation-card]")?.getAttribute("data-delegation-card-state")).toBe("failed");
    expect(host.querySelector("[data-delegation-card-status]")?.textContent).toBe("Failed");
    render({ entries: [entries[0]!, { ...entries[1]!, status: "needs_input" }] });
    expect(host.querySelector("[data-delegation-card]")?.getAttribute("data-delegation-card-state")).toBe("waiting");
    expect(host.querySelector("[data-delegation-card-status]")?.textContent).toBe("Needs your answer");
  });

  it("folds once every teammate finished, stays open while one works, and the title toggles it", () => {
    render({ entries: entries.map((entry) => ({ ...entry, status: "completed" })) }, "done");
    const toggle = host.querySelector<HTMLButtonElement>("[data-delegation-toggle]")!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelector("[data-run-handed-to]")?.hasAttribute("hidden")).toBe(true);
    // folded, the rows are still in the page (the names stay findable)
    expect(host.querySelector('[data-run-handoff="harrie"]')).not.toBeNull();
    act(() => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector("[data-run-handed-to]")?.hasAttribute("hidden")).toBe(false);
    render({ entries }, "running");
    expect(host.querySelector("[data-delegation-toggle]")?.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector("[data-run-handed-to]")?.hasAttribute("hidden")).toBe(false);
  });

  it("a click on a row opens that teammate's work right there under the card, one at a time, and Close puts it away", async () => {
    render({ entries });
    const row = host.querySelector<HTMLButtonElement>('[data-delegation-reveal="orla-work"]')!;
    expect(row.tagName).toBe("BUTTON");
    expect(row.getAttribute("aria-label")).toBe("See Orla's work, Planning next moves");
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelector("[data-run-teammate-thread]")).toBeNull();
    expect(host.querySelector("[data-delegation-work]")).toBeNull();
    await click('[data-delegation-reveal="orla-work"]');
    await settle();
    const work = host.querySelector('[data-delegation-work="orla-work"]')!;
    expect(work).not.toBeNull();
    expect(work.getAttribute("role")).toBe("region");
    expect(work.getAttribute("aria-label")).toBe("Orla's work");
    expect(work.querySelector('[data-test-conversation="orla-work"]')?.getAttribute("data-test-title")).toBe("Draft the client summary");
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(host.textContent).not.toMatch(/Open thread|Go to conversation|Open the chat/i);
    // the other row takes the same place: never two conversations at once
    await click('[data-delegation-reveal="harrie-work"]');
    await settle();
    expect(host.querySelectorAll("[data-delegation-work]")).toHaveLength(1);
    expect(host.querySelector('[data-delegation-work="harrie-work"] [data-test-conversation="harrie-work"]')).not.toBeNull();
    expect(row.getAttribute("aria-expanded")).toBe("false");
    // Close in the conversation's header puts it away; the row again closes it too
    await click("[data-test-close]");
    expect(host.querySelector("[data-delegation-work]")).toBeNull();
    await click('[data-delegation-reveal="harrie-work"]');
    await settle();
    expect(host.querySelector('[data-delegation-work="harrie-work"]')).not.toBeNull();
    await click('[data-delegation-reveal="harrie-work"]');
    expect(host.querySelector("[data-delegation-work]")).toBeNull();
  });

  it("with onOpen (threads shown) a click opens the same thing as before", () => {
    const onOpen = vi.fn();
    render({ entries, onOpen });
    const button = host.querySelector<HTMLButtonElement>('[data-run-teammate-thread="orla-work"]')!;
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("aria-label")).toBe("See Orla's work, Planning next moves");
    act(() => button.click());
    expect(onOpen).toHaveBeenCalledWith("orla", "orla-work");
    expect(host.querySelector("[data-delegation-work]")).toBeNull();
    expect(host.querySelector("[data-delegation-reveal]")).toBeNull();
    expect(host.textContent).not.toMatch(/Open thread/i);
  });

  it("inline off: the rows are plain, not buttons", () => {
    render({ entries, inline: false });
    expect(host.querySelector("[data-run-handed-to] button")).toBeNull();
    expect(host.querySelector("[data-run-teammate-thread]")).toBeNull();
    expect(host.querySelector("[data-delegation-reveal]")).toBeNull();
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
