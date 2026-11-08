// @vitest-environment happy-dom
// #2946: a learned skill's card shows its name and gist; the
// SKILL.md, its source and its sha256 render only once "View SKILL.md" is
// opened, and a settled skill folds to one compact row.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { Message } from "@/state/store";
import type { SkillRequestCardData } from "../../shared/skill-request";
import { ApprovalCard } from "./ApprovalCard";
import { ProposalBody } from "./ProposalBody";

const skill: SkillRequestCardData = {
  version: 1,
  requestId: "skill-request",
  botId: "bot-1",
  threadId: "thread-1",
  stagedId: "staged-1",
  action: "create",
  name: "task-abort",
  gist: "Stops a running task cleanly when the person asks.",
  source: "learn:automatic review of this conversation",
  preview: "---\nname: task-abort\ndescription: Stops a task.\n---\n\n# Task abort\n",
  sha256: "6d3bee9d".repeat(8),
  warnings: [],
  createdAt: 1,
};

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  setLocale("en");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
});

describe("ProposalBody", () => {
  it("keeps the SKILL.md out of the DOM until the disclosure is opened", () => {
    flushSync(() => root.render(createElement(ProposalBody, { text: skill.gist, skillRequest: skill, ariaLabel: "details" })));
    expect(host.querySelector("[data-proposal-summary]")?.textContent).toBe(skill.gist);
    expect(host.querySelector("[data-skill-md-body]")).toBeNull();
    expect(host.textContent).not.toContain("name: task-abort");
    expect(host.textContent).not.toContain("sha256 6d3bee9d");
    expect(host.textContent).not.toContain("learn:automatic review");

    const toggle = host.querySelector<HTMLButtonElement>("[data-skill-md-toggle]")!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    flushSync(() => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector("[data-skill-md-body]")).not.toBeNull();
    expect(host.textContent).toContain("name: task-abort");
    expect(host.textContent).toContain("sha256 6d3bee9d");
    expect(host.textContent).toContain("Source: learn:automatic review of this conversation");
  });

  it("folds a settled learned skill to one compact row", () => {
    const message: Message = {
      id: "skill-done",
      role: "bot",
      kind: "options",
      at: 1,
      card: {
        title: 'Enable skill "task-abort"?',
        subtitle: skill.gist,
        options: ["Enable", "Deny"],
        requestId: "skill-request",
        tool: "stage_skill",
        answered: "Enable",
        skillRequest: skill,
      },
    };
    flushSync(() => root.render(createElement(ApprovalCard, { message })));
    const row = host.querySelector("[data-proposal-receipt]");
    expect(row).not.toBeNull();
    expect(host.querySelector("[data-proposal-card]")).toBeNull();
    expect(host.textContent).toContain("task-abort");
    expect(host.textContent).not.toContain("name: task-abort");
    expect(host.querySelector("[data-skill-md-body]")).toBeNull();
  });
});
