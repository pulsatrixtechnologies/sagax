import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createRemoteSessionActionsAudit, readRemoteSessionLog } from "./remote-session-actions-audit.ts";

let dir: string;
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), "rsa-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("remote session actions audit", () => {
  it("records exec and transfer, redacting a tunnel token from the command", () => {
    const audit = createRemoteSessionActionsAudit(dir);
    audit.write({ at: 1000, sessionId: "s1", principalId: "p", botId: "b", kind: "exec", command: "dir tc0123456789abcdef0123456789", readOnly: true, exitCode: 0 });
    audit.write({ at: 2000, sessionId: "s1", principalId: "p", botId: "b", kind: "transfer", direction: "upload", file: "patch.msi" });
    const log = readRemoteSessionLog(dir, "s1");
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ kind: "exec", command: "dir", readOnly: true, exitCode: 0 });
    expect(log[0]!.command).not.toContain("tc0123");
    expect(log[1]).toMatchObject({ kind: "transfer", direction: "upload", file: "patch.msi" });
  });

  it("merges control-audit lines, keeps counts, and never leaks other sessions", () => {
    // a control.jsonl written by the control audit (counts only, no keys)
    appendFileSync(path.join(dir, "remote-control.jsonl"),
      JSON.stringify({ at: 500, sessionId: "s1", principalId: "p", botId: "b", kind: "control.start" }) + "\n" +
      JSON.stringify({ at: 1500, sessionId: "s1", principalId: "p", botId: "b", kind: "control.release", keys: 12, clicks: 3 }) + "\n" +
      JSON.stringify({ at: 1600, sessionId: "OTHER", principalId: "p", botId: "b", kind: "control.start" }) + "\n");
    const audit = createRemoteSessionActionsAudit(dir);
    audit.write({ at: 1000, sessionId: "s1", principalId: "p", botId: "b", kind: "exec", command: "whoami", readOnly: true });
    const log = readRemoteSessionLog(dir, "s1");
    expect(log.map((e) => e.kind)).toEqual(["start", "exec", "control.release"]);
    expect(log[2]!.counts).toEqual({ keys: 12, clicks: 3 });
    expect(log.some((e) => (e as { sessionId?: string }).sessionId === "OTHER")).toBe(false);
  });
});
