import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { ASK_CHOICE_TOOL, parseAskChoiceInput } from "../shared/options-card.ts";
import { createAgentCard, type AgentCardStore } from "./chat-widgets.ts";
import { availableTools, type CatalogProfile } from "./drivers/agents-catalog.ts";
import { BUILT_IN_DRIVERS } from "./drivers/builtIn.ts";
import { MEMBER_OWN_SCOPE_AGENT_TOOLS } from "./people/member-tool-scope.ts";
import { buildSystemPrompt } from "./system-prompt.ts";
import type { Message } from "./store.ts";

const BOT = { id: "bot-any", name: "Any", color: "blue" as const };
const everything: CatalogProfile = {
  externalRuntime: false, coordinating: false, ownThreadCreation: true, skillAuthoring: true, sharedComputers: true,
  voiceNotes: true, cloudHome: false, memoryEnabled: true, groupMemory: true, chief: true, claims: true, botId: "bot-1",
};

function store(rooms: string[] = []) {
  const rows: Message[] = [];
  const appendMessage = vi.fn((_thread: string, message: Omit<Message, "id" | "at">): Message => {
    const full = { ...message, id: `m${rows.length + 1}`, at: 1 } as Message;
    rows.push(full);
    return full;
  });
  const fake: AgentCardStore = {
    groupByThread: (id) => (rooms.includes(id) ? { id: "room" } : undefined),
    messagesFor: () => rows,
    appendMessage,
    patchMessage: () => null,
  };
  return { fake, rows };
}

describe("ask_choice, the clickable question every engine can use", () => {
  it("parses a question with 2-6 options, recommended first", () => {
    expect(parseAskChoiceInput({ question: "Which one?", options: ["Plan A", "Plan B"] })).toEqual({
      ok: true, value: { title: "Your bot has a question", subtitle: "Which one?", options: ["Plan A", "Plan B"] },
    });
    expect(parseAskChoiceInput({ question: "Which?", options: ["Only"] })).toMatchObject({ ok: false });
    expect(parseAskChoiceInput({ options: ["A", "B"] })).toMatchObject({ ok: false });
  });

  it("draws the card for any bot, without a `from` in a direct thread", () => {
    const { fake, rows } = store(["room-1"]);
    const result = createAgentCard({ store: fake, bot: BOT, threadId: "direct", input: { tool: ASK_CHOICE_TOOL, question: "Which?", options: ["A", "B", "C"] } });
    expect(result.ok).toBe(true);
    expect(rows[0]).toMatchObject({ kind: "options", card: { subtitle: "Which?", options: ["A", "B", "C"] } });
    expect(rows[0]!.from).toBeUndefined();
    expect((rows[0]!.card as unknown as Record<string, unknown>).requestId).toBeUndefined();
    createAgentCard({ store: fake, bot: BOT, threadId: "room-1", input: { tool: ASK_CHOICE_TOOL, question: "Which?", options: ["A", "B"] } });
    expect(rows[1]!.from).toMatchObject({ botId: BOT.id });
  });

  it("refuses a malformed call without drawing anything", () => {
    const { fake, rows } = store();
    expect(createAgentCard({ store: fake, bot: BOT, threadId: "t", input: { tool: ASK_CHOICE_TOOL, question: "?", options: ["A"] } })).toMatchObject({ ok: false, status: 400 });
    expect(rows).toHaveLength(0);
  });

  it("is offered to every bot, and is the member's own conversation scope", () => {
    for (const profile of [everything, { ...everything, coordinating: true }]) {
      expect(availableTools(profile).map((tool) => tool.name)).toContain(ASK_CHOICE_TOOL);
    }
    expect(MEMBER_OWN_SCOPE_AGENT_TOOLS[ASK_CHOICE_TOOL]).toBe("conversation");
  });

  it("puts the rule in the prompt of every engine, and every engine has a question tool", () => {
    const natives = JSON.parse(readFileSync(new URL("./drivers/engine-native-tools.json", import.meta.url), "utf8")) as { engines: Record<string, { solo: string[]; org: string[] }> };
    const prompt = buildSystemPrompt("You are Kiwi.", "", []).stable;
    expect(prompt).toContain("Always ask through the interactive question tool, never in your reply text");
    expect(prompt).toContain("ask_choice");
    // an engine with a native question tool uses it; the others (and an organization turn that withholds it) get ask_choice from the agents server
    const withNative = Object.entries(natives.engines).filter(([, tools]) => tools.org.some((name) => /ask_?user|request_user_input/i.test(name))).map(([engine]) => engine);
    expect(withNative.sort()).toEqual(["claude", "codex", "kimi", "qwen"]);
    for (const driver of BUILT_IN_DRIVERS) expect(driver.driverKind).toBeTruthy();
    expect(availableTools(everything).some((tool) => tool.name === ASK_CHOICE_TOOL)).toBe(true);
  });
});
