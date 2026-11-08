import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { terminalDurationLabel, terminalTranscriptText } from "../../shared/terminal-resources.ts";
import { TerminalResourceRegistry } from "../terminal-resources/registry.ts";
import { createTestTerminalAdapter } from "../terminal-resources/adapters/test.ts";
import { createTerminalAuditLog } from "./terminal-audit.ts";
import { foldEndedTerminalCard } from "./terminal-install.ts";
import { createTerminalSessionManager, type TerminalSessionEnded } from "./terminal-sessions.ts";
import type { Message } from "../store.ts";

describe("terminal transcript text", () => {
  it("drops escape sequences, resolves carriage returns and keeps the end", () => {
    const raw = "\u001b]0;title\u0007\u001b[1;32mok\u001b[0m\r\nprogress 10%\rprogress 100%\r\nbell\u0007 done\r\n\r\n";
    expect(terminalTranscriptText(raw)).toBe("ok\nprogress 100%\nbell done");
    expect(terminalTranscriptText("abcdef", 3)).toBe("def");
  });

  it("names the length of a session", () => {
    expect(terminalDurationLabel(1_000, 43_000)).toBe("42 s");
    expect(terminalDurationLabel(1_000, 1_000 + 5 * 60_000)).toBe("5 min");
    expect(terminalDurationLabel(1_000, 1_000 + 2 * 3_600_000 + 7 * 60_000)).toBe("2 h 7 min");
  });
});

describe("an ended terminal session folds its chat card", () => {
  let dataDir: string;
  beforeEach(() => { dataDir = mkdtempSync(join(tmpdir(), "sagax-terminal-fold-")); });
  afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

  it("hands the kept output to onEnded once the session is closed", async () => {
    const registry = new TerminalResourceRegistry();
    registry.register(createTestTerminalAdapter({ kind: "sandbox", id: "mine", label: "Cloud", scope: "personal" }));
    const ended: TerminalSessionEnded[] = [];
    let now = 1_000;
    const sessions = createTerminalSessionManager({ registry, audit: createTerminalAuditLog(dataDir), now: () => now, onEnded: (row) => ended.push(row) });
    const opened = await sessions.open({
      principalId: "pr_owner", botId: "b1", threadId: "t1", resourceKey: "sandbox:mine", label: "Cloud", hostLabel: "Cloud",
      access: { organization: true, admin: false, ownsBot: true }, cols: 80, rows: 24,
    });
    sessions.record(opened.id, "$ ls\r\n");
    sessions.record(opened.id, Buffer.from("a.txt\r\n"));
    now = 61_000;
    expect(sessions.close(opened.id, "pr_owner")).toBe(true);
    expect(ended).toHaveLength(1);
    expect(ended[0]).toMatchObject({ id: opened.id, threadId: "t1", endedAt: 61_000, output: "$ ls\r\na.txt\r\n" });
    // a second end (the shell's own close) does not report twice
    sessions.close(opened.id, "pr_owner");
    expect(ended).toHaveLength(1);
    sessions.stop();
  });

  it("marks the card ended and folded on the message, with the output (secrets redacted)", () => {
    const messages: Message[] = [
      { id: "m1", at: 1, role: "bot", kind: "text", text: "", terminalEmbed: { sessionId: "s1", provider: "sandbox", resourceId: "mine", label: "Cloud", status: "live", openedAt: 1_000 } } as unknown as Message,
    ];
    const patches: Array<{ id: string; patch: Partial<Message> }> = [];
    const store = {
      messagesFor: () => messages,
      patchMessage: (_thread: string, id: string, patch: Partial<Message>) => { patches.push({ id, patch }); },
    };
    foldEndedTerminalCard(store as never, {
      id: "s1", threadId: "t1", botId: "b1", principalId: "pr_owner", endedReason: "closed", openedAt: 1_000, endedAt: 61_000,
      output: "\u001b[32m$ echo ok\u001b[0m\r\nok\r\nghp_abcdefghijklmnopqrstuvwxyz0123456789\r\n",
    } as TerminalSessionEnded);
    expect(patches).toHaveLength(1);
    const embed = patches[0]!.patch.terminalEmbed!;
    expect(embed).toMatchObject({ sessionId: "s1", status: "ended", endedReason: "closed", openedAt: 1_000, endedAt: 61_000, collapsed: true });
    expect(embed.transcript).toContain("$ echo ok\nok");
    expect(embed.transcript).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz0123456789");
    // another session's end touches nothing
    foldEndedTerminalCard(store as never, { id: "other", threadId: "t1", output: "" } as TerminalSessionEnded);
    expect(patches).toHaveLength(1);
  });
});
