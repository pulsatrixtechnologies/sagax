// #4528: a routine run waiting on a permission card outlives a restart. The
// card stays open on the transcript, the run stays waiting, and the answer's
// turn resumes the same run.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { RoutineManager, type RoutineManagerOptions } from "../routines/routines.ts";
import { createAwaitsPerson } from "./awaitsPerson.ts";
import { createIsApprovalCardMessage } from "./isApprovalCardMessage.ts";
import { createOpenApprovalCard } from "./openApprovalCard.ts";
import { createOpenQuestionCard } from "./openQuestionCard.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function cardHost(messagesFor: (threadId: string) => unknown[]) {
  const host: Record<string, unknown> = {
    store: { messagesFor },
    redactSecretsInText: (text: string) => text,
    isPersistentQuestionCard: (card: { questionRequest?: boolean }) => Boolean(card?.questionRequest),
  };
  host.isApprovalCardMessage = createIsApprovalCardMessage(() => host);
  host.openQuestionCard = createOpenQuestionCard(() => host);
  host.openApprovalCard = createOpenApprovalCard(() => host);
  return { host, awaitsPerson: createAwaitsPerson(() => host) as (threadId: string) => string | null };
}

describe("the open permission card of a conversation (#4528)", () => {
  const one = (message: unknown) => cardHost(() => [message]).host.openApprovalCard as (threadId: string) => unknown;

  it("finds an open permission card, not a question, an answered card or one that holds nothing", () => {
    expect(one({ kind: "options", card: { requestId: "r1", tool: "send_mail", subtitle: "Send the invoice" } })("t1")).toMatchObject({ requestId: "r1" });
    expect(one({ kind: "options", card: { requestId: "q1", questionRequest: true } })("t1")).toBeUndefined();
    expect(one({ kind: "options", card: { requestId: "r1", tool: "send_mail", answered: "allow" } })("t1")).toBeUndefined();
    expect(one({ kind: "options", card: { requestId: "r1", tool: "send_mail", expired: true } })("t1")).toBeUndefined();
    expect(one({ kind: "options", card: { requestId: "r1", tool: "send_mail", noHold: true } })("t1")).toBeUndefined();
  });

  it("words the run's waiting line for a question first, then a permission", () => {
    const permission = { kind: "options", card: { requestId: "r1", tool: "send_mail", subtitle: "Send   the invoice" } };
    const question = { kind: "options", card: { requestId: "q1", questionRequest: true, subtitle: "Which batch?" } };
    expect(cardHost(() => [permission]).awaitsPerson("t1")).toBe("Waiting for your approval: Send the invoice");
    expect(cardHost(() => [permission, question]).awaitsPerson("t1")).toBe("Waiting for your answer: Which batch?");
    expect(cardHost(() => []).awaitsPerson("t1")).toBeNull();
  });
});

describe("a routine run waiting on a permission card through a restart (#4528)", () => {
  it("stays waiting after the restart, and the answer's turn completes the same run", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omb-permission-restart-"));
    dirs.push(dir);
    let now = Date.parse("2026-11-19T15:00:00Z");
    const transcript = new Map<string, unknown[]>();
    const cards = cardHost((threadId) => transcript.get(threadId) ?? []);
    let task = 0;
    const options: RoutineManagerOptions = {
      file: join(dir, "routines.json"),
      now: () => now,
      emit: () => {},
      botState: () => "ready",
      createTask: () => ({ threadId: `thread-${++task}` }),
      startTurn: async () => {},
      interruptTurn: async () => {},
      awaitsPerson: cards.awaitsPerson,
    };
    const before = new RoutineManager(options);
    const routine = before.create({ name: "Invoices", prompt: "Send the overdue invoices.", botId: "scout", enabled: false,
      schedule: { type: "cron", expression: "0 9 * * 1-5", timeZone: "America/Toronto" } });
    before.runNow(routine.id);
    await before.tick();
    const run = before.listRuns()[0]!;
    const threadId = run.threadId!;
    const event = (manager: RoutineManager, rest: Record<string, unknown>) =>
      manager.handleRuntimeEvent({ eventId: `e-${now++}`, provider: "fake", threadId, createdAt: new Date(now).toISOString(), ...rest } as never);
    // the turn asks for a permission: the card is on the transcript, the run waits
    event(before, { type: "turn.started" });
    event(before, { type: "request.opened", requestType: "permission", requestId: "perm-1", tool: "send_mail", summary: "Send the invoice" });
    transcript.set(threadId, [{ kind: "options", card: { requestId: "perm-1", tool: "send_mail", subtitle: "Send the invoice", requestType: "permission" } }]);
    expect(before.listRuns()[0]!.status).toBe("waiting");

    // the server stops and starts again
    const after = new RoutineManager(options);
    expect(after.listRuns()[0]).toMatchObject({ id: run.id, status: "waiting" });
    expect(after.listRuns()[0]!.error).toBeUndefined();

    // the person allows: the card is answered and one turn carries the verdict
    transcript.set(threadId, [{ kind: "options", card: { requestId: "perm-1", tool: "send_mail", subtitle: "Send the invoice", requestType: "permission", answered: "allow" } }]);
    event(after, { type: "turn.started" });
    expect(after.listRuns()[0]!.status).toBe("running");
    event(after, { type: "item.completed", itemType: "assistant_text", text: "Invoice sent." });
    event(after, { type: "turn.completed", ok: true });
    expect(after.listRuns()[0]).toMatchObject({ id: run.id, status: "completed", output: "Invoice sent." });
  });

  it("without an open card, the waiting run ends at the restart as before", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omb-permission-restart-"));
    dirs.push(dir);
    let now = Date.parse("2026-11-19T15:00:00Z");
    let task = 0;
    const options: RoutineManagerOptions = {
      file: join(dir, "routines.json"),
      now: () => now,
      emit: () => {},
      botState: () => "ready",
      createTask: () => ({ threadId: `thread-${++task}` }),
      startTurn: async () => {},
      interruptTurn: async () => {},
      awaitsPerson: cardHost(() => []).awaitsPerson,
    };
    const before = new RoutineManager(options);
    const routine = before.create({ name: "Invoices", prompt: "Send.", botId: "scout", enabled: false,
      schedule: { type: "cron", expression: "0 9 * * 1-5", timeZone: "America/Toronto" } });
    before.runNow(routine.id);
    await before.tick();
    const threadId = before.listRuns()[0]!.threadId!;
    before.handleRuntimeEvent({ eventId: `e-${now++}`, provider: "fake", threadId, createdAt: new Date(now).toISOString(), type: "request.opened", requestType: "permission", requestId: "perm-1", tool: "send_mail", summary: "Send" } as never);
    expect(before.listRuns()[0]!.status).toBe("waiting");
    expect(new RoutineManager(options).listRuns()[0]!.status).toBe("failed");
  });
});
