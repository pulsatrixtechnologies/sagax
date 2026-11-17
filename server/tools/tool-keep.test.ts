// #4527 lot B: the rule that leaves a bot's unused tools out of its next
// conversations, and its small store per bot and person.
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { DATA_DIR } from "../config.ts";
import { createCompactPromptFor } from "../index-leaves/compactPromptFor.ts";
import {
  bringAllToolsBack, emptyToolKeep, EVIDENCE_SESSIONS, foldToolSession, forgetToolKeep, forgetToolKeepInMemory, LEFT_OUT_PROMPT_SESSIONS, LEFT_OUT_PROMPTS,
  LEFT_OUT_SESSIONS, meetsLeftOutRule, namedByToolScope, neverPruned, readToolKeep, saveToolKeep, toolKeepCall, toolKeepDir, toolKeepTurn, toolKeepVerdict,
  type ToolKeepState,
} from "./tool-keep.ts";

const EMPTY = new Set<string>();

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
    toolKeepTurn(turn);
    bringAllToolsBack("bot-1", "alice");
    const state = readToolKeep("bot-1", "alice");
    expect(state.tools).toEqual({});
    expect(state.leftOut).toEqual([]);
    expect(state.restoredAt).toBeGreaterThan(0);
  });
});

describe("sessions and the store", () => {
  const turn = (threadId: string, extra: Partial<Parameters<typeof toolKeepTurn>[0]> = {}) =>
    toolKeepTurn({ botId: "bot-1", person: "alice@example.test", threadId, prompt: true, ...extra });

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
    toolKeepTurn({ botId: "bot-1", person: "bob@example.test", threadId: "t-2", prompt: true });
    saveToolKeep();
    const dirs = readdirSync(toolKeepDir());
    expect(dirs).toHaveLength(1);
    const files = readdirSync(join(toolKeepDir(), dirs[0]!));
    expect(files).toHaveLength(2);
    for (const file of files) {
      const path = join(toolKeepDir(), dirs[0]!, file);
      expect(statSync(path).mode & 0o777).toBe(0o600);
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
      toolKeepTurn({ botId: "bot-1", person: "alice", threadId: `a-${n}`, prompt: true });
      toolKeepCall(`a-${n}`, "ledger/balance");
    }
    expect(readToolKeep("bot-1", "alice").sessions).toBe(5);
    expect(readToolKeep("bot-1", "bob")).toEqual(emptyToolKeep());
    expect(readToolKeep("bot-2", "alice")).toEqual(emptyToolKeep());
    // bob's call in his own conversation never reaches alice's session
    toolKeepTurn({ botId: "bot-1", person: "bob", threadId: "b-0", prompt: true });
    toolKeepCall("b-0", "crm/secret");
    expect(JSON.stringify(readToolKeep("bot-1", "alice"))).not.toContain("crm/secret");
  });
});

describe("compactPromptFor (#4527)", () => {
  const host = { DATA_DIR, routines: { listRoutines: () => [] } };
  const compactPromptFor = createCompactPromptFor(() => host);
  const bot = { id: "bot-9" };

  it("lists the default core until the bot has its own evidence, then its used tools", () => {
    const first = compactPromptFor(bot, "alice", { threadId: "c-0", prompt: true });
    expect(first.agents).toEqual({ core: "default", pinned: [] });
    toolKeepCall("c-0", "agents/propose_page");
    toolKeepCall("c-0", "crm/get_ticket");
    compactPromptFor(bot, "alice", { threadId: "c-1", prompt: true });
    toolKeepCall("c-1", "agents/propose_page");
    const third = compactPromptFor(bot, "alice", { threadId: "c-2", prompt: true });
    expect(third.agents).toEqual({ core: "used", pinned: ["propose_page"] });
    expect(third.pinned).toEqual({ crm: ["get_ticket"] });
    expect(third.memoryDir).toContain("claude-auto-memory");
    // another person on the same bot starts from nothing
    expect(compactPromptFor(bot, "bob", { threadId: "c-9", prompt: true }).agents).toEqual({ core: "default", pinned: [] });
  });
});
