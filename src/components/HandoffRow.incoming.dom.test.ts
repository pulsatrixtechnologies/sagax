// @vitest-environment happy-dom
// #3581: the "Asked by" line never quotes the request; its name opens that
// party's exchanges of the line, newest first: a stored copy's request and
// reply in the bot-to-bot sheet, and one request at a time (Newer, Older)
// when the party asked in several threads. Neutral names only (term-guard).
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/use-side-transcript", () => ({
  useSideTranscript: (threadId: string) => ({ messages: [{ id: `${threadId}-1`, role: "user", kind: "text", at: 1, text: `Thread ${threadId}` }], failed: false }),
}));

import type { Bot, Message } from "@/state/store";
import { setLocale } from "@/lib/i18n";
import type { IncomingEntry } from "@/lib/incoming-line";
import { IncomingLine } from "./HandoffRow";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
setLocale("en");

const bots = [{ id: "self", name: "Server", color: "green" }, { id: "b", name: "Bot B", color: "blue" }] as unknown as Bot[];
const self = { id: "self", name: "Server", color: "green" };
const row = (id: string, at: number) => ({ id, role: "bot", kind: "text", at, text: "" }) as Message;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** Lets the lazy sheet load: waits until `ready` holds, a few ticks at most. */
async function settle(ready: () => boolean = () => true) {
  for (let i = 0; i < 50 && !ready(); i++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
  await act(async () => { await Promise.resolve(); });
}

describe("IncomingLine", () => {
  it("opens an AI client's stored requests and replies, newest first, from its name", async () => {
    const entries: IncomingEntry[] = [
      { verb: "askedBy", key: "agent:Client", name: "Client", agent: true, request: "First request", reply: "First reply", message: row("c1", 1_000) },
      { verb: "askedBy", key: "agent:Client", name: "Client", agent: true, request: "Second request", reply: "Second reply", message: row("c2", 2_000) },
    ];
    act(() => root.render(createElement(IncomingLine, { line: { verb: "askedBy", entries }, self, bots })));
    const line = host.querySelector('[data-testid="incoming-line"]')!;
    expect(line.textContent).toContain("Asked by");
    expect(line.textContent).toContain("Client");
    expect(line.textContent).toContain("2 requests");
    expect(line.textContent).not.toContain("request ");
    expect(line.querySelector("[title*='request']")).toBeNull();
    act(() => (host.querySelector('[data-testid="incoming-line-recipient"]') as HTMLButtonElement).click());
    await settle();
    const sheet = document.querySelector('[data-testid="incoming-exchange-sheet"]')!;
    expect(sheet).not.toBeNull();
    const words = sheet.textContent ?? "";
    for (const said of ["First request", "First reply", "Second request", "Second reply"]) expect(words).toContain(said);
    expect(words.indexOf("Second request")).toBeLessThan(words.indexOf("First request"));
  });

  it("opens a number's texts and the bot's answers, newest first, as a teammate's request opens (#4112)", async () => {
    const entries: IncomingEntry[] = [
      { verb: "askedBy", key: "phone:sms:555 010-0142", name: "555 010-0142", phone: "sms", request: "First text", reply: "First answer", message: row("t1", 1_000) },
      { verb: "askedBy", key: "phone:sms:555 010-0142", name: "555 010-0142", phone: "sms", request: "Second text", reply: "Second answer", message: row("t2", 2_000) },
    ];
    act(() => root.render(createElement(IncomingLine, { line: { verb: "askedBy", entries }, self, bots })));
    const line = host.querySelector('[data-testid="incoming-line"]')!;
    expect(line.textContent).toContain("Text Message");
    expect(line.textContent).toContain("(555 010-0142)");
    expect(line.textContent).toContain("2 requests");
    expect(line.textContent).not.toContain("answer");
    act(() => (host.querySelector('[data-testid="incoming-line-recipient"]') as HTMLButtonElement).click());
    await settle(() => document.querySelector('[data-testid="incoming-exchange-sheet"]') !== null);
    const words = document.querySelector('[data-testid="incoming-exchange-sheet"]')!.textContent ?? "";
    for (const said of ["First text", "First answer", "Second text", "Second answer"]) expect(words).toContain(said);
    expect(words.indexOf("Second text")).toBeLessThan(words.indexOf("Second answer"));
    expect(words.indexOf("Second answer")).toBeLessThan(words.indexOf("First text"));
  });

  it("keeps a phone line's number and the count whole on a narrow row: only the source word gives way (#4112)", () => {
    const entries: IncomingEntry[] = [
      { verb: "askedBy", key: "phone:sms:555 010-0142", name: "555 010-0142", phone: "sms", request: "First text", message: row("s1", 1_000) },
      { verb: "askedBy", key: "phone:sms:555 010-0199", name: "555 010-0199", phone: "sms", request: "Second text", message: row("s2", 2_000) },
      { verb: "askedBy", key: "phone:sms:555 010-0142", name: "555 010-0142", phone: "sms", request: "Third text", message: row("s3", 3_000) },
    ];
    act(() => root.render(createElement(IncomingLine, { line: { verb: "askedBy", entries }, self, bots })));
    const name = host.querySelector('[data-testid="incoming-line-recipient"]')!;
    expect(name.getAttribute("title")).toBe("Text Message (555 010-0142)");
    const detail = name.querySelector("[data-line-detail]")!;
    // the number is its own element that never shrinks; the source word before it truncates
    expect(detail.textContent).toBe("(555 010-0142)");
    expect(detail.className).toContain("shrink-0");
    const lead = detail.previousElementSibling!;
    expect(lead.textContent).toBe("Text Message");
    expect(lead.className).toContain("truncate");
    // the count gives way only after the names (a near-zero shrink)
    const tail = host.querySelector("[data-line-tail]")!;
    expect(tail.textContent).toBe("3 requests");
    expect(tail.className).toContain("shrink-[0.01]");
  });

  it("says a stored request that left no answer with the line's own words", async () => {
    const entries: IncomingEntry[] = [
      { verb: "askedBy", key: "agent:Client", name: "Client", agent: true, request: "Only request", trace: "stopped", message: row("c1", 1_000) },
    ];
    act(() => root.render(createElement(IncomingLine, { line: { verb: "askedBy", entries }, self, bots })));
    expect(host.querySelector('[data-testid="incoming-line"]')?.textContent).toContain("stopped before an answer");
    act(() => (host.querySelector('[data-testid="incoming-line-recipient"]') as HTMLButtonElement).click());
    await settle();
    const words = document.querySelector('[data-testid="incoming-exchange-sheet"]')?.textContent ?? "";
    expect(words).toContain("Only request");
    expect(words).toContain("Stopped before an answer");
    expect(words).not.toContain("This request");
  });

  it("walks a bot's requests in their own threads one at a time, newest first", async () => {
    const entries: IncomingEntry[] = [
      { verb: "askedBy", key: "b", botId: "b", name: "Bot B", threadId: "t1", request: "One", message: row("s1", 1_000) },
      { verb: "askedBy", key: "b", botId: "b", name: "Bot B", threadId: "t2", request: "Two", message: row("s2", 2_000) },
    ];
    act(() => root.render(createElement(IncomingLine, { line: { verb: "askedBy", entries }, self, bots })));
    act(() => (host.querySelector('[data-testid="incoming-line-recipient"]') as HTMLButtonElement).click());
    await settle(() => Boolean(document.querySelector("[data-incoming-position]")));
    expect(document.body.textContent).toContain("Thread t2");
    expect(document.querySelector("[data-incoming-position]")?.textContent).toBe("1 of 2");
    act(() => (document.querySelector("[data-incoming-older]") as HTMLButtonElement).click());
    await settle(() => (document.body.textContent ?? "").includes("Thread t1"));
    expect(document.body.textContent).toContain("Thread t1");
    expect(document.querySelector("[data-incoming-position]")?.textContent).toBe("2 of 2");
  });
});
