// #5032 (M-20261119-026): a question nobody answered before the engine's
// timer is never an answer. In production a bot's time-entry question was
// answered by its timer with "use your best judgment", the model took the
// first options and an entry was written in the person's name. Every engine
// now hands its model the one shared note, never a pick; the card stays
// open, and the person's later answer takes the kept-card path. A
// permission's own timeout is unchanged.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { isPersistentQuestionCard, QUESTION_UNANSWERED_NOTE, shouldSettleRequestCard } from "../../shared/ask-question.ts";
import { flushDecisionLog } from "../decision-log.ts";
import { handleRequestResolved } from "../runtime-events/request-resolved.ts";
import { openQuestionRequest } from "./acp/question-requests.ts";
import { CURSOR_ASK_QUESTION } from "./acp/cursor.ts";
import { GROK_ASK_USER_QUESTION } from "./acp/grok.ts";
import { DENY_TIMEOUT_NOTE, type Ask, type AskBehavior, type AskResolutionSource } from "./claude-asks.ts";
import { createPermissionBroker } from "./claude.ts";
import { claudeCanUseTool } from "./claude/can-use-tool.ts";
import type { ClaudeSession } from "./claude/session-types.ts";
import { codexQuestionReply } from "./codex/questions.ts";

/** The incident's shape: entries to write, the first option the one taken. */
const ASKED = "Write these three time entries in ConnectWise?";
const FIRST = "Yes, write all three";
const QUESTIONS = { questions: [{ question: ASKED, options: [{ label: FIRST }, { label: "No" }] }] };

/** Nothing in a reply the model reads may be one of the offered options. */
const picksNothing = (reply: unknown) => expect(JSON.stringify(reply)).not.toContain(FIRST);

const dirs: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function shortBroker() {
  const dir = mkdtempSync(join(tmpdir(), "sagax-question-timeout-"));
  dirs.push(dir);
  const resolved: Array<Ask & { behavior: AskBehavior; source: AskResolutionSource }> = [];
  const broker = await createPermissionBroker({
    socketPaths: [join(dir, "broker.sock")],
    onAsk: () => {},
    onResolve: (entry) => resolved.push(entry),
    timeoutMs: 40,
  });
  return { broker, resolved };
}

// Windows cannot listen on a filesystem socket path (see claude.test.ts).
describe.skipIf(process.platform === "win32")("Claude: a question its broker timed out", () => {
  it("answers the model with the no-answer note, and the engine no longer holds it, so a later answer takes the kept-card path", async () => {
    const { broker, resolved } = await shortBroker();
    try {
      const reply = await broker.hostAsk({ id: "q1", kind: "question", tool: "AskUserQuestion", input: QUESTIONS, at: Date.now() });
      expect(reply).toEqual({ behavior: "answer", message: QUESTION_UNANSWERED_NOTE, source: "timeout" });
      expect(JSON.stringify(reply)).not.toMatch(/best judgment/i);
      expect(resolved).toEqual([expect.objectContaining({ id: "q1", kind: "question", source: "timeout" })]);
      // answerRequest then reads "unavailable" and the respond route hands the
      // answer to deliverLateQuestionAnswer (routes/bots-messages.test.ts)
      expect(broker.answer("q1", "answer", FIRST)).toBe(false);
    } finally {
      broker.close();
    }
  });

  it("leaves a permission's timeout as it was: denied with its own note", async () => {
    const { broker } = await shortBroker();
    try {
      const reply = await broker.hostAsk({ id: "p1", kind: "permission", tool: "Bash", input: { command: "ls" }, at: Date.now() });
      expect(reply).toEqual({ behavior: "deny", message: DENY_TIMEOUT_NOTE, source: "timeout" });
    } finally {
      broker.close();
    }
  });

  it("refuses the CLI's AskUserQuestion with the note instead of running it with no answers; a permission still denies", async () => {
    const { broker } = await shortBroker();
    const frames: Array<{ response: { request_id: string; response: Record<string, unknown> } }> = [];
    const session = {
      closing: false,
      turn: { turnId: "u1", input: { botId: "b1" } },
      searchedMounts: new Set<string>(),
      permissionFacts: { preallowed: [], artifactReads: false },
      broker,
    } as unknown as ClaudeSession;
    const handler = claudeCanUseTool(() => session, async (frame) => {
      frames.push(frame as (typeof frames)[number]);
      return true;
    });
    const reply = async (requestId: string, request: Record<string, unknown>) => {
      handler.frame({ type: "control_request", request_id: requestId, request: { subtype: "can_use_tool", tool_use_id: `toolu_${requestId}`, ...request } });
      await vi.waitFor(() => {
        if (!frames.some((frame) => frame.response.request_id === requestId)) throw new Error("no answer yet");
      }, { timeout: 5_000 });
      return frames.find((frame) => frame.response.request_id === requestId)!.response.response;
    };
    try {
      const question = await reply("r1", { tool_name: "AskUserQuestion", input: QUESTIONS });
      expect(question).toEqual({ behavior: "deny", message: QUESTION_UNANSWERED_NOTE, toolUseID: "toolu_r1" });
      expect(question).not.toHaveProperty("updatedInput");
      picksNothing(question);
      expect(await reply("r2", { tool_name: "Bash", input: { command: "ls" } }))
        .toEqual({ behavior: "deny", message: DENY_TIMEOUT_NOTE, toolUseID: "toolu_r2" });
    } finally {
      broker.close();
    }
  });
});

describe("Codex: a requestUserInput nobody answered", () => {
  const protocol = [
    { id: "entries", question: { question: ASKED, options: [{ label: FIRST }, { label: "No" }] } },
    { id: "billable", question: { question: "Billable?", options: [{ label: "Yes" }, { label: "No" }] } },
  ];

  it("carries the note on every question, never a pick and never empty answers", () => {
    const reply = codexQuestionReply("deny", undefined, "timeout", protocol);
    expect(JSON.parse(JSON.stringify(reply))).toEqual({ answers: {
      entries: { answers: [QUESTION_UNANSWERED_NOTE] },
      billable: { answers: [QUESTION_UNANSWERED_NOTE] },
    } });
    picksNothing(reply);
  });

  it("keeps the person's own answer and the turn's teardown as they were", () => {
    expect(JSON.parse(JSON.stringify(codexQuestionReply("answer", FIRST, "user", protocol.slice(0, 1)))))
      .toEqual({ answers: { entries: { answers: [FIRST] } } });
    expect(JSON.parse(JSON.stringify(codexQuestionReply("deny", undefined, "system", protocol)))).toEqual({ answers: {} });
  });
});

describe("ACP: a question request nobody answered", () => {
  function open(params: unknown, request: typeof GROK_ASK_USER_QUESTION) {
    vi.useFakeTimers();
    const sent: Array<{ result?: unknown }> = [];
    const events: Array<Record<string, unknown>> = [];
    const asks = new Map();
    openQuestionRequest({ id: 7, params }, request, { asks, controlsHost: false, flushAssistantText: () => {} },
      (message) => sent.push(message as { result?: unknown }), (event) => events.push(event), () => ({ threadId: "t1", turnId: "u1" }));
    return { sent, events, asks };
  }

  it("Grok Build reads the note as each question's own-words answer, no option picked", () => {
    const { sent, events } = open({ questions: [{ question: ASKED, options: [{ label: FIRST }, { label: "No" }] }] }, GROK_ASK_USER_QUESTION);
    vi.advanceTimersByTime(15 * 60_000);
    expect(JSON.parse(JSON.stringify(sent))).toEqual([{ jsonrpc: "2.0", id: 7, result: {
      outcome: "accepted", answers: { [ASKED]: ["Other"] }, annotations: { [ASKED]: { notes: QUESTION_UNANSWERED_NOTE } },
    } }]);
    picksNothing(sent);
    // the card is not answered: the resolve says nobody answered in time
    expect(events.at(-1)).toMatchObject({ type: "request.resolved", behavior: "deny", source: "timeout" });
  });

  it("Cursor skips the question with the note as the reason it hands the model", () => {
    const { sent, events } = open({ questions: [{ id: "entries", prompt: ASKED, options: [{ id: "yes-id", label: FIRST }, { id: "no-id", label: "No" }] }] }, CURSOR_ASK_QUESTION);
    vi.advanceTimersByTime(15 * 60_000);
    expect(sent).toEqual([{ jsonrpc: "2.0", id: 7, result: { outcome: { outcome: "skipped", reason: QUESTION_UNANSWERED_NOTE } } }]);
    picksNothing(sent);
    expect(events.at(-1)).toMatchObject({ type: "request.resolved", behavior: "deny", source: "timeout" });
  });

  it("still cancels a question the turn's end closes", () => {
    const { sent, asks } = open({ questions: [{ question: ASKED, options: [{ label: FIRST }, { label: "No" }] }] }, GROK_ASK_USER_QUESTION);
    const finish = [...asks.values()][0] as (behavior: string, source?: "user" | "timeout" | "system") => unknown;
    finish("deny", "system");
    expect(sent).toEqual([{ jsonrpc: "2.0", id: 7, result: { outcome: "cancelled" } }]);
  });
});

describe("the card of a question nobody answered in time", () => {
  function host(card: Record<string, unknown>) {
    const patched: unknown[] = [];
    const rows = [
      { id: "p", role: "user", kind: "text", at: 1, text: "log my time" },
      { id: "q", role: "bot", kind: "options", at: 2, card },
    ];
    const dir = mkdtempSync(join(tmpdir(), "sagax-question-card-"));
    dirs.push(dir);
    const value: Record<string, any> = {
      // a permission's timeout is written to the decision log there
      DATA_DIR: dir,
      pendingCommandRules: new Map(),
      agentCardGuard: { resolved: () => undefined },
      withdrawApprovalNotice: () => undefined,
      settleWaitingOnPersonChips: () => undefined,
      askMessageByRequest: new Map([["t1:req-q", "q"]]),
      shouldSettleRequestCard,
      isPersistentQuestionCard,
      unansweredApprovals: { record: () => undefined, answered: () => undefined },
      botForThread: () => undefined,
      agentPendingApproval: () => ({ open: [] }),
      store: {
        bot: () => undefined,
        messagesFor: () => rows,
        taskByThread: () => ({ activity: "waiting-on-you", busy: true }),
        setTaskActivity: () => undefined,
        setActivity: () => undefined,
        patchMessage: (...args: unknown[]) => { patched.push(args); },
      },
    };
    return { value, patched, dir };
  }

  it("stays open for the person whatever the engine resolved it with", () => {
    const card = { requestId: "req-q", requestType: "question", title: ASKED, options: [FIRST, "No"] };
    for (const behavior of ["answer", "deny"]) {
      const { value, patched } = host({ ...card });
      handleRequestResolved({ type: "request.resolved", threadId: "t1", requestId: "req-q", behavior, source: "timeout" }, { bot: { id: "b1" } }, value);
      expect(patched).toEqual([]);
    }
  });

  it("while a permission's card still closes as expired on its timeout", async () => {
    const { value, patched, dir } = host({ requestId: "req-q", requestType: "permission", tool: "Bash", options: ["Allow", "Deny"] });
    handleRequestResolved({ type: "request.resolved", threadId: "t1", requestId: "req-q", behavior: "deny", source: "timeout" }, { bot: { id: "b1" } }, value);
    expect(patched).toEqual([["t1", "q", { card: expect.objectContaining({ answered: "deny", expired: true, options: [] }) }]]);
    await flushDecisionLog(dir);
  });
});
