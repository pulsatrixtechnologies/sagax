// A runtime the server drives itself calls the model several times in one
// turn: each call carries the clock read when it is made, not the one the
// turn was handed with (#3511). The fresh time rides a trailing line after
// the last message, so the bytes already sent in the turn never change and
// the provider's cached prefix stays valid (#3549).
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RuntimeEvent } from "../contracts.ts";
import { turnClockNote, turnClockNow, withTurnClock } from "../turns/turn-clock.ts";
import { withoutTurnClock } from "../testing/turn-clock-text.ts";
import { OpenAICompatDriver } from "./openai-compat.ts";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

type Message = { role: string; content: unknown };
const sse = (body: string) => new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
// A provider's refusal of a made-up tool call: the same request goes again.
const refusal = { message: "attempted to call tool 'JSON' which was not in request", type: "invalid_request_error", code: "tool_use_failed" };
const refused = () => new Response(JSON.stringify({ error: refusal }), { status: 400, headers: { "content-type": "application/json" } });
const answer = () => sse('data: {"choices":[{"index":0,"finish_reason":"stop","delta":{"content":"done"}}]}\n\ndata: [DONE]\n\n');

describe("openai chat runtime turn clock", () => {
  it("keeps the sent messages byte-identical across calls and gives the fresh minute in a trailing line", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const zone = "America/Toronto";
    const minutes = [new Date("2026-11-11T01:08:00Z"), new Date("2026-11-11T01:09:00Z"), new Date("2026-11-11T01:10:00Z")];
    vi.setSystemTime(minutes[0]);
    const bodies: Array<{ messages: Message[] }> = [];
    let next: () => Response = answer;
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (!String(url).endsWith("/chat/completions")) return new Response("", { status: 404 });
      bodies.push(JSON.parse(String(init?.body)));
      const reply = next();
      // each call takes one minute before the provider answers
      if (bodies.length < minutes.length) vi.setSystemTime(minutes[bodies.length]);
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

    const started = turnClockNote(minutes[0], zone);
    let calls = 0;
    next = () => ++calls < 3 ? refused() : answer();
    await instance.adapter.sendTurn({ threadId: "t", text: withTurnClock("Quelle heure?", minutes[0], zone), turnClock: { timeZone: zone, note: started } });
    await settled(1);
    expect(bodies).toHaveLength(3);

    // The turn's message keeps the time the turn started on every call.
    const turnMessage = (body: { messages: Message[] }) => body.messages.find((message) => message.role === "user" && String(message.content).endsWith("Quelle heure?"));
    for (const body of bodies) expect(String(turnMessage(body)?.content)).toBe(withTurnClock("Quelle heure?", minutes[0], zone));
    // The first call is current already: no trailing line.
    expect(bodies[0].messages.at(-1)).toEqual(turnMessage(bodies[0]));
    // Every message before the trailing line is byte-identical across calls.
    const prefix = JSON.stringify(bodies[0].messages);
    for (const body of bodies.slice(1)) {
      expect(JSON.stringify(body.messages.slice(0, -1))).toBe(prefix);
      expect(body.messages.at(-1)!.role).toBe("user");
    }
    // Each later call carries its own fresh minute at the end.
    expect(bodies[1].messages.at(-1)!.content).toBe(turnClockNow(minutes[1], zone));
    expect(bodies[2].messages.at(-1)!.content).toBe(turnClockNow(minutes[2], zone));

    // The next turn replays the message as it was first sent, and no
    // trailing line: the cached prefix of the conversation still matches.
    next = answer;
    await instance.adapter.sendTurn({
      threadId: "t", text: "Merci",
      transcript: [{ role: "user", text: "Quelle heure?" }, { role: "assistant", text: "done" }],
    });
    await settled(2);
    const replay = bodies.at(-1)!.messages;
    expect(String(turnMessage({ messages: replay })?.content)).toBe(withTurnClock("Quelle heure?", minutes[0], zone));
    expect(replay.some((message) => String(message.content).startsWith("[Current time:") && !String(message.content).includes("when this turn started"))).toBe(false);
    expect(replay.at(-1)).toEqual({ role: "user", content: "Merci" });
    await instance.dispose();
  });

  it("strips an echoed trailing line the way it strips the turn's note", () => {
    const zone = "America/Toronto";
    const now = new Date("2026-11-11T01:09:00Z");
    expect(withoutTurnClock(turnClockNow(now, zone))).toBe("");
    expect(withoutTurnClock(`${withTurnClock("Quelle heure?", now, zone)}\n\n${turnClockNow(now, zone)}`)).toBe("Quelle heure?");
  });
});
