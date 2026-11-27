// #4527 lot B: the rule that leaves a bot's unused tools out of its next
// conversations, and its small store per bot and person.
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { isOwnerOnlyProtected } from "../owner-only-acl.ts";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { DATA_DIR } from "../config.ts";
import { createCompactPromptFor } from "../index-leaves/compactPromptFor.ts";
import {
  bringAllToolsBack, emptyToolKeep, setToolAlwaysListed, toolKeepOffered, EVIDENCE_SESSIONS, foldToolSession, forgetToolKeep, forgetToolKeepInMemory, LEFT_OUT_PROMPT_SESSIONS, LEFT_OUT_PROMPTS,
  LEFT_OUT_SESSIONS, meetsLeftOutRule, namedByToolScope, neverPruned, readToolKeep, saveToolKeep, sessionLeftOut, toolKeepBindTurn, toolKeepDir, toolKeepSteps, toolKeepTurn, toolKeepVerdict,
  type ToolKeepState, type ToolTurn,
} from "./tool-keep.ts";

const EMPTY = new Set<string>();

/** The engine turn each conversation runs now, as a dispatch binds it. */
const lastTurn = new Map<string, string>();
let turnCount = 0;
/** A turn starts and its dispatch binds the engine's turn id. */
function startTurn(turn: ToolTurn) {
  const verdict = toolKeepTurn(turn);
  const turnId = `turn-${++turnCount}`;
  lastTurn.set(turn.threadId, turnId);
  toolKeepBindTurn(turn.threadId, turnId, turn.botId, turn.person);
  return verdict;
}
/** One tool step written to the conversation's log, as the bus hands it. */
const step = (threadId: string, turnId: string, toolId: string) => ({ type: "item.started", itemType: "tool", threadId, turnId, itemId: `i-${toolId}`, title: toolId.split("/")[1], tool: toolId });
/** A call in the conversation's current turn. */
function toolKeepCall(threadId: string, toolId: string) {
  toolKeepSteps(threadId, [step(threadId, lastTurn.get(threadId)!, toolId)]);
}

/** `sessions` sessions of `prompts` prompts each, using only `used`. */
function sessions(state: ToolKeepState, count: number, prompts: number, used: string[], offered: string[] = []): ToolKeepState {
  for (let n = 0; n < count; n++) state = foldToolSession(state, { prompts, used, offered });
  return state;
}

/** A bot that used `tool` and `other` once, then only `other`. */
function stale(prompts: number, count: number): ToolKeepState {
  const state = sessions(emptyToolKeep(), 1, 1, ["crm/stale", "crm/other"]);
  return sessions(state, count, prompts, ["crm/other"]);
}

beforeEach(() => {
  forgetToolKeepInMemory();
  lastTurn.clear();
  rmSync(toolKeepDir(), { recursive: true, force: true });
});

describe("the rule (10 prompts over 2 sessions, or 5 sessions)", () => {
  it("leaves a tool out after 10 unused prompts spread across 2 sessions, not before", () => {
    expect(LEFT_OUT_PROMPTS).toBe(10);
    expect(LEFT_OUT_PROMPT_SESSIONS).toBe(2);
    expect(toolKeepVerdict(stale(4, 2)).leftOut).toEqual([]);
    expect(toolKeepVerdict(stale(5, 2)).leftOut).toEqual(["crm/stale"]);
    // 10 prompts in one session is not enough: the sessions are spread
    expect(toolKeepVerdict(sessions(sessions(emptyToolKeep(), 2, 1, ["crm/stale"]), 1, 30, [])).leftOut).toEqual([]);
  });

  it("leaves a tool out after 5 unused sessions, however short", () => {
    expect(LEFT_OUT_SESSIONS).toBe(5);
    expect(toolKeepVerdict(stale(1, 4)).leftOut).toEqual([]);
    expect(toolKeepVerdict(stale(1, 5)).leftOut).toEqual(["crm/stale"]);
    expect(meetsLeftOutRule({ sessions: 5, prompts: 5 })).toBe(true);
    expect(meetsLeftOutRule({ sessions: 1, prompts: 99 })).toBe(false);
  });

  it("one use brings a tool back for good, until it meets the rule again", () => {
    let state = stale(1, 5);
    state = foldToolSession(state, { prompts: 1, used: ["crm/stale"] });
    expect(toolKeepVerdict(state).leftOut).toEqual([]);
    expect(state.tools["crm/stale"]).toMatchObject({ sessions: 0, prompts: 0 });
  });

  it("a tool seen for the first time starts at zero, with its own full window", () => {
    let state = stale(1, 5);
    state = foldToolSession(state, { prompts: 3, used: [], offered: ["crm/new"] });
    expect(state.tools["crm/new"]).toEqual({ sessions: 0, prompts: 0, uses: 0 });
    state = sessions(state, 4, 1, []);
    expect(toolKeepVerdict(state).leftOut).not.toContain("crm/new");
    expect(toolKeepVerdict(sessions(state, 1, 1, [])).leftOut).toContain("crm/new");
  });

  it("a session without a prompt is no evidence", () => {
    const state = stale(1, 4);
    expect(foldToolSession(state, { prompts: 0, used: [] })).toBe(state);
  });

  it("a bot with fewer than 2 sessions of evidence keeps everything", () => {
    expect(EVIDENCE_SESSIONS).toBe(2);
    const state = { ...stale(1, 5), sessions: 1 };
    expect(toolKeepVerdict(state)).toMatchObject({ evidence: false, leftOut: [] });
  });

  it("never leaves out approvals, cards, memory, finding tools, the core or the Perspicax bridge's core", () => {
    for (const id of ["agents/answer_approval", "agents/ask_choice", "agents/create_options_card", "agents/sagax_approvals", "agents/request_login",
      "agents/memory_update", "agents/search_tools", "agents/call_tool", "agents/shared_computer", "agents/task_list", "agents/sagax_help", "agents/run_routine",
      "px/memory_search", "px/api_search", "px/flow", "px/cw_psa_query", "px/cw_psa_write", "crm/search_tools"]) {
      expect(neverPruned(id, EMPTY, EMPTY), id).toBe(true);
    }
    expect(neverPruned("agents/propose_page", EMPTY, EMPTY)).toBe(false);
    expect(neverPruned("crm/get_ticket", EMPTY, EMPTY)).toBe(false);
    // a live call's tools, on a call only
    expect(neverPruned("agents/send_dtmf", EMPTY, EMPTY)).toBe(false);
    expect(neverPruned("agents/send_dtmf", EMPTY, EMPTY, { voiceCall: true })).toBe(true);
  });

  it("never leaves out a tool a routine run called, until the bot has no routine left", () => {
    let state = sessions(emptyToolKeep(), 1, 1, ["crm/monthly"]);
    state = foldToolSession(state, { prompts: 1, used: ["crm/monthly"], routine: true });
    state = sessions(state, 8, 3, []);
    expect(toolKeepVerdict(state).leftOut).toEqual([]);
    expect(toolKeepVerdict({ ...state, routineTools: [] }).leftOut).toEqual(["crm/monthly"]);
  });

  it("never leaves out a tool the person named in the tool selection or the turn names", () => {
    const state = stale(1, 5);
    expect(namedByToolScope({ allow: ["mcp:crm:stale", "mcp:crm:*", "native:Bash"] })).toEqual(["crm/stale"]);
    expect(toolKeepVerdict(state, { named: namedByToolScope({ allow: ["mcp:crm:stale"] }) }).leftOut).toEqual([]);
    expect(toolKeepVerdict(state, { named: ["mcp__crm__stale"] }).leftOut).toEqual([]);
  });

  it("bring all back empties the streaks", () => {
    const turn = { botId: "bot-1", person: "alice", threadId: "t-1", prompt: true };
    startTurn(turn);
    bringAllToolsBack("bot-1", "alice");
    const state = readToolKeep("bot-1", "alice");
    expect(state.tools).toEqual({});
    expect(state.leftOut).toEqual([]);
    expect(state.restoredAt).toBeGreaterThan(0);
  });
});

describe("sessions and the store", () => {
  const turn = (threadId: string, extra: Partial<Parameters<typeof toolKeepTurn>[0]> = {}) =>
    startTurn({ botId: "bot-1", person: "alice@example.test", threadId, prompt: true, ...extra });

  /** `count` conversations in a row, each calling `used`. */
  function conversations(count: number, used: string[], from = 0) {
    for (let n = from; n < from + count; n++) {
      turn(`t-${n}`);
      for (const id of used) toolKeepCall(`t-${n}`, id);
    }
  }

  it("folds a conversation when the next one starts, and leaves a stale tool out of the next ones", () => {
    conversations(1, ["crm/stale", "crm/other"]);
    conversations(4, ["crm/other"], 1);
    // a conversation's evidence is folded when the next one starts
    expect(turn("t-5").leftOut).toEqual([]);
    toolKeepCall("t-5", "crm/other");
    expect(turn("t-6").leftOut).toEqual(["crm/stale"]);
    expect(readToolKeep("bot-1", "alice@example.test").tools["crm/stale"]).toMatchObject({ sessions: 5 });
  });

  it("keeps a session's verdict for its whole life, across a restart, and changes it only at a new session", () => {
    conversations(1, ["crm/stale", "crm/other"]);
    conversations(4, ["crm/other"], 1);
    const running = turn("t-run");
    expect(running.leftOut).toEqual([]);
    // more conversations end meanwhile: the running one keeps its list
    conversations(3, ["crm/other"], 10);
    expect(turn("t-run")).toEqual(running);
    saveToolKeep();
    forgetToolKeepInMemory();
    expect(turn("t-run")).toEqual(running);
    // a compaction is a new session of the same conversation: the list moves then
    expect(turn("t-run", { compaction: "c-1" }).leftOut).toEqual(["crm/stale"]);
  });

  it("counts a conversation that goes on after its fold as the same session", () => {
    turn("a");
    toolKeepCall("a", "crm/x");
    turn("b");
    // "a" goes on: more prompts, no new session
    turn("a");
    turn("a");
    turn("c");
    const state = readToolKeep("bot-1", "alice@example.test");
    expect(state.sessions).toBe(2);
    expect(state.tools["crm/x"]).toEqual({ sessions: 1, prompts: 3, uses: 1 });
  });

  it("a warm start counts no prompt", () => {
    turn("w", { prompt: false });
    turn("next");
    expect(readToolKeep("bot-1", "alice@example.test").sessions).toBe(0);
  });

  it("keeps one file per bot and person, ids and integers only, mode 0600, removed with the bot", () => {
    turn("t-1");
    toolKeepCall("t-1", "crm/get_ticket");
    startTurn({ botId: "bot-1", person: "bob@example.test", threadId: "t-2", prompt: true });
    saveToolKeep();
    const dirs = readdirSync(toolKeepDir());
    expect(dirs).toHaveLength(1);
    const files = readdirSync(join(toolKeepDir(), dirs[0]!));
    expect(files).toHaveLength(2);
    for (const file of files) {
      const path = join(toolKeepDir(), dirs[0]!, file);
      expect(isOwnerOnlyProtected(path)).toBe(true);
      const text = readFileSync(path, "utf8");
      // never a person, a bot or a conversation id in clear
      for (const name of ["alice", "bob", "bot-1", "t-1", "t-2"]) expect(text).not.toContain(name);
      const strings: string[] = [];
      JSON.parse(text, (_key, value) => {
        if (typeof value === "string") strings.push(value);
        return value;
      });
      for (const value of strings) expect(value).toMatch(/^(?:[0-9a-f]{40}|[\w-]+\/[\w.:-]+|used|default)$/);
    }
    forgetToolKeep("bot-1");
    expect(existsSync(join(toolKeepDir(), dirs[0]!))).toBe(false);
    expect(readToolKeep("bot-1", "alice@example.test").open).toEqual({});
  });

  it("never reads one person's use for another person, on the same bot or another", () => {
    for (let n = 0; n < 6; n++) {
      startTurn({ botId: "bot-1", person: "alice", threadId: `a-${n}`, prompt: true });
      toolKeepCall(`a-${n}`, "ledger/balance");
    }
    expect(readToolKeep("bot-1", "alice").sessions).toBe(5);
    expect(readToolKeep("bot-1", "bob")).toEqual(emptyToolKeep());
    expect(readToolKeep("bot-2", "alice")).toEqual(emptyToolKeep());
    // bob's call in his own conversation never reaches alice's session
    startTurn({ botId: "bot-1", person: "bob", threadId: "b-0", prompt: true });
    toolKeepCall("b-0", "crm/secret");
    expect(JSON.stringify(readToolKeep("bot-1", "alice"))).not.toContain("crm/secret");
  });
});

describe("calls belong to the turn that made them", () => {
  it("two members of a room, two people, overlapping turns: each call reaches its own bot and person", () => {
    const room = "room-1";
    // bot A for alice and bot B for bob start in the same room conversation
    toolKeepTurn({ botId: "bot-a", person: "alice", threadId: room, prompt: true });
    toolKeepTurn({ botId: "bot-b", person: "bob", threadId: room, prompt: true });
    toolKeepBindTurn(room, "turn-a", "bot-a", "alice");
    toolKeepBindTurn(room, "turn-b", "bot-b", "bob");
    // their calls interleave in the room's log
    toolKeepSteps(room, [step(room, "turn-a", "crm/get_ticket"), step(room, "turn-b", "ledger/balance"), step(room, "turn-a", "crm/close_ticket")]);
    const used = (botId: string, person: string) => Object.values(readToolKeep(botId, person).open).flatMap((open) => open.used);
    expect(used("bot-a", "alice")).toEqual(["crm/get_ticket", "crm/close_ticket"]);
    expect(used("bot-b", "bob")).toEqual(["ledger/balance"]);
    expect(used("bot-a", "bob")).toEqual([]);
    expect(used("bot-b", "alice")).toEqual([]);
  });

  it("a call written before its turn is bound waits for the binding; an unbound turn reaches nobody", () => {
    toolKeepTurn({ botId: "bot-1", person: "alice", threadId: "t-early", prompt: true });
    toolKeepSteps("t-early", [step("t-early", "fast", "crm/get_ticket"), step("t-early", "stranger", "crm/delete_all")]);
    expect(Object.values(readToolKeep("bot-1", "alice").open)[0]!.used).toEqual([]);
    toolKeepBindTurn("t-early", "fast", "bot-1", "alice");
    expect(Object.values(readToolKeep("bot-1", "alice").open)[0]!.used).toEqual(["crm/get_ticket"]);
  });

  it("a context renewal inside a turn starts a new session at the conversation's next turn", () => {
    for (let n = 0; n < 3; n++) startTurn({ botId: "bot-1", person: "alice", threadId: `w-${n}`, prompt: true });
    const before = startTurn({ botId: "bot-1", person: "alice", threadId: "long", prompt: true });
    expect(startTurn({ botId: "bot-1", person: "alice", threadId: "long", prompt: true })).toEqual(before);
    const sessions = readToolKeep("bot-1", "alice").sessions;
    toolKeepSteps("long", [{ type: "runtime.notice", threadId: "long", turnId: lastTurn.get("long")!, message: "renewed", contextRenewed: true }]);
    startTurn({ botId: "bot-1", person: "alice", threadId: "long", prompt: true });
    // the renewed session was folded: one more session of evidence
    startTurn({ botId: "bot-1", person: "alice", threadId: "other", prompt: true });
    expect(readToolKeep("bot-1", "alice").sessions).toBe(sessions + 2);
  });

  it("writes a new session at once: a crash right after keeps its list", () => {
    const frozen = startTurn({ botId: "bot-1", person: "alice", threadId: "t-crash", prompt: true });
    // no save timer, no exit hook: what is on disk is all a restart reads
    forgetToolKeepInMemory();
    expect(Object.keys(readToolKeep("bot-1", "alice").open)).toHaveLength(1);
    expect(toolKeepTurn({ botId: "bot-1", person: "alice", threadId: "t-crash", prompt: true })).toEqual(frozen);
  });

  it("never leaves out a tool the session's prompt or a rule names by its own name", () => {
    const state = stale(1, 5);
    // a one-word name counts written as code or as its id, never as a word of a sentence
    expect(toolKeepVerdict(state, { namedText: ["Use `stale` for the weekly report."] }).leftOut).toEqual([]);
    expect(toolKeepVerdict(state, { namedText: ["Run crm/stale every Monday."] }).leftOut).toEqual([]);
    expect(toolKeepVerdict(state, { namedText: ["Call mcp__crm__stale first."] }).leftOut).toEqual([]);
    expect(toolKeepVerdict(state, { namedText: ["Use stale for the weekly report."] }).leftOut).toEqual(["crm/stale"]);
    expect(toolKeepVerdict(state, { namedText: ["A stalemate is not a tool name."] }).leftOut).toEqual(["crm/stale"]);
    expect(sessionLeftOut(["crm/stale", "crm/old"], { namedText: ["call `stale` now"] })).toEqual(["crm/old"]);
  });

  it("a compound name counts as a whole token, never as part of a longer one", () => {
    const state = sessions(sessions(emptyToolKeep(), 1, 1, ["crm/list_deals", "crm/other"]), 5, 1, ["crm/other"]);
    expect(toolKeepVerdict(state, { namedText: ["Then list_deals for the week."] }).leftOut).toEqual([]);
    expect(toolKeepVerdict(state, { namedText: ["Then list_deals_v2 for the week."] }).leftOut).toEqual(["crm/list_deals"]);
  });
});

describe("compactPromptFor (#4527)", () => {
  const host = { DATA_DIR, routines: { hasRoutineForBot: () => false } };
  const compactPromptFor = createCompactPromptFor(() => host);
  const bot = { id: "bot-9" };

  it("lists the default core until the bot has its own evidence, then its used tools", () => {
    const prompt = (threadId: string, person = "alice") => {
      const pins = compactPromptFor(bot, person, { threadId, prompt: true });
      lastTurn.set(threadId, `${threadId}-turn`);
      toolKeepBindTurn(threadId, `${threadId}-turn`, bot.id, person);
      return pins;
    };
    const first = prompt("c-0");
    expect(first.agents).toEqual({ core: "default", pinned: [] });
    toolKeepCall("c-0", "agents/propose_page");
    toolKeepCall("c-0", "crm/get_ticket");
    prompt("c-1");
    toolKeepCall("c-1", "agents/propose_page");
    const third = prompt("c-2");
    expect(third.agents).toEqual({ core: "used", pinned: ["propose_page"] });
    expect(third.pinned).toEqual({ crm: ["get_ticket"] });
    expect(third.memoryDir).toContain("claude-auto-memory");
    // another person on the same bot starts from nothing
    expect(prompt("c-9", "bob").agents).toEqual({ core: "default", pinned: [] });
  });
});

describe("lots C and E: the session's list, what it was offered, the person's choices (#4527)", () => {
  const turn = (threadId: string, extra: Partial<Parameters<typeof toolKeepTurn>[0]> = {}) =>
    startTurn({ botId: "bot-1", person: "alice@example.test", threadId, prompt: true, ...extra });
  function conversations(count: number, used: string[], from = 0) {
    for (let n = from; n < from + count; n++) {
      turn(`t-${n}`);
      for (const id of used) toolKeepCall(`t-${n}`, id);
    }
  }


  it("a routine's instruction (the turn's own text) keeps the tool it names listed before its first run", () => {
    conversations(1, ["crm/stale", "crm/other"]);
    conversations(5, ["crm/other"], 1);
    expect(turn("t-plain").leftOut).toEqual(["crm/stale"]);
    expect(turn("t-routine", { routine: true, context: { namedText: ["Every Monday, run crm/stale and post the result."] } }).leftOut).toEqual([]);
  });

  it("a tool named later in a conversation comes back from that turn on, for the rest of its session only", () => {
    conversations(1, ["crm/stale", "crm/old", "crm/other"]);
    conversations(5, ["crm/other"], 1);
    expect(turn("t-live").leftOut).toEqual(["crm/old", "crm/stale"]);
    // the others stay as the session froze them
    expect(turn("t-live", { context: { namedText: ["now use crm/stale"] } }).leftOut).toEqual(["crm/old"]);
    expect(turn("t-live").leftOut).toEqual(["crm/old"]);
    // a new conversation reads the rule again
    expect(turn("t-next").leftOut).toEqual(["crm/old", "crm/stale"]);
  });

  it("records only the offered tools it does not know yet, and writes nothing when they are already there", () => {
    turn("t-offer");
    toolKeepOffered("bot-1", "alice@example.test", "t-offer", ["agents/list_bots", "agents/list_rooms"]);
    expect(readToolKeep("bot-1", "alice@example.test").open[Object.keys(readToolKeep("bot-1", "alice@example.test").open)[0]!]!.offered).toEqual(["agents/list_bots", "agents/list_rooms"]);
    const before = readToolKeep("bot-1", "alice@example.test");
    toolKeepOffered("bot-1", "alice@example.test", "t-offer", ["agents/list_bots", "agents/list_rooms"]);
    // the same list again: the very same state object, nothing to write
    expect(readToolKeep("bot-1", "alice@example.test")).toBe(before);
    turn("t-offer-2");
    // known now: a later session keeps none of them with it
    toolKeepOffered("bot-1", "alice@example.test", "t-offer-2", ["agents/list_bots", "agents/list_rooms"]);
    const open = Object.values(readToolKeep("bot-1", "alice@example.test").open);
    expect(open.find((session) => session.offered.length === 0)).toBeDefined();
    expect(readToolKeep("bot-1", "alice@example.test").tools["agents/list_rooms"]).toEqual({ sessions: 0, prompts: 0, uses: 0 });
  });

  it("offered tools never called are left out after the rule, and a call through search brings one back at once", () => {
    for (let n = 0; n < 7; n++) {
      turn(`t-o${n}`);
      toolKeepOffered("bot-1", "alice@example.test", `t-o${n}`, ["agents/list_bots", "agents/list_rooms"]);
      toolKeepCall(`t-o${n}`, "agents/list_bots");
    }
    expect(turn("t-o7").leftOut).toEqual(["agents/list_rooms"]);
    // the bot found it by search and ran it: the next session lists it again
    toolKeepCall("t-o7", "agents/list_rooms");
    expect(turn("t-o8").leftOut).toEqual([]);
  });

  it("a tool the person keeps listed always is never left out, and goes back to the rule when unset", () => {
    conversations(1, ["crm/stale", "crm/other"]);
    conversations(5, ["crm/other"], 1);
    expect(turn("t-a").leftOut).toEqual(["crm/stale"]);
    expect(setToolAlwaysListed("bot-1", "alice@example.test", "crm/stale", true)).toBe(true);
    expect(readToolKeep("bot-1", "alice@example.test").leftOut).toEqual([]);
    expect(turn("t-b").leftOut).toEqual([]);
    setToolAlwaysListed("bot-1", "alice@example.test", "crm/stale", false);
    expect(turn("t-c").leftOut).toEqual(["crm/stale"]);
    expect(setToolAlwaysListed("bot-1", "alice@example.test", "not an id", true)).toBe(false);
  });

  it("bring all back shows at the next conversation; a running one keeps its frozen list", () => {
    // another person on the same bot, with the same left out tool
    const bob = (threadId: string, used: string[]) => {
      startTurn({ botId: "bot-1", person: "bob@example.test", threadId, prompt: true });
      for (const id of used) toolKeepCall(threadId, id);
    };
    bob("b-0", ["crm/stale", "crm/other"]);
    for (let n = 1; n < 7; n++) bob(`b-${n}`, ["crm/other"]);
    conversations(1, ["crm/stale", "crm/other"]);
    conversations(5, ["crm/other"], 1);
    expect(turn("t-run").leftOut).toEqual(["crm/stale"]);
    bringAllToolsBack("bot-1", "alice@example.test");
    expect(turn("t-run").leftOut).toEqual(["crm/stale"]);
    expect(turn("t-new").leftOut).toEqual([]);
    // another person's list on the same bot is untouched
    expect(readToolKeep("bot-1", "bob@example.test").leftOut).toEqual(["crm/stale"]);
  });
});

// #4527 review: a turn's tool names come from what stays put in a conversation
describe("toolKeepNamedText", () => {
  it("reads the stable prompt, the routine's instruction, the turn's text and the rules, never a memory", async () => {
    const { toolKeepNamedText } = await import("./tool-keep.ts");
    const texts = toolKeepNamedText({
      stable: "Identity. Use `list_bots`.",
      sections: [
        { id: "memory", text: "Last week the person ran `run_routine` twice." },
        { id: "routine-execution", text: "Run the routine with `export_report`." },
      ],
    }, "please list_rooms", ["refuse agents__delete_bot"]);
    const all = texts.join("\n");
    expect(all).toContain("list_bots");
    expect(all).toContain("export_report");
    expect(all).toContain("list_rooms");
    expect(all).toContain("agents__delete_bot");
    expect(all).not.toContain("run_routine");
    // so a memory naming a left out tool does not bring it back mid-conversation
    expect(sessionLeftOut(["agents/run_routine", "agents/export_report"], { namedText: texts })).toEqual(["agents/run_routine"]);
  });
});
