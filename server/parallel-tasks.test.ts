import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { liveParallelState, parseBusySendPreference, suggestBusySendMode } from "../shared/parallel-tasks.ts";
import {
  parallelAdmission,
  parallelBlocked,
  parallelBrief,
  parallelOutcome,
  parallelResultText,
  parallelTaskTitle,
  prepareParallelWorkspace,
} from "./parallel-tasks.ts";

const link = (principalId?: string, reportedAt?: number) => ({
  threadId: "main", messageId: "m", at: 1, ...(principalId ? { principalId } : {}), ...(reportedAt ? { reportedAt } : {}),
});

describe("parallel task admission", () => {
  it("starts under the limit, queues at it and refuses past twice the limit waiting", () => {
    const tasks = [
      { threadId: "a", parallelOf: link("pr_1") },
      { threadId: "b", parallelOf: link("pr_1") },
      { threadId: "done", parallelOf: link("pr_1", 5) },
      { threadId: "other", parallelOf: link("pr_2") },
      { threadId: "plain" },
    ];
    const queued = (id: string) => id === "b";
    expect(parallelAdmission({ tasks, principalId: "pr_1", limit: 2, queued })).toEqual({ action: "start", running: 1, waiting: 1 });
    expect(parallelAdmission({ tasks, principalId: "pr_1", limit: 1, queued })).toEqual({ action: "queue", running: 1, waiting: 1 });
    expect(parallelAdmission({ tasks: [...tasks, { threadId: "c", parallelOf: link("pr_1") }], principalId: "pr_1", limit: 1, queued: (id) => id !== "a" }))
      .toEqual({ action: "refuse", running: 1, waiting: 2 });
    // another person's tasks never count against this one
    expect(parallelAdmission({ tasks, principalId: "pr_2", limit: 1, queued })).toEqual({ action: "queue", running: 1, waiting: 0 });
    expect(parallelAdmission({ tasks, principalId: "pr_3", limit: 1, queued }).action).toBe("start");
  });

  it("holds a waiting task while its person has the limit running, not for someone else's", () => {
    const tasks = [
      { threadId: "a", parallelOf: link("pr_1") },
      { threadId: "b", parallelOf: link("pr_1") },
      { threadId: "x", parallelOf: link("pr_2") },
    ];
    const busy = (id: string) => id === "a";
    expect(parallelBlocked({ task: tasks[1]!, tasks, limit: 1, busy })).toBe(true);
    expect(parallelBlocked({ task: tasks[1]!, tasks, limit: 2, busy })).toBe(false);
    expect(parallelBlocked({ task: tasks[2]!, tasks, limit: 1, busy })).toBe(false);
    expect(parallelBlocked({ task: { threadId: "plain" }, tasks, limit: 1, busy })).toBe(false);
  });
});

describe("parallel task brief and result", () => {
  it("names the asker and the conversation, quotes recent lines as context and ends with the request", () => {
    const brief = parallelBrief({
      request: "Draft the email to the client",
      conversationTitle: "Server migration",
      recent: [{ role: "user", text: "Move the database" }, { role: "bot", text: "Working on it" }],
      workspace: { kind: "worktree", cwd: "/w", repo: "/repo", branch: "sagax/parallel-abc" },
      personName: "Marie",
    });
    expect(brief).toMatch(/^\[Parallel task\. Marie sent this while you were busy with other work in #Server migration\./);
    expect(brief).toContain("- Marie: Move the database\n- You: Working on it");
    expect(brief).toContain("git worktree of /repo on branch sagax/parallel-abc");
    expect(brief.endsWith("Request:\nDraft the email to the client")).toBe(true);
    expect(parallelBrief({ request: "x", recent: [], workspace: { kind: "read-only", folder: "/proj" }, personName: "P", byBot: true }))
      .toContain("Parallel task you started yourself");
    expect(parallelBrief({ request: "x", recent: [], workspace: { kind: "read-only", folder: "/proj" }, personName: "P" }))
      .toContain("/proj is in use by your other task");
  });

  it("titles the task from the request and words the outcome", () => {
    expect(parallelTaskTitle("  summarize\nthe logs  ")).toBe("summarize the logs");
    expect(parallelTaskTitle("x".repeat(80))).toHaveLength(60);
    expect(parallelTaskTitle("   ")).toBe("Parallel task");
    expect(parallelOutcome({ ok: true, stopped: false })).toBe("done");
    expect(parallelOutcome({ ok: false, stopped: false })).toBe("failed");
    expect(parallelOutcome({ ok: true, stopped: true })).toBe("stopped");
    expect(parallelResultText({ state: "done", reply: " Here it is " })).toBe("Here it is");
    expect(parallelResultText({ state: "stopped", reply: "" })).toBe("(The task was stopped.)");
    expect(parallelResultText({ state: "failed", reply: "", why: "no engine" })).toBe("(The task did not finish: no engine.)");
  });

  it("writes the result line in the person's language", () => {
    expect(parallelResultText({ state: "failed", reply: "", why: "the task could not start", language: "fr-CA" })).toBe("(La tâche n'a pas abouti : elle n'a pas pu démarrer.)");
    expect(parallelResultText({ state: "stopped", reply: "", language: "fr" })).toBe("(La tâche a été arrêtée.)");
    expect(parallelResultText({ state: "failed", reply: "", why: "the task could not start", language: "en" })).toBe("(The task did not finish: the task could not start.)");
  });
});

describe("parallel task workspace", () => {
  const dirs: string[] = [];
  const temp = () => {
    const dir = mkdtempSync(join(tmpdir(), "omb-parallel-ws-"));
    dirs.push(dir);
    return dir;
  };
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("keeps a private conversation's task on its own folder and reads a plain project folder only", async () => {
    const root = temp();
    const privateRoot = join(root, "task-workspaces");
    mkdirSync(join(privateRoot, "bot", "main"), { recursive: true });
    expect(await prepareParallelWorkspace({ parentCwd: join(privateRoot, "bot", "main"), privateRoot, root: join(root, "wt"), botId: "bot", threadId: "t" }))
      .toEqual({ kind: "own" });
    expect(await prepareParallelWorkspace({ parentCwd: undefined, privateRoot, root, botId: "bot", threadId: "t" })).toEqual({ kind: "own" });
    const project = join(root, "project");
    mkdirSync(project);
    expect(await prepareParallelWorkspace({ parentCwd: project, privateRoot, root: join(root, "wt"), botId: "bot", threadId: "t",
      git: () => { throw new Error("not a repository"); } })).toEqual({ kind: "read-only", folder: project });
  });

  it("gives a task in a git repository its own worktree on its own branch", async () => {
    const root = temp();
    const repo = join(root, "repo");
    mkdirSync(join(repo, "sub"), { recursive: true });
    const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
    git("init", "-q");
    writeFileSync(join(repo, "sub", "a.txt"), "a");
    git("add", ".");
    git("-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "init");
    const workspace = await prepareParallelWorkspace({ parentCwd: join(repo, "sub"), privateRoot: join(root, "private"), root: join(root, "wt"), botId: "bot", threadId: "thread-1" });
    expect(workspace).toMatchObject({ kind: "worktree", branch: "sagax/parallel-thread-1" });
    if (workspace.kind !== "worktree") return;
    expect(workspace.cwd.endsWith(join("wt", "bot", "thread-1", "sub"))).toBe(true);
    expect(existsSync(join(workspace.cwd, "a.txt"))).toBe(true);
  });
});

describe("busy send choices", () => {
  it("suggests steering a short correction and a parallel task for anything else", () => {
    expect(suggestBusySendMode("arrête, utilise plutôt Postgres")).toBe("steer");
    expect(suggestBusySendMode("actually use the staging server")).toBe("steer");
    expect(suggestBusySendMode("Peux-tu aussi me préparer le rapport mensuel des billets du client Exemple ?")).toBe("parallel");
    expect(suggestBusySendMode("Draft the onboarding email for the new client")).toBe("parallel");
    expect(parseBusySendPreference("parallel")).toBe("parallel");
    expect(parseBusySendPreference("nope")).toBe("ask");
  });

  it("reads a card's live state from its task", () => {
    expect(liveParallelState("running", { busy: true, activity: "waiting-on-you" }, false)).toBe("waiting");
    expect(liveParallelState("queued", { busy: true }, false)).toBe("running");
    expect(liveParallelState("queued", { busy: false }, true)).toBe("queued");
    expect(liveParallelState("done", { busy: true }, false)).toBe("done");
  });
});
