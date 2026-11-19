// Contract test for permission-proxy — the MCP stdio server the claude CLI
// spawns for --permission-prompt-tool. A fake broker on the socket stands in
// for the harness, so these assert the two halves of the wire the proxy owns:
// the ask it writes to the broker, and the JSON it hands back to the CLI.
//
// The case that matters most is the CLI's own AskUserQuestion. It arrives
// through `approve` looking like a permission, and answering it as one is why
// a multiple-choice question reached users as an Allow/Deny boat over a
// truncated JSON blob. It has to leave here as a question, and come back as
// the `answers` object the tool documents — a bare allow makes the CLI run
// the tool, and a headless run has no dialog, so the click is discarded
// ("The user did not answer the questions.").
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer, type Server, type Socket } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { brokerSocketPath } from "./procs.ts";
import { removeTempDir } from "./testing/cleanup.ts";
import { formatQuestionAnswers, QUESTION_UNANSWERED_NOTE } from "../shared/ask-question.ts";

const PROXY = join(dirname(fileURLToPath(import.meta.url)), "permission-proxy.ts");

/** A question with two labelled options and a per-option explanation — the
 * shape the real CLI sends (verified against claude 2.1.238). */
const QUESTION = {
  questions: [
    {
      question: "Which framework should we use?",
      header: "Framework",
      multiSelect: false,
      options: [
        { label: "React", description: "What the app already uses" },
        { label: "Vue", description: "Smaller, but a rewrite" },
      ],
    },
  ],
};

describe("permission proxy", () => {
  let scratch: string;
  let broker: Server;
  let proxy: ChildProcess;
  /** every ask the broker received, in order */
  let asks: any[];
  /** how the fake broker answers ask N — set per test */
  let answerWith: (ask: any, index: number) => Record<string, unknown> | null;
  /** live broker connections, so a test can drop one mid-ask */
  let conns: Socket[];
  const results = new Map<number, any>();

  const rpc = (msg: unknown) => proxy.stdin!.write(JSON.stringify(msg) + "\n");
  const waitFor = async (id: number, ms = 8000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (results.has(id)) return results.get(id);
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`no response for id ${id}; asks so far: ${JSON.stringify(asks)}`);
  };
  const waitForAsks = async (count: number, ms = 8000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (asks.length >= count) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`only ${asks.length} of ${count} asks arrived`);
  };
  /** The tool result the CLI would read, parsed. */
  const resultJson = (res: any) => JSON.parse(res.result.content[0].text);

  const startProxy = (socketPath: string, env?: NodeJS.ProcessEnv) => {
    proxy = spawn(process.execPath, ["--experimental-strip-types", PROXY, socketPath], { stdio: ["pipe", "pipe", "pipe"], env });
    let out = "";
    proxy.stdout!.setEncoding("utf8");
    proxy.stdout!.on("data", (chunk) => {
      out += chunk; let nl;
      while ((nl = out.indexOf("\n")) !== -1) {
        const line = out.slice(0, nl); out = out.slice(nl + 1);
        if (!line.trim()) continue;
        try { const msg = JSON.parse(line); if (msg.id != null) results.set(msg.id, msg); } catch { /* non-protocol frame */ }
      }
    });
  };

  beforeEach(async () => {
    scratch = mkdtempSync(join(tmpdir(), "omb-perm-proxy-"));
    asks = [];
    conns = [];
    answerWith = () => null;
    const socketPath = brokerSocketPath(scratch, "test");
    broker = createServer((conn: Socket) => {
      conns.push(conn);
      let buf = "";
      conn.on("error", () => {});
      conn.setEncoding("utf8");
      conn.on("data", (chunk) => {
        buf += chunk;
        let nl;
        while ((nl = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          const ask = JSON.parse(line);
          if (ask.t !== "ask") continue;
          const index = asks.length;
          asks.push(ask);
          const answer = answerWith(ask, index);
          if (answer) conn.write(JSON.stringify({ t: "answer", id: ask.id, ...answer }) + "\n");
        }
      });
    });
    await new Promise<void>((resolve) => broker.listen(socketPath, resolve));

    startProxy(socketPath);
    rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    await waitFor(1);
  }, 20_000);

  afterEach(async () => {
    results.clear();
    proxy?.kill();
    await new Promise<void>((resolve) => broker.close(() => resolve()));
    removeTempDir(scratch);
  });

  it("withholds an excluded question without losing the CLI permission callback", async () => {
    const exited = once(proxy, "exit"); proxy.kill(); await exited; results.clear();
    startProxy(brokerSocketPath(scratch, "test"), { ...process.env, SAGAX_PERMISSION_TOOL_SCOPE: JSON.stringify({ allow: ["native:*"] }) });
    rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect((await waitFor(2)).result.tools.map((tool: { name: string }) => tool.name)).toEqual(["approve"]);
    rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "ask_user", arguments: { question: "Must not ask" } } });
    expect((await waitFor(3)).result.content[0].text).toContain("excluded"); expect(asks).toEqual([]);
    answerWith = () => ({ behavior: "allow" });
    rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "approve", arguments: { tool_name: "Read", input: {} } } });
    expect(resultJson(await waitFor(4)).behavior).toBe("allow"); expect(asks).toHaveLength(1);
  });

  it("exposes approve and ask_user", async () => {
    rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const res = await waitFor(2);
    expect(res.result.tools.map((tool: any) => tool.name)).toEqual(["approve", "ask_user"]);
  });

  it("asks AskUserQuestion as ONE question card carrying every question it posed", async () => {
    answerWith = () => ({
      behavior: "answer",
      message: "The user answered your questions.\n\nQ: Which framework should we use?\nA: React",
      source: "user",
    });
    rpc({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "approve", arguments: { tool_name: "AskUserQuestion", input: QUESTION } },
    });
    const res = await waitFor(2);

    // it left as a question — not a permission, so no card can ever offer
    // an Allow the broker would refuse, and auto mode can never answer it
    expect(asks).toHaveLength(1);
    expect(asks[0]).toMatchObject({
      kind: "question",
      tool: "AskUserQuestion",
      input: {
        questions: [
          {
            question: "Which framework should we use?",
            options: [
              { label: "React", description: "What the app already uses" },
              { label: "Vue", description: "Smaller, but a rewrite" },
            ],
          },
        ],
      },
    });

    // and it comes back as the tool's own contract: the original questions,
    // plus an answers object keyed by the question's text
    expect(resultJson(res)).toEqual({
      behavior: "allow",
      updatedInput: { ...QUESTION, answers: { "Which framework should we use?": "React" } },
    });
  });

  it("returns an answer for every question the one card collected", async () => {
    const input = {
      questions: [
        { question: "Which framework?", options: [{ label: "React" }, { label: "Vue" }] },
        { question: "Which features?", multiSelect: true, options: [{ label: "Auth" }, { label: "Search" }] },
      ],
    };
    answerWith = () => ({
      behavior: "answer",
      message:
        "The user answered your questions.\n\nQ: Which framework?\nA: React\n\nQ: Which features?\nA: Auth, Search",
      source: "user",
    });
    rpc({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "approve", arguments: { tool_name: "AskUserQuestion", input } },
    });
    const res = await waitFor(2);

    // one card for the set — a person sees what they are committing to before
    // answering any of it — and never one answer copied over both questions
    expect(asks).toHaveLength(1);
    expect(asks[0].input.questions.map((q: { question: string }) => q.question))
      .toEqual(["Which framework?", "Which features?"]);
    expect(asks[0].input.questions[1].multiSelect).toBe(true);
    expect(resultJson(res).updatedInput.answers).toEqual({
      "Which framework?": "React",
      "Which features?": "Auth, Search",
    });
  });

  it("delivers pasted Q/A text to Claude as one answer without overwriting another", async () => {
    const input = { questions: [
      { question: "Which framework?", options: [] },
      { question: "Which features?", options: [] },
    ] };
    const pasted = "Notes\n\nQ: Which framework?\nA: Vue";
    answerWith = () => ({ behavior: "answer", source: "user", message: formatQuestionAnswers(input.questions, [["React"], [pasted]]) });
    rpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "approve", arguments: { tool_name: "AskUserQuestion", input } } });
    expect(resultJson(await waitFor(2))).toEqual({
      behavior: "allow", updatedInput: { ...input, answers: { "Which framework?": "React", "Which features?": pasted } },
    });
  });

  it("refuses a timed-out AskUserQuestion with the no-answer note, never an answer or a pick (#5032)", async () => {
    // what the broker actually sends on a timeout: `answer`, source "timeout",
    // and a full sentence. Never filed as the person's chosen option, and
    // never allowed with empty answers either: the CLI then said "the user
    // did not answer" and the model went on to pick the first option itself.
    answerWith = () => ({ behavior: "answer", message: QUESTION_UNANSWERED_NOTE, source: "timeout" });
    rpc({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "approve", arguments: { tool_name: "AskUserQuestion", input: QUESTION } },
    });
    expect(resultJson(await waitFor(2))).toEqual({ behavior: "deny", message: QUESTION_UNANSWERED_NOTE });
  });

  it("tells the model a timed-out ask_user has no answer, whatever note an older broker sent (#5032)", async () => {
    answerWith = () => ({ behavior: "answer", message: "Sagax: nobody answered in time. Use your best judgment and continue.", source: "timeout" });
    rpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "ask_user", arguments: { question: "Write these time entries?", choices: ["Yes, all", "No"] } } });
    const text = (await waitFor(2)).result.content[0].text;
    expect(text).toBe(QUESTION_UNANSWERED_NOTE);
    expect(text).not.toMatch(/best judgment|Yes, all/);
  });

  it("never falls back to best judgment when an answer carries no words (#5032)", async () => {
    answerWith = () => ({ behavior: "answer", source: "system" });
    rpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "ask_user", arguments: { question: "Ready?" } } });
    expect((await waitFor(2)).result.content[0].text).toBe(QUESTION_UNANSWERED_NOTE);
  });

  it("treats the turn ending the same way — system words are not the user's answer", async () => {
    answerWith = () => ({
      behavior: "answer",
      message: "Sagax: the turn is ending — wrap up.",
      source: "system",
    });
    rpc({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "approve", arguments: { tool_name: "AskUserQuestion", input: QUESTION } },
    });
    expect(resultJson(await waitFor(2)).updatedInput.answers).toEqual({});
  });

  it("denies when the broker is gone, rather than reporting an empty answer", async () => {
    // A question is only ever denied when nobody is there to be asked. Saying
    // "allow, nothing answered" there would tell the model a person declined
    // to choose, which is not what happened.
    answerWith = () => ({ behavior: "deny", message: "Sagax: permission broker unavailable" });
    rpc({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "approve", arguments: { tool_name: "AskUserQuestion", input: QUESTION } },
    });
    expect(resultJson(await waitFor(2))).toMatchObject({ behavior: "deny" });
  });

  it("denies an unanswerable AskUserQuestion instead of carding it as a permission", async () => {
    // No question text at all, so there is nothing to show. It must NOT become
    // an Allow/Deny card over raw JSON: allowing that makes the CLI run the
    // tool headless, where it collects nothing and reports "The user did not
    // answer the questions." — the click thrown away, the original bug.
    // (A question with no OPTIONS is a different case and is kept: the card
    // always offers free text, so a person can still answer it.)
    answerWith = () => ({ behavior: "allow" });
    rpc({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "approve",
        arguments: { tool_name: "AskUserQuestion", input: { questions: [{ options: [{ label: "Yes" }] }] } },
      },
    });
    const res = await waitFor(2);
    expect(asks).toHaveLength(0); // nobody was interrupted for it
    expect(resultJson(res)).toMatchObject({ behavior: "deny" });
    expect(resultJson(res).message).toContain("no answerable question");
  });

  it("keeps the good questions when one entry in the same call has no text", async () => {
    const input = {
      questions: [
        { question: "Which framework?", options: [{ label: "React" }, { label: "Vue" }] },
        { options: [{ label: "orphaned" }] },
      ],
    };
    answerWith = () => ({
      behavior: "answer",
      message: "The user answered your questions.\n\nQ: Which framework?\nA: React",
      source: "user",
    });
    rpc({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "approve", arguments: { tool_name: "AskUserQuestion", input } },
    });
    const res = await waitFor(2);
    // the answerable one is still asked, and the bad entry costs it nothing
    expect(asks[0].input.questions.map((q: { question: string }) => q.question)).toEqual(["Which framework?"]);
    expect(resultJson(res).updatedInput.answers).toEqual({ "Which framework?": "React" });
  });

  // #4507: a send or a connector tool the engine runs itself never carries
  // the app's record address once allowed, and the card shows what runs;
  // the CLI's own file, notebook and shell tools keep their input exactly
  it("hands a send or a connector tool its input with each record link reduced to its label, as the card showed it", async () => {
    answerWith = () => ({ behavior: "allow" });
    const body = "Votre billet [#481516](sagax://record/nimbus_desk/ticket/481516) est fermé.";
    const stripped = "Votre billet #481516 est fermé.";
    rpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "approve", arguments: { tool_name: "mcp__mail__send_email", input: { to: "ada@desk.example", body } } } });
    expect(resultJson(await waitFor(2))).toEqual({ behavior: "allow", updatedInput: { to: "ada@desk.example", body: stripped } });
    expect(asks[0].input).toEqual({ to: "ada@desk.example", body: stripped });
    rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "approve", arguments: { tool_name: "mcp__notes__create_page", input: { title: "Suivi", content: body } } } });
    expect(resultJson(await waitFor(3)).updatedInput).toEqual({ title: "Suivi", content: stripped });
    expect(asks[1].input).toEqual({ title: "Suivi", content: stripped });
  });

  it("gives a connector tool whose input is file content its input byte for byte", async () => {
    answerWith = () => ({ behavior: "allow" });
    const inputs: Array<[string, Record<string, unknown>]> = [
      ["mcp__code_host__create_or_update_file", { path: "src/prefix.ts", content: 'const PREFIX = "sagax://record/";', message: "add" }],
      ["mcp__code_host__push_files", { owner: "o", repo: "r", branch: "main", files: [{ path: "a.ts", content: "sagax://record/a/b/c" }], message: "push" }],
      ["mcp__files__write_file", { path: "/w/a.md", content: "[#1](sagax://record/nimbus_desk/ticket/1)" }],
    ];
    let id = 20;
    for (const [tool, input] of inputs) {
      id += 1;
      rpc({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "approve", arguments: { tool_name: tool, input } } });
      expect(resultJson(await waitFor(id)).updatedInput, tool).toEqual(input);
    }
  });

  it("gives the CLI's own Edit, Write, MultiEdit, NotebookEdit and Bash their input byte for byte", async () => {
    answerWith = () => ({ behavior: "allow" });
    const inputs: Array<[string, Record<string, unknown>]> = [
      ["Edit", { file_path: "/w/shared/record-cards.test.ts", old_string: "[#1](sagax://record/nimbus_desk/ticket/1)", new_string: "x" }],
      ["Write", { file_path: "/w/prefix.ts", content: 'const PREFIX = "sagax://record/";\n' }],
      ["MultiEdit", { file_path: "/w/a.ts", edits: [{ old_string: "sagax://record/a/b/c", new_string: "y" }] }],
      ["NotebookEdit", { notebook_path: "/w/n.ipynb", new_source: "print('sagax://record/a/b/c')" }],
      ["Bash", { command: "grep -rn 'sagax://record/' shared" }],
    ];
    let id = 10;
    for (const [tool, input] of inputs) {
      id += 1;
      rpc({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "approve", arguments: { tool_name: tool, input } } });
      expect(resultJson(await waitFor(id)).updatedInput, tool).toEqual(input);
    }
  });

  it("still brokers an ordinary permission, with the CLI's own rules on allow", async () => {
    answerWith = () => ({ behavior: "allow", always: true });
    rpc({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "approve",
        arguments: {
          tool_name: "Bash",
          input: { command: "git status" },
          permission_suggestions: [{ type: "addRules", rules: [{ toolName: "Bash" }] }],
        },
      },
    });
    const res = await waitFor(2);
    expect(asks[0]).toMatchObject({ tool: "Bash", input: { command: "git status" } });
    expect(asks[0].kind).toBeUndefined();
    expect(resultJson(res)).toEqual({
      behavior: "allow",
      updatedInput: { command: "git status" },
      updatedPermissions: [{ type: "addRules", rules: [{ toolName: "Bash" }] }],
    });
  });

  // #1374: the agents bridge's use_tool is asked about as the tool it runs
  it("asks a use_tool as the tool it runs, and never hands back the CLI's rule for use_tool", async () => {
    answerWith = () => ({ behavior: "allow", always: true });
    rpc({
      jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: "approve", arguments: {
        tool_name: "mcp__agents__use_tool",
        input: { name: "shared_computer", arguments: { action: "status" } },
        permission_suggestions: [{ type: "addRules", rules: [{ toolName: "mcp__agents__use_tool" }] }],
      } },
    });
    const res = await waitFor(2);
    expect(asks[0]).toMatchObject({ tool: "mcp__agents__shared_computer", input: { action: "status" } });
    expect(resultJson(res)).toEqual({ behavior: "allow", updatedInput: { name: "shared_computer", arguments: { action: "status" } } });
  });

  it("refuses a use_tool that names no tool, without a card", async () => {
    rpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "approve", arguments: { tool_name: "mcp__agents__use_tool", input: { name: "use_tool" } } } });
    const res = await waitFor(2);
    expect(asks).toHaveLength(0);
    expect(resultJson(res)).toMatchObject({ behavior: "deny" });
  });

  it("hands a large non-ASCII tool input back to the CLI byte for byte", async () => {
    // About 1.5 MB of three-byte characters: the line reaches the proxy over
    // many pipe reads, and most read boundaries fall inside a character.
    // Decoding each read on its own turned those into U+FFFD, and the allow
    // carried the damaged text back as updatedInput, so the CLI wrote it.
    const content = "中文ok€".repeat(150_000);
    answerWith = () => ({ behavior: "allow" });
    rpc({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "approve", arguments: { tool_name: "Write", input: { file_path: "notes.md", content } } },
    });
    const res = await waitFor(2, 20_000);
    expect(asks[0].input.content === content).toBe(true);
    const updated = resultJson(res).updatedInput.content as string;
    expect(updated.includes("\uFFFD")).toBe(false);
    expect(updated === content).toBe(true);
  }, 30_000);

  it("still asks ask_user as a question and returns the words verbatim", async () => {
    answerWith = () => ({ behavior: "answer", message: "ship it", source: "user" });
    rpc({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "ask_user", arguments: { question: "Ready?", choices: ["ship it", "wait"] } },
    });
    const res = await waitFor(2);
    expect(asks[0]).toMatchObject({ kind: "question", tool: "ask_user", input: { question: "Ready?" } });
    // a question's answer is text, never a permission envelope
    expect(res.result.content[0].text).toBe("ship it");
  });

  it("asks a multiSelect ask_user as a checkbox question and returns the picks", async () => {
    const card = [{ question: "Which fruits?", multiSelect: true, options: [{ label: "Apple" }, { label: "Banana" }, { label: "Cherry" }] }];
    answerWith = () => ({ behavior: "answer", source: "user", message: formatQuestionAnswers(card, [["Apple", "Cherry"]]) });
    rpc({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "ask_user", arguments: { question: "Which fruits?", choices: ["Apple", "Banana", "Cherry"], multiSelect: true } },
    });
    const res = await waitFor(2);
    expect(asks[0]).toMatchObject({ kind: "question", tool: "ask_user", input: { question: "Which fruits?", questions: card } });
    expect(res.result.content[0].text).toBe("Apple, Cherry");
  });

  it("gives a timed-out multiSelect ask_user the no-answer note, not picks", async () => {
    answerWith = () => ({ behavior: "answer", source: "timeout", message: "Nobody answered in time." });
    rpc({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "ask_user", arguments: { question: "Which fruits?", choices: ["Apple", "Banana"], multiSelect: true } },
    });
    expect((await waitFor(2)).result.content[0].text).toBe(QUESTION_UNANSWERED_NOTE);
  });

  it("leaves a single-pick ask_user without a question card", async () => {
    answerWith = () => ({ behavior: "answer", message: "wait", source: "user" });
    rpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "ask_user", arguments: { question: "Ready?", choices: ["ship it", "wait"], multiSelect: false } } });
    await waitFor(2);
    expect(asks[0].input.questions).toBeUndefined();
  });

  it("denies every waiting ask when the broker dies", async () => {
    answerWith = () => null; // never answers
    rpc({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "approve", arguments: { tool_name: "Bash", input: { command: "sleep 1" } } },
    });
    await waitForAsks(1);
    for (const conn of conns) conn.destroy();
    const res = await waitFor(2);
    expect(resultJson(res)).toMatchObject({ behavior: "deny" });
  });
});
