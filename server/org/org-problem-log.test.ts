// The problem log (server/org/org-problem-log.ts): reason codes, labels in two
// languages, append and read newest first, the detail bound.
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { removeTempDir } from "../testing/cleanup.ts";
import { appendProblem, flushProblemLog, problemFileFor, problemReason, readProblems, reasonLabel } from "./org-problem-log.ts";

const DASHES = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);
const dir = mkdtempSync(join(tmpdir(), "omb-problems-"));
afterAll(() => removeTempDir(dir));

describe("problem log", () => {
  it("classifies the cause into a reason code", () => {
    expect(problemReason("failed", "429 Too Many Requests")).toBe("rate_limited");
    expect(problemReason("failed", "Your credit balance is too low")).toBe("quota");
    expect(problemReason("failed", "401 Unauthorized: invalid x-api-key")).toBe("auth");
    expect(problemReason("failed", "Overloaded")).toBe("provider_unavailable");
    expect(problemReason("could-not-start", "spawn claude ENOENT")).toBe("engine_missing");
    expect(problemReason("failed", "request timed out")).toBe("timeout");
    expect(problemReason("failed", "fetch failed")).toBe("network");
    expect(problemReason("failed", "prompt is too long")).toBe("context_too_long");
    expect(problemReason("failed", "turn interrupted, provider settings changed")).toBe("interrupted");
    expect(problemReason("could-not-start", "something odd")).toBe("could_not_start");
    expect(problemReason("routine-failed", "something odd")).toBe("routine_failed");
    expect(problemReason("failed", "")).toBe("failed");
    expect(problemReason("stalled", "429")).toBe("stalled");
    expect(problemReason("refused", "", "engine_missing")).toBe("engine_missing");
    expect(problemReason("refused", "", "unknown")).toBe("no_access");
  });

  it("labels in English and French, a known label for an unknown code", () => {
    expect(reasonLabel("rate_limited")).toBe("The provider is rate limiting");
    expect(reasonLabel("rate_limited", "fr")).toBe("Le fournisseur limite le débit");
    expect(reasonLabel("nope")).toBe(reasonLabel("failed"));
    for (const code of ["no_access", "payer_disabled", "key_refused", "engine_missing", "auth", "stalled", "routine_delegation"]) {
      expect(reasonLabel(code, "en")).not.toMatch(DASHES);
      expect(reasonLabel(code, "fr")).not.toMatch(DASHES);
    }
  });

  it("appends 0600 rows and reads them newest first, bounded detail", async () => {
    const base = Date.UTC(2026, 9, 8, 12);
    await appendProblem(dir, { kind: "failed", botId: "b1", botName: "One", ownerPrincipalId: "p1", threadId: "t1", title: null, engine: "claude", detail: "x".repeat(400), at: base });
    await appendProblem(dir, { kind: "refused", reason: "no_access", botId: "b2", botName: "Two", ownerPrincipalId: "p2", threadId: "t2", title: "T", engine: null, detail: "No access", at: base + 1000 });
    await flushProblemLog(dir);
    const rows = readProblems(dir, { from: base - 1 });
    expect(rows.map((row) => row.botId)).toEqual(["b2", "b1"]);
    expect(rows[1]!.detail).toHaveLength(300);
    expect(rows[1]!.reason).toBe("failed");
    expect(readProblems(dir, { from: base + 500 }).map((row) => row.botId)).toEqual(["b2"]);
    if (process.platform !== "win32") expect(statSync(problemFileFor(dir, new Date(base))).mode & 0o777).toBe(0o600);
    expect(readFileSync(problemFileFor(dir, new Date(base)), "utf8").split("\n").filter(Boolean)).toHaveLength(2);
  });
});
