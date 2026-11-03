// @vitest-environment happy-dom
// Details > Coding, a branch on the person's cloud computer while it is
// stopped (the case reported on 2026-11-02): the menu says why in plain
// words, and one click on an action sends the bot that request, for that
// branch, in the conversation the branch came from. Deleting asks first.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const dispatch = vi.fn();
const api = vi.fn();
vi.mock("@/state/store", () => ({
  api: (...args: unknown[]) => api(...args),
  ApiError: class ApiError extends Error {},
  useStore: () => ({ state: {}, dispatch }),
}));

import type { BotBranchInfo, CodingBranch } from "@/lib/code-branches";
import { CodeBranchList } from "./CodeBranchList";

const NOW = 1_800_000_000_000;
const branch: CodingBranch = { name: "fix/send-card", repo: "acme/web", pushed: true, at: NOW - 3_600_000, threadId: "t-work" };
const stopped: BotBranchInfo = { branch: branch.name, place: "remote", computer: "sandbox", offline: true, canPublish: false, publishBlocked: "offline" };

let root: Root | undefined;
afterEach(() => {
  root?.unmount();
  root = undefined;
  document.body.innerHTML = "";
  dispatch.mockReset();
  api.mockReset();
});

const settle = () => new Promise((done) => setTimeout(done, 0));

async function mount(info: BotBranchInfo | Error) {
  api.mockImplementation(async () => { if (info instanceof Error) throw info; return info; });
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => root!.render(createElement(CodeBranchList, {
    branches: [branch],
    now: NOW,
    label: "Branches",
    actions: { botId: "scout-id", botName: "Scout", onArchive: async () => {} },
  })));
  await settle();
  await settle();
}

function open(): HTMLElement {
  const button = document.querySelector<HTMLButtonElement>('[data-branch-menu-button="fix/send-card"]')!;
  flushSync(() => button.click());
  return document.querySelector<HTMLElement>('[data-branch-menu="fix/send-card"]')!;
}

describe("Coding branches: asking the bot when its computer cannot be reached", () => {
  it("says why and sends the bot the push, in the branch's own conversation", async () => {
    await mount(stopped);
    const menu = open();
    expect(menu.querySelector("[data-branch-away]")?.textContent).toBe("Your cloud computer is stopped. Start it in the Computer tab and try again, or ask Scout to do this action: its commands start your cloud computer.");
    // the reason describes the menu from outside it
    const list = menu.querySelector<HTMLElement>('[role="menu"]')!;
    expect(list.querySelector("[data-branch-away]")).toBeNull();
    expect(document.getElementById(list.getAttribute("aria-describedby") ?? "")?.textContent).toContain("Your cloud computer is stopped.");
    const push = menu.querySelector<HTMLButtonElement>('[data-menu-item="push"]')!;
    expect(push.disabled).toBe(false);
    expect(push.textContent).toContain("Ask Scout to do it");
    flushSync(() => push.click());
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0]![0]).toMatchObject({ type: "send", botId: "scout-id", threadId: "t-work", text: "Push the branch fix/send-card to its remote." });
    await settle();
    expect(document.querySelector("[data-branch-note]")?.textContent).toBe("Asked Scout in its conversation");
    // the panel itself ran nothing on that branch
    expect(api.mock.calls.every(([path]) => !String(path).includes("/branch/push"))).toBe(true);
  });

  it("says so when sending fails", async () => {
    await mount(stopped);
    flushSync(() => open().querySelector<HTMLButtonElement>('[data-menu-item="pr"]')!.click());
    const sent = dispatch.mock.calls[0]![0] as { text: string; onError: () => void };
    expect(sent.text).toBe("Open a pull request from the branch fix/send-card.");
    flushSync(() => sent.onError());
    expect(document.querySelector('[data-branch-note="error"]')?.textContent).toBe("The request could not be sent to Scout. Try again.");
  });

  it("asks before sending a delete", async () => {
    await mount(stopped);
    flushSync(() => open().querySelector<HTMLButtonElement>('[data-menu-item="delete"]')!.click());
    expect(dispatch).not.toHaveBeenCalled();
    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).toContain("Ask Scout to delete fix/send-card?");
    const confirm = [...dialog!.querySelectorAll("button")].find((button) => button.textContent === "Ask Scout")!;
    flushSync(() => confirm.click());
    expect(dispatch.mock.calls[0]![0]).toMatchObject({ type: "send", threadId: "t-work", text: "Delete the local branch fix/send-card. Keep its pushed copy, its pull request and its folder." });
  });

  it("reads again only the rows of the conversation the bot worked in, not every row", async () => {
    // each read is a command on the bot's computer (the desktop app runs one at a time)
    api.mockImplementation(async () => stopped);
    const other: CodingBranch = { name: "feat/other", repo: "acme/web", pushed: false, at: NOW - 7_200_000, threadId: "t-other" };
    const sibling: CodingBranch = { ...branch, name: "fix/sibling" };
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const render = (rows: CodingBranch[]) => flushSync(() => root!.render(createElement(CodeBranchList, {
      branches: rows,
      now: NOW,
      label: "Branches",
      actions: { botId: "scout-id", botName: "Scout", onArchive: async () => {} },
    })));
    const reads = () => api.mock.calls.map(([path]) => String(path)).filter((path) => /\/code\/branch\?/.test(path)).map((path) => new URLSearchParams(path.split("?")[1]).get("branch"));
    render([branch, sibling, other]);
    await settle();
    expect(reads().sort()).toEqual(["feat/other", "fix/send-card", "fix/sibling"]);
    api.mockClear();
    // the bot ran git again on fix/send-card: its conversation's rows are read again, the other is not
    render([{ ...branch, at: NOW - 60_000 }, sibling, other]);
    await settle();
    expect(reads().sort()).toEqual(["fix/send-card", "fix/sibling"]);
    api.mockClear();
    // nothing changed: nothing is read
    render([{ ...branch, at: NOW - 60_000 }, sibling, other]);
    await settle();
    expect(reads()).toEqual([]);
  });

  it("offers to ask the bot when the branch could not be read at all", async () => {
    await mount(new Error("timeout"));
    const menu = open();
    expect(menu.querySelector("[data-branch-away]")?.textContent).toBe("Sagax could not read this branch right now. Try again in a moment, or ask Scout to do this action.");
    flushSync(() => menu.querySelector<HTMLButtonElement>('[data-menu-item="commit"]')!.click());
    expect(dispatch.mock.calls[0]![0]).toMatchObject({ text: "Commit the changes on the branch fix/send-card, with a clear message." });
  });
});
