// The coding job card in the bot's chat (#2148, the owner 2026-11-06): running with
// its status, elapsed time and Stop; finished with the branch, a short result
// and the PR. It never opens a thread, a thread panel or "Go to conversation".
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BotActivityItem } from "../../shared/bot-activity";
import { codingJobView, isCodingJob, lastBotText, shortRepoName, shortResult } from "@/lib/coding-job-card";
import { CodingJobCard } from "./CodingJobCard";

const NOW = 1_800_000_000_000;
const base: BotActivityItem = {
  id: "thread:t1", kind: "session", botId: "pepper", botName: "Pepper", title: "Fix the lexer",
  status: "running", startedAt: NOW - 5 * 60_000, updatedAt: NOW, threadId: "t1", coding: true, currentStep: "Running the tests",
  code: { folder: "/srv/repos/parser", branch: "fix/lexer", repo: "acme/parser", pullRequests: [], branches: [], commits: [] },
} as BotActivityItem;
const done = {
  ...base, status: "finished", endedAt: NOW - 60_000,
  code: { ...base.code!, pullRequests: [{ number: 42, title: "Split the lexer", url: "https://github.com/acme/parser/pull/42", action: "opened", at: NOW - 90_000 }], branches: [{ name: "fix/lexer", repo: "acme/parser", pushed: true, url: "https://github.com/acme/parser/tree/fix/lexer", at: NOW - 100_000 }] },
} as BotActivityItem;
const draw = (item: BotActivityItem, result?: string, onStop?: () => void) =>
  renderToStaticMarkup(createElement(CodingJobCard, { job: codingJobView(item, result), threadId: "t1", now: NOW, onStop }));
const NO_THREAD = /Open thread|Go to conversation|Open the chat|Ouvrir le chat|Ouvrir le fil|Aller à la conversation|data-thread-chip|data-open-thread/i;

describe("coding job card in the chat", () => {
  it("shows a running job with its step, elapsed time and Stop", () => {
    const html = draw(base, undefined, () => {});
    expect(html).toContain('data-coding-job-card="t1"');
    expect(html).toContain('data-coding-job-state="running"');
    // #3581: the chat's compact card (AskCard), its state while it runs
    expect(html).toContain('data-ask-card="result"');
    expect(html).toContain("data-coding-job-status");
    expect(html).toContain("data-coding-job-stop");
    expect(html).toContain("Running the tests");
    expect(html).toContain("data-coding-spinner");
    expect(html).toContain('data-coding-job-branch="fix/lexer"');
    expect(html).not.toMatch(NO_THREAD);
  });

  it("stays once finished, with the branch, a short result and the PR, without Stop", () => {
    const html = draw(done, "**Done.** I split the lexer and opened the PR.", () => {});
    expect(html).toContain('data-coding-job-state="finished"');
    expect(html).not.toContain("data-coding-job-stop");
    expect(html).not.toContain("data-coding-spinner");
    expect(html).toContain("Done. I split the lexer and opened the PR.");
    expect(html).toContain('data-coding-job-pr="https://github.com/acme/parser/pull/42"');
    expect(html).toContain("PR #42");
    expect(html).toContain("· parser");
    expect(html).not.toContain("https://github.com/acme/parser/tree");
    expect(html).not.toMatch(NO_THREAD);
  });

  it("reads the view: short repo, last bot words, coding or not", () => {
    expect(shortRepoName("acme/marketplace")).toBe("marketplace");
    expect(shortRepoName("https://github.com/acme/marketplace.git")).toBe("marketplace");
    expect(shortRepoName(undefined)).toBeUndefined();
    expect(shortResult("x".repeat(300))?.length).toBe(280);
    expect(lastBotText([{ role: "bot", text: "first" }, { role: "user", text: "ok" }, { role: "bot", kind: "tool", text: "ls" }])).toBe("first");
    expect(isCodingJob(base)).toBe(true);
    expect(isCodingJob({ coding: false, code: undefined })).toBe(false);
    expect(codingJobView(done)).toMatchObject({ branch: "fix/lexer", repo: "parser", pr: { number: 42 } });
  });
});

describe("PR link contrast (#2641)", () => {
  it("uses the accent text token, not the accent fill, for small link text", () => {
    const html = draw(done);
    expect(html).toContain("data-coding-job-pr");
    expect(html).not.toMatch(/data-coding-job-pr[^>]*class="[^"]*\btext-accent\b(?!-)/);
  });
});
