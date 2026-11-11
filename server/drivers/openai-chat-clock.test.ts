// A runtime the server drives itself calls the model several times in one
// turn: each call carries the clock read when it is made, not the one the
// turn was handed with (#3511).
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RuntimeEvent } from "../contracts.ts";
import { turnClockNote, withTurnClock } from "../turns/turn-clock.ts";
import { OpenAICompatDriver } from "./openai-compat.ts";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const sse = (body: string) => new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
// A provider's refusal of a made-up tool call: the same request goes again.
const refusal = { message: "attempted to call tool 'JSON' which was not in request", type: "invalid_request_error", code: "tool_use_failed" };
const refused = () => new Response(JSON.stringify({ error: refusal }), { status: 400, headers: { "content-type": "application/json" } });
const answer = () => sse('data: {"choices":[{"index":0,"finish_reason":"stop","delta":{"content":"done"}}]}\n\ndata: [DONE]\n\n');

describe("openai chat runtime turn clock", () => {
  it("reads the clock again before each model call and replays the request as last sent", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const zone = "America/Toronto";
    const start = new Date("2026-11-11T01:08:00Z");
    const later = new Date("2026-11-11T01:11:00Z");
    vi.setSystemTime(start);
    const bodies: Array<{ messages: Array<{ role: string; content: unknown }> }> = [];
    let next: () => Response = answer;
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (!String(url).endsWith("/chat/completions")) return new Response("", { status: 404 });
      bodies.push(JSON.parse(String(init?.body)));
      const reply = next();
      // the first call takes three minutes before the provider refuses it
      if (bodies.length === 1) vi.setSystemTime(later);
      return reply;
    }));
    const instance = await OpenAICompatDriver.create({
      instanceId: "clock", displayName: "Clock", enabled: true,
      config: OpenAICompatDriver.decodeConfig({ url: "https://api.example.com/v1", apiKeyEnv: "K", model: "m" }),
      environment: { K: "secret" },
    });
    const events: RuntimeEvent[] = [];
    instance.adapter.onEvent((event) => events.push(event));
    const settled = async (count: number) => vi.waitFor(() => {
      if (events.filter((event) => event.type === "turn.completed").length < count) throw new Error("turn still running");
    }, { timeout: 10_000 });

    const first = turnClockNote(start, zone);
    const fresh = turnClockNote(later, zone);
    expect(fresh).not.toBe(first);
    let calls = 0;
    next = () => ++calls === 1 ? refused() : answer();
    await instance.adapter.sendTurn({ threadId: "t", text: withTurnClock("Quelle heure?", start, zone), turnClock: { timeZone: zone, note: first } });
    await settled(1);
    const sent = bodies.map((body) => String(body.messages.at(-1)!.content));
    expect(sent).toHaveLength(2);
    expect(sent[0]).toContain(first);
    expect(sent[1]).toContain(fresh);
    expect(sent[1]).not.toContain(first);
    expect(sent[1].endsWith("\n\nQuelle heure?")).toBe(true);

    // The next turn replays that message as it went last, so the provider's
    // cached prefix still matches.
    next = answer;
    await instance.adapter.sendTurn({
      threadId: "t", text: "Merci",
      transcript: [{ role: "user", text: "Quelle heure?" }, { role: "assistant", text: "done" }],
    });
    await settled(2);
    const replayed = bodies.at(-1)!.messages.find((message) => message.role === "user" && String(message.content).endsWith("Quelle heure?"));
    expect(String(replayed?.content)).toContain(fresh);
    await instance.dispose();
  });
});
