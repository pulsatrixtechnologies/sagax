// @vitest-environment happy-dom
// Heavy mode in the chat (#4901, #5089, #5090): the row while the experts
// work (the orbit: they turn around the bot, the speaker pulses, lines link
// them while they critique, they merge into the bot on agreement), after,
// Auto's one line, and the Thoughts panel it opens.
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
  maxRounds: 5,
  rounds: [{ n: 1, kind: "propose", startedAt: T0 + 1_000 }],
  agents: [
    { n: 1, persona: "Skeptic", engineLabel: "ada@example.com", modelLabel: "Claude Opus 5.5", status: "working", messages: [], live: "Weighing the cutover window against the backup", speaking: true },
    { n: 2, persona: "Security", engineLabel: "OpenAI", modelLabel: "GPT-6 Astra", status: "working", messages: ["The rollback plan is the real risk."] },
    { n: 3, persona: "Cost", engineLabel: "Grok", modelLabel: "Grok 4.7", status: "working", messages: [] },
  ],
  leader: { engineLabel: "OpenAI", modelLabel: "GPT-6 Astra", steps: [{ kind: "planned", at: T0 }, { kind: "sent", at: T0 }, { kind: "processing", at: T0 }] },
  ...over,
});
const critique = (): HeavyTeamLine => line({
  rounds: [{ n: 1, kind: "propose", startedAt: T0 + 1_000, endedAt: T0 + 3_000 }, { n: 2, kind: "critique", startedAt: T0 + 3_000 }],
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

describe("a Heavy run while the experts work", () => {
  it("draws the orbit: the experts around the bot, the one speaking pulsing, no line while they propose", () => {
    render(createElement(HeavyTeamRow, { message: message(line()), busy: true }));
    expect($("[data-heavy-orbit]")!.dataset.heavyOrbit).toBe("running");
    expect($$("[data-heavy-orbit-expert]")).toHaveLength(3);
    expect($$("[data-heavy-orbit-speaking]").map((seat) => seat.dataset.heavyOrbitExpert)).toEqual(["1"]);
    expect($("[data-heavy-orbit-speaking] .heavy-orbit-speaking")).not.toBeNull();
    expect($$("[data-heavy-orbit-link]")).toHaveLength(0);
    expect($("[data-heavy-orbit-leader]")).not.toBeNull();
  });

  it("links every two experts while they critique each other", () => {
    render(createElement(HeavyTeamRow, { message: message(critique()), busy: true }));
    expect($$("[data-heavy-orbit-link]").map((link) => link.dataset.heavyOrbitLink)).toEqual(["1-2", "1-3", "2-3"]);
  });

  it("says Experts thinking with the round and the seconds, and a live preview of the exchange", () => {
    render(createElement(HeavyTeamRow, { message: message(critique()), busy: true }));
    expect($("[data-heavy-header]")!.textContent).toBe("Experts thinking · round 2 of 5 · 6s");
    expect($$("[data-heavy-agent]").map((row) => row.textContent)).toEqual([
      "Expert 1 · SkepticWeighing the cutover window against the backup",
      "Expert 2 · SecurityThe rollback plan is the real risk.",
      "Expert 3 · CostThinking…",
    ]);
    expect($("[data-heavy-leader]")!.textContent).toBe("LeaderExperts working…");
  });

  it("while the leader picks the team, says so", () => {
    render(createElement(HeavyTeamRow, { message: message(line({ phase: "planning", agents: [], rounds: [], leader: { engineLabel: "x", modelLabel: "y", steps: [] } })), busy: true }));
    expect($("[data-heavy-header]")!.textContent).toBe("Leader picking the team · 6s");
  });

  it("counts on, a second at a time", () => {
    render(createElement(HeavyTeamRow, { message: message(line()), busy: true }));
    act(() => { vi.advanceTimersByTime(3_000); });
    expect($("[data-heavy-header]")!.textContent).toBe("Experts thinking · round 1 of 5 · 9s");
  });

  it("a run nobody patches any more, in a chat that no longer works, reads as stopped, with no orbit", () => {
    render(createElement(HeavyTeamRow, { message: message(line()), busy: false }));
    expect($("[data-heavy-header]")!.textContent).toBe("Stopped after 6s");
    expect($("[data-heavy-preview]")).toBeNull();
    expect($("[data-heavy-orbit]")).toBeNull();
  });

  it("says in one line that Auto chose Heavy on its own", () => {
    render(createElement(HeavyTeamRow, { message: message(line({ auto: "risky" })), busy: true }));
    expect($("[data-heavy-auto]")!.textContent).toBe("Auto chose Heavy: a risky task.");
  });
});

describe("agreement and after", () => {
  const agreed = (phase: "leader" | "done") => line({
    phase, outcome: "agreed", thoughtEndedAt: T0 + 8_000, updatedAt: T0 + 9_000,
    rounds: [{ n: 1, kind: "propose", startedAt: T0, endedAt: T0 + 3_000 }, { n: 2, kind: "critique", startedAt: T0 + 3_000, endedAt: T0 + 8_000, agreed: true }],
    agents: line().agents.map((agent) => ({ ...agent, status: "done" as const, live: undefined, speaking: undefined, agrees: true, messages: ["Plan.", "Agreed."] })),
  });

  it("on agreement the experts merge into the bot while it writes", () => {
    render(createElement(HeavyTeamRow, { message: message(agreed("leader")), busy: true }));
    expect($("[data-heavy-orbit]")!.dataset.heavyOrbit).toBe("merged");
    for (const seat of $$("[data-heavy-orbit-expert]")) {
      expect(seat.style.opacity).toBe("0");
      expect(seat.style.transform).toContain("scale(0.3)");
    }
  });

  it("is then one quiet line: Thought for 8s and how it ended, no orbit, no preview", () => {
    render(createElement(HeavyTeamRow, { message: message(agreed("done")), busy: false }));
    expect($("[data-heavy-header]")!.textContent).toBe("Thought for 8s");
    expect($("[data-heavy-outcome]")!.textContent).toBe("· agreed in round 2");
    expect($("[data-heavy-orbit]")).toBeNull();
    expect($("[data-heavy-preview]")).toBeNull();
    expect($$("[data-owl]").map((owl) => owl.dataset.owl)).toEqual(["blue", "green", "orange"]);
    act(() => { vi.advanceTimersByTime(60_000); });
    expect($("[data-heavy-header]")!.textContent).toBe("Thought for 8s");
  });

  it("without agreement says the leader decided", () => {
    render(createElement(HeavyTeamRow, { message: message(line({ phase: "done", outcome: "decided", thoughtEndedAt: T0 + 8_000, rounds: [1, 2, 3, 4, 5].map((n) => ({ n, kind: n === 1 ? "propose" as const : "critique" as const, startedAt: T0, endedAt: T0 })) })), busy: false }));
    expect($("[data-heavy-outcome]")!.textContent).toBe("· no agreement after 5 rounds, the leader decided");
  });

  it("opens the Thoughts panel, and closes it again", () => {
    function Probe() {
      const id = useOpenThoughts();
      return createElement("span", { "data-open-id": id ?? "none" });
    }
    render(createElement("div", null, createElement(HeavyTeamRow, { message: message(agreed("done"), "run-7"), busy: false }), createElement(Probe)));
    const open = $("[data-heavy-open]")!;
    expect(open.getAttribute("aria-expanded")).toBe("false");
    expect(open.getAttribute("aria-label")).toBe("Thought for 8s. Open the Thoughts panel");
    click(open);
    expect($("[data-open-id]")!.dataset.openId).toBe("run-7");
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
  it("shows the leader's steps, how it ended with what is still disputed, then every expert with its persona and seat", () => {
    const decided = line({
      phase: "done", outcome: "decided", disagreements: ["who owns the cutover", "export first"],
      rounds: [1, 2, 3, 4, 5].map((n) => ({ n, kind: n === 1 ? "propose" as const : "critique" as const, startedAt: T0, endedAt: T0 })),
      leader: { engineLabel: "OpenAI", modelLabel: "GPT-6 Astra", steps: [{ kind: "planned", at: T0 }, { kind: "sent", at: T0 }, { kind: "processing", at: T0 + 1_000 }, { kind: "decided", at: T0 + 8_000, round: 5 }, { kind: "writing", at: T0 + 8_000 }] },
      agents: line().agents.map((agent) => ({ ...agent, status: "done" as const, live: undefined, speaking: undefined, messages: ["Plan.", "Critique."], agrees: agent.n !== 2 })),
    });
    render(createElement(ThoughtsPanel, { line: decided, running: false, onClose: () => {} }));
    expect($("[data-thoughts-panel]")!.getAttribute("aria-label")).toBe("Thoughts");
    expect($$("[data-thoughts-step]").map((step) => step.textContent)).toEqual(["0sPicked the team", "0sSent to the experts", "1sExperts working…", "8sNo agreement after round 5: deciding", "8sWriting the plan and acting"]);
    expect($("[data-thoughts-outcome]")!.textContent).toBe("no agreement after 5 rounds, the leader decided");
    expect($$("[data-thoughts-disputes] li").map((li) => li.textContent)).toEqual(["who owns the cutover", "export first"]);
    expect($("[data-thoughts-agent='1'] button")!.textContent).toContain("Expert 1 · Skeptic");
    expect($("[data-thoughts-agent='1'] button")!.textContent).toContain("Claude Opus 5.5 · ada@example.com");
    expect($("[data-thoughts-agent='2'] [data-thoughts-status]")!.textContent).toBe("Disagrees");
    expect($("[data-thoughts-agent='1'] [data-thoughts-status]")!.textContent).toBe("Agrees");
  });

  it("each expert opens on its own, one message per round", () => {
    render(createElement(ThoughtsPanel, { line: line({ phase: "done", agents: line().agents.map((agent) => ({ ...agent, status: "done" as const, live: undefined, messages: ["One.", "Two."] })) }), running: false, onClose: () => {} }));
    expect($$("[data-thoughts-messages]")).toHaveLength(0);
    click($("[data-thoughts-agent='2'] button")!);
    expect($$("[data-thoughts-agent='2'] [data-thoughts-round]").map((round) => round.textContent)).toEqual(["Round 1One.", "Round 2Two."]);
    click($("[data-thoughts-agent='2'] button")!);
    expect($("[data-thoughts-agent='2'] [data-thoughts-messages]")).toBeNull();
  });

  it("names an expert that did not finish, with why", () => {
    const failed = line({ agents: line().agents.map((agent, index) => (index === 1 ? { ...agent, status: "failed" as const, messages: [], error: "engine refused" } : agent)) });
    render(createElement(ThoughtsPanel, { line: failed, running: false, onClose: () => {} }));
    expect($("[data-thoughts-agent='2'] [data-thoughts-status]")!.textContent).toBe("Did not finish");
    expect($("[data-thoughts-agent='2'] [data-thoughts-preview]")!.textContent).toBe("engine refused");
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
    render(createElement(ThoughtsPanelHost, { messages: [message(line({ agents: line().agents.map((agent) => ({ ...agent, live: "A newer thought" })) }), "run-1")], busy: true }));
    expect($("[data-thoughts-live]")!.textContent).toBe("A newer thought");
    render(createElement(ThoughtsPanelHost, { messages: [], busy: false }));
    expect($("[data-thoughts-panel]")).toBeNull();
  });
});
