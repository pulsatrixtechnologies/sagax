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
import { branchActions, branchAskText, branchAway, branchCounts, branchStatus, branchUnavailable, branchWhere, codingBranchKey, deleteNeedsSecondConfirm, remoteActionNeedsConfirm, type BotBranchInfo, type CodingBranch } from "@/lib/code-branches";
import type { BotActivityItem } from "../../../shared/bot-activity";
import en from "@/locales/en.json";
import fr from "@/locales/fr.json";
import { BranchMenuItems, BranchMenuPanel, BranchRow, branchErrorText, CodeBranchList, CommitDialog } from "./CodeBranchList";
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
      // Routine rows are condensed on purpose (#1164): py-1.5 replaces the row's py-2.5.
      if (!part.startsWith("py-")) expect(routines).toContain(part);
    }
    expect(routines).toContain("py-1.5");
    expect(branches.match(/data-code-row="branch"/g)).toHaveLength(2);
    // RoutineList and the branch card draw from one place, never copies
    expect(readFileSync(new URL("../routines/RoutineList.tsx", import.meta.url), "utf8")).toContain("GROUPED_CARD");
    expect(readFileSync(new URL("./CodeBranchList.tsx", import.meta.url), "utf8")).not.toContain("rounded-xl border border-hairline-weak bg-card");
  });

  it("draws icon, name, status pill, repository, counts, time and the menu button", () => {
    const html = renderToStaticMarkup(createElement(BranchRow, { branch: local, now: NOW, info: info(), actions: { botId: "pepper", botName: "Pepper", onArchive: async () => {} }, onAct: () => {} }));
    expect(html).toContain("feat/it-tools-widgets");
    expect(html).toContain('data-branch-status="local"');
    expect(html).toContain(">Not pushed<");
    // #2148: one grey sub-line with the short repo name; the rest in the tooltip
    expect(html).toMatch(/data-branch-repo=""[^>]*>web</);
    expect(html).not.toContain("acme/web · 2 commits ahead");
    expect(html).toContain("2 commits ahead · 2 changed files · 15 h ago");
    expect(html).toContain('data-branch-menu-button="feat/it-tools-widgets"');
    expect(html).toContain('aria-label="Actions for feat/it-tools-widgets"');
    // busy: a spinner instead of the menu; a note under the row
    const busy = renderToStaticMarkup(createElement(BranchRow, { branch: local, now: NOW, busy: true, note: { tone: "error", text: "Refused" }, actions: { botId: "pepper", botName: "Pepper", onArchive: async () => {} }, onAct: () => {} }));
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
    const html = renderToStaticMarkup(createElement(BranchRow, { branch: { ...local, repo: undefined }, now: NOW, info: remote, actions: { botId: "pepper", botName: "Pepper", onArchive: async () => {} }, onAct: () => {} }));
    expect(html).toContain("on Studio de Max");
  });

  it("says in plain words why the branch's computer cannot be reached, per kind, and what to do", () => {
    const away = (extra: Partial<BotBranchInfo>): BotBranchInfo => ({ branch: local.name, place: "remote", canPublish: false, ...extra });
    expect(branchAway(away({ offline: true, computer: "sandbox" }))).toBe("botPanel.branch.away.sandboxOff");
    expect(branchAway(away({ offline: true, computer: "desktop" }))).toBe("botPanel.branch.away.desktopOff");
    expect(branchAway(away({ offline: true, computer: "local_vm" }))).toBe("botPanel.branch.away.vmOff");
    expect(branchAway(away({ offline: true, computer: "remote_session" }))).toBe("botPanel.branch.away.remoteOff");
    // an older server says no computer: a remote session
    expect(branchAway(away({ offline: true }))).toBe("botPanel.branch.away.remoteOff");
    expect(branchAway(away({ noPath: true }))).toBe("botPanel.branch.away.noPath");
    expect(branchAway(away({ publishBlocked: "unknown_os", windows: true }))).toBe("botPanel.branch.away.windows");
    expect(branchAway(away({ publishBlocked: "unknown_os" }))).toBe("botPanel.branch.away.unknownOs");
    expect(branchAway({ branch: local.name, place: "elsewhere", canPublish: false })).toBe("botPanel.branch.away.elsewhere");
    expect(branchAway(undefined, true)).toBe("botPanel.branch.away.unread");
    // where the panel acts itself, or while the branch is read: nothing to ask
    expect(branchAway(info())).toBeNull();
    expect(branchAway(info({}, { place: "remote", computer: "sandbox" }))).toBeNull();
    expect(branchAway(undefined)).toBeNull();
    // only the person's own conversation and a branch that still exists can be acted on at all
    expect(branchUnavailable(info(), { ...local, threadId: undefined })).toBe("botPanel.branch.hint.noThread");
    expect(branchUnavailable(info({ exists: false }), local)).toBe("botPanel.branch.gone");
    expect(branchUnavailable(away({ offline: true, computer: "sandbox" }), local)).toBeNull();
    // when unreachable, no action applies here
    expect(branchActions({ branch: local.name, place: "remote", offline: true, canPublish: false }, undefined, local)).toEqual({ commit: false, push: false, openPr: false, diff: false, remove: false });
    // no jargon: neither "this server" nor a dash
    for (const key of ["botPanel.branch.hint.elsewhere", "botPanel.branch.away.elsewhere", "botPanel.branch.away.sandboxOff", "botPanel.branch.away.noPath"] as const) {
      expect(en[key]).not.toMatch(/this server/i);
      expect(fr[key]).not.toMatch(/ce serveur/i);
    }
  });

  it("offers, instead of a grey menu, one click per action that asks the bot to do it", () => {
    const offline: BotBranchInfo = { branch: local.name, place: "remote", computer: "sandbox", offline: true, canPublish: false, publishBlocked: "offline" };
    const html = renderToStaticMarkup(createElement(BranchMenuPanel, { branch: local, info: offline, archived: false, botName: "Scout", onPick: () => {} }));
    expect(html).toContain('data-branch-away="botPanel.branch.away.sandboxOff"');
    expect(html).toContain("Your cloud computer is stopped. Start it in the Computer tab and try again, or ask Scout to do this action: its commands start your cloud computer.");
    // the reason is outside the menu (a menu holds only its items) and describes it
    const reason = /<p id="([^"]+)" data-branch-away=/.exec(html)?.[1];
    expect(reason).toBeTruthy();
    const menu = /<div role="menu"[^>]*>/.exec(html)?.[0] ?? "";
    expect(menu).toContain(`aria-describedby="${reason}"`);
    expect(html.indexOf("data-branch-away")).toBeLessThan(html.indexOf('role="menu"'));
    expect(html.slice(html.indexOf('role="menu"'))).not.toContain("data-branch-away");
    for (const id of ["commit", "push", "pr", "diff", "delete"]) {
      const row = new RegExp(`<button[^>]*data-menu-item="${id}"[^>]*>`).exec(html)?.[0] ?? "";
      expect(row, id).toContain("data-menu-item-ask");
      expect(row, id).not.toContain("disabled");
    }
    expect(html.match(/Ask Scout to do it/g)).toHaveLength(5);
    expect(html).not.toMatch(/this server/i);
    // archive and Open in Computer stay what they are
    expect(/<button[^>]*data-menu-item="archive"[^>]*>/.exec(html)?.[0]).not.toContain("data-menu-item-ask");
    // where the panel can act: the actions themselves, no asking
    const here = renderToStaticMarkup(createElement(BranchMenuPanel, { branch: local, info: info(), archived: false, botName: "Scout", onPick: () => {} }));
    expect(here).not.toContain("data-menu-item-ask");
    expect(here).not.toContain("data-branch-away");
    expect(here).not.toContain("aria-describedby");
    // while the branch is read, the actions wait and say so
    const reading = renderToStaticMarkup(createElement(BranchMenuItems, { branch: local, archived: false, botName: "Scout", onPick: () => {} }));
    expect(reading).toContain("Reading this branch…");
    expect(reading).not.toContain("data-menu-item-ask");
  });

  it("words the request for each action on that branch, in English and in French", () => {
    expect(branchAskText("push", "fix/send-card")).toBe("Push the branch fix/send-card to its remote.");
    expect(branchAskText("commit", "fix/send-card")).toBe("Commit the changes on the branch fix/send-card, with a clear message.");
    expect(branchAskText("pr", "fix/send-card")).toBe("Open a pull request from the branch fix/send-card.");
    expect(branchAskText("diff", "fix/send-card")).toContain("diff of the branch fix/send-card");
    expect(branchAskText("delete", "fix/send-card")).toBe("Delete the local branch fix/send-card. Keep its pushed copy, its pull request and its folder.");
    const keys = Object.keys(en).filter((key) => key.startsWith("botPanel.branch.ask") || key.startsWith("botPanel.branch.away.") || key.startsWith("botPanel.branch.on") || key === "botPanel.branch.reading" || key === "botPanel.branch.hint.elsewhere");
    expect(keys.length).toBeGreaterThanOrEqual(25);
    for (const key of keys as Array<keyof typeof en>) {
      const french = (fr as Record<string, string>)[key];
      expect(french, key).toBeTruthy();
      expect(french, key).not.toBe(en[key]);
      expect([en[key], french].join(" "), key).not.toMatch(/[\u2013\u2014]/);
      expect((french.match(/\{\w+\}/g) ?? []).sort(), key).toEqual((en[key].match(/\{\w+\}/g) ?? []).sort());
    }
    expect(fr["botPanel.branch.ask"]).toBe("Demander à {bot} de le faire");
    expect(fr["botPanel.branch.ask.push"]).toBe("Pousse la branche {branch} vers son dépôt distant.");
  });

  it("says where the branch is, and asks to confirm a push only on a client's computer", () => {
    expect(branchWhere(info({}, { place: "remote", computer: "sandbox" }))).toBe("on your cloud computer");
    expect(branchWhere(info({}, { place: "remote", computer: "local_vm" }))).toBe("on your Local VM");
    expect(branchWhere(info({}, { place: "remote", computer: "desktop", host: "Studio" }))).toBe("on Studio");
    expect(branchWhere(info({}, { place: "remote", computer: "desktop" }))).toBe("on your computer");
    expect(branchWhere(info())).toBeUndefined();
    for (const computer of ["sandbox", "desktop", "local_vm"] as const) expect(remoteActionNeedsConfirm(info({}, { place: "remote", computer }), "push"), computer).toBe(false);
    expect(remoteActionNeedsConfirm(info({}, { place: "remote", computer: "remote_session" }), "pr")).toBe(true);
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
    const html = renderToStaticMarkup(createElement(CodeBranchList, { branches: work.branches, archivedBranches: work.archivedBranches, now: NOW, label: "Branches", actions: { botId: "pepper", botName: "Pepper", onArchive: async () => {} } }));
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
    // every file checked: it says the commit takes every change, also any not listed (as it does)
    expect(html).toContain('data-branch-commit-scope=""');
    expect(html).toContain("With every file checked, every change in this repository is committed, including any not listed here.");
  });

  it("words a refusal by its code, else the server's message", () => {
    expect(branchErrorText(new ApiError("x", 403, { code: "github_not_connected" }))).toBe("Connect your own GitHub account on the GitHub plugin's page (Plugins > Sources > GitHub connection)");
    expect(branchErrorText(new ApiError("x", 409, { code: "rejected" }))).toContain("nothing is forced");
    expect(branchErrorText(new ApiError("Something else", 500, { code: "odd" }))).toBe("Something else");
    // the computer is there but busy, in plain words; no "bot's computer" for the person's own
    expect(branchErrorText(new ApiError("x", 503, { code: "busy" }))).toBe("The computer that holds this branch is busy with other work. Try again in a moment.");
    expect(branchErrorText(new ApiError("x", 502, { code: "offline" }))).toBe("The computer that holds this branch cannot be reached right now");
    expect(branchErrorText(new ApiError("x", 409, { code: "no_path" }))).toBe("The folder that holds this branch is not known");
    // too long for that computer's connection: what to do, never "cannot be reached"
    expect(branchErrorText(new ApiError("x", 413, { code: "too_long" }))).toBe("That is too long to send to that computer in one command, so nothing ran there. Ask the bot to do it.");
    expect(branchErrorText(new ApiError("x", 413, { code: "commit_too_long" }))).toBe("That commit is too long to send to that computer in one command. Pick fewer files or shorten the message, or ask the bot to commit.");
    // the message is what does not fit: said so, never "fewer files"
    expect(branchErrorText(new ApiError("x", 413, { code: "message_too_long_for_computer" }))).toBe("That commit message is too long for that computer. Shorten it, or ask the bot to commit.");
    expect(en["botPanel.branch.error.messageTooLong"]).not.toMatch(/files/i);
    expect((fr as Record<string, string>)["botPanel.branch.error.messageTooLong"]).toBe("Ce message de commit est trop long pour cet ordinateur. Raccourcissez-le, ou demandez au bot de faire le commit.");
    expect((fr as Record<string, string>)["botPanel.branch.error.tooLong"]).not.toMatch(/fichiers/);
    // that computer's own git identity, not the person's profile
    expect(branchErrorText(new ApiError("x", 409, { code: "no_git_identity" }))).toBe("Git has no name and email on that computer to sign the commit. Set them there (git config --global user.name and user.email), then try again, or ask the bot to commit.");
    for (const key of ["botPanel.branch.error.tooLong", "botPanel.branch.error.commitTooLong", "botPanel.branch.error.messageTooLong", "botPanel.branch.commit.everyChange", "botPanel.branch.error.noGitIdentity", "botPanel.branch.tryAgain"] as const) {
      expect((fr as Record<string, string>)[key], key).toBeTruthy();
      expect(`${en[key]} ${(fr as Record<string, string>)[key]}`, key).not.toMatch(/[\u2013\u2014]/);
    }
    expect((fr as Record<string, string>)["botPanel.branch.error.noGitIdentity"]).not.toMatch(/profil/);
    expect(en["botPanel.branch.error.noGitIdentity"]).not.toMatch(/profile/);
  });

  it("offers to try again where trying again can help, never where it cannot", () => {
    const remote = (extra: Partial<BotBranchInfo>): BotBranchInfo => ({ branch: local.name, place: "remote", canPublish: false, ...extra });
    const items = (read: BotBranchInfo | undefined, readFailed = false) => renderToStaticMarkup(createElement(BranchMenuItems, { branch: local, info: read, archived: false, botName: "Scout", readFailed, onPick: () => {} }));
    for (const read of [remote({ offline: true, computer: "sandbox" }), remote({ offline: true, computer: "desktop" }), remote({ offline: true, computer: "local_vm" }), remote({ offline: true, computer: "remote_session" }), remote({ publishBlocked: "unknown_os" })]) {
      expect(items(read), JSON.stringify(read)).toContain('data-menu-item="retry"');
    }
    expect(items(undefined, true)).toContain('data-menu-item="retry"');
    // the place or the folder is not known, or Windows: reading again changes nothing
    for (const read of [{ branch: local.name, place: "elsewhere", canPublish: false } as BotBranchInfo, remote({ noPath: true }), remote({ publishBlocked: "unknown_os", windows: true }), info(), undefined]) {
      expect(items(read), JSON.stringify(read)).not.toContain('data-menu-item="retry"');
    }
  });

  it("asks the bot to do this action, naming it, and never says the bot's computer where it is the person's", () => {
    for (const key of Object.keys(en).filter((entry) => entry.startsWith("botPanel.branch.away.")) as Array<keyof typeof en>) {
      expect(en[key], key).toMatch(/ask \{bot\} to do this action/i);
      expect((fr as Record<string, string>)[key], key).toMatch(/demande à \{bot\} de faire cette action/i);
      expect(en[key], key).not.toMatch(/\{bot\}'s computer|bot's computer/);
    }
    // a computer that is off: ask once it is back (the bot cannot reach it either)
    for (const key of ["botPanel.branch.away.desktopOff", "botPanel.branch.away.vmOff", "botPanel.branch.away.remoteOff"] as const) {
      expect(en[key], key).toMatch(/once it (?:is connected|runs|is back)/);
    }
    for (const key of ["botPanel.branch.hint.offline", "botPanel.branch.hint.noPath", "botPanel.branch.error.busy"] as const) {
      expect(en[key], key).not.toMatch(/bot's computer/);
      expect((fr as Record<string, string>)[key], key).not.toMatch(/ordinateur du bot/);
    }
  });

  it("keeps what the row no longer shows behind the menu: details, GitHub, copy link, and Ignore (#2148)", () => {
    const pushed: CodingBranch = { ...local, pushed: true, url: "https://github.com/acme/web/tree/feat/it-tools-widgets" };
    const html = renderToStaticMarkup(createElement(BranchMenuPanel, { branch: pushed, info: info(), archived: false, botName: "Scout", details: "2 commits ahead · 15 h ago", canIgnore: true, onPick: () => {} }));
    expect(html).toContain("data-branch-details");
    expect(html).toContain("2 commits ahead · 15 h ago");
    expect(html).toContain('data-menu-item="github"');
    expect(html).toContain('data-menu-item="copyLink"');
    expect(html).toContain('data-menu-item="ignore"');
    expect(html).toContain(">Ignore<");
    // no link: no GitHub nor copy; no handler: no Ignore
    const bare = renderToStaticMarkup(createElement(BranchMenuItems, { branch: local, info: info(), archived: false, botName: "Scout", onPick: () => {} }));
    expect(bare).not.toContain('data-menu-item="github"');
    expect(bare).not.toContain('data-menu-item="ignore"');
    // the row no longer says "Pushed to <URL>" nor where the computer is
    const row = renderToStaticMarkup(createElement(BranchRow, { branch: pushed, now: NOW, info: info({}, { place: "remote", computer: "desktop" }), actions: { botId: "pepper", botName: "Pepper", onArchive: async () => {}, onIgnore: () => {} }, onAct: () => {} }));
    expect(row).not.toMatch(/Pushed to/i);
    expect(row).not.toMatch(/>[^<]*on your computer[^<]*</i);
    expect(row).toMatch(/title="[^"]*github\.com\/acme\/web\/tree/);
    expect(en["botPanel.branch.ignore"]).toBe("Ignore");
    expect(fr["botPanel.branch.ignore"]).toBe("Ignorer");
  });
});
