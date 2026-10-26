import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/state/store", () => ({
  api: vi.fn(),
  useStore: () => ({ state: { instances: [], selectedId: "pepper" }, dispatch: vi.fn() }),
}));

import type { BotActivityDetail, BotActivityItem } from "../../../shared/bot-activity";
import { ActivityList, ActivitySection, CodeWorkList, PanelSections, panelSections, SectionHeader } from "./ActivitySection";
import { LaunchedAgentsList } from "./LaunchedAgentsList";
import type { BotLaunchedAgentItem } from "../../../shared/bot-launched-agents.ts";
import { ActivityDetailBody, ActivityDetailModal, activityViews } from "./ActivityDetailModal";
import { SETTINGS_WINDOW } from "../SettingsPrimitives";
import { ActivityListModal } from "./ActivityListModal";
import { TeammatesWorkingChip } from "../TeammatesWorkingChip";
import { activityLive, codingLive, codingWhere, codingWork, FINISHED_FADE_MS, FINISHED_LINGER_MS, formatActivityDuration, historyItems, isParallelWork, LiveActivity } from "@/lib/bot-activity";
import type { Bot } from "@/state/store";

const NOW = 1_800_000_000_000;
const running: BotActivityItem = {
  id: "thread:t1", kind: "session", botId: "pepper", botName: "Pepper", title: "Refactor the parser and split the lexer into its own module",
  status: "running", startedAt: NOW - 90_000, updatedAt: NOW, threadId: "t1", startedBy: { kind: "person", name: "Alice" }, childCount: 2,
};
const finished: BotActivityItem = { id: "run:r1", kind: "routine", botId: "pepper", title: "hourly-dispatch-board-1-si", status: "finished", startedAt: NOW - 600_000, endedAt: NOW - 540_000, updatedAt: NOW - 540_000, startedBy: { kind: "routine", name: "hourly-dispatch-board-1-si" } };
const failed: BotActivityItem = { id: "thread:t2", kind: "hop", botId: "pepper", title: "Check the build", status: "failed", startedAt: NOW - 50_000, endedAt: NOW - 40_000, updatedAt: NOW - 40_000, threadId: "t2", startedBy: { kind: "bot", name: "Echo" } };
const waiting: BotActivityItem = { ...running, id: "thread:t3", status: "waiting", childCount: undefined };

const list = (items: BotActivityItem[] | null, error = false) => renderToStaticMarkup(createElement(ActivityList, { items, error, onOpen: () => {} }));

describe("Coding list", () => {
  it("draws one rounded card per entry: icon by status, truncated title, status line, chevron", () => {
    const html = list([running, waiting, failed, finished]);
    expect(html.match(/data-activity-card=/g)).toHaveLength(4);
    expect(html).toContain('data-activity-icon="running"');
    expect(html).toContain("animate-spin");
    expect(html).toContain('data-activity-icon="waiting"');
    expect(html).toContain('data-activity-icon="failed"');
    expect(html).toContain('data-activity-icon="finished"');
    expect(html).toContain("truncate");
    expect(html).toContain("Running · 2 sub-agents");
    expect(html).toContain("Waiting for approval");
    expect(html).toContain("Failed · from Echo");
    expect(html).toContain("Finished · Routine");
    expect(html).toContain("lucide-chevron-right");
    expect(html).toContain("rounded-xl");
  });

  it("says when there is nothing, when it loads and when it failed", () => {
    expect(list([])).toContain("No coding jobs in the last 7 days.");
    expect(list(null)).toContain("Loading activity");
    expect(list(null, true)).toContain("Couldn&#x27;t load this bot&#x27;s activity.");
  });
});

const detail: BotActivityDetail = {
  ...running,
  engine: { instanceId: "claude", model: "claude-sonnet-5" },
  via: "subscription",
  payer: "speaker",
  steps: [
    { id: "s1", name: "mcp__sagax-desktop__shell", summary: "pnpm test", ok: true, at: NOW - 60_000, where: "computer" },
    { id: "s2", name: "Edit", at: NOW - 10_000, where: "server", files: ["src/lexer.ts"] },
  ],
  stepsTruncated: true,
  files: ["src/lexer.ts"],
  children: [{ id: "thread:c1", kind: "subagent", botId: "echo", botName: "Echo", title: "Write the lexer tests", status: "running", startedAt: NOW - 30_000, updatedAt: NOW - 30_000, threadId: "c1" }],
  canStop: true,
};
const body = (props: Partial<Parameters<typeof ActivityDetailBody>[0]>) => renderToStaticMarkup(createElement(ActivityDetailBody, {
  item: running, detail, error: false, now: NOW, onStop: () => {}, onOpenThread: () => {}, onOpenChild: () => {},
  engineName: (id) => (id === "claude" ? "Claude Code" : undefined), ...props,
}));

describe("activity detail modal", () => {
  it("shows status, times, duration, who started it, engine and payer", () => {
    const html = body({});
    expect(html).toContain("Refactor the parser");
    expect(html).toContain("Running");
    expect(html).toContain("Started");
    expect(html).toContain("1m");
    expect(html).toContain("Alice");
    expect(html).toContain("Claude Code · claude-sonnet-5");
    expect(html).toContain("Personal subscription");
  });

  it("lists the steps with where each ran, the files touched and the sub-agents", () => {
    const html = body({});
    expect(html).toContain('data-activity-step="mcp__sagax-desktop__shell"');
    expect(html).toContain('data-activity-where="computer"');
    expect(html).toContain("Your computer");
    expect(html).toContain("Server environment");
    expect(html).toContain("Older steps are in the conversation.");
    expect(html).toContain("src/lexer.ts");
    expect(html).toContain("Sub-agents");
    expect(html).toContain("Write the lexer tests");
  });

  it("offers Stop only while it runs and the viewer may stop it, and Open thread when it is theirs", () => {
    expect(body({})).toContain(">Stop<");
    expect(body({})).toContain("Open thread");
    expect(body({ detail: { ...detail, canStop: false } })).not.toContain(">Stop<");
    const done = { ...detail, status: "finished" as const, endedAt: NOW - 1_000 };
    expect(body({ item: { ...running, status: "finished" }, detail: done })).not.toContain(">Stop<");
    expect(body({ item: { ...running, status: "finished" }, detail: done })).toContain("Ended");
  });

  it("shows a routine run seen without its thread as status only", () => {
    const run: BotActivityDetail = { ...finished, steps: [], stepsTruncated: false, files: [], children: [], canStop: false };
    const html = body({ item: finished, detail: run });
    expect(html).toContain("only its status is shown");
    expect(html).toContain("Routine hourly-dispatch-board-1-si");
    expect(html).not.toContain("Open thread");
    expect(html).not.toContain("Steps");
  });

  it("shows the owner the access card of a run refused on her credentials, with its actions", () => {
    const refused: BotActivityDetail = {
      ...finished, status: "failed", steps: [], stepsTruncated: false, files: [], children: [], canStop: false,
      access: { reason: "no_access", engine: "Claude", botId: "pepper", ownerPrincipalId: "alice", payer: "owner", payerPrincipalId: "alice", routine: true, cause: "no_credentials", subscriptionSignIn: true, keysUrl: "https://px.example.test/console/me/keys" },
    };
    const html = body({ item: finished, detail: refused, viewer: { principalId: "alice", admin: true }, onSignIn: () => {} });
    expect(html).toContain("data-activity-access");
    expect(html).toContain('data-access-card="no_access"');
    expect(html).toContain("Your routine can&#x27;t run: you don&#x27;t have Claude access.");
    expect(html).toContain("data-access-sign-in");
    expect(html).toContain("Sign in with my subscription");
    expect(html).toContain('href="https://px.example.test/console/me/keys"');
    expect(html).toContain("Add my key in Perspicax");
    expect(html).toContain("the organization&#x27;s key in Settings &gt; Connections");
    expect(html).not.toContain("Open thread");
    // a run without a card shows none
    expect(body({ item: finished, detail: { ...refused, access: undefined } })).not.toContain("data-activity-access");
  });

  it("opens at exactly the size of Settings, on Settings' layer", () => {
    const window = renderToStaticMarkup(createElement(ActivityDetailModal, { item: running, onClose: () => {}, onChanged: () => {} }));
    expect(window).toContain(`class="${SETTINGS_WINDOW.backdrop}"`);
    expect(window).toContain("h-[min(700px,calc(100dvh-96px))] w-[min(900px,calc(100vw-40px))]");
    const history = renderToStaticMarkup(createElement(ActivityListModal, { botId: "pepper", filter: "coding", onFilter: () => {}, onClose: () => {}, onStop: () => {}, stopping: new Set<string>() }));
    expect(history).toContain("h-[min(700px,calc(100dvh-96px))] w-[min(900px,calc(100vw-40px))]");
    // never the old 560 px native dialog
    expect(window + history).not.toContain("560px");
    expect(window + history).not.toContain("<dialog");
    // the very classes Settings draws itself with
    const settings = readFileSync(new URL("../SettingsModal.tsx", import.meta.url), "utf8");
    expect(settings).toContain(`className="${SETTINGS_WINDOW.backdrop}"`);
    expect(settings).toContain(`className="${SETTINGS_WINDOW.frame}"`);
  });

  it("puts the summary at the left and the steps at the right when wide", () => {
    const html = body({ renderConversation: () => "LIVE", onSteer: async () => {} });
    expect(html).toContain('data-activity-layout="columns"');
    const left = html.slice(html.indexOf("data-activity-summary"), html.indexOf("data-activity-detail-right"));
    expect(left).toContain("Started");
    expect(left).toContain("Send a message to this task");
    expect(left).toContain(">Stop<");
    expect(left).toContain("Open thread");
    expect(left).not.toContain("data-activity-step=");
    const right = html.slice(html.indexOf("data-activity-detail-right"));
    expect(right).toContain('data-activity-step="mcp__sagax-desktop__shell"');
    expect(right).toContain('data-activity-view="steps"');
    expect(right).toContain('data-activity-view="conversation"');
    expect(right).not.toContain('data-activity-view="summary"');
    expect(html).not.toContain("LIVE");
  });

  it("shows the task's live conversation in its window, the sub-agent's own once dived into", () => {
    const seen: unknown[] = [];
    const html = body({ initialView: "conversation", renderConversation: (target) => { seen.push(target); return "LIVE THREAD"; } });
    expect(html).toContain("LIVE THREAD");
    expect(html).toContain('aria-labelledby="activity-view-conversation"');
    expect(seen).toEqual([{ botId: "pepper", threadId: "t1", title: running.title }]);
    // a sub-agent opened in place is drawn from its own detail: its thread
    const child = { ...detail, ...detail.children[0], steps: [], stepsTruncated: false, files: [], children: [], canStop: true };
    seen.length = 0;
    body({ item: detail.children[0], detail: child, initialView: "conversation", renderConversation: (target) => { seen.push(target); return "CHILD"; } });
    expect(seen).toEqual([{ botId: "echo", threadId: "c1", title: "Write the lexer tests" }]);
    // no thread to read, no Conversation
    expect(body({ detail: { ...detail, threadId: undefined }, renderConversation: () => "LIVE" })).not.toContain('data-activity-view="conversation"');
  });

  it("has one column with a Summary view when narrow, and Back in History", () => {
    const html = body({ wide: false, renderConversation: () => "LIVE", onBack: () => {}, onSteer: async () => {} });
    expect(html).toContain('data-activity-layout="single"');
    expect(html).toContain('data-activity-view="summary"');
    expect(html).toContain("Send a message to this task");
    expect(html).not.toContain('data-activity-step="mcp__sagax-desktop__shell"');
    expect(html).toContain("data-activity-back");
    expect(body({ wide: false, initialView: "steps" })).toContain('data-activity-step="mcp__sagax-desktop__shell"');
    expect(activityViews(true, true, true)).toEqual(["steps", "conversation"]);
    expect(activityViews(false, true, false)).toEqual(["summary", "steps"]);
    expect(activityViews(false, false, false)).toEqual([]);
  });

  it("formats durations at a glance", () => {
    expect(formatActivityDuration(45_000)).toBe("45s");
    expect(formatActivityDuration(12 * 60_000)).toBe("12m");
    expect(formatActivityDuration(65 * 60_000)).toBe("1h 05m");
  });
});

const job = (id: string, over: Partial<BotActivityItem> = {}): BotActivityItem => ({
  id, kind: "session", botId: "pepper", title: id, status: "finished", startedAt: NOW - 60_000, endedAt: NOW - 30_000, updatedAt: NOW - 30_000, ...over,
});

describe("Coding, live only", () => {
  it("keeps running coding jobs only, whatever their title says", () => {
    const items = [
      job("thread:fix", { coding: true, status: "running", title: "Fix the build" }),
      job("thread:done", { coding: true, title: "Fixed yesterday" }),
      job("thread:soul", { status: "running", title: "Import this as your directive, soul, identity" }),
      job("thread:code-titled", { status: "running", title: "Write code for the parser" }),
      job("run:r1", { kind: "routine", status: "running" }),
    ];
    const tracker = new LiveActivity(() => {});
    tracker.update(items);
    expect(codingLive(items, tracker.view()).map((item) => item.id)).toEqual(["thread:fix"]);
  });
});

const liveOf = (items: BotActivityItem[]) => {
  const tracker = new LiveActivity(() => {});
  tracker.update(items);
  return tracker.view();
};

describe("Activity, live only", () => {
  const routine = job("run:r1", { kind: "routine", status: "running", endedAt: undefined, updatedAt: NOW - 2_000, currentStep: "cw_psa__query" });
  const sub = job("thread:sub", { kind: "subagent", botName: "Echo", status: "running", endedAt: undefined, startedAt: NOW - 125_000, updatedAt: NOW - 125_000, canStop: true, threadId: "sub" });
  const parallel = job("thread:par", { parallel: true, title: "Parallel task", endedAt: NOW - 60_000 });
  const coding = job("thread:code", { coding: true, status: "running", endedAt: undefined });

  it("shows running workflows and sub-agents, never coding jobs nor work that finished before", () => {
    const tracker = new LiveActivity(() => {});
    tracker.update([coding, routine, parallel, sub]);
    expect(activityLive([coding, routine, parallel], [sub], tracker.view()).map((item) => item.id)).toEqual(["run:r1", "thread:sub"]);
  });

  it("shows parallel work only: never a conversation's own running turn", () => {
    const chat = job("thread:chat", { status: "running", endedAt: undefined, updatedAt: NOW - 1_000, startedBy: { kind: "person", name: "Alice" } });
    const task = job("thread:task", { parallel: true, status: "running", endedAt: undefined, updatedAt: NOW - 3_000 });
    const self = job("thread:self", { status: "running", endedAt: undefined, updatedAt: NOW - 4_000, startedBy: { kind: "bot", name: "Pepper" } });
    const hop = job("thread:hop", { kind: "hop", status: "waiting", endedAt: undefined, updatedAt: NOW - 5_000, startedBy: { kind: "bot", name: "Echo" } });
    expect([chat, task, self, hop, routine, sub].map(isParallelWork)).toEqual([false, true, true, true, true, true]);
    const tracker = new LiveActivity(() => {});
    tracker.update([chat, task, self, hop, routine, sub]);
    expect(activityLive([chat, task, self, hop, routine], [sub], tracker.view()).map((item) => item.id))
      .toEqual(["run:r1", "thread:task", "thread:self", "thread:hop", "thread:sub"]);
    // a conversation's turn alone: nothing in Activity
    expect(activityLive([chat], [], tracker.view())).toEqual([]);
  });

  it("draws live status: spinner, elapsed time, current step, and Stop where allowed", () => {
    const html = renderToStaticMarkup(createElement(ActivityList, { items: [routine, sub], error: false, onOpen: () => {}, onStop: () => {}, now: NOW }));
    expect(html).toContain("animate-spin");
    expect(html).toContain("Running · 1m · Routine · cw_psa__query");
    expect(html).toContain("Running · 2m · Echo");
    expect(html).toContain('data-activity-stop="thread:sub"');
    expect(html).not.toContain('data-activity-stop="run:r1"');
  });

  it("is not drawn when nothing runs, title included", () => {
    const sections = (list: Parameters<typeof PanelSections>[0]["list"]) => renderToStaticMarkup(createElement(PanelSections, { list, live: liveOf(list?.items ?? []), actions: { onOpen: () => {}, now: NOW }, onOpenHistory: () => {} }));
    // not loaded yet, then loaded with nothing running
    expect(sections(null)).toBe("");
    const chat = job("thread:chat", { status: "running", endedAt: undefined });
    const idle = sections({ items: [job("thread:old", { coding: true }), chat, parallel], subagents: [] });
    expect(idle).not.toContain("data-bot-settings-section");
    expect(idle).not.toContain("Nothing running.");
    expect(idle).not.toContain("Ongoing activities");
    expect(idle).not.toContain("No background work");
    expect(idle).not.toContain("data-activity-empty");
    // other work running (a routine, a bot-to-bot hop) is not shown here:
    // it lives in the chat and in Automations (JC 2026-10-19)
    const busy = sections({ items: [routine, chat], subagents: [] });
    expect(busy).not.toContain('data-bot-settings-section="activity"');
    expect(busy).not.toContain("data-activity-card");
  });

  it("draws no Ongoing activities section, Coding alone", () => {
    const code = job("thread:code", { coding: true, status: "running", endedAt: undefined });
    const items = [routine, code];
    const html = renderToStaticMarkup(createElement(PanelSections, { list: { items, subagents: [] }, live: liveOf(items), actions: { onOpen: () => {}, now: NOW }, onOpenHistory: () => {} }));
    expect(html).not.toContain("Ongoing activities");
    expect(html).toContain('data-bot-settings-section="coding"');
    expect(html).not.toContain('data-bot-settings-section="activity"');
    expect(html).not.toContain('data-activity-card="run:r1"');
  });
});

const codeJob = (id: string, over: Partial<BotActivityItem> = {}) => job(id, {
  coding: true,
  code: { pullRequests: [], branches: [], commits: [] },
  ...over,
});

describe("history and errors", () => {
  const props = (over: Partial<Parameters<typeof PanelSections>[0]> = {}) => ({ list: { items: [], subagents: [] }, live: liveOf([]), actions: { onOpen: () => {}, now: NOW }, onOpenHistory: () => {}, ...over });

  it("draws no All history row when the person hid it (Settings > Appearance)", () => {
    const html = renderToStaticMarkup(createElement(PanelSections, props({ showAllHistory: false })));
    expect(html).not.toContain(">All history<");
    expect(html).not.toContain('data-activity-history="all"');
  });

  it("is hidden by default in the panel: ActivitySection reads the preference", () => {
    const source = readFileSync(new URL("./ActivitySection.tsx", import.meta.url), "utf8");
    expect(source).toContain("showAllHistory={showAllHistory}");
    expect(source).toContain("useShowAllHistory()");
    expect(source).toContain("watchBotHistoryRequests(bot.id");
  });

  it("keeps the history reachable through one quiet All history row when no section is drawn", () => {
    const html = renderToStaticMarkup(createElement(PanelSections, props()));
    expect(html).toContain('data-activity-history="all"');
    expect(html).toContain(">All history<");
    expect(html).not.toContain("text-ink-tertiary");
    expect(html).not.toContain("data-bot-settings-section");
    // the row is the shared SectionHeader, not copied classes: its button
    // markup is byte-identical to a Coding/Activity header's
    const header = (h: string) => /<button[^>]*>/.exec(h)![0].replace(/ data-activity-history="[^"]*"/, "");
    expect(header(html)).toBe(header(renderToStaticMarkup(createElement(SectionHeader, { icon: null, title: "x", name: "coding", onOpenHistory: () => {} }))));
    expect(html).toContain('<h2 class="flex">');
    const onOpenHistory = vi.fn();
    type El = { type: unknown; props: { name?: string; onOpenHistory?: (f: string) => void; children?: unknown } };
    const fragment = PanelSections(props({ onOpenHistory })) as unknown as { props: { children: Array<El | false> } };
    const rowEl = fragment.props.children.filter(Boolean).at(-1) as El;
    const rowHeader = rowEl.props.children as El;
    expect(rowHeader.type).toBe(SectionHeader);
    expect(rowHeader.props.name).toBe("all");
    rowHeader.props.onOpenHistory!("coding");
    expect(onOpenHistory).toHaveBeenCalledWith("coding");
    // a section is drawn: its title opens the history, and the extra row goes
    const routine = job("run:r1", { kind: "routine", status: "running", endedAt: undefined });
    const busy = renderToStaticMarkup(createElement(PanelSections, props({ list: { items: [routine], subagents: [] }, live: liveOf([routine]) })));
    expect(busy).not.toContain('data-activity-history="other"');
    expect(busy).toContain('data-activity-history="all"');
    // still loading: nothing at all
    expect(renderToStaticMarkup(createElement(PanelSections, props({ list: null })))).toBe("");
  });

  it("says once, quietly, that the list could not load", () => {
    const html = renderToStaticMarkup(createElement(PanelSections, props({ list: null, error: true })));
    expect(html).toContain("data-activity-error");
    expect(html).toContain("Couldn&#x27;t load this bot&#x27;s activity.");
    expect(html).toContain("text-ink-tertiary");
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain("data-activity-history");
    // a failed refresh keeps the last list on screen
    const kept = renderToStaticMarkup(createElement(PanelSections, props({ error: true })));
    expect(kept).toContain('data-activity-history="all"');
    expect(kept).not.toContain("data-activity-error");
  });
});

describe("Coding, code work only", () => {
  const pr = { repo: "acme/parser", number: 42, title: "Split the lexer", url: "https://github.com/acme/parser/pull/42", action: "opened" as const, branch: "fix/lexer", at: NOW - 3_600_000 };
  const shipped = codeJob("thread:ship", {
    code: {
      folder: "/srv/repos/parser", branch: "fix/lexer", repo: "acme/parser", repoUrl: "https://github.com/acme/parser",
      pullRequests: [pr],
      branches: [{ name: "fix/lexer", repo: "acme/parser", pushed: true, url: "https://github.com/acme/parser/tree/fix/lexer", at: NOW - 3_700_000 }],
      commits: [{ sha: "1a2b3c4d5e", message: "fix: split the lexer", branch: "fix/lexer", repo: "acme/parser", pushed: true, url: "https://github.com/acme/parser/commit/1a2b3c4d5e", at: NOW - 3_800_000 }],
    },
  });

  it("gathers pull requests, branches and commits of coding jobs, newest first, each once", () => {
    const merged = codeJob("thread:merge", { code: { pullRequests: [{ ...pr, action: "merged", at: NOW - 60_000 }], branches: [{ name: "spike", pushed: false, at: NOW - 30_000 }], commits: [] } });
    const notCoding = job("thread:chat", { code: { pullRequests: [{ ...pr, number: 7, url: undefined }], branches: [], commits: [] } });
    const work = codingWork([shipped, merged, notCoding]);
    expect(work.pullRequests).toEqual([{ ...pr, action: "merged", at: NOW - 60_000 }]);
    expect(work.branches.map((branch) => branch.name)).toEqual(["spike", "fix/lexer"]);
    expect(work.commits.map((commit) => commit.sha)).toEqual(["1a2b3c4d5e"]);
    expect(codingWork([job("thread:a"), codeJob("thread:b")])).toEqual({ pullRequests: [], branches: [], commits: [] });
  });

  it("draws the pull request, branch and commit rows with links to the browser", () => {
    const html = renderToStaticMarkup(createElement(CodeWorkList, { work: codingWork([shipped]), now: NOW }));
    expect(html).toContain(">Pull requests<");
    expect(html).toContain("#42 Split the lexer");
    expect(html).toContain("acme/parser · Opened · 1 h ago");
    expect(html).toContain('data-code-link="https://github.com/acme/parser/pull/42"');
    expect(html).toContain(">Branches<");
    // a branch is a grouped card row like a routine's: status pill, where and when
    expect(html).toContain('data-branch-status="open"');
    expect(html).toContain("PR #42 open");
    expect(html).toContain("acme/parser · 1 h ago");
    expect(html).toContain(">Commits<");
    expect(html).toContain("fix: split the lexer");
    expect(html).toContain("1a2b3c4 · fix/lexer · Pushed");
    // a row without a page is not a link
    const local = renderToStaticMarkup(createElement(CodeWorkList, { work: { pullRequests: [], branches: [{ name: "spike", pushed: false, at: NOW }], commits: [] }, now: NOW }));
    expect(local).toContain('data-branch-status="local"');
    expect(local).toContain(">Not pushed<");
    expect(local).toContain("just now");
    expect(local).not.toContain("data-code-link");
    expect(local).not.toContain("Pull requests");
  });

  it("shows a running coding job with its repository and branch, and is drawn for code work alone", () => {
    const running = codeJob("thread:run", { status: "running", endedAt: undefined, code: { folder: "/srv/repos/parser", branch: "main", pullRequests: [], branches: [], commits: [] } });
    expect(codingWhere(running)).toBe("parser · main");
    expect(codingWhere(shipped)).toBe("acme/parser · fix/lexer");
    const draw = (items: BotActivityItem[]) => renderToStaticMarkup(createElement(PanelSections, { list: { items, subagents: [] }, live: liveOf(items), actions: { onOpen: () => {}, now: NOW }, onOpenHistory: () => {} }));
    const live = draw([running]);
    expect(live).toContain('data-bot-settings-section="coding"');
    expect(live).toContain("data-activity-where");
    expect(live).toContain("parser · main");
    // finished jobs are not listed, their pull request is
    const done = draw([shipped]);
    expect(done).toContain('data-bot-settings-section="coding"');
    expect(done).not.toContain("data-activity-card");
    expect(done).toContain("#42 Split the lexer");
    expect(panelSections({ items: [codeJob("thread:empty")], subagents: [] }, liveOf([])).showCoding).toBe(false);
  });

  it("keeps the Git links (pull requests, branches, commits) for Advanced mode", () => {
    const simple = renderToStaticMarkup(createElement(PanelSections, { list: { items: [shipped], subagents: [] }, live: liveOf([shipped]), actions: { onOpen: () => {}, now: NOW }, onOpenHistory: () => {}, advanced: false }));
    expect(simple).not.toContain("#42 Split the lexer");
    expect(simple).not.toContain("data-code-work");
    // finished work with only Git links draws no Coding section in Simple
    expect(simple).not.toContain('data-bot-settings-section="coding"');
    expect(simple).toContain('data-activity-history="all"');
    expect(panelSections({ items: [shipped], subagents: [] }, liveOf([shipped]), false).showCoding).toBe(false);
  });

  it("draws launched cloud agents in one grouped card with failed PR link", () => {
    const launched: BotLaunchedAgentItem[] = [{
      id: "thread:agent-1",
      targetBotId: "scout",
      targetBotName: "Scout",
      title: "Sagax: CI main au vert",
      status: "failed",
      startedAt: NOW - 50_000,
      updatedAt: NOW - 40_000,
      threadId: "agent-1",
      pullRequest: { number: 200, url: "https://github.com/org/repo/pull/200" },
      coding: true,
    }];
    const html = renderToStaticMarkup(createElement(LaunchedAgentsList, {
      items: launched,
      onOpen: () => {},
    }));
    expect(html).toContain("data-launched-agents");
    expect(html).toContain("Sagax: CI main au vert");
    expect(html).toContain('data-launched-pr');
    expect(html).toContain("#200");
    expect(html).toContain("Run failed");
    const panel = renderToStaticMarkup(createElement(PanelSections, {
      list: { items: [], subagents: [], launchedAgents: launched },
      actions: { onOpen: () => {}, now: NOW },
      onOpenHistory: () => {},
      onOpenLaunched: () => {},
    }));
    expect(panel).toContain('data-bot-settings-section="coding"');
    expect(panel).toContain("data-launched-agents");
    expect(panelSections({ items: [], subagents: [], launchedAgents: launched }).showCoding).toBe(true);
  });
});

describe("launched agents by kind of work", () => {
  const agent = (id: string, title: string, coding?: true): BotLaunchedAgentItem => ({
    id, targetBotId: "peer", targetBotName: "Peer", title, status: "finished",
    startedAt: NOW - 50_000, updatedAt: NOW - 40_000, threadId: id.slice("thread:".length), ...(coding ? { coding } : {}),
  });

  it("Coding holds only coding agents; a dispatch or bot-to-bot run goes to Activity", () => {
    const list = {
      items: [], subagents: [],
      launchedAgents: [agent("thread:d1", "Dispatch"), agent("thread:o1", "Orion: @Cryptic · work"), agent("thread:s1", "Scout: Split the lexer", true)],
    };
    const sections = panelSections(list);
    expect(sections.launched.map((item) => item.id)).toEqual(["thread:s1"]);
    expect(sections.launchedOther.map((item) => item.id)).toEqual(["thread:d1", "thread:o1"]);
    expect(sections.showCoding).toBe(true);
    expect(sections.showActivity).toBe(true);
    const panel = renderToStaticMarkup(createElement(PanelSections, {
      list, actions: { onOpen: () => {}, now: NOW }, onOpenHistory: () => {}, onOpenLaunched: () => {},
    }));
    const activity = panel.slice(panel.indexOf('data-bot-settings-section="activity"'), panel.indexOf('data-bot-settings-section="coding"'));
    const coding = panel.slice(panel.indexOf('data-bot-settings-section="coding"'));
    expect(coding).toContain("Scout: Split the lexer");
    expect(coding).not.toContain("Dispatch");
    expect(coding).not.toContain("Orion");
    expect(activity).toBe("");
  });

  it("no coding agent: the Coding section is not drawn for other launched work", () => {
    const sections = panelSections({ items: [], subagents: [], launchedAgents: [agent("thread:d1", "Dispatch")] });
    expect(sections.showCoding).toBe(false);
    expect(sections.showActivity).toBe(true);
  });
});

describe("finished work leaves after 5 seconds", () => {
  afterEach(() => { vi.useRealTimers(); });
  const run = job("thread:par", { parallel: true, status: "running", endedAt: undefined });
  const done = { ...run, status: "finished" as const, endedAt: NOW };

  it("reads Finished, fades, then leaves the panel", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const onChange = vi.fn();
    const tracker = new LiveActivity(onChange);
    tracker.update([run]);
    expect(activityLive([run], [], tracker.view()).map((item) => item.id)).toEqual(["thread:par"]);
    tracker.update([done]);
    let view = tracker.view();
    expect(activityLive([done], [], view)).toHaveLength(1);
    expect(view.fading(done)).toBe(false);
    const html = renderToStaticMarkup(createElement(ActivityList, { items: [done], error: false, onOpen: () => {}, fading: view.fading }));
    expect(html).toContain("Finished");
    expect(html).not.toContain("data-activity-fading");

    vi.advanceTimersByTime(FINISHED_LINGER_MS - FINISHED_FADE_MS);
    expect(onChange).toHaveBeenCalledTimes(1);
    view = tracker.view();
    expect(activityLive([done], [], view)).toHaveLength(1);
    expect(view.fading(done)).toBe(true);
    expect(renderToStaticMarkup(createElement(ActivityList, { items: [done], error: false, onOpen: () => {}, fading: view.fading }))).toContain("opacity-0");

    vi.advanceTimersByTime(FINISHED_FADE_MS - 1);
    expect(activityLive([done], [], tracker.view())).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(activityLive([done], [], tracker.view())).toEqual([]);
    // the next fetch still lists it: it stays gone
    tracker.update([done]);
    expect(activityLive([done], [], tracker.view())).toEqual([]);
    tracker.dispose();
  });

  it("does the same for a coding job, and brings back one that runs again", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const tracker = new LiveActivity(() => {});
    const code = { ...run, id: "thread:code", coding: true };
    tracker.update([code]);
    tracker.update([{ ...code, status: "failed" }]);
    expect(codingLive([{ ...code, status: "failed" }], tracker.view())).toHaveLength(1);
    vi.advanceTimersByTime(FINISHED_LINGER_MS);
    expect(codingLive([{ ...code, status: "failed" }], tracker.view())).toEqual([]);
    tracker.update([code]);
    expect(codingLive([code], tracker.view())).toHaveLength(1);
    tracker.dispose();
  });
});

describe("section headers and history", () => {
  const bot = { id: "pepper", name: "Pepper", tasks: [] } as unknown as Bot;

  it("section titles open the history; no extra History row below them", () => {
    // nothing loaded yet: no section at all
    expect(renderToStaticMarkup(createElement(ActivitySection, { bot }))).not.toContain("data-bot-settings-section");
    const items = [
      job("thread:code", { coding: true, status: "running", endedAt: undefined }),
      job("run:r1", { kind: "routine", status: "running", endedAt: undefined }),
    ];
    const html = renderToStaticMarkup(createElement(PanelSections, { list: { items, subagents: [] }, actions: { onOpen: () => {}, now: NOW }, onOpenHistory: () => {} }));
    expect(html).not.toContain(">All history<");
    expect(html).not.toContain("data-activity-see-all");
    expect(html).toContain('data-activity-history="coding"');
    expect(html).not.toContain('data-activity-history="other"');
    expect(html).not.toContain('data-activity-history="all"');
  });

  it("opens the history modal for that section when its title is clicked", () => {
    const onOpenHistory = vi.fn();
    const header = SectionHeader({ icon: null, title: "Activity", name: "other", onOpenHistory });
    const button = (header.props as { children: { props: { onClick: () => void; "data-activity-history": string } } }).children;
    expect(button.props["data-activity-history"]).toBe("other");
    button.props.onClick();
    expect(onOpenHistory).toHaveBeenCalledWith("other");
  });

  it("draws the history modal with its status filters and search", () => {
    const html = renderToStaticMarkup(createElement(ActivityListModal, { botId: "pepper", filter: "other", onFilter: () => {}, onClose: () => {}, onStop: () => {}, stopping: new Set<string>() }));
    expect(html).toContain(">History<");
    for (const id of ["all", "running", "finished", "failed"]) expect(html).toContain(`data-history-status="${id}"`);
    expect(html).toContain("data-history-search");
    // master and detail in one window: the list, and the chosen entry beside it
    expect(html).toContain("data-activity-history-list");
    expect(html).toContain("Choose a task to see its details and its conversation here.");
  });

  it("lists the past newest first, by status and words", () => {
    const items = [
      job("thread:a", { startedAt: NOW - 3_000, title: "Import this as your directive" }),
      job("thread:b", { startedAt: NOW - 1_000, status: "failed", title: "Parallel task" }),
      job("thread:c", { startedAt: NOW - 2_000, status: "running", title: "Dispatch board" }),
      job("thread:d", { startedAt: NOW - 4_000, status: "stopped", title: "Old check" }),
    ];
    expect(historyItems(items, "all", "").map((item) => item.id)).toEqual(["thread:b", "thread:c", "thread:a", "thread:d"]);
    expect(historyItems(items, "running", "").map((item) => item.id)).toEqual(["thread:c"]);
    expect(historyItems(items, "finished", "").map((item) => item.id)).toEqual(["thread:a"]);
    expect(historyItems(items, "failed", "").map((item) => item.id)).toEqual(["thread:b", "thread:d"]);
    expect(historyItems(items, "all", "  DIRECTIVE ").map((item) => item.id)).toEqual(["thread:a"]);
  });
});

describe("no separate Ongoing activities rail beside the bot", () => {
  it("opens the bot with its chat alone: ongoing work lives in Details", async () => {
    const { readFileSync, existsSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = dirname(fileURLToPath(import.meta.url));
    const app = readFileSync(join(here, "../../App.tsx"), "utf8");
    expect(app).not.toMatch(/BackgroundWorkPanel/);
    expect(app).toMatch(/: bot \? \(\s*<ChatView (?:key=\{\w+\} )?bot=\{bot\} \/>/);
    expect(existsSync(join(here, "../BackgroundWorkPanel.tsx"))).toBe(false);
  });
});

describe("one place for ongoing work while the bot panel is open", () => {
  it("draws a running activity once: in Details, not in the header chip nor a rail", async () => {
    const work = job("thread:w1", { kind: "hop", title: "@Comet · work", status: "running", endedAt: undefined, startedBy: { kind: "bot", name: "Comet" }, canStop: true, threadId: "w1" });
    const details = renderToStaticMarkup(createElement(PanelSections, { list: { items: [work], subagents: [] }, live: liveOf([work]), actions: { onOpen: () => {}, onStop: () => {}, now: NOW }, onOpenHistory: () => {} }));
    const header = renderToStaticMarkup(createElement(TeammatesWorkingChip, { busy: false, waitingForTeammates: true, panelOpen: true, onOpen: () => {} }));
    const { readFileSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const app = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../App.tsx"), "utf8");
    const screen = details + header;
    expect(screen).not.toContain('data-activity-card="thread:w1"');
    expect(screen).not.toContain("Ongoing activities");
    expect(header).toBe("");
    expect(app).not.toMatch(/data-background-work-panel|BackgroundWorkPanel/);
    expect(details).not.toContain("data-activity-stop");
  });

  it("keeps the header chip as an entry point while the panel is closed", () => {
    const onOpen = vi.fn();
    const html = renderToStaticMarkup(createElement(TeammatesWorkingChip, { busy: false, waitingForTeammates: true, panelOpen: false, onOpen }));
    expect(html).toContain("data-teammates-working");
    expect(html).toContain("Teammates working");
    expect(html).toContain('title="Show ongoing activities"');
    const chip = TeammatesWorkingChip({ busy: false, waitingForTeammates: true, panelOpen: false, onOpen }) as unknown as { props: { onClick: () => void } };
    chip.props.onClick();
    expect(onOpen).toHaveBeenCalledOnce();
    expect(renderToStaticMarkup(createElement(TeammatesWorkingChip, { busy: true, waitingForTeammates: true, panelOpen: false, onOpen }))).toBe("");
    expect(renderToStaticMarkup(createElement(TeammatesWorkingChip, { busy: false, waitingForTeammates: false, panelOpen: false, onOpen }))).toBe("");
  });
});
