// The dev pods live only in a coding window (#2149, JC 2026-11-06): the
// normal chat is the same markup with the Experimental switch on or off.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { Bot, InstanceInfo, Message } from "@/state/store";

vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
});
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({
    state: { ...original.initialState, config: null, instances: [{ instanceId: "test", driverKind: "codex", displayName: "Test" } as InstanceInfo] },
    dispatch: vi.fn(),
  }) };
});
vi.mock("../DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("../DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "other" }, localComputer: { available: false, reasonCode: "cua-driver-unavailable", message: "" } }, ready: true }),
}));
// The composer's own pickers are not what this test is about.
vi.mock("../ModelPicker", () => ({ ModelPicker: () => createElement("span", { "data-test-model-control": true }) }));
vi.mock("../ApprovalModeSelector", () => ({ ApprovalModeSelector: () => createElement("span", { "data-test-approval-control": true }) }));
vi.mock("../CitationUI", async (importOriginal) => ({
  ...await importOriginal<typeof import("../CitationUI")>(),
  CitationSelectionToolbar: () => createElement("span", { "data-testid": "citation-toolbar" }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/cloud-guest", () => ({ useCanWriteIn: () => null }));
vi.mock("@/lib/perspicax-org", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/perspicax-org")>(), usePerspicaxOrg: () => null }));
vi.mock("@/lib/mcp-servers", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/mcp-servers")>(),
  useMcpServers: () => ({ servers: [], error: false, refresh: async () => [] }),
}));

const { ChatView } = await import("../ChatView");
const { DEFAULT_PREFS, resetDevPodPrefsForTest } = await import("./prefs");
afterAll(() => vi.unstubAllGlobals());

let seq = 0;
const tool = (name: string, summary: string, output = ""): Message => ({ id: `m${++seq}`, role: "bot", kind: "activity", at: seq, tool: { name, ok: true, summary, output } });
const messages: Message[] = [
  { id: "u1", role: "user", kind: "text", text: "fix the login and open a PR", at: 1 },
  tool("Edit", "src/lib/auth.ts"),
  tool("Bash", "git commit -m \"Fix login\"", "[feat/login 1a2b3c4] Fix login"),
  tool("Bash", "gh pr create --title \"Fix login\"", "https://github.com/acme/app/pull/7"),
  { id: "b1", role: "bot", kind: "text", text: "Opened https://github.com/acme/app/pull/7", at: 9 },
];
const bot = (threadId: string): Bot => ({
  id: "dev", threadId, name: "Dev", title: "", description: "", color: "green", notifications: true, unread: false, busy: false,
  messages, modelSelection: { instanceId: "test", model: "m" },
  tasks: [{ threadId, title: "T", createdAt: 1, busy: false, activity: "idle", modelSelection: { instanceId: "test", model: "m" }, approvalMode: "ask" }],
} as Bot);

/** The opening tags of the transcript's scroll pane and centered log. */
function transcriptShell(markup: string): string[] {
  const scroll = markup.match(/<div class="h-full overflow-x-hidden[^"]*"[^>]*>/)?.[0];
  const log = markup.match(/<div class="mx-auto flex w-full max-w-\[960px\][^"]*"[^>]*role="log"[^>]*>/)?.[0];
  expect(scroll, "scroll pane").toBeTruthy();
  expect(log, "transcript log").toBeTruthy();
  return [scroll!, log!];
}

describe("ChatView never shows the dev pods (#2149)", () => {
  it("draws no pods in the normal chat, the Experimental switch on or off", () => {
    resetDevPodPrefsForTest({ ...DEFAULT_PREFS, enabled: false });
    const off = renderToStaticMarkup(createElement(ChatView, { bot: bot("t-layout") }));
    expect(off).not.toContain("data-dev-pods");

    resetDevPodPrefsForTest({ ...DEFAULT_PREFS, enabled: true });
    const on = renderToStaticMarkup(createElement(ChatView, { bot: bot("t-layout") }));
    // the </> panel (Environment, Connectors, Context, Changes) and its
    // toggle live only in a coding window, never in the chat
    expect(on).not.toContain("data-dev-pods");
    expect(on).not.toContain("data-dev-pods-toggle");
    expect(transcriptShell(on)).toEqual(transcriptShell(off));
    expect(on).toBe(off);
  });
});
