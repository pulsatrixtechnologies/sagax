import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { cursorApprovalArgs } from "./acp/cursor.ts";
import { qwenApprovalArgs } from "./acp/qwen.ts";
import { codexNamedApprovalParams } from "./codex.ts";
import { SAGAX_REVIEWER_FILE, sagaxReviewsAuto } from "./sagax-reviewer.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function dataDir(flag?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "sagax-reviewer-"));
  dirs.push(dir);
  if (flag !== undefined) writeFileSync(join(dir, SAGAX_REVIEWER_FILE), flag);
  return dir;
}

describe("one reviewer on Approve for me (parity A13)", () => {
  it("is off unless the flag file opts the bot, or every bot, in", () => {
    expect(sagaxReviewsAuto("bot-a", dataDir())).toBe(false);
    expect(sagaxReviewsAuto("bot-a", dataDir("not json"))).toBe(false);
    expect(sagaxReviewsAuto("bot-a", dataDir("[]"))).toBe(false);
    expect(sagaxReviewsAuto("bot-a", dataDir('{"bots": ["bot-b"]}'))).toBe(false);
    expect(sagaxReviewsAuto("bot-a", dataDir('{"bots": ["bot-a"]}'))).toBe(true);
    expect(sagaxReviewsAuto("bot-a", dataDir('{"bots": "all"}'))).toBe(true);
    // a turn without a bot is never opted in by a list
    expect(sagaxReviewsAuto(undefined, dataDir('{"bots": ["bot-a"]}'))).toBe(false);
    expect(sagaxReviewsAuto(undefined, dataDir('{"bots": "all"}'))).toBe(true);
  });

  it("Codex: Approve for me keeps its own reviewer by default, the person as reviewer when Sagax decides", () => {
    expect(codexNamedApprovalParams("auto").thread.approvalsReviewer).toBe("auto_review");
    expect(codexNamedApprovalParams("auto").turn.approvalsReviewer).toBe("auto_review");
    const sagax = codexNamedApprovalParams("auto", true);
    expect(sagax.thread).toMatchObject({ approvalPolicy: "on-request", approvalsReviewer: "user", sandbox: "workspace-write" });
    expect(sagax.turn).toMatchObject({ approvalPolicy: "on-request", approvalsReviewer: "user", sandboxPolicy: { type: "workspaceWrite" } });
    // the other levels never change
    expect(codexNamedApprovalParams("ask", true)).toEqual(codexNamedApprovalParams("ask"));
    expect(codexNamedApprovalParams("full", true)).toEqual(codexNamedApprovalParams("full"));
  });

  it("Qwen: Approve for me runs auto-edit when Sagax decides, never its classifier", () => {
    expect(qwenApprovalArgs(false, "auto")).toEqual(["--approval-mode", "auto"]);
    expect(qwenApprovalArgs(false, "auto", true)).toEqual(["--approval-mode", "auto-edit"]);
    expect(qwenApprovalArgs(false, "edits", true)).toEqual(["--approval-mode", "auto-edit"]);
    expect(qwenApprovalArgs(false, "ask", true)).toEqual([]);
    expect(qwenApprovalArgs(true, "full", true)).toEqual(["--yolo"]);
  });

  it("Cursor: Approve for me drops --auto-review when Sagax decides", () => {
    expect(cursorApprovalArgs(false, "auto")).toEqual(["--auto-review"]);
    expect(cursorApprovalArgs(false, "auto", true)).toEqual([]);
    expect(cursorApprovalArgs(false, "ask", true)).toEqual([]);
    expect(cursorApprovalArgs(true, "full", true)).toEqual(["--force"]);
  });
});
