// @vitest-environment happy-dom
// #4204, the owner's rule (2026-11-13, a repeat of #3551 and #3681): a
// pending ask is drawn once, on the pinned card over the message bar. A
// "Waiting on you" head (a task's window over the chat, a routine run's
// window, the bot panel's task page) never draws a second copy of what that
// card holds; once the card lets it go (answered, or no pinned card), the
// head draws it again.
import { createElement, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "@/state/store";
import type { Pending } from "../PendingApproval";
import type { WaitingItem } from "@/lib/use-waiting-cards";

vi.mock("../OptionCard", () => ({
  OptionCard: (props: { message: Message }) => createElement("div", { "data-test-option-card": props.message.id }),
}));
vi.mock("../PendingApproval", () => ({
  PendingApprovalBox: (props: { approvals: Pending[] }) => createElement("div", { "data-test-approvals": props.approvals.map((pending) => pending.message.id).join(",") }),
}));

const { WaitingOnYou } = await import("./WaitingOnYou");
const { createPinnedHold, PinnedHoldContext } = await import("@/lib/pinned-waiting");

const from = { botId: "scout", name: "Scout", color: "green" as const };
const question = (id: string): Message => ({
  id, role: "bot", kind: "options", at: 1_000, text: "", from,
  card: { title: "", subtitle: "", options: [], requestId: `req-${id}`, requestType: "question", questionRequest: { version: 1, questions: [{ question: "Which board?", options: [{ label: "Help desk" }] }] } },
} as unknown as Message);
const approvalMessage: Message = {
  id: "a1", role: "bot", kind: "options", at: 2_000, text: "", from,
  card: { title: "Run a command", subtitle: "ls", options: ["Allow", "Deny"], requestId: "req-a1", tool: "Bash" },
} as unknown as Message;

const items: WaitingItem[] = [
  { kind: "question", message: question("q1"), threadId: "th-1", botId: "scout" },
  { kind: "question", message: question("q2"), threadId: "th-2", botId: "scout", from: "Sub-agent" },
  { kind: "approval", pending: { requestId: "req-a1", tool: "Bash", detail: "ls", message: approvalMessage } as unknown as Pending, threadId: "th-1", botId: "scout" },
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

const head = (wrap: (node: ReactNode) => ReactNode = (node) => node) => {
  flushSync(() => root.render(wrap(createElement(WaitingOnYou, { items, threadId: "th-1", botFor: () => undefined, onCancel: () => undefined }))));
};
const drawn = () => [
  ...[...host.querySelectorAll<HTMLElement>("[data-test-option-card]")].map((node) => node.dataset.testOptionCard!),
  ...[...host.querySelectorAll<HTMLElement>("[data-test-approvals]")].flatMap((node) => node.dataset.testApprovals!.split(",")),
];

describe("WaitingOnYou leaves to the pinned card what it holds (#4204)", () => {
  it("inside a view: draws nothing the view's pinned card holds, and draws it again once the card lets it go", () => {
    const hold = createPinnedHold();
    const inView = (node: ReactNode) => createElement(PinnedHoldContext, { value: hold }, node);
    head(inView);
    expect(drawn().sort()).toEqual(["a1", "q1", "q2"]);
    flushSync(() => hold.set(new Set(["q1", "a1"])));
    expect(drawn()).toEqual(["q2"]);
    flushSync(() => hold.set(new Set(["q1", "q2", "a1"])));
    expect(host.querySelector("[data-task-waiting]")).toBeNull();
    flushSync(() => hold.set(new Set()));
    expect(drawn().sort()).toEqual(["a1", "q1", "q2"]);
  });

  it("beside the chat, with no view of its own (the bot panel): leaves out what any pinned card on screen holds", () => {
    const chat = createPinnedHold();
    head();
    expect(drawn().sort()).toEqual(["a1", "q1", "q2"]);
    flushSync(() => chat.set(new Set(["q1", "q2", "a1"])));
    expect(host.querySelector("[data-task-waiting]")).toBeNull();
    flushSync(() => chat.set(new Set()));
    expect(drawn().sort()).toEqual(["a1", "q1", "q2"]);
  });

  it("inside a view, reads that view's hold only: another view's pinned card does not take its asks away", () => {
    const own = createPinnedHold();
    const other = createPinnedHold();
    head((node) => createElement(PinnedHoldContext, { value: own }, node));
    flushSync(() => other.set(new Set(["q1", "q2", "a1"])));
    expect(drawn().sort()).toEqual(["a1", "q1", "q2"]);
    flushSync(() => other.set(new Set()));
  });
});
