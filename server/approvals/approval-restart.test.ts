import { describe, expect, it } from "vitest";
import { expireApprovalsAfterRestart, type StaleApproval } from "./approval-restart.ts";
import type { Message } from "../store.ts";

const card = (extra: Record<string, unknown>) => ({ title: "t", subtitle: "s", options: ["Allow", "Deny"], requestType: "permission", requestId: "r1", tool: "other", ...extra });
const msg = (id: string, c: Record<string, unknown>) => ({ id, at: 1, role: "bot", kind: "options", card: card(c) }) as unknown as Message;

describe("expireApprovalsAfterRestart", () => {
  it("expires open permission cards (Expired pill, nothing to answer) and logs each", () => {
    const rows: StaleApproval[] = [
      { threadId: "t1", message: msg("m1", { mcpTool: "sagax-environment__run_command", expiresAt: 1 }) },
      { threadId: "t2", message: msg("m2", { requestId: "r2" }) },
      { threadId: "t3", message: msg("m3", { answered: "allow" }) },
      { threadId: "t4", message: msg("m4", { requestType: "question" }) },
      { threadId: "t5", message: msg("m5", { expired: true }) },
    ];
    const patched: Array<[string, string, any]> = [];
    const decided: any[] = [];
    const n = expireApprovalsAfterRestart({ open: () => rows, patch: (t, m, c) => patched.push([t, m, c]), decide: (r) => decided.push(r) });
    expect(n).toBe(2);
    expect(patched.map(([t, m]) => `${t}/${m}`)).toEqual(["t1/m1", "t2/m2"]);
    expect(patched[0][2]).toMatchObject({ answered: "deny", expired: true, options: [], mcpTool: "sagax-environment__run_command" });
    expect(decided).toEqual([
      { threadId: "t1", requestId: "r1", tool: "other", summary: "s" },
      { threadId: "t2", requestId: "r2", tool: "other", summary: "s" },
    ]);
  });
});
