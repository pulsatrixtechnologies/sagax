// #3289: every bot-to-bot trace of a turn reads as the Messaged line's quiet
// centered line in the real chat view, never a left-aligned row per
// teammate, a "Teammates · Finished" card or a bare "Teammate" label over an
// italic line: "Asking / Asked [face] A, [face] B and [face] C" on the
// sender's side, a stopped request said on the same line. Tool calls hidden
// or shown, English and French. Neutral names only (term-guard).
//
// #3581: the receiver's side is the same line, never a quote: "Asked by
// [face] A" (a hand-off received, a stored copy of a teammate's or an AI
// client's request), folded per burst with "5 requests"; a background task
// is a step row in the interface font; a reply the bot's own work brought
// back unfolds from one row; a send receipt joins the Messaged line.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import type { Bot, InstanceInfo, Message } from "@/state/store";
import { setLocale } from "@/lib/i18n";

setLocale("en");

const fixture = vi.hoisted(() => ({ showToolCalls: false }));

vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
});
const NAMES = vi.hoisted(() => ["Wren", "Marlin", "Harbor", "Quill", "Beacon", "Ledger"]);
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({
    state: {
      ...original.initialState,
      config: { features: { showToolCalls: fixture.showToolCalls } },
      instances: [{ instanceId: "test", driverKind: "codex", displayName: "Test" } as InstanceInfo],
      bots: [
        { id: "scout", threadId: "scout-t", name: "Scout", color: "green" },
        ...NAMES.map((name, i) => ({ id: `r${i}`, threadId: `r${i}-t`, name, color: "blue" })),
      ],
    },
    dispatch: vi.fn(),
  }) };
});
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "other" }, localComputer: { available: false, reasonCode: "cua-driver-unavailable", message: "" } }, ready: true }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("./ModelPicker", () => ({ ModelPicker: () => createElement("span") }));
vi.mock("./ApprovalModeSelector", () => ({ ApprovalModeSelector: () => createElement("span") }));

const { ChatView } = await import("./ChatView");
afterAll(() => vi.unstubAllGlobals());
afterEach(() => {
  fixture.showToolCalls = false;
  setLocale("en");
});

const at = new Date(2026, 10, 9, 9, 0).getTime();
const BRIEF = "Go through the open tickets and list the duplicates.";
const text = (id: string, role: Message["role"], body: string, second: number, extra: Partial<Message> = {}): Message =>
  ({ id, role, kind: "text", text: body, at: at + second * 1000, ...extra }) as Message;
const receipt = (i: number): Message => ({
  id: `s${i}`, role: "bot", kind: "activity", at: at + (3 + i) * 1000,
  from: { botId: "scout", name: "Scout", color: "green" },
  tool: { name: `Sent to ${NAMES[i]}`, ok: true, input: BRIEF, handoffId: `h${i}` },
  threadRef: { botId: `r${i}`, threadId: `r${i}-w`, title: "Duplicates" },
}) as Message;
const answer = (i: number, ok = true): Message => ({
  id: `a${i}`, role: "bot", kind: "activity", at: at + (20 + i) * 1000,
  roomRequest: { id: `h${i}`, phase: "result" },
  from: { botId: `r${i}`, name: NAMES[i]!, color: "blue" },
  tool: ok ? { name: `${NAMES[i]} replied`, ok, output: "Three duplicates." } : { name: `${NAMES[i]} — stopped: stopped`, ok },
  threadRef: { botId: `r${i}`, threadId: `r${i}-w`, title: "Duplicates" },
}) as Message;

/** A request bot `from` sent to Wren (r0): its receipt in Wren's chat. */
const incoming = (i: number, from: string): Message => ({
  id: `in${i}`, role: "bot", kind: "activity", at: at + (5 + i) * 1000,
  from: { botId: from, name: from === "scout" ? "Scout" : NAMES[Number(from.slice(1))]!, color: "green" },
  tool: { name: "Asked by", ok: true, input: BRIEF, handoffId: `in${i}` },
  threadRef: { botId: "r0", threadId: `r0-w${i}`, title: "Duplicates" },
}) as Message;

function render(botId: string, rows: Message[]) {
  rows.forEach((message, i) => { if (i > 0) message.parentId = rows[i - 1]!.id; });
  const bot = {
    id: botId, threadId: `${botId}-t`, name: botId === "scout" ? "Scout" : "Wren", title: "", description: "", color: "green",
    notifications: true, unread: false, busy: false, messages: rows, activeLeafId: rows.at(-1)!.id,
    modelSelection: { instanceId: "test", model: "m" },
  } as Bot;
  return renderToStaticMarkup(createElement(ChatView, { bot }));
}

function sender(count: number, state: "running" | "done" | "stopped") {
  return render("scout", [
    text("u", "user", "Ask them.", 0),
    text("b1", "bot", "Asking now.", 1),
    ...Array.from({ length: count }, (_, i) => receipt(i)),
    ...(state === "running" ? [] : Array.from({ length: count }, (_, i) => answer(i, !(state === "stopped" && i === 1)))),
    text("b2", "bot", "Here it is.", 40),
  ]);
}

const plain = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, "\"").replace(/&amp;/g, "&").replace(/\s+/g, " ").replace(/ ,/g, ",");
const count = (markup: string, needle: string) => markup.split(needle).length - 1;

describe("bot-to-bot asks in the chat (#3289)", () => {
  it("draws five asks as ONE centered line, Tool calls hidden, never a row per teammate", () => {
    const markup = sender(5, "done");
    expect(count(markup, 'data-testid="ask-line"')).toBe(1);
    expect(markup).not.toContain('data-testid="handoff-row"');
    expect(markup).not.toContain('data-testid="step-row"');
    expect(plain(markup)).toContain("Asked Wren, Marlin, Harbor, and 2 others");
    expect(count(markup, 'data-testid="ask-line-recipient"')).toBe(3);
    expect(markup.indexOf("Asking now.")).toBeLessThan(markup.indexOf('data-testid="ask-line"'));
    expect(markup.indexOf('data-testid="ask-line"')).toBeLessThan(markup.indexOf("Here it is."));
  });

  it("says Asking while a teammate works, Tool calls shown too", () => {
    fixture.showToolCalls = true;
    const markup = sender(2, "running");
    expect(count(markup, 'data-testid="ask-line"')).toBe(1);
    expect(markup).toContain('data-ask-line-state="asking"');
    expect(plain(markup)).toContain("Asking Wren and Marlin");
  });

  it("keeps a stopped request on the line", () => {
    const markup = sender(5, "stopped");
    expect(count(markup, 'data-testid="ask-line"')).toBe(1);
    expect(plain(markup)).toContain("stopped before an answer: Marlin");
    expect(plain(markup)).not.toContain("Could not ask Marlin");
  });

  it("says it in French", () => {
    setLocale("fr");
    const markup = sender(2, "done");
    expect(plain(markup)).toContain("A demandé à Wren et Marlin");
    expect(plain(markup)).not.toContain("Asked");
  });

  it("draws a routine run's teammates as the Asked line, never a Teammates card", () => {
    const run = {
      id: "run", role: "bot", kind: "routine.run", at: at + 50_000, text: "",
      routineRun: {
        runId: "run-1", routineId: "rt-1", routineName: "Morning pass", status: "completed", summary: "Done.",
        handedTo: [0, 1].map((i) => ({ botId: `r${i}`, threadId: `r${i}-run`, name: NAMES[i], task: BRIEF, status: "completed" })),
      },
    } as unknown as Message;
    const markup = render("scout", [text("u", "user", "Run it.", 0), run]);
    expect(count(markup, 'data-testid="delegation-line"')).toBe(1);
    expect(markup).not.toContain("data-delegation-provenance");
    expect(plain(markup)).toContain("Asked Wren and Marlin");
    expect(plain(markup)).not.toContain("Teammates");
  });

  it("draws a request received as Asked by, never its words nor a tooltip that quotes them (#3581)", () => {
    const markup = render("r0", [text("u", "user", "Hi.", 0), incoming(0, "scout"), text("b", "bot", "On it.", 40)]);
    expect(count(markup, 'data-testid="incoming-line"')).toBe(1);
    expect(plain(markup)).toContain("Asked by Scout");
    expect(markup).not.toContain(BRIEF);
    expect(markup).not.toContain("“");
    expect(markup).not.toContain('data-testid="handoff-line"');
  });

  it("folds five requests from three bots into one line: three names and 5 requests (#3581)", () => {
    const markup = render("r0", [
      text("u", "user", "Hi.", 0),
      incoming(0, "scout"), incoming(1, "r1"), incoming(2, "scout"), incoming(3, "r2"), incoming(4, "r1"),
      text("b", "bot", "On it.", 40),
    ]);
    expect(count(markup, 'data-testid="incoming-line"')).toBe(1);
    expect(count(markup, 'data-testid="incoming-line-recipient"')).toBe(3);
    expect(plain(markup)).toContain("Asked by Scout, Marlin, and Harbor · 5 requests");
  });

  it("says it in French (#3581)", () => {
    setLocale("fr");
    const markup = render("r0", [text("u", "user", "Hi.", 0), incoming(0, "scout"), incoming(1, "scout")]);
    expect(plain(markup)).toContain("Demandé par Scout · 2 demandes");
  });

  it("draws a teammate's stored copy as the line, its reply behind the name, never a bubble (#3581)", () => {
    const markup = render("r0", [
      text("u", "user", "Hi.", 0),
      text("m1", "bot", "Three duplicates.", 20, { relayVia: "teammate", relayOf: "x1", relayAsk: { text: BRIEF, by: "Scout", botId: "scout" } } as Partial<Message>),
    ]);
    expect(count(markup, 'data-testid="incoming-line"')).toBe(1);
    expect(plain(markup)).toContain("Asked by Scout");
    expect(markup).not.toContain(BRIEF);
    expect(markup).not.toContain("Three duplicates.");
    expect(plain(markup)).not.toContain("Teammate ·");
  });

  it("draws an AI client's copies, stored before and after the change, as one Asked by line with no bubble (#3581)", () => {
    const client = (id: string, second: number) => text(id, "bot", `Reply ${id}.`, second, { relayVia: "mcp", relayOf: `k${id}`, relayAsk: { text: `Request ${id}`, by: "Client" } } as Partial<Message>);
    const markup = render("r0", [text("u", "user", "Hi.", 0), client("c1", 10), client("c2", 11), client("c3", 12)]);
    expect(count(markup, 'data-testid="incoming-line"')).toBe(1);
    expect(markup).toContain("data-agent-avatar");
    expect(plain(markup)).toContain("Asked by Client · 3 requests");
    expect(markup).not.toMatch(/Reply c\d|Request c\d|Via MCP/);
  });

  it("says a stopped request on that same line, never a bare Teammate label and an italic line", () => {
    const markup = render("r0", [
      text("u", "user", "Hi.", 0),
      text("m2", "bot", "This request was stopped before an answer.", 30, { relayVia: "teammate", relayOf: "x2", relayTrace: "stopped", relayAsk: { text: "", by: "Scout", botId: "scout" } } as Partial<Message>),
    ]);
    expect(count(markup, 'data-testid="incoming-line"')).toBe(1);
    expect(plain(markup)).toContain("Asked by Scout · stopped before an answer");
    expect(plain(markup)).not.toContain("This request was stopped before an answer.");
    expect(plain(markup)).not.toMatch(/\bTeammate\b/);
  });

  it("draws one line, not two, for a request and the reply copied under it", () => {
    const replied = {
      id: "in-r", role: "bot", kind: "activity", at: at + 6000, roomRequest: { id: "in0", phase: "result" },
      from: { botId: "r0", name: "Wren", color: "blue" }, tool: { name: "Wren replied", ok: true, output: "Three duplicates." },
      threadRef: { botId: "r0", threadId: "r0-w0", title: "Duplicates" },
    } as Message;
    const markup = render("r0", [
      text("u", "user", "Hi.", 0),
      incoming(0, "scout"),
      replied,
      text("m1", "bot", "Three duplicates.", 20, { relayVia: "teammate", relayOf: "x1", relayAsk: { text: BRIEF, by: "Scout", botId: "scout" } } as Partial<Message>),
    ]);
    expect(count(markup, 'data-testid="incoming-line"')).toBe(1);
    expect(count(plain(markup), "Asked by Scout")).toBe(1);
    expect(plain(markup)).not.toContain("requests");
  });

  it("draws a waiting card from a background thread with no quoted request above it (#3581)", () => {
    const card = {
      id: "card", role: "bot", kind: "options", at: at + 20_000, text: "Allow?",
      relayVia: "mcp", relayAsk: { text: BRIEF, by: "Client" },
      card: { title: "Allow the change?", options: ["Allow", "Deny"], requestId: "q1", tool: "ask" },
    } as unknown as Message;
    const markup = render("r0", [text("u", "user", "Hi.", 0), card]);
    expect(markup).not.toContain(BRIEF);
    expect(markup).not.toContain("“");
  });

  it("joins a send receipt to the Messaged line, its state said only when it failed (#3581)", () => {
    const send = (i: number, state: string): Message => ({
      id: `send${i}`, role: "bot", kind: "activity", at: at + (5 + i) * 1000,
      tool: { name: `Sent to ${NAMES[i]}`, ok: true, input: BRIEF },
      threadRef: { botId: `r${i}`, threadId: `r${i}-send`, title: NAMES[i]! },
      sendReceipt: { id: `d${i}`, senderId: "scout", botId: `r${i}`, threadId: `r${i}-send`, state, summary: "Three duplicates." },
    }) as unknown as Message;
    let markup = render("scout", [text("u", "user", "Send it.", 0), send(0, "done"), send(1, "read")]);
    expect(count(markup, 'data-testid="messaged-line"')).toBe(1);
    expect(markup).not.toContain('data-testid="send-receipt"');
    expect(plain(markup)).toContain("Messaged Wren and Marlin");
    expect(markup).not.toContain("Three duplicates.");
    expect(markup).not.toContain("data-send-state");
    markup = render("scout", [text("u", "user", "Send it.", 0), send(0, "done"), send(1, "failed")]);
    expect(markup).toContain('data-send-state="failed"');
    expect(plain(markup)).toContain("Messaged Wren and Marlin · failed");
  });
});

describe("background tasks and replies in the chat (#3581)", () => {
  const taskCard = (id: string, state: string): Message => ({
    id, role: "bot", kind: "activity", at: at + 2000, tool: { name: `Parallel task #${id}`, ok: true },
    threadRef: { botId: "scout", threadId: `${id}-t`, title: `Task ${id}` },
    parallelTask: { threadId: `${id}-t`, title: `Task ${id}`, requestMessageId: id, role: "card", state, startedAt: at },
  }) as unknown as Message;
  const taskAnswer = (id: string, body: string, replyToId?: string): Message => ({
    id: `${id}-r`, role: "bot", kind: "text", at: at + 30_000, text: body,
    ...(replyToId ? { replyToId } : {}),
    parallelTask: { threadId: `${id}-t`, title: `Task ${id}`, requestMessageId: replyToId ?? id, role: "result", state: "done" },
  }) as unknown as Message;

  it("draws no terminal line for a task, and no row once it ended", () => {
    const markup = render("scout", [text("u", "user", "Go.", 0), taskCard("a", "done"), taskCard("b", "failed"), text("b2", "bot", "Done.", 40)]);
    expect(markup).not.toMatch(/font-mono|●|⎿|Agent\(|Backgrounded agent|answer below/);
    expect(markup).not.toContain("data-parallel-card");
  });

  it("draws the answer of a task the bot opened as one step row with its first sentence", () => {
    const markup = render("scout", [
      text("u", "user", "Go.", 0),
      taskAnswer("a", "Two findings, both fixed on the branch. The first was a missing check in the parser, and the second a stale cache."),
    ]);
    expect(count(markup, 'data-testid="folded-reply"')).toBe(1);
    expect(markup).toContain('data-folded-reply="task"');
    expect(plain(markup)).toContain("Task a Two findings, both fixed on the branch.");
    expect(markup).not.toContain("missing check in the parser");
    expect(markup).not.toContain("Answer from the parallel task");
  });

  it("keeps the answer to the person's own request a whole bubble, without a label", () => {
    const markup = render("scout", [text("u", "user", "Draft it.", 0), taskAnswer("a", "Here is the draft, in full.", "u")]);
    expect(markup).not.toContain('data-testid="folded-reply"');
    expect(markup).toContain("Here is the draft, in full.");
    expect(markup).not.toContain("Answer from the parallel task");
  });

  it("draws two relayed replies as two rows, and one as its bubble", () => {
    const relayed = (i: number, second: number): Message => text(`rel${i}`, "bot", `Reply of ${NAMES[i]}. More words after it.`, second, { relayedFrom: { botId: `r${i}`, name: NAMES[i]! } } as Partial<Message>);
    let markup = render("scout", [text("u", "user", "Ask them.", 0), relayed(0, 10), relayed(1, 11)]);
    expect(count(markup, 'data-testid="folded-reply"')).toBe(2);
    expect(markup).not.toContain("More words after it.");
    markup = render("scout", [text("u", "user", "Ask them.", 0), relayed(0, 10)]);
    expect(markup).not.toContain('data-testid="folded-reply"');
    expect(markup).toContain("More words after it.");
  });

  it("looks past a hidden tool step for the second relayed reply", () => {
    const relayed = (i: number, second: number): Message => text(`rel${i}`, "bot", `Reply of ${NAMES[i]}. More words after it.`, second, { relayedFrom: { botId: `r${i}`, name: NAMES[i]! } } as Partial<Message>);
    const step = { id: "step", role: "bot", kind: "activity", at: at + 10_500, tool: { name: "Read file", ok: true, input: "notes.md" } } as Message;
    const markup = render("scout", [text("u", "user", "Ask them.", 0), relayed(0, 10), step, relayed(1, 11)]);
    expect(count(markup, 'data-testid="folded-reply"')).toBe(2);
    expect(markup).not.toContain("More words after it.");
  });

  it("keeps a task's title whole on a narrow row: the brief gives way first, then drops", () => {
    const markup = render("scout", [text("u", "user", "Go.", 0), taskAnswer("a", "Two findings, both fixed on the branch.")]);
    const wrapper = markup.replace(/&gt;/g, ">").replace(/&amp;/g, "&").match(/<div class="([^"]*)" data-step-whole="label">/);
    expect(wrapper?.[1]).toContain("[&>[data-step-row]>*>[data-step-label]]:shrink-0");
    expect(wrapper?.[1]).toContain("@max-[20rem]:[&>[data-step-row]>*>[data-step-target]]:hidden");
  });

  it("says a failed task's answer in the danger ink", () => {
    const failed = { ...taskAnswer("a", "The task stopped on an error. Nothing was changed."), parallelTask: { threadId: "a-t", title: "Task a", requestMessageId: "a", role: "result", state: "failed" } } as unknown as Message;
    let markup = render("scout", [text("u", "user", "Go.", 0), failed]);
    expect(markup).toMatch(/data-testid="folded-reply"[^>]*data-phase="failed"/);
    expect(markup).toContain("text-danger/90");
    markup = render("scout", [text("u", "user", "Go.", 0), taskAnswer("a", "Two findings.")]);
    expect(markup).toMatch(/data-testid="folded-reply"[^>]*data-phase="done"/);
  });
});
