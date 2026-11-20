import { describe, expect, it } from "vitest";

import { classifyRoutineFailure } from "./routine-recovery.ts";
import { ROUTINE_LASTING_FAILURE_RULE, ROUTINE_REPORT_CONTRACT } from "./routine-report.ts";
import { routineFailureText, routineStepFailure, routineStepProblem } from "./routine-step-failure.ts";

// #4877: a failed routine step says what failed, why and what to do; a
// failure trying again cannot change is surfaced and stops there.
describe("lasting routine step failures (#4877)", () => {
  it("reads a missing tool only from a whole 'not found' message, never from a tool's own refusal", () => {
    for (const said of ["tool not found: Flow", "Tool not found: gateway__flow", "MCP error -32602: Unknown tool: cw_psa_query", "no tool named flow_run", "Tool `flow_run` not found."]) {
      expect(routineStepFailure(said)?.kind, said).toBe("missing_tool");
    }
    expect(routineStepFailure("tool not found: Flow")?.why).toBe("the tool \"Flow\" is not available to this bot");
    // #4432 review: the tool answered, refusing an operation it does not have
    expect(routineStepFailure("Unknown tool: create_invoice is not an operation of this API")).toBeNull();
    expect(routineStepFailure("search returned no match")).toBeNull();
  });

  it("an expired result handle never comes back: the query runs again", () => {
    const said = "handle res_0123456789abcdef is unknown, expired, or not yours (handle_unknown)";
    expect(routineStepFailure(said)).toMatchObject({ kind: "expired_result", next: expect.stringContaining("run its query again") });
  });

  it("a refused permission names it; a bare 403, a 5xx or the engine's sign-in is not one", () => {
    expect(routineStepFailure("HTTP 403: You do not have permission (Inquire) on service tickets")).toMatchObject({
      kind: "permission", why: "the account was refused the \"Inquire\" permission this step needs",
    });
    expect(routineStepFailure("403 Forbidden: permission Inquire is required for Service Ticket")?.next).toContain("the \"Inquire\" permission");
    expect(routineStepFailure("The token lacks the developer.billing.write scope")?.why).toContain("\"developer.billing.write\"");
    expect(routineStepFailure("403 Forbidden")).toBeNull();
    expect(routineStepFailure("502 Bad Gateway")).toBeNull();
    expect(routineStepFailure("timeout")).toBeNull();
  });

  it("a problem line keeps the step's own words and adds what to do", () => {
    expect(routineStepProblem("Flow", "Tool not found: Flow", 2))
      .toBe("Flow failed 2 times and never succeeded after: Tool not found: Flow. Next: Reconnect the connector or plugin that provides it, or change the routine to a tool the bot has.");
    expect(routineStepProblem("fetch", "timeout")).toBe("fetch failed: timeout");
    expect(routineFailureText("The bot did not complete this run")).toBe("The bot did not complete this run");
    expect(routineFailureText("HTTP 403: You do not have permission (Inquire) on service tickets."))
      .toMatch(/^HTTP 403: You do not have permission \(Inquire\) on service tickets\. Why: the account was refused the "Inquire" permission this step needs\. Next: Give the "Inquire" permission/);
  });

  it("a run refused for a permission stops and says so; it never waits for the engine's sign-in", () => {
    for (const said of ["HTTP 403: You do not have permission (Inquire) on service tickets", "403 Forbidden: permission Inquire is required for Service Ticket"]) {
      expect(classifyRoutineFailure(said), said).toEqual({ kind: "final" });
    }
    // the engine's own sign-in and a bare 403 still ask for a new sign-in
    expect(classifyRoutineFailure("403 Forbidden")).toEqual({ kind: "owner", cause: "signed_out" });
    expect(classifyRoutineFailure("401 Unauthorized")).toEqual({ kind: "owner", cause: "signed_out" });
    // #4720: a scope refusal keeps its reconnect invitation
    expect(classifyRoutineFailure("403 Resource not accessible by integration")).toEqual({ kind: "owner", cause: "signed_out" });
  });

  it("every routine run is told to retry only what may pass, and never the same expired handle", () => {
    expect(ROUTINE_REPORT_CONTRACT).toContain(ROUTINE_LASTING_FAILURE_RULE);
    expect(ROUTINE_LASTING_FAILURE_RULE).toContain("at most twice");
    expect(ROUTINE_LASTING_FAILURE_RULE).toContain("never the same handle again");
  });
});
