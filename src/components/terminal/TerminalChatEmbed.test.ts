// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TerminalEmbed } from "../../../shared/terminal-resources";

const fixture = vi.hoisted(() => ({
  status: "live" as "connecting" | "live" | "ended",
  listeners: new Set<() => void>(),
  state: { connecting: { status: "connecting" }, live: { status: "live" }, ended: { status: "ended" } } as const,
  calls: [] as Array<{ path: string; method?: string; body?: unknown }>,
}));
vi.mock("./terminal-session", () => {
  const session = {
    state: () => fixture.state[fixture.status],
    subscribe: (listener: () => void) => { fixture.listeners.add(listener); return () => fixture.listeners.delete(listener); },
    retain: () => () => {},
    attach: () => () => {},
    getSelection: () => "",
    focus: () => {},
  };
  return { terminalSession: () => session };
});
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: async (path: string, init?: { method?: string; body?: string }) => {
    fixture.calls.push({ path, method: init?.method, body: init?.body ? JSON.parse(init.body) : undefined });
    return {};
  },
}));

const { TerminalChatEmbed, terminalFoldedLabel, terminalStartsFolded } = await import("./TerminalChatEmbed");
const { t } = await import("@/lib/i18n");

const owner = { botId: "b1", threadId: "t1", messageId: "m1" };
const base: TerminalEmbed = { sessionId: "s1", provider: "tailcat", resourceId: "r1", label: "x", hostLabel: "POSTE-02", status: "live", openedAt: 1_000 };

let host: HTMLDivElement;
let root: Root;
const render = (embed: TerminalEmbed) => act(() => root.render(createElement(TerminalChatEmbed, { embed, owner })));
const q = (selector: string) => host.querySelector<HTMLElement>(selector);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  fixture.status = "live";
  fixture.calls = [];
  fixture.listeners.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("terminal card fold", () => {
  it("names an ended session in one row: label, host, Ended, length", () => {
    const label = terminalFoldedLabel({ ...base, status: "ended", endedAt: 1_000 + 5 * 60_000 }, "ended");
    expect(label).toContain(t("remoteSession.terminal"));
    expect(label).toContain("POSTE-02");
    expect(label).toContain(t("terminal.status.ended"));
    expect(label).toContain("5 min");
    expect(terminalStartsFolded({ ...base, status: "ended" })).toBe(true);
    expect(terminalStartsFolded({ ...base, status: "ended", collapsed: false })).toBe(false);
    expect(terminalStartsFolded(base)).toBe(false);
  });

  it("X on a live session ends it, then folds the card and saves the fold", () => {
    render(base);
    const x = q("[data-terminal-close]")!;
    expect(x.dataset.terminalClose).toBe("end");
    act(() => x.click());
    expect(fixture.calls).toContainEqual(expect.objectContaining({ path: "/api/terminal/sessions/s1/close", method: "POST" }));
    expect(fixture.calls).toContainEqual({ path: "/api/bots/b1/terminal-embeds/m1", method: "PATCH", body: { threadId: "t1", collapsed: true } });
    expect(q("[data-terminal-folded]")!.dataset.terminalFolded).toBe("true");
  });

  it("folds by itself when the session ends, and reopens on the kept output", () => {
    render(base);
    expect(q("[data-terminal-folded]")!.dataset.terminalFolded).toBe("false");
    fixture.status = "ended";
    act(() => fixture.listeners.forEach((listener) => listener()));
    expect(q("[data-terminal-folded]")!.dataset.terminalFolded).toBe("true");
    // the server's ended embed, with the output kept, after a reload
    render({ ...base, status: "ended", collapsed: true, endedAt: 43_000, transcript: "$ ls\na.txt" });
    expect(q("[data-terminal-folded-label]")!.textContent).toContain("42 s");
    act(() => q("[data-terminal-folded]")!.click());
    expect(q("[data-terminal-transcript]")!.textContent).toBe("$ ls\na.txt");
    expect(q("[data-terminal-close]")!.dataset.terminalClose).toBe("fold");
    expect(fixture.calls.at(-1)).toEqual({ path: "/api/bots/b1/terminal-embeds/m1", method: "PATCH", body: { threadId: "t1", collapsed: false } });
  });
});
