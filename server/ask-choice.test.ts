import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { ASK_CHOICE_TOOL, parseAskChoiceInput } from "../shared/options-card.ts";
import { createAgentCard, type AgentCardStore } from "./widgets/chat-widgets.ts";
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
    // 1fccfa2eb4: a blocking decision is an actionable card, the engine's own question tool first, else ask_choice
    expect(prompt).toContain("Every decision that blocks your work MUST be an actionable card");
    expect(prompt).toContain("use your native question tool (AskUserQuestion, ask_user_question, request_user_input or ask_user), else the Sagax tool ask_choice");
    expect(prompt).toContain("ask_choice");
    // an engine with a native question tool uses it; the others (and an organization turn that withholds it) get ask_choice from the agents server
    const withNative = Object.entries(natives.engines).filter(([, tools]) => tools.org.some((name) => /ask_?user|request_user_input/i.test(name))).map(([engine]) => engine);
    expect(withNative.sort()).toEqual(["claude", "codex", "kimi", "qwen"]);
    for (const driver of BUILT_IN_DRIVERS) expect(driver.driverKind).toBeTruthy();
    expect(availableTools(everything).some((tool) => tool.name === ASK_CHOICE_TOOL)).toBe(true);
  });
});

describe("ask_choice answers that answer the question (#2909)", () => {
  it("refuses Yes / No for an \"A or B?\" question, on the server", () => {
    const refused = parseAskChoiceInput({ question: "Je garde la version locale ou celle du serveur ?", options: ["Oui", "Non"] });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toContain("not Yes / No");
    expect(parseAskChoiceInput({ question: "Keep the local copy or the server one?", options: ["Yes", "No"] }).ok).toBe(false);
    // a real yes / no question keeps Yes / No
    expect(parseAskChoiceInput({ question: "Je publie la version 2.4 ?", options: ["Oui", "Non"] }).ok).toBe(true);
    expect(parseAskChoiceInput({ question: "Je garde la version locale ou celle du serveur ?", options: ["Locale", "Serveur"] }).ok).toBe(true);
  });

  it("takes {label, detail}: the label is the answer, the detail says what it does", () => {
    const parsed = parseAskChoiceInput({
      question: "La sauvegarde a échoué deux fois. Je relance ou j'attends ?",
      options: [{ label: "Relancer", detail: "Relance la sauvegarde maintenant" }, "Attendre"],
    });
    expect(parsed).toMatchObject({ ok: true, value: { options: ["Relancer", "Attendre"], details: ["Relance la sauvegarde maintenant", undefined] } });
    expect(parseAskChoiceInput({ question: "Je relance ou j'attends ?", options: ["Relancer", "Attendre"], details: ["Maintenant"] }))
      .toMatchObject({ ok: true, value: { details: ["Maintenant", undefined] } });
    const long = parseAskChoiceInput({ question: "Lequel ?", options: [{ label: "Un libellé beaucoup trop long pour un bouton" }, "B"] });
    expect(long.ok).toBe(false);
  });

  it("raises the question with each option's detail as its description", () => {
    const { fake } = store();
    const raiseQuestion = vi.fn(() => ({ messageId: "m-q" }));
    const result = createAgentCard({
      store: fake, bot: BOT, threadId: "t", raiseQuestion,
      input: { tool: ASK_CHOICE_TOOL, question: "Je relance ou j'attends ?", options: [{ label: "Relancer", detail: "Maintenant" }, "Attendre"] },
    });
    expect(result).toMatchObject({ ok: true, messageId: "m-q" });
    expect(raiseQuestion).toHaveBeenCalledWith(expect.objectContaining({
      options: ["Relancer", "Attendre"],
      questionOptions: [{ label: "Relancer", description: "Maintenant" }, { label: "Attendre" }],
    }));
  });

  it("the prompt asks for answers that answer the question", () => {
    expect(buildSystemPrompt("You are Kiwi.", "", []).stable).toContain("never Yes / No");
  });
});
