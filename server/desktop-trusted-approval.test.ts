import { describe, expect, it } from "vitest";
import { createHandleDesktopTrustedApprovalMessage } from "./desktop-trusted-approval.ts";

describe("createHandleDesktopTrustedApprovalMessage", () => {
  it("returns false for non-object payloads", () => {
    const handle = createHandleDesktopTrustedApprovalMessage(() => ({
      store: { bot: () => null, tasks: () => [], patchBot: () => null, projectBotForTask: () => null },
      registry: { cliTarget: () => null },
      threadBusy: () => false,
      supportsApprovalMode: () => true,
    }));
    expect(handle(null)).toBe(false);
    expect(handle("x")).toBe(false);
    expect(handle(1)).toBe(false);
  });

  it("returns false for unknown message types", () => {
    const handle = createHandleDesktopTrustedApprovalMessage(() => ({
      store: { bot: () => null, tasks: () => [], patchBot: () => null, projectBotForTask: () => null },
      registry: { cliTarget: () => null },
      threadBusy: () => false,
      supportsApprovalMode: () => true,
    }));
    expect(handle({ type: "not-a-trusted-approval" })).toBe(false);
  });
});

const REQUEST_ID = "123e4567-e89b-42d3-a456-426614174000";

type Task = { threadId: string; approvalMode?: string; approvalOwn?: string; busy?: boolean };
type Bot = { id: string; approvalMode: string; autoApprove?: boolean; computer?: string; modelSelection: { instanceId: string }; tasks: Task[]; approvalGrant?: unknown };

/** The host surface the private-channel handler reads, over one bot. */
function fixture(bot: Bot, { unsupported = new Set<string>() } = {}) {
  const posted: Record<string, unknown>[] = [];
  const writes: string[] = [];
  const host = {
    isApprovalMode: (value: unknown) => ["ask", "edits", "auto", "full", "custom"].includes(value as string),
    memberOwnedInOrg: () => false,
    approvalModeFor: (record: Bot) => record.approvalMode,
    everyThreadMode: (record: Bot) => [record.approvalMode, ...record.tasks.map((task) => task.approvalMode ?? record.approvalMode)],
    memberAutoRefused: () => false,
    approvalModeStepUpGate: () => false,
    localPrincipalId: () => "local",
    threadBusy: (_botId: string, threadId: string) => Boolean(bot.tasks.find((task) => task.threadId === threadId)?.busy),
    supportsApprovalMode: (selection: { instanceId: string } | undefined, mode: string) => !unsupported.has(`${selection?.instanceId}:${mode}`),
    wireTrustedApprovalBot: (record: Bot) => structuredClone(record),
    wireBot: (record: Bot) => structuredClone(record),
    postDesktopPrivateMessage: (message: Record<string, unknown>) => { posted.push(message); },
    store: {
      bot: (id: string) => (id === bot.id ? bot : null),
      tasks: () => bot.tasks,
      setAllThreadApprovalMode: (_id: string, mode: string) => {
        writes.push(mode);
        Object.assign(bot, { approvalMode: mode, autoApprove: mode === "auto", approvalGrant: undefined });
        bot.tasks = bot.tasks.map(({ approvalMode: _mode, approvalOwn: _own, ...task }) => task);
        return bot;
      },
    },
  };
  const handle = createHandleDesktopTrustedApprovalMessage(() => host);
  return { handle, posted, writes };
}

const claudeBot = (): Bot => ({
  id: "bot-1", approvalMode: "custom", modelSelection: { instanceId: "claude" },
  tasks: [{ threadId: "first" }, { threadId: "rules", approvalOwn: "thread", approvalMode: "custom" }],
});

describe("all-thread Auto and Edits over the private desktop channel (#3568)", () => {
  // Before the fix this branch answered "Invalid all-threads approval scope":
  // a team-wide level could not leave Custom in the desktop app.
  for (const mode of ["auto", "edits"] as const) {
    it(`sets ${mode} on the bot and every thread in one write, with no grant phases`, () => {
      const bot = claudeBot();
      const { handle, posted, writes } = fixture(bot);
      expect(handle({ type: "approval-trusted-mode-set", requestId: REQUEST_ID, botId: "bot-1", mode, allThreads: true })).toBe(true);
      expect(writes).toEqual([mode]);
      expect(posted).toHaveLength(1);
      expect(posted[0]).toMatchObject({ type: "approval-trusted-mode-result", requestId: REQUEST_ID, ok: true, bot: { id: "bot-1", approvalMode: mode } });
      expect(bot.approvalGrant).toBeUndefined();
      expect(bot.tasks.every((task) => task.approvalMode === undefined && task.approvalOwn === undefined)).toBe(true);
    });
  }

  it("still refuses Custom on every thread", () => {
    const { handle, posted, writes } = fixture(claudeBot());
    handle({ type: "approval-trusted-mode-set", requestId: REQUEST_ID, botId: "bot-1", mode: "custom", allThreads: true });
    expect(writes).toEqual([]);
    expect(posted[0]).toMatchObject({ ok: false, error: "Invalid all-threads approval scope" });
  });

  it("leaves the bot alone while one of its threads runs a turn", () => {
    const bot = claudeBot();
    bot.tasks[0].busy = true;
    const { handle, posted, writes } = fixture(bot);
    handle({ type: "approval-trusted-mode-set", requestId: REQUEST_ID, botId: "bot-1", mode: "auto", allThreads: true });
    expect(writes).toEqual([]);
    expect(posted[0]).toMatchObject({ ok: false });
  });

  it("asks the local Auto warning first, like the bot-wide change", () => {
    const bot = { ...claudeBot(), computer: "local" };
    const { handle, posted, writes } = fixture(bot);
    handle({ type: "approval-trusted-mode-set", requestId: REQUEST_ID, botId: "bot-1", mode: "auto", allThreads: true });
    expect(writes).toEqual([]);
    expect(posted[0]).toMatchObject({ ok: false, error: "Auto mode on this computer requires confirming the warning" });
    handle({ type: "approval-trusted-mode-set", requestId: REQUEST_ID, botId: "bot-1", mode: "auto", allThreads: true, acknowledgeLocalAuto: true });
    expect(writes).toEqual(["auto"]);
  });
});
