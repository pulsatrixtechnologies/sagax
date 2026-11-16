// #4490: ask_choice takes only well formed cards: a form of rows with their
// controls, a checklist with action buttons, one question per control. The
// two cards the owner was shown are refused with a message that says how to
// ask again; their rebuilt forms are drawn as rows.
import { describe, expect, it, vi } from "vitest";

import { ASK_CHOICE_TOOL, parseAskChoiceInput } from "../shared/options-card.ts";
import { BAD_DRAFTS_CARD, BAD_TIME_CARD, GOOD_DRAFTS_CARD, GOOD_TIME_CARD } from "../shared/card-rules.fixtures.ts";
import { ASK_CHOICE_DEF } from "./drivers/agents-tools/extras.ts";
import { createAgentCard, type AgentCardStore } from "./widgets/chat-widgets.ts";
import { buildSystemPrompt } from "./system-prompt.ts";
import type { Message } from "./store.ts";

const BOT = { id: "bot-any", name: "Nimbus", color: "blue" as const };

function store() {
  const rows: Message[] = [];
  const fake: AgentCardStore = {
    groupByThread: () => undefined,
    messagesFor: () => rows,
    appendMessage: vi.fn((_thread: string, message: Omit<Message, "id" | "at">): Message => {
      const full = { ...message, id: `m${rows.length + 1}`, at: 1 } as Message;
      rows.push(full);
      return full;
    }),
    patchMessage: () => null,
  };
  return { fake, rows };
}

describe("ask_choice refuses a badly made card (#4490)", () => {
  it("refuses the time card and tells the bot to ask again as one form", () => {
    const parsed = parseAskChoiceInput(BAD_TIME_CARD);
    expect(parsed.ok).toBe(false);
    const error = (parsed as { error: string }).error;
    expect(error).toMatch(/^Card refused \(rule several-questions/);
    expect(error).toMatch(/same turn/);
    expect(error).toMatch(/ask_choice \{.*"questions":\[/);
  });

  it("refuses the drafts card and tells the bot to ask again as a checklist", () => {
    const parsed = parseAskChoiceInput(BAD_DRAFTS_CARD);
    expect(parsed.ok).toBe(false);
    const error = (parsed as { error: string }).error;
    expect(error).toMatch(/^Card refused \(rule list-in-prose/);
    expect(error).toMatch(/"items":\[.*"actions":\["Post selected","Skip tonight"\]/);
  });

  it("draws nothing for a refused card", () => {
    const { fake, rows } = store();
    const raiseQuestion = vi.fn(() => ({ messageId: "q1" }));
    const result = createAgentCard({ store: fake, bot: BOT, threadId: "t", input: { tool: ASK_CHOICE_TOOL, ...BAD_DRAFTS_CARD }, raiseQuestion });
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(raiseQuestion).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });

  it.each([
    [{ question: "Tonight", questions: [{ question: "Done?", kind: "yes_no", options: ["Yes", "No"] }] }, /yes_no row takes no options/],
    [{ question: "Tonight", questions: [{ question: "How long?", kind: "duration", options: ["1 h", "2 h"] }] }, /duration row takes no options/],
    [{ question: "Tonight", questions: [{ question: "Which?", kind: "choice", options: ["Only"] }] }, /2-8 short answers/],
    [{ question: "Tonight", questions: [{ question: "Which?", kind: "slider" }] }, /kind: one of choice, multi/],
    [{ question: "Tonight", questions: [{ question: "A?", kind: "text" }, { question: "A?", kind: "text" }] }, /asked twice/],
    [{ question: "Tonight", items: [{ label: "A" }, { label: "B" }] }, /actions: 1-3 buttons/],
    [{ question: "Tonight", items: [{ label: "A" }] , actions: ["Go"] }, /items: 2-20/],
    [{ question: "Tonight", items: [{ label: "A" }, { label: "B" }], actions: ["Go"], questions: [] }, /not both/],
    [{ question: "Tonight", items: [{ label: "A" }, { label: "B" }], actions: ["Go"], options: ["X", "Y"] }, /Leave options out/],
  ])("refuses a malformed form %#", (input, error) => {
    const parsed = parseAskChoiceInput(input);
    expect(parsed.ok).toBe(false);
    expect((parsed as { error: string }).error).toMatch(error);
  });
});

describe("ask_choice draws a form and a checklist (#4490)", () => {
  it("parses the rebuilt time card as one form, a row per line", () => {
    const parsed = parseAskChoiceInput(GOOD_TIME_CARD);
    expect(parsed.ok).toBe(true);
    const value = (parsed as { value: { questions: unknown[]; decision?: true; subtitle: string } }).value;
    expect(value.subtitle).toBe(GOOD_TIME_CARD.question);
    expect(value.decision).toBe(true);
    expect(value.questions).toHaveLength(7);
    expect(value.questions[0]).toMatchObject({ kind: "choice", options: [{ label: "Done" }, { label: "Not done" }, { label: "Move to tomorrow" }] });
    expect(value.questions[1]).toMatchObject({ kind: "duration", options: [] });
    expect(value.questions[5]).toMatchObject({ kind: "yes_no", options: [{ label: "Yes", id: "yes" }, { label: "No", id: "no" }] });
    expect(value.questions[6]).toMatchObject({ optional: true });
  });

  it("parses the rebuilt drafts card as a checklist of six rows and two buttons", () => {
    const parsed = parseAskChoiceInput(GOOD_DRAFTS_CARD);
    expect(parsed.ok).toBe(true);
    const [row] = (parsed as { value: { questions: Array<{ options: Array<{ label: string; description?: string }>; checked?: string[]; actions?: string[]; multiSelect?: boolean }> } }).value.questions;
    expect(row!.multiSelect).toBe(true);
    expect(row!.options).toHaveLength(6);
    expect(row!.options[0]!.description).toMatch(/Nimbus 2\.4 is out/);
    expect(row!.actions).toEqual(["Post selected", "Skip tonight"]);
    // pre-checked as the bot proposes: all but the one it left unchecked
    expect(row!.checked).toHaveLength(5);
    expect(row!.checked).not.toContain("Clip of the new sidebar");
  });

  it("raises a form as a real question card with its rows, never as a passive card", () => {
    const { fake, rows } = store();
    const raiseQuestion = vi.fn((_choice: { questions?: unknown[]; question: string }) => ({ messageId: "q1" }));
    const result = createAgentCard({ store: fake, bot: BOT, threadId: "t", input: { tool: ASK_CHOICE_TOOL, ...GOOD_TIME_CARD }, raiseQuestion });
    expect(result).toMatchObject({ ok: true, messageId: "q1", waitsForPerson: true });
    expect(rows).toHaveLength(0);
    const raised = raiseQuestion.mock.calls[0]![0];
    expect(raised.question).toBe(GOOD_TIME_CARD.question);
    expect(raised.questions).toHaveLength(7);
  });

  it("is never answered for the person under Full access", () => {
    const { fake } = store();
    const raiseQuestion = vi.fn(() => ({ messageId: "q1" }));
    const result = createAgentCard({ store: fake, bot: BOT, threadId: "t", approvalLevel: "full", input: { tool: ASK_CHOICE_TOOL, ...GOOD_DRAFTS_CARD }, raiseQuestion });
    expect(result).not.toHaveProperty("answered");
    expect(raiseQuestion).toHaveBeenCalledTimes(1);
  });

  it("says where a form cannot be raised instead of drawing it passive", () => {
    const { fake, rows } = store();
    const result = createAgentCard({ store: fake, bot: BOT, threadId: "t", input: { tool: ASK_CHOICE_TOOL, ...GOOD_TIME_CARD } });
    expect(result).toMatchObject({ ok: false });
    expect(rows).toHaveLength(0);
  });
});

describe("the tool and the prompt teach the rules (#4490)", () => {
  it("describes a form and a checklist, with one example each", () => {
    const schema = ASK_CHOICE_DEF.inputSchema as { properties: Record<string, unknown>; required: string[] };
    expect(Object.keys(schema.properties)).toEqual(expect.arrayContaining(["questions", "items", "actions"]));
    expect(schema.required).toEqual(["question"]);
    expect(ASK_CHOICE_DEF.description).toMatch(/one question per control/i);
    expect(ASK_CHOICE_DEF.description).toMatch(/refused/);
  });

  it("puts the rule in the system prompt", () => {
    const prompt = buildSystemPrompt("You are Nimbus.", "", []).stable;
    expect(prompt).toMatch(/one question per control/i);
    expect(prompt).toMatch(/checklist/);
  });
});
