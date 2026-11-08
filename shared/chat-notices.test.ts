// The technical notices the chat leaves out (shared/chat-notices.ts), and the
// fixture the iOS core reads the same rules from.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHAT_NOTICE_RULES, isTechnicalNoticeName } from "./chat-notices.ts";
import { ONE_PASSWORD_WAITING } from "./credential-vault.ts";
import { HOST_CONTROL_NOTICE } from "./host-control.ts";
import { SANDBOX_WAKE_NOTICE, SANDBOX_WAKE_TIMEOUT_NOTICE } from "./sandbox-wake.ts";
import { workspaceLineName } from "./workspace-line.ts";
import { limitFailoverText } from "./limit-failover.ts";
import { STOPPED_TURN_NAME } from "./client-cancel.ts";
import { rebuiltSessionNotice } from "../server/resume-recovery.ts";

const FIXTURE = join(import.meta.dirname, "../ios/Tests/CompanionCoreTests/Fixtures/chat-notices.json");
const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as {
  hiddenPrefixes: string[]; shown: string[]; hidden: string[]; visible: string[];
};

describe("technical notices", () => {
  it("hides every engine notice the server stored, Auto's lines, the Workspace line and automatic recovery", () => {
    for (const name of [
      `notice: ${rebuiltSessionNotice("Claude Code")}`,
      'notice: MCP server "slack" was skipped for this turn: 401 Unauthorized',
      "notice: Waiting for a free Codex slot: 2 Codex runs are starting on this computer. This one starts on its own.",
      workspaceLineName({ target: "cloud" }),
      workspaceLineName({ target: "cloud", fallback: { wanted: "this_computer", reason: "offline" } }),
      "recovery: Automatic recovery: Claude Code could not start. Trying Codex · gpt-5 once in this thread.",
    ]) expect(isTechnicalNoticeName(name), name).toBe(true);
  });

  it("keeps what asks something of the person, a usage limit, a stop, an error and a tool step", () => {
    for (const name of [
      ONE_PASSWORD_WAITING,
      // QA 0.8.66 F1: a cold start is shown, never a silent chat
      SANDBOX_WAKE_NOTICE,
      SANDBOX_WAKE_TIMEOUT_NOTICE,
      HOST_CONTROL_NOTICE,
      `recovery: ${limitFailoverText({ kind: "waiting", from: "Claude", resetsAt: 0 }, () => "2:05 PM")}`,
      STOPPED_TURN_NAME,
      "error: Claude Code is signed out",
      "mcp_sagax-environment__run_command",
      "",
      undefined,
    ]) expect(isTechnicalNoticeName(name), String(name)).toBe(false);
  });

  it("is the list the iOS core reads (Fixtures/chat-notices.json)", () => {
    expect(fixture.hiddenPrefixes).toEqual([...CHAT_NOTICE_RULES.hiddenPrefixes]);
    expect(fixture.shown).toEqual([...CHAT_NOTICE_RULES.shown]);
    for (const name of fixture.hidden) expect(isTechnicalNoticeName(name), name).toBe(true);
    for (const name of fixture.visible) expect(isTechnicalNoticeName(name), name).toBe(false);
  });
});
