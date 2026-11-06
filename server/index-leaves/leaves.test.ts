import { describe, expect, it } from "vitest";
import { createAcceptDirectSend } from "./acceptDirectSend.ts";
import { createSyncRoutineRunToSource } from "./syncRoutineRunToSource.ts";
import { createIndexSettingsActions } from "./settingsActions.ts";
import { createIndexPrimaryApprovals } from "./primaryApprovals.ts";
import { isTerminalSessionWsPath } from "./isTerminalSessionWsPath.ts";
import { installMainRuntimeEventSubscriber } from "../runtime-events/dispatcher.ts";
import { createApplyConfigHttpPatch } from "../routes/config-http-patch.ts";

describe("index-35k leaf factories (#1388)", () => {
  it("acceptDirectSend factory returns a function", () => {
    expect(typeof createAcceptDirectSend(() => ({}))).toBe("function");
  });
  it("syncRoutineRunToSource factory returns a function", () => {
    expect(typeof createSyncRoutineRunToSource(() => ({}))).toBe("function");
  });
  it("settingsActions / primaryApprovals factories return functions", () => {
    expect(typeof createIndexSettingsActions(() => ({
      settingsActionService: null,
      createSettingsActions: () => ({}),
    }))).toBe("function");
    expect(typeof createIndexPrimaryApprovals(() => ({
      primaryApprovalService: null,
      createPrimaryApprovals: () => ({}),
      store: { isConfidentialThread: () => false, messagesFor: () => [], groups: [], bot: () => null, taskByThread: () => null },
    }))).toBe("function");
  });
  it("isTerminalSessionWsPath matches terminal upgrade paths only", () => {
    expect(isTerminalSessionWsPath("/api/terminal/sessions/abc-1/ws")).toBe(true);
    expect(isTerminalSessionWsPath("/api/terminal/sessions/abc-1")).toBe(false);
  });
  it("runtime-events dispatcher installs a subscriber", () => {
    let n = 0;
    installMainRuntimeEventSubscriber({ subscribe: () => { n += 1; } }, () => ({}));
    expect(n).toBe(1);
  });
  it("config-http-patch factory returns a function", () => {
    expect(typeof createApplyConfigHttpPatch(() => ({}))).toBe("function");
  });
});
