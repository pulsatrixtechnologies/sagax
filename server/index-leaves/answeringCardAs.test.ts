// #3671: an answered card's decision row is queued and written in the
// background (server/decision-log.ts). Both answer routes (POST
// /api/threads/:id/respond and the Approvals screen's POST
// /api/approvals/bulk) go through answeringCardAs, and the history
// (GET /api/approvals?history=1) reads that log from disk: on a slow host a
// person who opened the history right after answering missed a card. The
// answer now returns once its row is on disk.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { appendDecision, flushDecisionLog, readDecisionRange } from "../decision-log.ts";
import { createAnsweringCardAs } from "./answeringCardAs.ts";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await flushDecisionLog(dir);
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("answeringCardAs", () => {
  it("returns once the answer's decision row is in the log the history reads", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "answering-card-"));
    dirs.push(dataDir);
    const card = { requestId: "req-1", answered: undefined as string | undefined };
    const host = {
      DATA_DIR: dataDir,
      store: { messagesFor: () => [{ id: "m1", card }], patchMessage: () => undefined },
      decisionActorFor: () => undefined,
      withDecisionActor: (_actor: unknown, work: () => Promise<unknown>) => work(),
      cardAnswererFor: () => ({ kind: "loopback" }),
      actConfirmed: () => undefined,
      flushDecisionLog,
    };
    const answeringCardAs = createAnsweringCardAs(() => host);
    await answeringCardAs({ kind: "loopback" }, "thread-1", "req-1", async () => {
      // what answerRequest does once the engine took the answer
      card.answered = "allow";
      appendDecision(dataDir, { threadId: "thread-1", requestId: "req-1", tool: "Bash", decision: "user-approved", source: "user" });
    });
    const now = new Date();
    const rows = readDecisionRange(dataDir, { from: new Date(now.getTime() - 60_000), to: new Date(now.getTime() + 60_000) });
    expect(rows.map((row) => [row.requestId, row.decision])).toEqual([["req-1", "user-approved"]]);
  });
});
