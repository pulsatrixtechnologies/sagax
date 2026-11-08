import { describe, expect, it } from "vitest";
import { activeRoutines, formatDryRun, routinesDryRun } from "./routines-dry-run.ts";

const listing = {
  routines: [
    { id: "r1", name: "Overdue invoices report", botId: "osprey", enabled: true, canRun: true, bot: { name: "Osprey" } },
    { id: "r2", name: "Nightly", botId: "scout", enabled: true, canRun: true, bot: { name: "Scout" } },
    { id: "r3", name: "Paused", botId: "scout", enabled: false, canRun: true },
    { id: "r4", name: "Someone else", botId: "x", enabled: true, canRun: false, redacted: true },
  ],
};

function fakeFetch(calls: string[]) {
  return async (url: string, init?: { method?: string; headers?: Record<string, string> }) => {
    calls.push(`${init?.method ?? "GET"} ${url} ${init?.headers?.Authorization ? "auth" : "anon"}`);
    if (url.endsWith("/api/routines")) return { ok: true, status: 200, json: async () => listing };
    if (url.endsWith("/r1/check")) return { ok: true, status: 200, json: async () => ({ ok: true, checks: [{ kind: "engine", ok: true, line: "Grok ready" }] }) };
    return { ok: true, status: 200, json: async () => ({ ok: false, checks: [{ kind: "perspicax", ok: false, line: "Perspicax refused the run-as person" }] }) };
  };
}

describe("routines dry run at the cut (QA 0.8.66 F5)", () => {
  it("checks only the active routines the caller can run", () => {
    expect(activeRoutines(listing).map((row) => row.id)).toEqual(["r1", "r2"]);
    expect(activeRoutines({})).toEqual([]);
  });

  it("asks the readiness check of each active routine, never a run, and reports the failing check", async () => {
    const calls: string[] = [];
    const rows = await routinesDryRun("http://127.0.0.1:1", "secret", fakeFetch(calls));
    expect(calls).toEqual([
      "GET http://127.0.0.1:1/api/routines auth",
      "POST http://127.0.0.1:1/api/routines/r1/check auth",
      "POST http://127.0.0.1:1/api/routines/r2/check auth",
    ]);
    expect(calls.some((call) => call.includes("/run"))).toBe(false);
    expect(rows.map((row) => row.ok)).toEqual([true, false]);
    const text = formatDryRun(rows);
    expect(text).toContain("FAIL Scout / Nightly");
    expect(text).toContain("perspicax: Perspicax refused the run-as person");
    expect(text).toContain("1/2 active routines ready.");
    expect(text).not.toContain("secret");
  });
});
