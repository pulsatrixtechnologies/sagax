import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { IncomingMessage, ServerResponse } from "node:http";

import { json } from "./harness/http.ts";
import type { RequestAuth } from "./auth/request-auth.ts";
import { createWorkflowRoutes, resumeDueWorkflows } from "./routes/workflows.ts";
import { advanceWorkflow, parseWorkflowYaml, WORKFLOW_CLOCK_BACKOFF_MS, WorkflowStore, workflowScope, workflowScopeKey, type WorkflowEffects } from "./workflows.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const YAML = `
name: follow-up
steps:
  - send: { bot: bot-a, thread: thread-a, text: Starting }
  - wait: { seconds: 5 }
  - approve: { prompt: Continue?, bot: bot-a, thread: thread-a }
  - send: { bot: bot-a, thread: thread-a, text: Done }
`;

describe("deterministic workflows", () => {
  it("sends, then waits, then stops until the person answers, then continues", () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-workflows-"));
    dirs.push(dir);
    const store = new WorkflowStore(dir);
    const scope = workflowScope(false, null);
    expect(scope).toEqual({ organization: false });
    if (!scope) return;
    expect(typeof store.save(scope, YAML)).not.toBe("string");
    let now = 1_000_000;
    const sent: string[] = [];
    const effects = (): WorkflowEffects => ({
      now: () => now,
      deliver(_bot, _thread, text) { sent.push(text); },
    });
    const started = store.start(scope, "follow-up", now);
    expect(typeof started).not.toBe("string");
    if (typeof started === "string") return;
    const waiting = advanceWorkflow(started, effects());
    expect(waiting.status).toBe("waiting");
    expect(waiting.waitUntil).toBe(now + 5_000);
    expect(sent).toEqual(["Starting"]);
    const still = advanceWorkflow(waiting, effects());
    expect(still.waitUntil).toBe(waiting.waitUntil);
    expect(sent).toEqual(["Starting"]);
    now = waiting.waitUntil!;
    const gate = advanceWorkflow(still, effects());
    expect(gate.status).toBe("waiting");
    expect(gate.approval?.prompt).toBe("Continue?");
    expect(sent).toEqual(["Starting", "Continue?"]);
    const held = advanceWorkflow(gate, effects());
    expect(held.status).toBe("waiting");
    expect(sent).toEqual(["Starting", "Continue?"]);
    const done = advanceWorkflow(held, effects(), "yes");
    expect(done.status).toBe("done");
    expect(sent).toEqual(["Starting", "Continue?", "Done"]);
    const stopped = advanceWorkflow(gate, effects(), "no");
    expect(stopped.status).toBe("stopped");
    expect(sent).toEqual(["Starting", "Continue?", "Done"]);
  });

  it("refuses a step that is not send, wait or approve", () => {
    expect(parseWorkflowYaml("name: x\nsteps:\n  - model: { prompt: hi }\n")).toMatch(/send, wait or approve/);
  });

  it("keeps each person on a shared server in their own folder", () => {
    const local = workflowScope(false, null);
    const guest = workflowScope(false, null, "guest-a");
    const other = workflowScope(false, null, "guest-b");
    expect(local).toEqual({ organization: false });
    if (!guest || !other) throw new Error("a person scope is missing");
    expect(workflowScopeKey(guest)).not.toBe("local");
    expect(workflowScopeKey(guest)).not.toBe(workflowScopeKey(other));
  });

  it("drops finished runs after an hour and does not scan them every tick", () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-workflows-"));
    dirs.push(dir);
    const store = new WorkflowStore(dir);
    store.writeRun({
      id: "wf_0123456789abcdef",
      name: "follow-up",
      scopeKey: "local",
      steps: [],
      index: 0,
      status: "done",
      updatedAt: 2_000,
    });
    expect(store.getRun("wf_0123456789abcdef")?.status).toBe("done");
    expect(store.pruneFinished(2_000 + 59 * 60 * 1000)).toBe(0);
    expect(store.getRun("wf_0123456789abcdef")?.status).toBe("done");
    expect(store.pruneFinished(2_000 + 60 * 60 * 1000)).toBe(1);
    expect(store.getRun("wf_0123456789abcdef")).toBeNull();
    expect(store.due(9_000_000)).toEqual([]);
  });
});

function mockRes() {
  return {
    status: 0,
    body: "",
    setHeader() {},
    writeHead(status: number) { this.status = status; },
    end(data?: string) { this.body = data ?? ""; },
  };
}

const sessionAuth = { kind: "session", scopes: ["client"], via: "bearer", session: { id: "s" } } as unknown as RequestAuth;

describe("workflow routes", () => {
  it("refuses a step on someone else's conversation without replacing the file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-workflows-"));
    dirs.push(dir);
    const store = new WorkflowStore(dir);
    const scope = workflowScope(false, null);
    if (!scope) return;
    const kept = "name: follow-up\nsteps:\n  - wait: { seconds: 5 }\n";
    expect(typeof store.save(scope, kept)).not.toBe("string");
    const handler = createWorkflowRoutes({
      store,
      scope: () => scope,
      owns: (_auth, _bot, thread) => thread === "thread-a",
      deliver() {},
      now: () => 1,
    });
    const res = mockRes();
    await handler({
      req: {} as IncomingMessage,
      res: res as unknown as ServerResponse,
      url: new URL("http://127.0.0.1/api/me/workflows"),
      path: "/api/me/workflows",
      method: "PUT",
      auth: sessionAuth,
      json,
      readBody: async () => ({ yaml: "name: follow-up\nsteps:\n  - send: { bot: bot-a, thread: other, text: hi }\n" }),
    });
    expect(res.status).toBe(403);
    expect(store.read(scope, "follow-up")?.steps[0]?.kind).toBe("wait");
  });

  it("a second concurrent answer gets 409 and does not deliver twice", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-workflows-"));
    dirs.push(dir);
    const store = new WorkflowStore(dir);
    const scope = workflowScope(false, null);
    if (!scope) throw new Error("scope");
    expect(typeof store.save(scope, YAML)).not.toBe("string");
    let now = 1_000_000;
    const sent: string[] = [];
    const started = store.start(scope, "follow-up", now);
    if (typeof started === "string") throw new Error(started);
    const effects = (): WorkflowEffects => ({
      now: () => now,
      deliver(_bot, _thread, text) { sent.push(text); },
    });
    let gate = advanceWorkflow(started, effects());
    store.writeRun(gate);
    now = gate.waitUntil!;
    gate = advanceWorkflow(gate, effects());
    store.writeRun(gate);
    expect(gate.approval?.prompt).toBe("Continue?");
    expect(sent).toEqual(["Starting", "Continue?"]);

    const handler = createWorkflowRoutes({
      store,
      scope: () => scope,
      owns: () => true,
      deliver(_bot, _thread, text) { sent.push(text); },
      now: () => now,
    });
    const answer = () => {
      const res = mockRes();
      return handler({
        req: {} as IncomingMessage,
        res: res as unknown as ServerResponse,
        url: new URL(`http://127.0.0.1/api/me/workflows/runs/${gate.id}/answer`),
        path: `/api/me/workflows/runs/${gate.id}/answer`,
        method: "POST",
        auth: sessionAuth,
        json,
        readBody: async () => ({ decision: "yes" }),
      }).then(() => res);
    };
    const [first, second] = await Promise.all([answer(), answer()]);
    const statuses = [first.status, second.status].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 409]);
    expect(sent.filter((text) => text === "Done")).toHaveLength(1);
    expect(store.getRun(gate.id)?.status).toBe("done");
  });
});

describe("workflow clock", () => {
  it("a write failure on one due run is logged, backs off that run, and lets others continue", () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-workflows-"));
    dirs.push(dir);
    const store = new WorkflowStore(dir);
    const scope = workflowScope(false, null);
    if (!scope) throw new Error("scope");
    expect(typeof store.save(scope, "name: alpha\nsteps:\n  - wait: { seconds: 1 }\n  - send: { bot: bot-a, thread: thread-a, text: A }\n")).not.toBe("string");
    expect(typeof store.save(scope, "name: beta\nsteps:\n  - wait: { seconds: 1 }\n  - send: { bot: bot-a, thread: thread-a, text: B }\n")).not.toBe("string");
    let now = 1_000_000;
    const a = store.start(scope, "alpha", now);
    const b = store.start(scope, "beta", now);
    if (typeof a === "string" || typeof b === "string") throw new Error("start");
    const waitingA = advanceWorkflow(a, { now: () => now, deliver() {} });
    const waitingB = advanceWorkflow(b, { now: () => now, deliver() {} });
    store.writeRun(waitingA);
    store.writeRun(waitingB);
    now = Math.max(waitingA.waitUntil!, waitingB.waitUntil!);

    const sent: string[] = [];
    const logs: string[] = [];
    const original = store.writeRun.bind(store);
    store.writeRun = (run) => {
      if (run.id === a.id && run.status !== "stopped") throw new Error("disk full");
      original(run);
    };

    resumeDueWorkflows(
      store,
      () => now,
      () => ({ now: () => now, deliver(_bot, _thread, text) { sent.push(text); } }),
      () => true,
      (line) => logs.push(line),
    );

    expect(logs.some((line) => line.includes(a.id) && line.includes("disk full"))).toBe(true);
    expect(store.getRun(a.id)?.status).toBe("stopped");
    expect(store.getRun(a.id)?.error).toBe("clock_failed");
    // advance delivers before writeRun; the failure stops further ticks for A.
    expect(sent).toEqual(["A", "B"]);
    expect(store.getRun(b.id)?.status).toBe("done");
    expect(store.due(now).map((run) => run.id)).not.toContain(a.id);
    resumeDueWorkflows(
      store,
      () => now,
      () => ({ now: () => now, deliver(_bot, _thread, text) { sent.push(text); } }),
      () => true,
      (line) => logs.push(line),
    );
    expect(sent).toEqual(["A", "B"]);
  });

  it("when stop also fails, the run is backed off so it is not due every tick", () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-workflows-"));
    dirs.push(dir);
    const store = new WorkflowStore(dir);
    const scope = workflowScope(false, null);
    if (!scope) throw new Error("scope");
    expect(typeof store.save(scope, "name: poison\nsteps:\n  - wait: { seconds: 1 }\n  - send: { bot: bot-a, thread: thread-a, text: P }\n")).not.toBe("string");
    let now = 2_000_000;
    const started = store.start(scope, "poison", now);
    if (typeof started === "string") throw new Error(started);
    const waiting = advanceWorkflow(started, { now: () => now, deliver() {} });
    store.writeRun(waiting);
    now = waiting.waitUntil!;

    const original = store.writeRun.bind(store);
    store.writeRun = () => { throw new Error("disk full"); };
    const logs: string[] = [];
    const sent: string[] = [];
    resumeDueWorkflows(
      store,
      () => now,
      () => ({ now: () => now, deliver(_bot, _thread, text) { sent.push(text); } }),
      () => true,
      (line) => logs.push(line),
    );
    expect(logs.some((line) => line.includes("could not be stopped"))).toBe(true);
    expect(sent).toEqual(["P"]);
    expect(store.due(now)).toEqual([]);
    expect(store.due(now + WORKFLOW_CLOCK_BACKOFF_MS - 1)).toEqual([]);
    store.writeRun = original;
    const again = store.due(now + WORKFLOW_CLOCK_BACKOFF_MS);
    expect(again.map((run) => run.id)).toEqual([started.id]);
  });
});
