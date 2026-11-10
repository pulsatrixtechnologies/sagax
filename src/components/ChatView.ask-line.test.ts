// #3289: every bot-to-bot trace of a turn reads as the Messaged line's quiet
// centered line in the real chat view, never a left-aligned row per
// teammate, a "Teammates · Finished" card or a bare "Teammate" label over an
// italic line: "Asking / Asked [face] A, [face] B and [face] C" on the
// sender's side, "[face] A asked “first words”" on the receiver's, a stopped
// request said on the same line. Tool calls hidden or shown, English and
// French. Neutral names only (term-guard).
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

  it("draws a teammate's request on the receiver's side as one line with its face, name and first words", () => {
    const markup = render("r0", [
      text("u", "user", "Hi.", 0),
      text("m1", "bot", "Three duplicates.", 20, { relayVia: "teammate", relayOf: "x1", relayAsk: { text: BRIEF, by: "Scout", botId: "scout" } } as Partial<Message>),
    ]);
    expect(count(markup, 'data-testid="teammate-ask-line"')).toBe(1);
    expect(plain(markup)).toContain(`Scout asked “${BRIEF}”`);
    expect(plain(markup)).not.toContain("Teammate ·");
  });

  it("says a stopped request on that same line, never a bare Teammate label and an italic line", () => {
    const markup = render("r0", [
      text("u", "user", "Hi.", 0),
      text("m2", "bot", "This request was stopped before an answer.", 30, { relayVia: "teammate", relayOf: "x2", relayTrace: "stopped", relayAsk: { text: "", by: "Scout", botId: "scout" } } as Partial<Message>),
    ]);
    expect(count(markup, 'data-testid="teammate-ask-line"')).toBe(1);
    expect(plain(markup)).toContain("Scout asked · stopped before an answer");
    expect(plain(markup)).not.toContain("This request was stopped before an answer.");
    expect(plain(markup)).not.toMatch(/\bTeammate\b/);
  });

  it("draws one line, not two, for a request and the reply copied under it", () => {
    const incoming = {
      id: "in", role: "bot", kind: "activity", at: at + 5000, from: { botId: "scout", name: "Scout", color: "green" },
      tool: { name: "Asked by Scout", ok: true, input: BRIEF, handoffId: "h0" },
      threadRef: { botId: "r0", threadId: "r0-w", title: "Duplicates" },
    } as Message;
    const replied = {
      id: "in-r", role: "bot", kind: "activity", at: at + 6000, roomRequest: { id: "h0", phase: "result" },
      from: { botId: "r0", name: "Wren", color: "blue" }, tool: { name: "Wren replied", ok: true, output: "Three duplicates." },
      threadRef: { botId: "r0", threadId: "r0-w", title: "Duplicates" },
    } as Message;
    const markup = render("r0", [
      text("u", "user", "Hi.", 0),
      incoming,
      replied,
      text("m1", "bot", "Three duplicates.", 20, { relayVia: "teammate", relayOf: "x1", relayAsk: { text: BRIEF, by: "Scout", botId: "scout" } } as Partial<Message>),
    ]);
    expect(count(plain(markup), "Scout asked")).toBe(1);
    expect(markup).toContain("Three duplicates.");
  });
});
