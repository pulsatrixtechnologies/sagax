// @vitest-environment happy-dom
// claude.ai artifact cards (#2018): summary as plain text, the consent card,
// comment threads with reply and resolve, and in-place refresh per url.
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { resetClaudeArtifactStore } from "@/lib/claude-artifacts";
import { ChatMarkdown } from "./ChatMarkdown";
import { ClaudeArtifactCard } from "./ClaudeArtifactCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const URL_A = "https://claude.ai/artifact/AbCdEf123456";

type Reply = { status?: number; body: unknown };
let routes: Record<string, () => Reply>;
let fetchMock: ReturnType<typeof vi.fn>;
let root: Root | null = null;

function json({ status = 200, body }: Reply) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  setLocale("en");
  resetClaudeArtifactStore();
  routes = {};
  fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const path = String(input).split("?")[0]!;
    const route = routes[`${init?.method ?? "GET"} ${path}`];
    return json(route ? route() : { status: 404, body: { error: "not_found" } });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function flush() {
  for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); });
}

async function mount(element: ReturnType<typeof createElement>) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(element));
  await flush();
  return host;
}

const calls = (method: string, path: string) =>
  fetchMock.mock.calls.filter(([input, init]) => (init?.method ?? "GET") === method && String(input).split("?")[0] === path);

describe("ClaudeArtifactCard", () => {
  it("shows the summary as plain text, the owner and Open", async () => {
    routes["GET /api/claude-artifacts/summary"] = () => ({
      body: { url: URL_A, title: "Quarter plan", owned: false, updatedAt: new Date(Date.now() - 5 * 60_000).toISOString(), summary: "<img src=x onerror=alert(1)> two goals" },
    });
    const host = await mount(createElement(ClaudeArtifactCard, { url: URL_A }));
    expect(host.textContent).toContain("Quarter plan");
    expect(host.textContent).toContain("Someone else's");
    expect(host.querySelector("time")?.textContent).toMatch(/^Updated .*5/);
    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector("iframe")).toBeNull();
    expect(host.textContent).toContain("<img src=x onerror=alert(1)> two goals");
    expect(host.querySelector("a")?.getAttribute("href")).toBe(URL_A);
    expect(host.querySelector("a")?.getAttribute("rel")).toContain("noopener");
    expect(String(calls("GET", "/api/claude-artifacts/summary")[0]?.[0])).toContain(encodeURIComponent(URL_A));
    // not owned: no comments read
    expect(calls("GET", "/api/claude-artifacts/comments")).toHaveLength(0);
  });

  it("Open uses the desktop claude.ai window, else a new tab with noopener", async () => {
    routes["GET /api/claude-artifacts/summary"] = () => ({ body: { url: URL_A, title: "T", owned: true } });
    routes["GET /api/claude-artifacts/comments"] = () => ({ body: { threads: [] } });
    const open = vi.fn(() => null);
    vi.stubGlobal("open", open);
    const host = await mount(createElement(ClaudeArtifactCard, { url: URL_A }));
    act(() => host.querySelector("a")!.click());
    expect(open).toHaveBeenCalledWith(URL_A, "_blank", "noopener");

    const openClaudeAi = vi.fn(async () => "created" as const);
    (window as unknown as { ogb: unknown }).ogb = { artifactWindow: { openClaudeAi } };
    try {
      act(() => host.querySelector("a")!.click());
      expect(openClaudeAi).toHaveBeenCalledWith(URL_A);
      expect(open).toHaveBeenCalledTimes(1);
    } finally {
      delete (window as unknown as { ogb?: unknown }).ogb;
    }
  });

  it("an error and a signed-out engine each say so", async () => {
    routes["GET /api/claude-artifacts/summary"] = () => ({ status: 500, body: { error: "boom" } });
    const host = await mount(createElement(ClaudeArtifactCard, { url: URL_A }));
    expect(host.textContent).toContain("could not be read");
    routes["GET /api/claude-artifacts/summary"] = () => ({ status: 409, body: { error: "claude_not_signed_in" } });
    await act(async () => (host.querySelector("button") as HTMLButtonElement).click());
    await flush();
    expect(host.textContent).toContain("not signed in to claude.ai");
    expect(host.textContent).toContain("Reconnect the account");
  });

  it("another account's artifact becomes the consent card, and the copy asks the bot", async () => {
    routes["GET /api/claude-artifacts/summary"] = () => ({ body: { url: URL_A, blocked: "other_account", account: "engine@example.com" } });
    const send = vi.fn();
    const host = await mount(createElement(ClaudeArtifactCard, { url: URL_A, onSendToBot: send }));
    expect(host.textContent).toContain("engine@example.com");
    const copy = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("publish a copy"))!;
    act(() => copy.click());
    expect(send).toHaveBeenCalledWith(
      `Publish a copy of ${URL_A} from your account with claude_artifact. You cannot read that page from another claude.ai account: publish from an HTML file in your workspace (or a paste), then give the new URL so references can be updated.`,
    );
    expect(host.textContent).toContain("Reconnect the account");
  });

  it("an owned artifact lists open threads as plain text, reply and resolve refetch", async () => {
    routes["GET /api/claude-artifacts/summary"] = () => ({ body: { url: URL_A, title: "Quarter plan", owned: true } });
    let threads = [
      { id: "t1", status: "open", author: "Alex", text: "<b>fix</b> the second goal", replies: [{ author: "Sam", text: "agreed" }] },
      { id: "t2", status: "resolved", text: "old", replies: [] },
    ];
    routes["GET /api/claude-artifacts/comments"] = () => ({ body: { threads } });
    routes["POST /api/claude-artifacts/comments/reply"] = () => ({ body: { ok: true } });
    routes["POST /api/claude-artifacts/comments/resolve"] = () => {
      threads = threads.map((thread) => ({ ...thread, status: "resolved" }));
      return { body: { ok: true } };
    };
    const host = await mount(createElement(ClaudeArtifactCard, { url: URL_A }));
    const comment = host.querySelector('[data-claude-artifact-comment="t1"]')!;
    expect(comment.textContent).toContain("Comment on Quarter plan");
    expect(comment.textContent).toContain("<b>fix</b> the second goal");
    expect(comment.querySelector("b")).toBeNull();
    expect(comment.textContent).toContain("agreed");
    expect(host.querySelector('[data-claude-artifact-comment="t2"]')).toBeNull();

    const button = (label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === label) as HTMLButtonElement;
    act(() => button("Reply").click());
    const input = host.querySelector("input")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "done");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button("Send").click());
    await flush();
    const reply = calls("POST", "/api/claude-artifacts/comments/reply")[0]!;
    expect(JSON.parse(String(reply[1]!.body))).toEqual({ url: URL_A, threadId: "t1", text: "done" });
    expect(calls("GET", "/api/claude-artifacts/summary").length).toBe(2);

    await act(async () => button("Resolve").click());
    await flush();
    expect(JSON.parse(String(calls("POST", "/api/claude-artifacts/comments/resolve")[0]![1]!.body))).toEqual({ url: URL_A, threadId: "t1" });
    expect(host.querySelector('[data-claude-artifact-comment="t1"]')).toBeNull();
  });
});

describe("ChatMarkdown with claude.ai artifacts", () => {
  beforeEach(() => {
    routes["GET /api/claude-artifacts/summary"] = () => ({ body: { url: URL_A, title: "Quarter plan", owned: false } });
  });

  it("a claude.ai link renders as the card", async () => {
    const host = await mount(createElement(ChatMarkdown, { text: `See ${URL_A}/ here` }));
    expect(host.querySelector("[data-claude-artifact]")).not.toBeNull();
    expect(host.textContent).toContain("Quarter plan");
  });

  it("the consent fence is read before the page fence", async () => {
    const fence = ["```artifact", JSON.stringify({ blocked: "other_account", url: URL_A, account: "engine@example.com" }), "```"].join("\n");
    const send = vi.fn();
    const host = await mount(createElement(ChatMarkdown, { text: fence, youtubeSendToBot: send }));
    expect(host.querySelector("[data-claude-artifact-consent]")).not.toBeNull();
    expect(host.textContent).toContain("engine@example.com");
    expect(calls("GET", "/api/claude-artifacts/summary")).toHaveLength(0);
  });

  it("a publish of a claude.ai url uses the live card, and a later publish refreshes it", async () => {
    const fence = ["```artifact", JSON.stringify({ title: "Quarter plan", url: URL_A }), "```"].join("\n");
    const host = await mount(createElement(ChatMarkdown, { text: fence, message: { threadId: "th", messageId: "m1" } as never }));
    expect(host.querySelector("[data-claude-artifact]")).not.toBeNull();
    expect(calls("GET", "/api/claude-artifacts/summary")).toHaveLength(1);
    const second = document.createElement("div");
    document.body.append(second);
    const other = createRoot(second);
    await act(async () => other.render(createElement(ChatMarkdown, { text: fence, message: { threadId: "th", messageId: "m2" } as never })));
    await flush();
    // the later publish refreshed both cards with one shared read
    expect(calls("GET", "/api/claude-artifacts/summary")).toHaveLength(2);
    act(() => other.unmount());
  });
});
