// @vitest-environment happy-dom
// #2082 (2026-11-05): a question asked by a parallel task (or a routine run,
// a proactive wake included) of the open conversation is never pinned above
// that conversation's composer, over its thread. It renders inline in its
// own conversation, choices and "Show full question" intact; the open chat
// keeps the task's waiting card and the sidebar's waiting dot.
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ messages: [] as unknown[], bot: undefined as unknown }));
const threads = vi.hoisted(() => ({ show: true }));
vi.mock("@/lib/thread-preferences", async (load) => ({ ...(await load<object>()), useShowThreads: () => threads.show }));
vi.mock("@/state/store", () => ({
  api: vi.fn(async () => ({ messages: fixture.messages })),
  openThread: vi.fn(),
  useStore: () => ({ state: { instances: [], bots: [fixture.bot] }, dispatch: vi.fn() }),
  useStoreSelector: (pick: (state: unknown) => unknown) => pick({ instances: [], bots: [fixture.bot] }),
}));

import type { Bot, Message } from "@/state/store";
import { ComposerPendingStrip } from "./Composer.tsx-parts/ComposerPendingStrip";
import { usePinnedWaiting } from "./Composer.tsx-parts/PinnedWaitingCard";
import { optionsCardRow } from "./OptionsCardRow";
import { routineRunsWaiting, useParallelCards } from "./parallel-approvals";
import { ParallelTaskCard } from "./ParallelTaskCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LONG = "Three projects wait for a decision this week: moving the accounting team's computers, renewing the head office firewall and cleaning up inactive accounts. Which one do I take first, knowing the firewall expires Friday and the move needs two evenings planned with the client?";
const question = {
  id: "q1", role: "bot", kind: "options", at: 1,
  card: { title: "", subtitle: "", options: [], requestId: "req-q1", requestType: "question",
    questionRequest: { version: 1, questions: [{ header: "Projects to decide", question: LONG, options: [{ label: "A" }, { label: "B" }, { label: "C" }, { label: "D" }] }] } },
} as unknown as Message;

const bot = {
  id: "orla", name: "Orla", threadId: "main", messages: [],
  tasks: [
    { threadId: "main", title: "Main", createdAt: 0 },
    { threadId: "par", title: "Proactive teammate message", createdAt: 1, updatedAt: 2, activity: "waiting-on-you", parallelOf: { threadId: "main", messageId: "m", at: 1 } },
    { threadId: "run", title: "Proactive wake", createdAt: 1, updatedAt: 3, activity: "waiting-on-you", routineRunId: "run-1" },
  ],
} as unknown as Bot;
fixture.bot = bot;

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

function OpenChat() {
  const cards = useParallelCards(bot);
  const pinned = usePinnedWaiting([]);
  return createElement(Fragment, null,
    createElement("output", { "data-questions": String((cards as { questions?: unknown[] }).questions?.length ?? 0), "data-pendings": String(cards.pendings.length) }),
    createElement(ComposerPendingStrip, { bot, pinned, storeBots: [bot], threadId: "main", approvalBotFor: () => bot, onCancelTurn: () => {} }));
}

describe("a parallel task's question (#2082)", () => {
  it("is not drawn above the open conversation's composer", async () => {
    fixture.messages = [question];
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(createElement(OpenChat)));
    await act(async () => { await new Promise((done) => setTimeout(done, 0)); });
    expect(host.querySelector("[data-parallel-question]")).toBeNull();
    expect(host.textContent).not.toContain("Projects to decide");
    expect(host.textContent).not.toContain("Question from the parallel task");
    expect(host.querySelector("output")?.getAttribute("data-questions")).toBe("0");
  });

  it("renders inline in its own conversation, choices and full text intact", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(createElement(Fragment, null,
      optionsCardRow({ message: question, transcript: [question], botId: "orla", botName: "Orla", threadId: "par" }))));
    expect(host.textContent).toContain("Projects to decide");
    // the whole ask is there (clamped on screen, "Show full question" opens it)
    expect(host.textContent).toContain(LONG);
    for (const label of ["A", "B", "C", "D"]) expect([...host.querySelectorAll("button")].some((button) => button.textContent?.trim().endsWith(label))).toBe(true);
  });

  it("leaves the open chat a non-blocking pointer: the waiting run counts for the sidebar dot", () => {
    expect(routineRunsWaiting(bot).map((task) => task.threadId)).toEqual(["run"]);
  });
});

// the owner (2026-11-05, 21:10): in the one conversation (threads off) the card has
// no "Open" button and never opens a side thread; the question renders inline
// under the card, in the bot's chat, answered there.
describe("a parallel task's card in the one conversation (#2082)", () => {
  const card = { id: "m", role: "bot", kind: "text", at: 1, text: "", parallelTask: { role: "card", threadId: "par", title: "Proactive teammate message", state: "running" } } as unknown as Message;

  async function renderCard(showThreads: boolean) {
    threads.show = showThreads;
    fixture.messages = [question];
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(createElement(ParallelTaskCard, { message: card, botId: "orla" })));
    await act(async () => { await new Promise((done) => setTimeout(done, 0)); });
    return host;
  }

  it("has no Open button and shows the question inline", async () => {
    const host = await renderCard(false);
    expect(host.querySelector("[data-parallel-open]")).toBeNull();
    expect(host.querySelector("[data-parallel-inline-question='par']")).not.toBeNull();
    expect(host.textContent).toContain("Projects to decide");
    expect(host.textContent).toContain(LONG);
  });

  it("keeps the Open button when threads are on, the question staying in its thread", async () => {
    const host = await renderCard(true);
    expect(host.querySelector("[data-parallel-open='par']")).not.toBeNull();
    expect(host.querySelector("[data-parallel-inline-question]")).toBeNull();
  });
});
