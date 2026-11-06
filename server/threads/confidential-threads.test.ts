// Confidential threads (server/threads/confidential-threads.ts), the pure rules and
// each leak they close, one by one, without a server: the permanent flag,
// the internal writes refused, the Perspicax memory verdicts, the card
// passes, the [omb-turn] log line, the decision log, the sandbox routing,
// the capture buffer, the console file browser and the workspace backup.
// The whole path on a real server is server/threads/confidential-threads.e2e.test.ts.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import {
  CONFIDENTIAL_INCIDENT_TEXT,
  CONFIDENTIAL_PERMANENT,
  ConfidentialMemoryPasses,
  confidentialBrowserSession,
  confidentialCardAnswerable,
  confidentialInternalRefusal,
  confidentialPatch,
  memoryWriteDigest,
  newThreadConfidential,
  perspicaxMemoryVerdict,
} from "./confidential-threads.ts";
import { appendDecision, bindConfidentialDecisions, flushDecisionLog, readDecisions, scrubThreadDecisions } from "../decision-log.ts";
import { CaptureBuffer } from "../memory/memory-capture.ts";
import { answerBotFiles, type BotFileRoot } from "../org/org-admin-files.ts";
import { createPerspicaxToolInternalRoutes } from "../routes/perspicax-tool-internal.ts";
import { turnStartLogLine } from "../turns/turn-log.ts";
import { sandboxPrincipalForTurn } from "../sandbox/user-sandbox-routing.ts";
import { confidentialBackupPath, confidentialRoster, rosterWithoutConfidentialContent, stripConfidentialMessages, CONFIDENTIAL_BACKUP_TITLE } from "../workspace-backup.ts";
import { workspaceLocationsPrompt } from "../workspace/workspace.ts";

const dirs: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), "sagax-confidential-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  bindConfidentialDecisions(() => false);
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("the flag", () => {
  it("a new thread takes the person's choice, else the organization default", () => {
    expect(newThreadConfidential(undefined, false)).toEqual({ ok: true, confidential: false });
    expect(newThreadConfidential(undefined, true)).toEqual({ ok: true, confidential: true });
    expect(newThreadConfidential(false, true)).toEqual({ ok: true, confidential: false });
    expect(newThreadConfidential(true, false)).toEqual({ ok: true, confidential: true });
    expect(newThreadConfidential("yes", false).ok).toBe(false);
  });

  it("turning it on needs the confirmation that it is permanent", () => {
    expect(confidentialPatch({}, { confidential: true })).toMatchObject({ kind: "refused", status: 400, code: "confirm_confidential" });
    expect(confidentialPatch({}, { confidential: true, confirmConfidential: true })).toEqual({ kind: "make" });
    expect(confidentialPatch({ confidential: true }, { confidential: true, confirmConfidential: true })).toEqual({ kind: "none" });
    expect(confidentialPatch({}, {})).toEqual({ kind: "none" });
  });

  it("is irreversible: turning it off is always refused, confirmed or not", () => {
    for (const body of [{ confidential: false }, { confidential: false, confirmConfidential: true }]) {
      expect(confidentialPatch({ confidential: true }, body)).toMatchObject({ kind: "refused", status: 409, code: CONFIDENTIAL_PERMANENT });
    }
    expect(confidentialPatch({}, { confidential: false })).toEqual({ kind: "none" });
    expect(confidentialPatch({}, { confidential: "off" })).toMatchObject({ kind: "refused", status: 400 });
  });
});

describe("leak 1: memory, daily log and shared writes", () => {
  it("refuses every internal write other people or threads read", () => {
    for (const path of ["/api/internal/memory", "/api/internal/memory/log", "/api/internal/group-memory", "/api/internal/team-memory",
      "/api/internal/workspace/rules", "/api/internal/workspace/docs", "/api/internal/skills/stage", "/api/internal/routine-requests", "/api/internal/artifacts"]) {
      expect(confidentialInternalRefusal(path, "POST"), path).toMatchObject({ code: "confidential_thread" });
    }
    expect(confidentialInternalRefusal("/api/internal/memory", "GET")).toBeNull();
    expect(confidentialInternalRefusal("/api/internal/session-search", "GET")).toBeNull();
    expect(confidentialInternalRefusal("/api/internal/browser/mcp", "POST")).toBeNull();
    expect(confidentialInternalRefusal("/api/internal/routine-requests", "POST")!.error).toMatch(/no routine/);
  });

  it("Perspicax memory: team and org refused, the person's own tier asks first, reads pass", () => {
    expect(perspicaxMemoryVerdict("memory_write", { scope: "org" })).toBe("refuse");
    expect(perspicaxMemoryVerdict("memory_write", { scope: "team:abc" })).toBe("refuse");
    expect(perspicaxMemoryVerdict("mcp__perspicax_acme__memory_write", { scope: "TEAM:x" })).toBe("refuse");
    expect(perspicaxMemoryVerdict("memory_propose", { target: "org" })).toBe("refuse");
    expect(perspicaxMemoryVerdict("memory_promote", {})).toBe("refuse");
    expect(perspicaxMemoryVerdict("memory_write", {})).toBe("confirm");
    expect(perspicaxMemoryVerdict("memory_write", { scope: "me" })).toBe("confirm");
    expect(perspicaxMemoryVerdict("perspicax_acme__memory_save", { scope: "me" })).toBe("confirm");
    expect(perspicaxMemoryVerdict("memory_recall", { query: "x" })).toBe("pass");
    expect(perspicaxMemoryVerdict("api_search", { query: "x" })).toBe("pass");
  });

  it("an Allow is one pass for that exact write, once, for a while", () => {
    let now = 1_000;
    const passes = new ConfidentialMemoryPasses(() => now);
    const digest = memoryWriteDigest({ topic: "t", body: "b" });
    expect(passes.take("th", digest)).toBe(false);
    passes.grant("th", digest);
    expect(passes.take("th", memoryWriteDigest({ topic: "t", body: "other" }))).toBe(false);
    expect(passes.take("other-thread", digest)).toBe(false);
    expect(passes.take("th", digest)).toBe(true);
    expect(passes.take("th", digest)).toBe(false);
    passes.grant("th", digest);
    now += 11 * 60_000;
    expect(passes.take("th", digest)).toBe(false);
  });

  it("the Perspicax tool route answers the refusal before Perspicax is called", async () => {
    const calls: string[] = [];
    const route = createPerspicaxToolInternalRoutes({
      tools: new Set(["memory_write", "memory_recall"]),
      perspicaxMcp: () => ({ callTool: async (input) => { calls.push(input.name); return { ok: true, value: "saved", isError: false }; } }),
      review: async () => null,
      confidential: (_capability, tool, args) => perspicaxMemoryVerdict(tool, args) === "refuse" ? "refused here" : null,
    });
    const answers: Array<{ status: number; body: unknown }> = [];
    const call = (args: Record<string, unknown>, tool = "memory_write") => route({
      res: {} as ServerResponse, path: "/api/internal/perspicax/tool", method: "POST",
      json: (_res: ServerResponse, status: number, body: unknown) => { answers.push({ status, body }); },
      capability: { botId: "b", threadId: "t", generation: "g" },
      readBody: async () => ({ tool, args }),
    } as unknown as Parameters<typeof route>[0]);
    await call({ topic: "x", body: "y", scope: "org" });
    expect(answers.at(-1)).toEqual({ status: 200, body: { text: "refused here", isError: true } });
    expect(calls).toEqual([]);
    await call({ query: "x" }, "memory_recall");
    expect(calls).toEqual(["memory_recall"]);
  });
});

describe("leak 6: the [omb-turn] log line", () => {
  const turn = { botId: "bot-1", text: "the secret plan for the merger", images: 0, depth: 0, card: false, spoken: false };
  it("logs no prompt prefix for a confidential thread", () => {
    const line = turnStartLogLine({ ...turn, confidential: true });
    expect(line).toBe('[omb-turn] bot=bot-1 text=(confidential) images=0 depth=0 card=false');
    expect(line).not.toContain("secret");
    expect(turnStartLogLine({ ...turn, confidential: true, spoken: true })).toContain("text=(confidential)");
    // Loi 25: ordinary turns also never carry message text, only a char count.
    expect(turnStartLogLine(turn)).toBe("[omb-turn] bot=bot-1 text=chars=30 images=0 depth=0 card=false");
    expect(turnStartLogLine(turn)).not.toContain("secret");
  });
});

describe("leak 5: incidents", () => {
  it("carry one fixed line and nothing of the thread", () => {
    expect(CONFIDENTIAL_INCIDENT_TEXT).toBe("un tour d'un fil confidentiel a échoué");
  });
});

describe("leak 4: approvals", () => {
  it("a card its owner could not answer is refused", () => {
    expect(confidentialCardAnswerable({ adminApproval: false, host: { kind: "fleet" }, threadOwner: "pr_a" })).toBe(true);
    expect(confidentialCardAnswerable({ adminApproval: true, host: { kind: "fleet" }, threadOwner: "pr_a" })).toBe(false);
    expect(confidentialCardAnswerable({ adminApproval: false, host: { kind: "machine", userId: "pr_b" }, threadOwner: "pr_a" })).toBe(false);
    expect(confidentialCardAnswerable({ adminApproval: false, host: { kind: "machine", userId: "PR_A" }, threadOwner: "pr_a" })).toBe(true);
  });
});

describe("leak 7: the built-in browser", () => {
  it("a confidential thread's session is its own, never the bot's", () => {
    const one = confidentialBrowserSession("thread-1", "abcd1234");
    expect(one).toBe("conf-thread-1-abcd1234");
    expect(one).not.toMatch(/^bot-/);
    expect(confidentialBrowserSession("thread-1", "ffff0000")).not.toBe(one);
    expect(confidentialBrowserSession("t/../x", "r")).toMatch(/^[A-Za-z0-9_.-]+$/);
  });
});

describe("leak 8: where a confidential thread works", () => {
  it("in its owner's environment, whoever started the turn", () => {
    expect(sandboxPrincipalForTurn({ botOwnerPrincipalId: "pr_b", routine: true, confidentialOwnerPrincipalId: "pr_a" })).toBe("pr_a");
    expect(sandboxPrincipalForTurn({ botOwnerPrincipalId: "pr_b", routine: false, speakerPrincipalId: "pr_c", confidentialOwnerPrincipalId: "pr_a" })).toBe("pr_a");
    expect(sandboxPrincipalForTurn({ botOwnerPrincipalId: "pr_b", routine: true, confidentialOwnerPrincipalId: null })).toBe("pr_b");
  });

  it("is told of its own folder only", () => {
    const text = workspaceLocationsPrompt("bot-1", "/data/task-workspaces/bot-1/t1", "/projects/shared", { confidential: true });
    expect(text).toContain("/data/task-workspaces/bot-1/t1");
    expect(text).not.toContain("/projects/shared");
    expect(text).not.toContain("sharedBotFolder");
    expect(text).not.toContain("otherThreadFiles");
    expect(text).toMatch(/confidential/);
  });
});

describe("the capture buffer", () => {
  it("drops a thread's waiting turns without capturing them", () => {
    const flushed: string[] = [];
    const buffer = new CaptureBuffer({ quietMs: () => 60_000, maxTurns: 10, onFlush: (batch) => flushed.push(batch.threadId) });
    buffer.add("b", "t1", { person: "p", bot: "r", owner: true, turnId: "u1" });
    buffer.add("b", "t2", { person: "p", bot: "r", owner: true, turnId: "u2" });
    buffer.dropThread("t1");
    buffer.flushAll();
    expect(flushed).toEqual(["t2"]);
  });
});

describe("the decision log", () => {
  it("writes a confidential thread's rows metadata only", async () => {
    const dir = temp();
    bindConfidentialDecisions((threadId) => threadId === "secret");
    appendDecision(dir, { threadId: "secret", requestId: "r1", botId: "b", tool: "Bash", summary: "cat payroll.csv", rule: "^cat", decision: "user-approved", source: "user" });
    appendDecision(dir, { threadId: "open", requestId: "r2", botId: "b", tool: "Bash", summary: "ls", decision: "auto-approved", source: "auto-review" });
    await flushDecisionLog(dir);
    const rows = readDecisions(dir, 10);
    expect(rows.find((row) => row.threadId === "secret")).toMatchObject({ requestId: "r1", botId: "b", tool: "Bash", decision: "user-approved" });
    expect(rows.find((row) => row.threadId === "secret")!.summary).toBeUndefined();
    expect(rows.find((row) => row.threadId === "secret")!.rule).toBeUndefined();
    expect(rows.find((row) => row.threadId === "open")!.summary).toBe("ls");
  });

  it("strips rows written before, and keeps their ids, times and tool names", async () => {
    const dir = temp();
    appendDecision(dir, { threadId: "later", requestId: "r1", botId: "b", tool: "Write", summary: "write salary.txt", decision: "card-shown", source: "user" });
    appendDecision(dir, { threadId: "keep", requestId: "r2", botId: "b", tool: "Write", summary: "write notes.txt", decision: "card-shown", source: "user" });
    await flushDecisionLog(dir);
    expect(await scrubThreadDecisions(dir, "later")).toBe(1);
    const rows = readDecisions(dir, 10);
    const scrubbed = rows.find((row) => row.threadId === "later")!;
    expect(scrubbed).toMatchObject({ requestId: "r1", tool: "Write", decision: "card-shown" });
    expect(scrubbed.at).toBeTruthy();
    expect(JSON.stringify(rows)).not.toContain("salary");
    expect(rows.find((row) => row.threadId === "keep")!.summary).toBe("write notes.txt");
    expect(await scrubThreadDecisions(dir, "later")).toBe(0);
  });
});

describe("leak 3: the console file browser", () => {
  async function call(roots: BotFileRoot[], action: "list" | "stat" | "read", path: string) {
    let answer: { status: number; body: unknown } | undefined;
    await answerBotFiles({
      req: {} as never, res: {} as ServerResponse, url: new URL(`http://x/?root=tasks&path=${encodeURIComponent(path)}`), botId: "bot-1",
      action, principalId: "pr_admin",
      deps: { botFiles: () => ({ name: "Bot", roots }), attachments: async () => [], record: () => {} },
      send: (_res, status, body) => { answer = { status, body }; },
    });
    return answer!;
  }

  it("leaves a confidential thread's folder out of the list and reads it as missing", async () => {
    const dir = temp();
    mkdirSync(join(dir, "open-thread"), { recursive: true });
    mkdirSync(join(dir, "secret-thread"), { recursive: true });
    writeFileSync(join(dir, "secret-thread", "payroll.csv"), "x");
    const roots: BotFileRoot[] = [{ id: "tasks", kind: "folder", dir, hidden: new Set(["secret-thread"]) }];
    const listed = await call(roots, "list", "");
    expect(listed.status).toBe(200);
    expect(JSON.stringify(listed.body)).toContain("open-thread");
    expect(JSON.stringify(listed.body)).not.toContain("secret-thread");
    expect((await call(roots, "list", "secret-thread")).status).toBe(404);
    expect((await call(roots, "stat", "secret-thread/payroll.csv")).status).toBe(404);
    expect((await call(roots, "read", "secret-thread/payroll.csv")).status).toBe(404);
  });
});

describe("the workspace backup (an admin export)", () => {
  const roster = [
    { id: "bot-1", threadId: "secret", tasks: [
      { threadId: "secret", title: "Merger plan", confidential: true, createdAt: 1, contextSummaries: [{ summary: "the merger" }], link: "https://x", resumeCursors: { a: 1 } },
      { threadId: "open", title: "Weekly", createdAt: 2, resumeCursors: {} },
    ] },
  ];

  it("keeps a confidential task as an empty, retitled record", () => {
    expect([...confidentialRoster(roster)]).toEqual([["secret", "bot-1"]]);
    const out = rosterWithoutConfidentialContent(roster) as typeof roster;
    const task = out[0]!.tasks[0]!;
    expect(task).toMatchObject({ threadId: "secret", title: CONFIDENTIAL_BACKUP_TITLE, confidential: true, createdAt: 1, resumeCursors: {} });
    expect(JSON.stringify(out)).not.toContain("merger");
    expect(JSON.stringify(out)).not.toContain("Merger");
    expect(out[0]!.tasks[1]).toEqual(roster[0]!.tasks[1]);
  });

  it("leaves out its folder, its logs, its legacy transcript and its own attachments", () => {
    const threads = new Map([["secret", "bot-1"]]);
    const attachments = new Set(["abc-123.png"]);
    for (const path of ["task-workspaces/bot-1/secret", "task-workspaces/bot-1/secret/out.md", "events/secret.ndjson", "native/secret.ndjson", "messages-secret.json", "attachments/abc-123.png"]) {
      expect(confidentialBackupPath(path, threads, attachments), path).toBe(true);
    }
    for (const path of ["task-workspaces/bot-1/open", "task-workspaces/bot-2/secret", "events/open.ndjson", "attachments/other.png", "bots.json"]) {
      expect(confidentialBackupPath(path, threads, attachments), path).toBe(false);
    }
  });

  it("removes its rows from the message database snapshot and vacuums them away", () => {
    const file = join(temp(), "messages.db");
    const db = new DatabaseSync(file);
    db.exec("CREATE TABLE messages (thread_id TEXT, id TEXT, json TEXT); CREATE TABLE thread_state (thread_id TEXT PRIMARY KEY, active_leaf_id TEXT);");
    const insert = db.prepare("INSERT INTO messages VALUES (?, ?, ?)");
    insert.run("secret", "m1", JSON.stringify({ text: "the merger target is ACME-PLAN-7", attachments: [{ path: "/data/attachments/aaa-111.pdf" }, { path: "/data/attachments/shared-222.png" }] }));
    insert.run("open", "m2", JSON.stringify({ text: "see shared-222.png" }));
    db.prepare("INSERT INTO thread_state VALUES (?, ?)").run("secret", "m1");
    db.close();
    const unreferenced = stripConfidentialMessages(file, new Set(["secret"]));
    expect([...unreferenced]).toEqual(["aaa-111.pdf"]);
    const after = new DatabaseSync(file);
    expect(after.prepare("SELECT COUNT(*) AS n FROM messages WHERE thread_id = 'secret'").get()).toEqual({ n: 0 });
    expect(after.prepare("SELECT COUNT(*) AS n FROM thread_state").get()).toEqual({ n: 0 });
    expect(after.prepare("SELECT COUNT(*) AS n FROM messages").get()).toEqual({ n: 1 });
    after.close();
    expect(readFileSync(file).includes(Buffer.from("ACME-PLAN-7"))).toBe(false);
    expect(existsSync(file)).toBe(true);
  });
});

describe("security review: Perspicax outbound calls and the personal scope", () => {
  it("confirms every call that sends the thread's words out, reads pass", async () => {
    const { perspicaxConfidentialVerdict } = await import("./confidential-threads.ts");
    for (const name of ["ask_person", "send_prompt", "sagax_send", "sagax_nudge", "flow_action", "review_write", "tickets__write", "backups__agent_write", "endpoints__action", "phones__Bucket_write", "mcp__perspicax_acme__send_prompt",
      // fail closed: tools that write without saying so in their name
      "vendor_x__log_time", "vendor_x__update_ticket", "vendor_x__book_schedule_entry", "vendor_y__PhoneNumbers_Overrides", "something_new"]) {
      expect(perspicaxConfidentialVerdict(name, {}), name).toBe("confirm");
    }
    for (const name of ["api_search", "api_describe", "api_lookup", "api_list", "identity", "tickets__query", "memory_recall", "memory_search", "flow", "work_search", "claim_list",
      "vendor_x__query", "vendor_x__read_action", "read_transcript", "list_agents"]) {
      expect(perspicaxConfidentialVerdict(name, {}), name).toBe("pass");
    }
    expect(perspicaxConfidentialVerdict("memory_write", { scope: "org" })).toBe("refuse");
  });

  it("writes the personal scope in, and the digest binds scope, tags, directory title and searchable", async () => {
    const { pinPersonalScope, outboundCallDigest } = await import("./confidential-threads.ts");
    const args: Record<string, unknown> = { topic: "t", body: "b" };
    pinPersonalScope(args);
    expect(args.scope).toBe("me");
    const base = { scope: "me", topic: "t", body: "b", tags: ["a"], directory_title: "D", searchable: true };
    const digest = memoryWriteDigest(base);
    for (const change of [{ scope: "org" }, { tags: ["b"] }, { directory_title: "E" }, { searchable: false }, { title: "x" }]) {
      expect(memoryWriteDigest({ ...base, ...change }), JSON.stringify(change)).not.toBe(digest);
    }
    expect(outboundCallDigest("x__send_prompt", { b: 1, a: { d: 2, c: 3 } })).toBe(outboundCallDigest("send_prompt", { a: { c: 3, d: 2 }, b: 1 }));
    expect(outboundCallDigest("send_prompt", { a: 1 })).not.toBe(outboundCallDigest("send_prompt", { a: 2 }));
  });

  it("refuses the routes that hand content to another bot, room or channel", () => {
    for (const path of ["/api/internal/ask-bot", "/api/internal/delegate-bot", "/api/internal/coordinate-bots", "/api/internal/post-to-room", "/api/internal/message-person", "/api/internal/message-user", "/api/internal/create-room", "/api/internal/manage-room", "/api/internal/act", "/api/internal/create-bot", "/api/internal/team-setup-requests"]) {
      expect(confidentialInternalRefusal(path, "POST"), path).toMatchObject({ code: "confidential_thread" });
    }
    expect(confidentialInternalRefusal("/api/internal/room-targets", "GET")).toBeNull();
  });

  it("an MCP audit row of a confidential thread names no resource", async () => {
    const { createMcpAuditInternalRoutes } = await import("../routes/mcp-audit-internal.ts");
    const rows: Array<Record<string, unknown>> = [];
    const route = createMcpAuditInternalRoutes({ append: (row) => rows.push(row as Record<string, unknown>), confidential: (threadId) => threadId === "secret" });
    for (const threadId of ["secret", "open"]) {
      await route({
        res: {} as ServerResponse, path: "/api/internal/mcp-audit", method: "POST", json: () => {},
        capability: { botId: "b", threadId, generation: "g" },
        readBody: async () => ({ tool: "t", permission: "p", reason: "r", decision: "allowed", scope: "self", resource: "payroll.csv" }),
      } as unknown as Parameters<typeof route>[0]);
    }
    expect(JSON.stringify(rows[0])).not.toContain("payroll");
    expect(JSON.stringify(rows[1])).toContain("payroll");
  });
});

describe("re-review: fail closed, the memory file tool, other MCP servers, tool results", () => {
  it("the file-style memory tool reads freely and changes only /memories/me/ with a card", async () => {
    const { perspicaxConfidentialVerdict } = await import("./confidential-threads.ts");
    expect(perspicaxConfidentialVerdict("memory", { command: "view", path: "/memories/org/x.md" })).toBe("pass");
    expect(perspicaxConfidentialVerdict("memory", { command: "create", path: "/memories/me/notes.md", file_text: "x" })).toBe("confirm");
    expect(perspicaxConfidentialVerdict("memory", { command: "str_replace", path: "/memories/me/notes.md", old_str: "a", new_str: "b" })).toBe("confirm");
    expect(perspicaxConfidentialVerdict("memory", { command: "create", path: "/memories/org/notes.md", file_text: "x" })).toBe("refuse");
    expect(perspicaxConfidentialVerdict("memory", { command: "create", path: "/memories/me/../org/x.md", file_text: "x" })).toBe("refuse");
    expect(perspicaxConfidentialVerdict("memory", { command: "rename", old_path: "/memories/me/a.md", new_path: "/memories/team/a.md" })).toBe("refuse");
    expect(perspicaxConfidentialVerdict("memory", { command: "delete" })).toBe("refuse");
  });

  it("other MCP servers: reads pass, anything else takes the owner's card", async () => {
    const { mcpConfidentialVerdict } = await import("./confidential-threads.ts");
    for (const name of ["GMAIL_FETCH_EMAILS", "SLACK_LIST_CHANNELS", "mcp__notes__search_notes", "get_file", "data_describe", "data_show", "computer_select", "COMPOSIO_SEARCH_TOOLS"]) {
      expect(mcpConfidentialVerdict(name), name).toBe("pass");
    }
    for (const name of ["GMAIL_SEND_EMAIL", "COMPOSIO_MULTI_EXECUTE_TOOL", "mcp__notes__save_note", "data_load", "data_sql", "run_command", "write_file", "vendor_x__log_time"]) {
      expect(mcpConfidentialVerdict(name), name).toBe("confirm");
    }
  });

  it("the workspace backup leaves out its tool results", () => {
    const threads = new Map([["secret", "bot-1"]]);
    expect(confidentialBackupPath("tool-results/secret", threads, new Set())).toBe(true);
    expect(confidentialBackupPath("tool-results/secret/r1.txt", threads, new Set())).toBe(true);
    expect(confidentialBackupPath("tool-results/open/r1.txt", threads, new Set())).toBe(false);
  });
});

describe("third review: profile tools, plans, other servers, memory paths, the card", () => {
  it("a profile's tools pass only as query or read_action; a plan is judged step by step", async () => {
    const { perspicaxConfidentialVerdict } = await import("./confidential-threads.ts");
    for (const name of ["vendor_x__find_tickets", "vendor_x__get_ticket", "vendor_x__list_things", "vendor_x__read_notes"]) {
      expect(perspicaxConfidentialVerdict(name, {}), name).toBe("confirm");
    }
    expect(perspicaxConfidentialVerdict("api_plan", { steps: [{ tool: "api_search", args: {} }, { tool: "vendor_x__query", args: {} }] })).toBe("pass");
    expect(perspicaxConfidentialVerdict("api_plan", { steps: [{ tool: "api_search" }, { tool: "vendor_x__log_time", args: { notes: "x" } }] })).toBe("confirm");
    expect(perspicaxConfidentialVerdict("api_plan", { steps: [] })).toBe("confirm");
    expect(perspicaxConfidentialVerdict("api_plan", {})).toBe("confirm");
  });

  it("other servers: a read verb then a write verb is refused, a bare verb takes the card", async () => {
    const { mcpConfidentialVerdict } = await import("./confidential-threads.ts");
    for (const name of ["get_and_update_record", "APP_FETCH_THEN_SEND", "list_and_delete", "read_and_post"]) expect(mcpConfidentialVerdict(name), name).toBe("refuse");
    for (const name of ["fetch", "query", "APP_GET"]) expect(mcpConfidentialVerdict(name), name).toBe("confirm");
    expect(mcpConfidentialVerdict("get_record")).toBe("pass");
  });

  it("a memory path is plain: no percent-encoding, no backslash, no dot segment", async () => {
    const { perspicaxConfidentialVerdict } = await import("./confidential-threads.ts");
    for (const path of ["/memories/me/%2e%2e/org/x.md", "/memories/me/a\\..\\b", "/memories/me/./x", "/memories/me/", "/memories/me/a b.md"]) {
      expect(perspicaxConfidentialVerdict("memory", { command: "create", path, file_text: "x" }), path).toBe("refuse");
    }
    expect(perspicaxConfidentialVerdict("memory", { command: "create", path: "/memories/me/notes/a-1.md", file_text: "x" })).toBe("confirm");
  });

  it("a pass is bound to its server too, and to every bound memory field", async () => {
    const { outboundCallDigest, MEMORY_BOUND_FIELDS } = await import("./confidential-threads.ts");
    expect(outboundCallDigest("send", { a: 1 }, "/api/internal/connectors/mcp")).not.toBe(outboundCallDigest("send", { a: 1 }, "perspicax"));
    expect(memoryWriteDigest({ body: "b" }, "perspicax")).not.toBe(memoryWriteDigest({ body: "b" }, "/api/internal/personal-mcp"));
    expect([...MEMORY_BOUND_FIELDS]).toEqual(["scope", "topic", "title", "body", "tags", "directory_title", "searchable"]);
  });
});

