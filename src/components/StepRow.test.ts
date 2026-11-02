// @vitest-environment happy-dom
// The step rows of the thread: one look for a tool call, a folded run of
// them, the turn digest and the narration fold. Clicks are real here (the
// row has to open and close), so this mounts instead of rendering markup.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { Message } from "@/state/store";
import { ActivityRun } from "./ActivityRun";
import { DigestChip } from "./DigestChip";
import { ToolActivity } from "./ToolActivity";

let root: Root | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  flushSync(() => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
});

function mount(element: React.ReactElement): HTMLElement {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => root!.render(element));
  return host;
}

function click(element: Element | null | undefined) {
  if (!element) throw new Error("nothing to click");
  flushSync(() => (element as HTMLElement).click());
}

const step = (id: string, name: string, durationMs?: number, input?: string): Message => ({
  id, role: "bot", kind: "activity", at: 1, tool: { name, ok: true, durationMs, input },
});

describe("a tool step row", () => {
  it("opens under the row and closes again", () => {
    const node = mount(createElement(ToolActivity, { tool: { name: "WebSearch", ok: true, input: JSON.stringify({ query: "sagax" }), output: "3 results", durationMs: 1_500 } }));
    const row = node.querySelector("button")!;
    expect(row.textContent).toContain("Searched the web");
    expect(row.textContent).toContain("2s");
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(node.querySelector("[data-step-detail]")).toBeNull();
    click(row);
    expect(row.getAttribute("aria-expanded")).toBe("true");
    const detail = node.querySelector("[data-step-detail]")!;
    expect(detail.textContent).toContain("WebSearch");
    expect(detail.textContent).toContain("sagax");
    expect(detail.textContent).toContain("3 results");
    // the JSON stays folded until asked for
    expect(node.querySelector('[data-testid="tool-step-json"]')).toBeNull();
    click(node.querySelector('[data-testid="tool-step-json-toggle"]'));
    expect(node.querySelector('[data-testid="tool-step-json"]')?.textContent).toContain("\"tool\": \"WebSearch\"");
    click(row);
    expect(node.querySelector("[data-step-detail]")).toBeNull();
  });

  it("shows a short runCommand target without UUID or server path; full command in tooltip and detail", () => {
    const bot = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    const full = `ls /data/.sagax/bots/${bot}/sagax-plugins`;
    const node = mount(createElement(ToolActivity, { tool: { name: "Bash", ok: true, input: JSON.stringify({ command: full }), durationMs: 400 } }));
    const target = node.querySelector("[data-step-target]")!;
    expect(target.textContent).toBe("ls sagax-plugins");
    expect(target.textContent).not.toContain(bot);
    expect(target.textContent).not.toContain("/data/");
    expect(target.getAttribute("title")).toBe(full);
    click(node.querySelector("button"));
    expect(node.querySelector("[data-step-detail]")?.textContent).toContain(full);
  });
});

describe("a group of steps", () => {
  const steps = [step("a", "Read", 1_000), step("b", "Bash", 2_000), step("c", "mcp__x__acme_desk__find_tickets", 3_000)];
  const renderStep = (message: Message) => createElement(ToolActivity, { tool: message.tool! });
  const renderMessage = (message: Message) => createElement("p", null, message.text);

  it("reads as one line with the time only, then lists each step as its own row", () => {
    const node = mount(createElement(ActivityRun, { messages: steps, elapsedMs: 6_000, renderStep }));
    const row = node.querySelector("button")!;
    // folded: the duration alone, like "Thought 2s"; the count is spoken only
    expect(row.textContent).toBe("Worked 6s");
    expect(row.getAttribute("aria-label")).toBe("Worked 6s, 3 tools, press to see the detail");
    expect(row.querySelector("svg")?.getAttribute("data-quiet")).toBe("true");
    expect(node.querySelectorAll("[data-step-row]")).toHaveLength(1);
    click(row);
    const rows = node.querySelectorAll("[data-step-detail] [data-step-row]");
    expect(rows).toHaveLength(3);
    expect([...rows].map((entry) => entry.querySelector("[data-step-label]")?.textContent)).toEqual([
      "Read a file",
      "Ran a command",
      "Viewed tickets in Acme Desk",
    ]);
  });

  it("opens by itself for a search hit inside it", () => {
    const node = mount(createElement(ActivityRun, { messages: steps, focusedId: "b", renderStep }));
    expect(node.querySelectorAll("[data-step-detail] [data-step-row]")).toHaveLength(3);
  });

  it("keeps failures out of the folded line, shows them once open, and merges the same step repeated", () => {
    const tickets = JSON.stringify({ server: "pulsatrix-psa", tool: "acme_desk__query", args: { resource: "service.tickets" } });
    const failed = (id: string): Message => ({ id, role: "bot", kind: "activity", at: 1, tool: { name: "mcp", ok: false, input: tickets } });
    const done = (id: string): Message => ({ id, role: "bot", kind: "activity", at: 1, tool: { name: "mcp", ok: true, input: tickets } });
    const node = mount(createElement(ActivityRun, { messages: [done("1"), failed("2"), failed("3"), failed("4"), done("5")], renderStep }));
    const row = node.querySelector("button")!;
    expect(row.textContent).toBe("Worked");
    expect(row.textContent).not.toContain("failed");
    expect(row.getAttribute("aria-label")).toBe("Worked, 5 tools, 3 failed, press to see the detail");
    // no red on the folded line
    expect(row.querySelector(".text-danger, [class*='text-danger']")).toBeNull();
    click(row);
    expect(row.querySelector("svg")?.getAttribute("data-quiet")).toBeNull();
    const labels = [...node.querySelectorAll("[data-step-detail] > div > [data-step-row] > button [data-step-label], [data-step-detail] > div > .contents > [data-step-row] > button [data-step-label]")]
      .map((label) => label.textContent);
    expect(labels).toEqual([
      "Viewed tickets in Acme Desk",
      "Could not use Acme Desk ×3",
      "Viewed tickets in Acme Desk",
    ]);
    // the merged row opens to each call, each with its own detail
    click(node.querySelector('[data-testid="activity-run-repeat"] button'));
    expect(node.querySelectorAll('[data-testid="activity-run-repeat"] [data-testid="tool-activity"]')).toHaveLength(3);
  });

  it("says what runs now while the bot works, in place, without piling rows", () => {
    const live: Message = { id: "z", role: "bot", kind: "activity", at: 2, tool: { name: "WebSearch", input: JSON.stringify({ query: "sagax" }) } };
    const node = mount(createElement(ActivityRun, { messages: [...steps, live], renderStep }));
    expect(node.querySelectorAll("[data-step-row]")).toHaveLength(1);
    const label = node.querySelector("[data-step-label]")!;
    expect(label.textContent).toBe("Searching the web");
    expect(label.className).toContain("thinking-shimmer");
    expect(node.querySelector("button")?.textContent).not.toContain("tools");
    expect(node.querySelector("button")?.getAttribute("aria-label")).toContain("Searching the web");
    expect(node.querySelector('[data-testid="activity-run"]')?.getAttribute("data-live")).toBe("true");
  });

  it("reads a short turn's narration and tools as one line: Worked 15s", () => {
    const narration: Message = { id: "n0", role: "bot", kind: "text", at: 1, text: "Let me check.", turnId: "t" };
    const node = mount(createElement(ActivityRun, { messages: [narration, steps[0]!, steps[1]!], elapsedMs: 15_000, renderStep, renderMessage }));
    expect(node.querySelectorAll("[data-step-row]")).toHaveLength(1);
    expect(node.querySelector("button")?.textContent).toBe("Worked 15s");
    click(node.querySelector("button"));
    expect(node.textContent).toContain("Let me check.");
    expect(node.querySelectorAll("[data-step-detail] [data-step-row]")).toHaveLength(2);
  });

  it("folds a turn's narration among its steps", () => {
    const narration: Message = { id: "n", role: "bot", kind: "text", at: 1, text: "first narration", turnId: "t" };
    const node = mount(createElement(ActivityRun, { messages: [narration], elapsedMs: 12_000, renderStep, renderMessage }));
    expect(node.textContent).toContain("Worked 12s");
    expect(node.textContent).not.toContain("first narration");
    click(node.querySelector("button"));
    expect(node.textContent).toContain("first narration");
  });

  it("drops the Worked line and shows the narration when tool calls are hidden", () => {
    const narration: Message = { id: "n1", role: "bot", kind: "text", at: 1, text: "plain narration", turnId: "t" };
    const node = mount(createElement(ActivityRun, { messages: [narration], elapsedMs: 401_000, renderStep, renderMessage, bare: true }));
    expect(node.textContent).not.toContain("Worked");
    expect(node.querySelector("[data-step-row]")).toBeNull();
    expect(node.textContent).toContain("plain narration");
  });

  it("keeps the Worked line when tool calls show", () => {
    const narration: Message = { id: "n2", role: "bot", kind: "text", at: 1, text: "plain narration", turnId: "t" };
    const node = mount(createElement(ActivityRun, { messages: [narration], elapsedMs: 401_000, renderStep, renderMessage }));
    expect(node.textContent).toContain("Worked 6m 41s");
  });
});

describe("the turn digest", () => {
  it("says what the turn did in words, with the detail one click away", () => {
    const message: Message = {
      id: "d", role: "bot", kind: "digest", at: 1, text: "Observed work",
      digest: {
        turnId: "t", botId: "b", threadId: "th", at: 1, durationMs: 12_000,
        tools: [{ name: "Bash", count: 1, failed: 0 }], toolCalls: 1,
        memory: [], reply: "", hookCoverage: "preview",
      },
    };
    const node = mount(createElement(DigestChip, { message }));
    const row = node.querySelector("button")!;
    expect(row.textContent).toContain("Used 1 tool");
    expect(row.textContent).not.toContain("Did 1 tool calls");
    click(row);
    expect(node.querySelector('[data-testid="digest-detail"]')?.textContent).toContain("Ran a command");
  });
});
