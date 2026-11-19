// @vitest-environment happy-dom
// Heavy mode in the chat (#4901): the row while the agents work and after,
// and the Thoughts panel it opens.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { closeThoughts, openThoughts, useOpenThoughts } from "@/lib/thoughts-panel";
import { isToolStep, statusActivity } from "@/lib/activity-runs";
import type { Message } from "@/state/store";
import type { HeavyTeamLine } from "../../shared/heavy-team";

vi.mock("./Avatar", () => ({
  MausAvatar: (props: { color: string; state?: string }) => ({ $$typeof: Symbol.for("react.transitional.element"), type: "span", key: null, ref: null, props: { "data-owl": props.color, "data-owl-state": props.state }, _owner: null, _store: {} }),
}));

const { HeavyTeamRow } = await import("./HeavyTeamRow");
const { ThoughtsPanel, ThoughtsPanelHost } = await import("./ThoughtsPanel");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const T0 = 1_000_000;
const line = (over: Partial<HeavyTeamLine> = {}): HeavyTeamLine => ({
  phase: "agents",
  startedAt: T0,
  updatedAt: T0 + 6_000,
  agents: [
    { n: 1, engineLabel: "OpenAI", modelLabel: "GPT-6 Astra", status: "working", messages: [], live: "Weighing the cutover window against the backup" },
    { n: 2, engineLabel: "Claude", modelLabel: "Claude Opus 5.5", status: "working", messages: ["The rollback plan is the real risk."] },
    { n: 3, engineLabel: "Grok", modelLabel: "Grok 4.7", status: "working", messages: [] },
  ],
  leader: { engineLabel: "OpenAI", modelLabel: "GPT-6 Astra", steps: [{ kind: "sent", at: T0 }, { kind: "processing", at: T0 }] },
  ...over,
});
const message = (team: HeavyTeamLine, id = "m1"): Message => ({ id, at: T0, role: "bot", kind: "activity", tool: { name: "Team of Experts", ok: true, team } } as Message);

let host: HTMLDivElement;
let root: Root;
const render = (node: ReturnType<typeof createElement>) => act(() => root.render(node));
const $ = (selector: string) => host.querySelector<HTMLElement>(selector);
const $$ = (selector: string) => [...host.querySelectorAll<HTMLElement>(selector)];
const click = (target: Element) => act(() => { target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(T0 + 6_000);
  setLocale("en");
  closeThoughts();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("a Heavy run while the agents work", () => {
  it("says Agents thinking with the seconds, the agents' owls and a live preview of the exchange", () => {
    render(createElement(HeavyTeamRow, { message: message(line()), busy: true }));
    expect($("[data-heavy-header]")!.textContent).toBe("Agents thinking · 6s");
    expect($$("[data-owl]").map((owl) => [owl.dataset.owl, owl.dataset.owlState])).toEqual([["blue", "thinking"], ["green", "thinking"], ["orange", "thinking"]]);
    expect($("[data-heavy-avatars]")!.getAttribute("aria-label")).toBe("3 agents");
    const agents = $$("[data-heavy-agent]");
    expect(agents.map((row) => row.textContent)).toEqual([
      "Agent 1Weighing the cutover window against the backup",
      "Agent 2The rollback plan is the real risk.",
      "Agent 3Thinking…",
    ]);
    expect($("[data-heavy-leader]")!.textContent).toBe("LeaderProcessing…");
  });

  it("counts on, a second at a time", () => {
    render(createElement(HeavyTeamRow, { message: message(line()), busy: true }));
    act(() => { vi.advanceTimersByTime(3_000); });
    expect($("[data-heavy-header]")!.textContent).toBe("Agents thinking · 9s");
  });

  it("a run nobody patches any more, in a chat that no longer works, reads as stopped", () => {
    render(createElement(HeavyTeamRow, { message: message(line()), busy: false }));
    expect($("[data-heavy-header]")!.textContent).toBe("Stopped after 6s");
    expect($("[data-heavy-preview]")).toBeNull();
    expect($$("[data-owl]").every((owl) => owl.dataset.owlState === "idle")).toBe(true);
  });
});

describe("a Heavy run that finished", () => {
  const done = () => line({ phase: "done", thoughtEndedAt: T0 + 8_000, updatedAt: T0 + 9_000, agents: line().agents.map((agent) => ({ ...agent, status: "done" as const, live: undefined, messages: ["Finding."] })) });

  it("is one quiet line: Thought for 8s, no preview", () => {
    render(createElement(HeavyTeamRow, { message: message(done()), busy: false }));
    expect($("[data-heavy-header]")!.textContent).toBe("Thought for 8s");
    expect($("[data-heavy-preview]")).toBeNull();
    // the time stands still: the Leader's answer takes as long as it takes
    act(() => { vi.advanceTimersByTime(60_000); });
    expect($("[data-heavy-header]")!.textContent).toBe("Thought for 8s");
  });

  it("opens the Thoughts panel, and closes it again", () => {
    function Probe() {
      const id = useOpenThoughts();
      return createElement("span", { "data-open-id": id ?? "none" });
    }
    render(createElement("div", null, createElement(HeavyTeamRow, { message: message(done(), "run-7"), busy: false }), createElement(Probe)));
    const open = $("[data-heavy-open]")!;
    expect(open.getAttribute("aria-expanded")).toBe("false");
    expect(open.getAttribute("aria-label")).toBe("Thought for 8s. Open the Thoughts panel");
    click(open);
    expect($("[data-open-id]")!.dataset.openId).toBe("run-7");
    expect($("[data-heavy-open]")!.getAttribute("aria-expanded")).toBe("true");
    click($("[data-heavy-open]")!);
    expect($("[data-open-id]")!.dataset.openId).toBe("none");
  });
});

describe("the row is a status row of the transcript", () => {
  it("is drawn on its own, never folded into a stretch of tool steps", () => {
    const row = message(line());
    expect(statusActivity(row)).toEqual({ kind: "team", text: "Team of Experts" });
    expect(isToolStep(row)).toBe(false);
  });
});

describe("the Thoughts panel", () => {
  it("shows the Leader's steps with their time, then every agent, an agent still writing open", () => {
    render(createElement(ThoughtsPanel, { line: line({ leader: { engineLabel: "OpenAI", modelLabel: "GPT-6 Astra", steps: [{ kind: "sent", at: T0 }, { kind: "processing", at: T0 + 1_000 }, { kind: "writing", at: T0 + 8_000 }] }, agents: line().agents.map((agent, index) => (index === 2 ? { ...agent, status: "done" as const, messages: ["Third finding.", "And a second note."] } : agent)) }), running: true, onClose: () => {} }));
    expect($("[data-thoughts-panel]")!.getAttribute("aria-label")).toBe("Thoughts");
    expect($$("[data-thoughts-step]").map((step) => step.textContent)).toEqual(["0sSent to All", "1sProcessing…", "8sWriting the answer"]);
    // the two still writing are open, the finished one is folded to its preview
    expect($("[data-thoughts-agent='1'] [data-thoughts-messages]")).not.toBeNull();
    expect($("[data-thoughts-agent='1'] [data-thoughts-live]")!.textContent).toBe("Weighing the cutover window against the backup");
    expect($("[data-thoughts-agent='2'] [data-thoughts-messages] p")!.textContent).toBe("The rollback plan is the real risk.");
    expect($("[data-thoughts-agent='3'] [data-thoughts-messages]")).toBeNull();
    expect($("[data-thoughts-agent='3'] [data-thoughts-preview]")!.textContent).toBe("And a second note.");
  });

  it("each agent folds and opens on its own", () => {
    render(createElement(ThoughtsPanel, { line: line({ phase: "done", agents: line().agents.map((agent) => ({ ...agent, status: "done" as const, live: undefined, messages: ["One.", "Two."] })) }), running: false, onClose: () => {} }));
    expect($$("[data-thoughts-messages]")).toHaveLength(0);
    const toggle = $("[data-thoughts-agent='2'] button")!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    click(toggle);
    expect($$("[data-thoughts-agent='2'] [data-thoughts-messages] p").map((p) => p.textContent)).toEqual(["One.", "Two."]);
    expect($("[data-thoughts-agent='1'] [data-thoughts-messages]")).toBeNull();
    click($("[data-thoughts-agent='2'] button")!);
    expect($("[data-thoughts-agent='2'] [data-thoughts-messages]")).toBeNull();
  });

  it("names an agent that did not finish, with why", () => {
    const failed = line({ agents: line().agents.map((agent, index) => (index === 1 ? { ...agent, status: "failed" as const, messages: [], error: "engine refused" } : agent)) });
    render(createElement(ThoughtsPanel, { line: failed, running: false, onClose: () => {} }));
    expect($("[data-thoughts-agent='2'] [data-thoughts-status]")!.textContent).toBe("Did not finish");
    // folded, it still says why
    expect($("[data-thoughts-agent='2'] [data-thoughts-preview]")!.textContent).toBe("engine refused");
    click($("[data-thoughts-agent='2'] button")!);
    expect($("[data-thoughts-agent='2'] [data-thoughts-messages]")!.textContent).toBe("engine refused");
  });

  it("closes from its button", () => {
    const onClose = vi.fn();
    render(createElement(ThoughtsPanel, { line: line(), running: true, onClose }));
    click($("[data-detail-panel-close]")!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("the panel's host", () => {
  it("draws the panel of the row that was opened, live, and goes with its message", () => {
    const first = message(line(), "run-1");
    render(createElement(ThoughtsPanelHost, { messages: [first], busy: true }));
    expect($("[data-thoughts-panel]")).toBeNull();
    act(() => openThoughts("run-1"));
    expect($("[data-thoughts-panel]")).not.toBeNull();
    // a patch of the row reaches the open panel
    render(createElement(ThoughtsPanelHost, { messages: [message(line({ agents: line().agents.map((agent) => ({ ...agent, live: "A newer thought" })) }), "run-1")], busy: true }));
    expect($("[data-thoughts-live]")!.textContent).toBe("A newer thought");
    // the conversation changed: the run is gone, so is the panel
    render(createElement(ThoughtsPanelHost, { messages: [], busy: false }));
    expect($("[data-thoughts-panel]")).toBeNull();
    act(() => openThoughts("run-1"));
    expect($("[data-thoughts-panel]")).toBeNull();
  });
});
