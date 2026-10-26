// Details > Coding's branches: the same grouped card as Routines, each row
// with its status pill, where and when, and a "..." menu whose actions
// follow the branch read now (src/lib/code-branches.ts).
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/state/store", () => ({
  api: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    body?: Record<string, unknown>;
    constructor(message: string, status: number, body?: Record<string, unknown>) {
      super(message);
      this.status = status;
      this.body = body;
    }
  },
  useStore: () => ({ state: {}, dispatch: vi.fn() }),
}));

import { ApiError } from "@/state/store";
import { GROUPED_CARD, GROUPED_ROW } from "@/lib/grouped-card";
import { codingWork } from "@/lib/bot-activity";
import { branchActions, branchCounts, branchStatus, branchUnavailable, codingBranchKey, deleteNeedsSecondConfirm, remoteActionNeedsConfirm, type BotBranchInfo, type CodingBranch } from "@/lib/code-branches";
import type { BotActivityItem } from "../../../shared/bot-activity";
import { BranchRow, branchErrorText, CodeBranchList, CommitDialog } from "./CodeBranchList";
import { RoutineList } from "../routines/RoutineList";

const NOW = 1_800_000_000_000;
const local: CodingBranch = { name: "feat/it-tools-widgets", repo: "acme/web", pushed: false, at: NOW - 15 * 3_600_000, threadId: "t1", folder: "/srv/web" };
const info = (state: Partial<NonNullable<BotBranchInfo["state"]>> = {}, extra: Partial<BotBranchInfo> = {}): BotBranchInfo => ({
  branch: local.name,
  place: "server",
  folderName: "web",
  repo: "acme/web",
  canPublish: true,
  proposedMessage: "Add IT tools widgets",
  state: { exists: true, pushed: false, ahead: 2, behind: 0, changes: [{ path: "src/widget.ts", status: "modified" }, { path: "src/new.ts", status: "untracked" }], worktree: "/srv/wt", base: "main", ...state },
  ...extra,
});

describe("Coding branches: the card", () => {
  it("uses the Routines card: one rounded card, rows split by hairlines, the same classes", () => {
    const branches = renderToStaticMarkup(createElement(CodeBranchList, { branches: [local, { ...local, name: "fix/x", pushed: true }], now: NOW, label: "Branches" }));
    const routines = renderToStaticMarkup(createElement(RoutineList, {
      routines: [{
        id: "brief", name: "Morning brief", prompt: "Report progress", target: "bot", botId: "scout", runOn: "maus", enabled: true,
        schedule: { type: "interval", everyMinutes: 60, anchorAt: 1 }, durationMinutes: 30, nextRunAt: 3_600_000, createdAt: 1, updatedAt: 1,
      } as never],
      runs: [],
      onOpen: () => {},
      grouped: true,
      toggle: false,
    }));
    expect(branches).toContain(`class="${GROUPED_CARD}"`);
    expect(routines).toContain(`class="${GROUPED_CARD}"`);
    for (const part of GROUPED_ROW.split(" ")) {
      expect(branches).toContain(part);
      expect(routines).toContain(part);
    }
    expect(branches.match(/data-code-row="branch"/g)).toHaveLength(2);
    // RoutineList and the branch card draw from one place, never copies
    expect(readFileSync(new URL("../routines/RoutineList.tsx", import.meta.url), "utf8")).toContain("GROUPED_CARD");
    expect(readFileSync(new URL("./CodeBranchList.tsx", import.meta.url), "utf8")).not.toContain("rounded-xl border border-hairline-weak bg-card");
  });

  it("draws icon, name, status pill, repository, counts, time and the menu button", () => {
    const html = renderToStaticMarkup(createElement(BranchRow, { branch: local, now: NOW, info: info(), actions: { botId: "pepper", onArchive: async () => {} }, onAct: () => {} }));
    expect(html).toContain("feat/it-tools-widgets");
    expect(html).toContain('data-branch-status="local"');
    expect(html).toContain(">Not pushed<");
    expect(html).toContain("acme/web · 2 commits ahead · 2 changed files · 15 h ago");
    expect(html).toContain('data-branch-menu-button="feat/it-tools-widgets"');
    expect(html).toContain('aria-label="Actions for feat/it-tools-widgets"');
    // busy: a spinner instead of the menu; a note under the row
    const busy = renderToStaticMarkup(createElement(BranchRow, { branch: local, now: NOW, busy: true, note: { tone: "error", text: "Refused" }, actions: { botId: "pepper", onArchive: async () => {} }, onAct: () => {} }));
    expect(busy).toContain("animate-spin");
    expect(busy).not.toContain("data-branch-menu-button");
    expect(busy).toContain('role="alert"');
    expect(busy).toContain("Refused");
    // no actions: no menu
    expect(renderToStaticMarkup(createElement(BranchRow, { branch: local, now: NOW }))).not.toContain("data-branch-menu-button");
  });

  it("says pushed, PR open, merged, closed or deleted, newest truth first", () => {
    expect(branchStatus(local).tone).toBe("local");
    expect(branchStatus({ ...local, pushed: true })).toEqual({ tone: "pushed", label: "Pushed" });
    expect(branchStatus(local, info({ pushed: true }).state).tone).toBe("pushed");
    const opened = { ...local, pull: { number: 42, action: "opened" as const, at: NOW, url: "https://github.com/acme/web/pull/42" } };
    expect(branchStatus(opened)).toEqual({ tone: "open", label: "PR #42 open" });
    expect(branchStatus(opened, undefined, { number: 42, url: "u", state: "merged" })).toEqual({ tone: "merged", label: "Merged" });
    expect(branchStatus(opened, undefined, { number: 42, url: "u", state: "closed" }).tone).toBe("closed");
    expect(branchStatus(local, info({ exists: false }).state).tone).toBe("gone");
    expect(branchCounts(info({ ahead: 1, changes: [{ path: "a", status: "added" }] }).state)).toEqual(["1 commit ahead", "1 changed file"]);
  });

  it("offers each action only where it applies", () => {
    expect(branchActions(info(), undefined, local)).toEqual({ commit: true, push: true, openPr: false, diff: true, remove: true });
    expect(branchActions(info({ pushed: true, ahead: 0, changes: [] }), null, local)).toMatchObject({ commit: false, push: false, openPr: true });
    expect(branchActions(info({ pushed: true, ahead: 0 }), { number: 3, url: "https://github.com/acme/web/pull/3", state: "open" }, local)).toMatchObject({ openPr: false, prUrl: "https://github.com/acme/web/pull/3" });
    expect(branchActions(info({}, { canPublish: false, publishBlocked: "github_not_connected" }), undefined, local)).toMatchObject({ push: false, commit: true });
    expect(branchActions(info({ isDefault: true }), undefined, local)).toMatchObject({ push: false, remove: false });
    expect(branchActions(info({ worktree: undefined }), undefined, local).commit).toBe(false);
    expect(branchActions({ branch: local.name, place: "elsewhere", canPublish: false }, undefined, local)).toEqual({ commit: false, push: false, openPr: false, diff: false, remove: false });
    expect(deleteNeedsSecondConfirm(info({ pushed: true, ahead: 0 }).state)).toBe(false);
    expect(deleteNeedsSecondConfirm(info({ pushed: true, ahead: 1 }).state)).toBe(true);
    expect(deleteNeedsSecondConfirm(info({ pushed: false, ahead: 0 }).state)).toBe(true);
  });

  it("acts on a branch on the bot's own computer just like one on this server", () => {
    const remote = info({}, { place: "remote", host: "Studio de Max" });
    expect(branchActions(remote, undefined, local)).toEqual({ commit: true, push: true, openPr: false, diff: true, remove: true });
    expect(branchUnavailable(remote, local)).toBeNull();
    // push and open-PR on a client's computer ask to confirm first
    expect(remoteActionNeedsConfirm(remote, "push")).toBe(true);
    expect(remoteActionNeedsConfirm(remote, "pr")).toBe(true);
    expect(remoteActionNeedsConfirm(info(), "push")).toBe(false);
    // the computer's name shows on the row
    const html = renderToStaticMarkup(createElement(BranchRow, { branch: { ...local, repo: undefined }, now: NOW, info: remote, actions: { botId: "pepper", onArchive: async () => {} }, onAct: () => {} }));
    expect(html).toContain("on Studio de Max");
  });

  it("gives one plain reason when the bot's computer cannot be reached, not five disabled rows", () => {
    expect(branchUnavailable({ branch: local.name, place: "remote", offline: true, canPublish: false, publishBlocked: "offline" }, local)).toBe("botPanel.branch.hint.offline");
    expect(branchUnavailable({ branch: local.name, place: "remote", noPath: true, canPublish: false }, local)).toBe("botPanel.branch.hint.noPath");
    expect(branchUnavailable({ branch: local.name, place: "remote", canPublish: false, publishBlocked: "unknown_os" }, local)).toBe("botPanel.branch.hint.unknownOs");
    expect(branchUnavailable({ branch: local.name, place: "elsewhere", canPublish: false }, local)).toBe("botPanel.branch.hint.elsewhere");
    expect(branchUnavailable(info(), { ...local, threadId: undefined })).toBe("botPanel.branch.hint.noThread");
    // when unreachable, no action applies
    expect(branchActions({ branch: local.name, place: "remote", offline: true, canPublish: false }, undefined, local)).toEqual({ commit: false, push: false, openPr: false, diff: false, remove: false });
  });

  it("puts archived branches behind Show archived, and keeps them out of the five", () => {
    const item = (id: string, names: string[]): BotActivityItem => ({
      id, kind: "session", botId: "pepper", title: "x", status: "finished", startedAt: NOW, updatedAt: NOW, threadId: id.slice(7), coding: true,
      code: { folder: "/srv/web", repo: "acme/web", pullRequests: [{ repo: "acme/web", number: 9, action: "opened", branch: "b1", at: NOW }], branches: names.map((name, index) => ({ name, repo: "acme/web", pushed: false, at: NOW - index })), commits: [] },
    });
    const archived = new Set([codingBranchKey({ name: "b1", repo: "acme/web" })]);
    const work = codingWork([item("thread:t1", ["b1", "b2", "b3", "b4", "b5", "b6"])], archived);
    expect(work.branches.map((branch) => branch.name)).toEqual(["b2", "b3", "b4", "b5", "b6"]);
    expect(work.archivedBranches?.map((branch) => branch.name)).toEqual(["b1"]);
    expect(work.archivedBranches?.[0]).toMatchObject({ threadId: "t1", folder: "/srv/web", pull: { number: 9 } });
    const html = renderToStaticMarkup(createElement(CodeBranchList, { branches: work.branches, archivedBranches: work.archivedBranches, now: NOW, label: "Branches", actions: { botId: "pepper", onArchive: async () => {} } }));
    expect(html).toContain("Show archived (1)");
    expect(html).not.toContain('data-branch="b1"');
    // without actions (the history) there is no archive toggle
    expect(renderToStaticMarkup(createElement(CodeBranchList, { branches: work.branches, archivedBranches: work.archivedBranches, now: NOW, label: "Branches" }))).not.toContain("Show archived");
  });

  it("proposes the commit message and lists the changed files, all chosen", () => {
    const html = renderToStaticMarkup(createElement(CommitDialog, { botId: "pepper", branch: local, info: info(), onClose: () => {}, onCommitted: () => {} }));
    expect(html).toContain("Commit on feat/it-tools-widgets");
    expect(html).toContain(">Add IT tools widgets</textarea>");
    expect(html).toContain("Files to commit (2)");
    expect(html).toContain("src/widget.ts");
    expect(html).toContain("src/new.ts");
    expect(html.match(/type="checkbox"[^>]*checked=""/g)).toHaveLength(2);
  });

  it("words a refusal by its code, else the server's message", () => {
    expect(branchErrorText(new ApiError("x", 403, { code: "github_not_connected" }))).toBe("Connect your own GitHub account (Connect apps, Personal)");
    expect(branchErrorText(new ApiError("x", 409, { code: "rejected" }))).toContain("nothing is forced");
    expect(branchErrorText(new ApiError("Something else", 500, { code: "odd" }))).toBe("Something else");
  });
});
