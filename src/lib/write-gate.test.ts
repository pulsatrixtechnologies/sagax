// @vitest-environment happy-dom
// While the stored drawing is on screen, this page's writes wait, in order,
// and go out unchanged once the server's own snapshot has replaced it.
import { afterEach, beforeEach, expect, it, vi } from "vitest";

let sent: string[];
beforeEach(() => {
  vi.resetModules();
  sent = [];
  window.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push(`${init?.method ?? "GET"} ${String(input)}`);
    return new Response("{}");
  }) as typeof fetch;
});
afterEach(() => vi.restoreAllMocks());

it("holds this page's writes until release, then sends them in order; reads go at once", async () => {
  const gate = await import("./write-gate");
  gate.holdWrites();
  expect(gate.writesHeld()).toBe(true);
  const read = window.fetch("/api/bots");
  const write1 = window.fetch("/api/bots/a/read", { method: "POST", body: "{}" });
  const write2 = window.fetch(new Request(`${location.origin}/api/bots/a`, { method: "PATCH" }));
  await read;
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(sent).toEqual(["GET /api/bots"]);
  gate.releaseWrites();
  await Promise.all([write1, write2]);
  expect(sent.slice(1, 2)).toEqual(["POST /api/bots/a/read"]);
  expect(sent).toHaveLength(3);
  expect(gate.writesHeld()).toBe(false);
});

it("does not hold another origin's requests", async () => {
  const gate = await import("./write-gate");
  gate.holdWrites();
  await window.fetch("https://example.com/collect", { method: "POST" });
  expect(sent).toEqual(["POST https://example.com/collect"]);
  gate.releaseWrites();
});
