import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { Bot, InstanceInfo } from "@/state/store";
import type { ApprovalModeSelector } from "./ApprovalModeSelector";
import type { ModelPicker } from "./ModelPicker";
import { CODEX_USAGE_LIMIT_REACHED, CODEX_USAGE_URL } from "../../shared/codex-usage-limit";
import { failedTurnTool } from "../../shared/failed-turn";

const fixture = vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  return { dispatch: vi.fn(), canWrite: null as boolean | null, showToolCalls: false, platform: "other", localReasonCode: "cua-driver-unavailable", localMessage: "", model: null as ComponentProps<typeof ModelPicker> | null,
    approval: null as ComponentProps<typeof ApprovalModeSelector> | null };
});
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({
    state: { ...original.initialState, config: fixture.showToolCalls ? { features: { showToolCalls: true } } : null,
      instances: [{ instanceId: "test", driverKind: "codex", displayName: "Test" } as InstanceInfo] },
    dispatch: fixture.dispatch,
  }) };
});
// The real useCaptionChrome rides along: it only asks this module for the
// window chrome, and these tests render the desktop-neutral layout.
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: fixture.platform }, localComputer: { available: false, reasonCode: fixture.localReasonCode, message: fixture.localMessage } }, ready: true }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/cloud-guest", () => ({ useCanWriteIn: () => fixture.canWrite }));
vi.mock("./CitationUI", async (importOriginal) => ({
  ...await importOriginal<typeof import("./CitationUI")>(),
  CitationSelectionToolbar: () => createElement("span", { "data-testid": "citation-toolbar" }),
}));
vi.mock("./ModelPicker", () => ({ ModelPicker: (props: ComponentProps<typeof ModelPicker>) => {
  fixture.model = props;
  return createElement("span", { "data-test-model-control": true });
} }));
vi.mock("./ApprovalModeSelector", () => ({ ApprovalModeSelector: (props: ComponentProps<typeof ApprovalModeSelector>) => {
  fixture.approval = props;
  return createElement("span", { "data-test-approval-control": true });
} }));

// The + menu opens on a click; rendered statically here with its items and
// rows laid out, so the rows it holds (approval level, workspace) are seen.
vi.mock("./ComposerControls", async (importOriginal) => {
  const original = await importOriginal<typeof import("./ComposerControls")>();
  return { ...original, ComposerPlusMenu: (props: ComponentProps<typeof original.ComposerPlusMenu>) => createElement("div", { "data-test-plus-menu": true },
    ...props.items.map((item) => createElement("button", { key: item.id, "data-composer-plus-item": item.id }, item.label)),
    props.rows?.(() => {})) };
});

const { ChatView, ErrorRow, FailedTurnRow, NewConversationInstead, claudeUpdateTarget } = await import("./ChatView");
const { setAdvancedMode } = await import("@/lib/interface-mode");
const { activityPreview } = await import("@/lib/failed-turn");
afterAll(() => vi.unstubAllGlobals());

const bot: Bot = {
  id: "bot", threadId: "selected", name: "Pepper", title: "", description: "", color: "green",
  notifications: true, unread: false, busy: true, messages: [],
  modelSelection: { instanceId: "test", model: "profile-default" },
  tasks: [{ threadId: "selected", title: "Selected", createdAt: 1, busy: false, activity: "idle",
    modelSelection: { instanceId: "test", model: "thread-model" }, approvalMode: "ask" }],
};

describe("thread control placement", () => {
  it("keeps the composer enabled on the open thread while a routine runs elsewhere", () => {
    const routineBusy: Bot = {
      ...bot,
      busy: true,
      activity: "working",
      tasks: [
        { threadId: "selected", title: "Selected", createdAt: 1, busy: false, activity: "idle",
          modelSelection: { instanceId: "test", model: "thread-model" }, approvalMode: "ask" },
        { threadId: "routine", title: "Dispatch", createdAt: 2, busy: true, activity: "working", unread: false, routineRunId: "run-1" },
      ],
    };
    const markup = renderToStaticMarkup(createElement(ChatView, { bot: routineBusy }));
    expect(markup).toMatch(/<textarea[^>]*(?![^>]*disabled)[^>]*>/);
    expect(markup).not.toMatch(/<textarea[^>]*disabled=""[^>]*aria-busy="true"/);
  });

  it("keeps the composer inert until the deleted thread's replacement transcript arrives", () => {
    const markup = renderToStaticMarkup(createElement(ChatView, { bot: { ...bot, awaitingThreadSnapshot: true } }));
    expect(markup).toMatch(/<textarea[^>]*disabled=""[^>]*aria-busy="true"/);
    expect(markup).not.toContain("Finish group setup");
  });
  // JC, 2026-10-08: one chat bar for both modes, Advanced's. JC, 2026-10-18:
  // no place row at all, the bot picks where each task runs.
  it("renders the same composer row in Simple and Advanced mode, with no place row", () => {
    const composerOf = (advanced: boolean) => {
      setAdvancedMode(advanced);
      fixture.approval = null;
      const markup = renderToStaticMarkup(createElement(ChatView, { bot: { ...bot, busy: false } }));
      const props = fixture.approval;
      const start = markup.indexOf('data-tour="composer"');
      const end = markup.indexOf('data-testid="citation-toolbar"');
      expect(start).toBeGreaterThan(-1);
      expect(end).toBeGreaterThan(start);
      return { row: markup.slice(start, end), props };
    };
    try {
      const simple = composerOf(false);
      const advanced = composerOf(true);
      expect(simple.row).not.toContain('data-testid="place-chip"');
      expect(advanced.row).not.toContain('data-testid="place-chip"');
      expect(advanced.row).toBe(simple.row);
      // the approval level lives in the bot's settings, not in the composer
      expect(simple.props).toBeNull();
      expect(advanced.props).toBeNull();
      // one + (attach files), the message field, then the headless model picker
      const row = simple.row;
      expect(row).not.toContain("data-composer-approval");
      expect(row).not.toContain("data-test-approval-control");
      expect(row).not.toContain('aria-label="Attach a file"');
      expect(row.indexOf('data-composer-plus-item="attach"')).toBeGreaterThan(-1);
      expect(row.indexOf("data-test-model-control")).toBeGreaterThan(row.indexOf("data-composer-actions"));
    } finally {
      setAdvancedMode(false);
    }
  });

  it("shows no place row even for a conversation an older build pinned", () => {
    setAdvancedMode(true);
    try {
      const pinned: Bot = { ...bot, busy: false, tasks: [{ ...bot.tasks![0]!, surface: "local" }] };
      expect(renderToStaticMarkup(createElement(ChatView, { bot: pinned }))).not.toContain('data-testid="place-chip"');
    } finally {
      setAdvancedMode(false);
    }
  });

  it("explains provider safety errors without offering an ineffective Retry", () => {
    const markup = renderToStaticMarkup(createElement(ErrorRow, { message: "Blocked by our safety systems", onRetry: () => {} }));
    expect(markup).toContain("Full access controls tool approvals, not provider safety checks");
    expect(markup).not.toContain("<button");
    expect(renderToStaticMarkup(createElement(ErrorRow, { message: "Network timeout", onRetry: () => {} }))).toContain("<button");
  });
  it("draws Retry and the next action on the 28px control step", () => {
    const retry = renderToStaticMarkup(createElement(ErrorRow, { message: "Network timeout", onRetry: () => {} }));
    const action = renderToStaticMarkup(createElement(ErrorRow, { message: "Network timeout", action: { label: "Open", onClick: () => {} } }));
    for (const markup of [retry, action]) {
      expect(markup).toContain('class="ui-button ui-button-md ');
      expect(markup).not.toContain("text-[12.5px]");
    }
  });
  it("directs ChatGPT plan limits to usage settings rather than repeatedly retrying", () => {
    const markup = renderToStaticMarkup(createElement(ErrorRow, { message: "ChatGPT plan usage limit reached (subscription_sharing_usage_limit_exceeded)", onRetry: () => {} }));
    expect(markup).toContain("Manage usage");
    expect(markup).toContain("https://chatgpt.com/settings/usage");
    expect(markup).not.toContain(">Retry<");
  });
  it("sends a Codex usage limit to the account's Codex usage page, not Retry", () => {
    const codex = { instanceId: "codex", driverKind: "codex", displayName: "Codex", snapshot: { state: "available", authenticated: true } } as unknown as InstanceInfo;
    const limit = `${CODEX_USAGE_LIMIT_REACHED} This is OpenAI's limit, not your Sagax plan. It resets at 5:23 PM (UTC).`;
    const markup = renderToStaticMarkup(createElement(FailedTurnRow, { tool: failedTurnTool(limit), engine: codex, onRetry: () => {} }));
    expect(markup).toContain(limit.replaceAll("'", "&#x27;"));
    expect(markup).toContain(`href="${CODEX_USAGE_URL}"`);
    expect(markup).toContain("Manage usage");
    expect(markup).not.toContain("<button");
  });
  it("opens a signed-out engine's failed turn with only the sign-in card", () => {
    const claude = {
      instanceId: "claude", driverKind: "claudeAgent", displayName: "Claude",
      snapshot: { state: "available", authenticated: false },
      install: { command: { darwin: "x", linux: "x", win32: "x" }, signInCommand: "claude /login", server: { package: "@anthropic-ai/claude-code" } },
      authentication: { method: "paste-code" },
      models: { default: "sonnet", options: [] },
    } as InstanceInfo;
    const markup = renderToStaticMarkup(createElement(FailedTurnRow, { tool: { name: "error: Not logged in · Please run /login", ok: false, setup: true }, engine: claude, onRetry: () => {} }));
    expect(markup).not.toContain("isn&#x27;t signed in yet");
    // the minimal engine card (#160): one Connect button
    expect(markup).toContain("Connect Claude</button>");
    // the only disclosure is the terminal command behind the card (#386),
    // never an error's Details
    expect(markup.match(/<details/g)).toHaveLength(1);
    expect(markup).toContain("<details data-manual-command");
    expect(markup).not.toContain("Not logged in");
    expect(markup).not.toContain(">Retry<");
    // a generic failure keeps the row
    const generic = renderToStaticMarkup(createElement(FailedTurnRow, { tool: { name: "error: Network timeout", ok: false }, engine: claude, onRetry: () => {} }));
    expect(generic).toContain("Network timeout");
    expect(generic).toContain("Retry</button>");
    // an update offer is not a sign-in: the row keeps the engine's words,
    // on a company-managed Claude too (chat cannot update it, so no offer
    // shows, but the row is still about the update, as the list says)
    const update = { name: "error: Claude Code 2.1.268 does not support this model", ok: false, setup: true, claudeUpdate: true };
    for (const engine of [claude, { ...claude, readOnly: true }]) {
      const row = renderToStaticMarkup(createElement(FailedTurnRow, { tool: update, engine }));
      expect(row).toContain(">Claude Code 2.1.268 does not support this model</span>");
      expect(row).not.toContain("isn&#x27;t signed in");
      expect(activityPreview(update, engine)).toBe("Claude Code 2.1.268 does not support this model");
    }
  });
  it("opens a failed turn with a technical cause on one plain line, the engine's words under Details", () => {
    const raw = 'API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}';
    const markup = renderToStaticMarkup(createElement(FailedTurnRow, { tool: { name: `error: ${raw}`, ok: false }, engine: undefined, onRetry: () => {} }));
    expect(markup).toContain(">The service is busy right now. Try again in a moment.</span>");
    expect(markup).toMatch(/<summary[^>]*>Details<\/summary><p[^>]*>API Error: 529/);
    expect(markup).toContain(" Retry</button>");
    // a cause already written for a person stays the headline, with nothing to expand
    const plain = renderToStaticMarkup(createElement(FailedTurnRow, { tool: { name: "error: no activity for 10 minutes — the turn was stopped", ok: false }, engine: undefined }));
    expect(plain).toContain(">no activity for 10 minutes — the turn was stopped</span>");
    expect(plain).not.toContain(">Details</summary>");
  });
  it("offers to update Claude Code for a too-old install, or hands over the command", () => {
    const claude = { instanceId: "claude", driverKind: "claudeAgent", displayName: "Claude", snapshot: { state: "available", authenticated: true } } as InstanceInfo;
    const markup = renderToStaticMarkup(createElement(ErrorRow, {
      message: "API Error: 400 Claude Code 2.1.268 does not support this model; version 2.1.280 or newer is required.",
      onRetry: () => {},
      setupInstance: claude,
      claudeUpdateInstance: claude,
    }));
    expect(markup).toContain("Update Claude for me");
    expect(markup).toContain("I&#x27;ll do it myself");
    // the offer replaces the plain Retry until they pick a path
    expect(markup).not.toContain(">Retry<");
  });
  it("updates only a local Claude Code engine from chat", () => {
    const claude = { instanceId: "claude", driverKind: "claudeAgent", displayName: "Claude" } as InstanceInfo;
    expect(claudeUpdateTarget(claude)).toBe(claude);
    expect(claudeUpdateTarget({ ...claude, readOnly: true })).toBeUndefined();
    expect(claudeUpdateTarget({ ...claude, driverKind: "codex" })).toBeUndefined();
    expect(claudeUpdateTarget(undefined)).toBeUndefined();
  });
  it("keeps Retry on the last failed turn after its digest, but never on an older turn", () => {
    const messages: Bot["messages"] = [
      { id: "ask", role: "user", kind: "text", at: 1, text: "Try the new model" },
      { id: "error", role: "bot", kind: "activity", at: 2, tool: { name: "error: outdated engine", ok: false } },
      { id: "digest", role: "bot", kind: "digest", at: 3, text: "no tool activity" },
    ];
    const render = () => renderToStaticMarkup(createElement(ChatView, { bot: { ...bot, busy: false, messages } }));
    expect(render()).toContain("Retry</button>");
    messages.push({ id: "next", role: "user", kind: "text", at: 4, text: "A different request" });
    expect(render()).not.toContain("Retry</button>");
  });
  it("keeps Retry on a failed turn after hanging up, when the call's record is the last row", () => {
    const messages: Bot["messages"] = [
      { id: "ask", role: "user", kind: "text", at: 1, text: "Try the new model", via: "call", callId: "c1" },
      { id: "error", role: "bot", kind: "activity", at: 2, tool: { name: "error: outdated engine", ok: false } },
      {
        id: "record", role: "bot", kind: "call", at: 3, text: "Call with Pepper · 0:42",
        call: { callId: "c1", botId: "bot", client: "ios", startedAt: 0, endedAt: 3, seconds: 42, endReason: "hung-up" },
      },
    ];
    const render = () => renderToStaticMarkup(createElement(ChatView, { bot: { ...bot, busy: false, messages } }));
    expect(render()).toContain("Retry</button>");
    expect(render()).toContain('data-testid="call-record"');
    messages.push({ id: "next", role: "user", kind: "text", at: 4, text: "A different request" });
    expect(render()).not.toContain("Retry</button>");
  });
  it.each([false, true])("keeps recovery visible and outside tool folds when tool calls are %s", (showToolCalls) => {
    fixture.showToolCalls = showToolCalls;
    const explanation = "Automatic recovery: Qwen could not start. Trying Backup · fixture-model once in this thread.";
    const messages: Bot["messages"] = [
      { id: "read", role: "bot", kind: "activity", at: 1, tool: { name: "Read", ok: true } },
      { id: "edit", role: "bot", kind: "activity", at: 2, tool: { name: "Edit", ok: true } },
      { id: "recovery", role: "bot", kind: "activity", at: 3, tool: { name: `recovery: ${explanation}`, ok: true } },
      { id: "bash", role: "bot", kind: "activity", at: 4, tool: { name: "Bash", ok: true } },
      { id: "write", role: "bot", kind: "activity", at: 5, tool: { name: "Write", ok: true } },
    ];
    try {
      const markup = renderToStaticMarkup(createElement(ChatView, { bot: { ...bot, busy: false, messages } }));
      expect(markup).toContain('data-mid="recovery"><div role="status"');
      expect(markup).toContain(explanation);
      expect(markup).not.toContain(`recovery: ${explanation}`);
      expect(markup.match(/Automatic recovery:/g)).toHaveLength(1);
      if (!showToolCalls) expect(markup).not.toContain('data-testid="tool-activity"');
    } finally {
      fixture.showToolCalls = false;
    }
  });
  // A bot saved on a retired model runs another one; with Tool calls off
  // (the default) the notice saying so was dropped with the tool steps.
  it.each([false, true])("shows a model notice as a status row when tool calls are %s", (showToolCalls) => {
    fixture.showToolCalls = showToolCalls;
    const explanation = "OpenCode no longer offers opencode/x-preview-f-free, so this conversation uses opencode/big-pickle.";
    const messages: Bot["messages"] = [
      { id: "read", role: "bot", kind: "activity", at: 1, tool: { name: "Read", ok: true } },
      { id: "notice", role: "bot", kind: "activity", at: 2, tool: { name: `notice: ${explanation}`, ok: true } },
      { id: "bash", role: "bot", kind: "activity", at: 3, tool: { name: "Bash", ok: true } },
      { id: "reply", role: "bot", kind: "text", at: 4, text: "ok" },
    ];
    try {
      const markup = renderToStaticMarkup(createElement(ChatView, { bot: { ...bot, busy: false, messages } }));
      expect(markup).toContain('data-mid="notice"><div role="status"');
      expect(markup.match(/no longer offers/g)).toHaveLength(1);
      expect(markup).not.toContain(`notice: ${explanation}`);
      if (!showToolCalls) expect(markup).not.toContain('data-testid="tool-activity"');
    } finally {
      fixture.showToolCalls = false;
    }
  });

  it("hides tool-call chips on iOS even when the server flag is on", () => {
    fixture.showToolCalls = true;
    const previous = globalThis.navigator;
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      maxTouchPoints: 5,
    });
    const messages: Bot["messages"] = [
      { id: "ok", role: "bot", kind: "activity", at: 1, tool: { name: "Read", ok: true } },
      { id: "run", role: "bot", kind: "activity", at: 2, tool: { name: "Bash" } },
      { id: "bad", role: "bot", kind: "activity", at: 3, tool: { name: "Write", ok: false } },
      { id: "notice", role: "bot", kind: "activity", at: 4, tool: { name: "notice: waiting on the model", ok: true } },
      { id: "err", role: "bot", kind: "activity", at: 5, tool: { name: "error: boom", ok: false } },
      { id: "comm", role: "bot", kind: "activity", at: 6, tool: { name: "Messaged @Ada" }, comm: { groupId: "g", withBotId: "ada", withName: "Ada", withColor: "teal" } },
      { id: "ask", role: "bot", kind: "options", at: 7, card: { title: "Approval needed", subtitle: "ls", options: ["Allow", "Deny"], requestId: "r-ask", tool: "Bash" } },
      { id: "file", role: "user", kind: "text", at: 8, text: "please\n<attached-file path=\"/store/123e4567-e89b-42d3-a456-426614174000.json\" name=\"a.json\" />" },
      { id: "reply", role: "bot", kind: "text", at: 9, text: "done" },
    ];
    try {
      const markup = renderToStaticMarkup(createElement(ChatView, { bot: { ...bot, busy: false, messages } }));
      expect(markup).not.toContain('data-testid="tool-activity"');
      expect(markup).not.toContain('data-mid="ok"');
      expect(markup).not.toContain('data-mid="run"');
      expect(markup).not.toContain('data-mid="bad"');
      expect(markup).toContain('data-mid="notice"');
      expect(markup).toContain("waiting on the model");
      expect(markup).toContain("boom");
      expect(markup).toContain("Messaged @Ada");
      expect(markup).toContain("Allow once");
      expect(markup).toContain("run a command");
      expect(markup).toContain("a.json");
      expect(markup).toContain("done");
    } finally {
      fixture.showToolCalls = false;
      vi.stubGlobal("navigator", previous ?? { userAgent: "", maxTouchPoints: 0 });
    }
  });

  it("still shows tool-call chips in Electron when the flag is on", () => {
    fixture.showToolCalls = true;
    window.ogb = { platform: "darwin" } as unknown as NonNullable<Window["ogb"]>;
    const previous = globalThis.navigator;
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
      maxTouchPoints: 5,
    });
    try {
      const markup = renderToStaticMarkup(createElement(ChatView, {
        bot: { ...bot, busy: false, messages: [{ id: "ok", role: "bot", kind: "activity", at: 1, tool: { name: "Read", ok: true } }] },
      }));
      expect(markup).toContain('data-testid="tool-activity"');
      expect(markup).toContain("Read");
    } finally {
      fixture.showToolCalls = false;
      delete window.ogb;
      vi.stubGlobal("navigator", previous ?? { userAgent: "", maxTouchPoints: 0 });
    }
  });

  it("offers the matching macOS Settings and relaunch actions only for a named CUA permission failure", () => {
    fixture.platform = "darwin";
    fixture.localMessage = "Screen Recording required";
    window.ogb = { platform: "darwin", permOpenSettings: vi.fn(), relaunch: vi.fn() } as unknown as NonNullable<Window["ogb"]>;
    const screen = renderToStaticMarkup(createElement(ErrorRow, {
      message: "CUA Driver is not ready for this computer — embedded host failed: Screen Recording required. Relaunch Sagax after granting any missing macOS permission.",
    }));
    expect(screen).toContain("Open Screen Recording Settings");
    expect(screen).toContain("Relaunch Sagax");
    expect(screen).not.toContain("Open Accessibility Settings");
    fixture.localMessage = "Accessibility required";
    const accessibility = renderToStaticMarkup(createElement(ErrorRow, {
      message: "CUA Driver is not ready for this computer — Accessibility required",
    }));
    expect(accessibility).toContain("Open Accessibility Settings");
    expect(accessibility).not.toContain("Open Screen Recording Settings");
    expect(renderToStaticMarkup(createElement(ErrorRow, {
      message: "CUA Driver is not ready for this computer — Screen Recording required",
    }))).not.toContain("Open Screen Recording Settings");
    expect(renderToStaticMarkup(createElement(ErrorRow, { message: "Network timeout" }))).not.toContain("Open Screen Recording Settings");
    fixture.localReasonCode = "remote-server";
    expect(renderToStaticMarkup(createElement(ErrorRow, { message: "CUA Driver is not ready for this computer — Screen Recording required" }))).not.toContain("Open Screen Recording Settings");
    fixture.localReasonCode = "cua-driver-unavailable";
    fixture.platform = "other";
    fixture.localMessage = "";
    delete window.ogb;
  });
  it.each([
    "شغّل الاختبارات\nThen run typecheck\nوبعدها ارفع الفرع",
    "שלום עולם\nThen run typecheck\nתודה רבה",
    `${"مرحبا\n".repeat(10)}Then run typecheck`,
  ])("applies per-line direction to the actual user text, including collapsed messages", (text) => {
    const markup = renderToStaticMarkup(createElement(ChatView, { bot: {
      ...bot,
      messages: [{ id: "mixed-script", role: "user", kind: "text", at: 1, text }],
    } }));
    // unicode-bidi does not inherit: setting it on the bubble leaves this
    // inner text block LTR. Keep the class directly on the node with prose.
    expect(markup).toMatch(/<div class="chat-text[^"]*"[^>]*>(?:شغّل|שלום|مرحبا)/);
    expect(markup).not.toMatch(/class="[^"]*chat-text[^"\n]*bg-bubble-user/);
  });

  it("marks the Primary Bot with the orange star on the header avatar, not a label chip", () => {
    const markup = renderToStaticMarkup(createElement(ChatView, { bot: { ...bot, busy: false, chiefOfStaff: true } }));
    expect(markup).toContain('data-testid="primary-bot-badge"');
    expect(markup).not.toContain("lucide-crown");
    expect(markup).not.toContain("Chief of Staff");
    expect(renderToStaticMarkup(createElement(ChatView, { bot: { ...bot, busy: false } }))).not.toContain("primary-bot-badge");
  });

  it("keeps the selected thread's model in the composer, and no approval control there", () => {
    const markup = renderToStaticMarkup(createElement(ChatView, { bot }));
    expect(markup.match(/data-test-model-control/g)).toHaveLength(1);
    expect(markup.indexOf("data-test-model-control")).toBeGreaterThan(markup.indexOf('data-tour="composer"'));
    expect(markup.indexOf('data-tour="composer"')).toBeGreaterThan(-1);
    expect(markup).not.toContain("data-test-approval-control");
    expect(markup).not.toContain('aria-label="Thread settings"');
    expect(fixture.model).toMatchObject({ threadId: "selected", bot: { busy: false, modelSelection: { model: "thread-model" } } });
  });

  it("keeps both controls hidden for remote clients", () => {
    window.ogb = { remoteClient: { active: true } } as NonNullable<Window["ogb"]>;
    const markup = renderToStaticMarkup(createElement(ChatView, { bot }));
    expect(markup).not.toContain("data-test-model-control");
    expect(markup).not.toContain("data-test-approval-control");
    delete window.ogb;
  });
});

// A polite live region on the whole transcript re-reads every change: the
// ticking "Thinking 3s", each activity label, every chip. The log stays a
// landmark people can browse, and one quiet status line speaks when a
// reply is done or an approval is waiting.
describe("screen reader announcements", () => {
  it("keeps the transcript log out of live announcements", () => {
    const markup = renderToStaticMarkup(createElement(ChatView, { bot }));
    expect(markup).toMatch(/role="log" aria-live="off" aria-label="Conversation with Pepper"/);
  });

  it("announces the working line once, never its rotating phrase", async () => {
    const { TurnPresence } = await import("./TurnPresence");
    const markup = renderToStaticMarkup(createElement(TurnPresence, { bot: { name: "Pepper", color: "blue" }, visible: true, label: "Running a command" }));
    expect(markup).toContain("Running a command");
    expect(markup).toMatch(/role="status" aria-live="polite"[^>]*><span class="sr-only">Pepper is thinking<\/span>/);
    expect(markup).not.toMatch(/thinking-shimmer[^"]*" aria-live/);
    expect(markup).toMatch(/<span aria-hidden="true" class="flex items-baseline"><span data-presence-phrase=""/);
  });

  it("renders one visually hidden status line for finished replies", () => {
    const markup = renderToStaticMarkup(createElement(ChatView, { bot }));
    expect(markup.match(/data-testid="transcript-announcer"/g)).toHaveLength(1);
    expect(markup).toMatch(/<p role="status" aria-live="polite" aria-atomic="true" class="sr-only" data-testid="transcript-announcer">/);
  });
});

// On an OMB Cloud home a guest writes only in conversations it opened: in
// any other, one button starts its own instead of a send that fails.
describe("a guest's composer on a Cloud home", () => {
  it("offers a new conversation in one click, with no dialog", () => {
    const onNew = vi.fn();
    const markup = renderToStaticMarkup(createElement(NewConversationInstead, { onNew }));
    expect(markup).toContain("You can only write in conversations you started on this Cloud.");
    expect(markup).toContain(">New conversation<");
    expect(markup).not.toContain("<textarea");
    const tree = NewConversationInstead({ onNew }) as { props: { children: Array<{ type: string; props: { onClick?: () => void } }> } };
    tree.props.children.find((child) => child.type === "button")!.props.onClick!();
    expect(onNew).toHaveBeenCalledOnce();
  });

  it("takes the composer's place only where the device may not write", () => {
    fixture.canWrite = false;
    const refused = renderToStaticMarkup(createElement(ChatView, { bot }));
    expect(refused).toContain('data-testid="cloud-guest-composer"');
    expect(refused).not.toContain("<textarea");
    expect(refused).not.toContain('data-testid="citation-toolbar"');
    fixture.canWrite = true;
    const allowed = renderToStaticMarkup(createElement(ChatView, { bot }));
    expect(allowed).not.toContain('data-testid="cloud-guest-composer"');
    expect(allowed).toContain("<textarea");
    expect(allowed).toContain('data-testid="citation-toolbar"');
    fixture.canWrite = null;
  });
});

const { awayFromMainThread, openBot } = await import("@/state/store");

// Sagax shows the way back as ThreadsOffReturnLink in the banner stack, not
// upstream's header button; the rule under it is the store's.
describe("the way back to the bot's own conversation", () => {
  const visiting: Bot = {
    ...bot, threadId: "side", mainThreadId: "main",
    tasks: [
      { threadId: "main", title: "Our chat", createdAt: 1, busy: false, activity: "idle" },
      // a thread the bot opened: outside the single stream, a visit
      { threadId: "side", title: "Routine report", createdAt: 2, busy: false, activity: "idle", openedBy: { botId: bot.id, name: bot.name, at: 2 } },
    ],
  };

  it("is offered with threads hidden while a side thread is open, and opens the main thread", () => {
    expect(awayFromMainThread(visiting, false)).toBe(true);
    fixture.dispatch.mockReset();
    openBot(fixture.dispatch, visiting, false);
    expect(fixture.dispatch.mock.calls.map(([action]) => action)).toContainEqual(expect.objectContaining({ threadId: "main" }));
  });

  it("never with threads shown, nor in the main thread itself", () => {
    expect(awayFromMainThread(visiting, true)).toBe(false);
    expect(awayFromMainThread({ ...visiting, threadId: "main" }, false)).toBe(false);
  });
});
