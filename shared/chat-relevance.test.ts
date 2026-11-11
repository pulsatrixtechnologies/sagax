import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  CHAT_ORIGINS, CHAT_SIGNALS, chatOrigin, chatPlace, routineRunSignal,
  type ChatOrigin, type ChatPlace, type ChatPlaceFacts, type ChatRunFacts, type ChatSignal,
} from "./chat-relevance.ts";
import type { BackgroundTaskFacts } from "./background-threads.ts";

const vectors = JSON.parse(readFileSync(new URL("./chat-relevance.vectors.json", import.meta.url), "utf8")) as {
  place: Array<{ name: string; origin: ChatOrigin; signal: ChatSignal; facts?: ChatPlaceFacts; place: ChatPlace }>;
  origin: Array<{ name: string; task: BackgroundTaskFacts; origin: ChatOrigin }>;
  signal: Array<{ name: string; run: ChatRunFacts; signal: ChatSignal }>;
};

describe("what enters a bot's main chat (#3581)", () => {
  it.each(vectors.place)("$name", ({ origin, signal, facts, place }) => {
    expect(chatPlace(origin, signal, facts)).toBe(place);
  });

  it.each(vectors.origin)("origin: $name", ({ task, origin }) => {
    expect(chatOrigin(task)).toBe(origin);
  });

  it.each(vectors.signal)("signal: $name", ({ run, signal }) => {
    expect(routineRunSignal(run)).toBe(signal);
  });

  it("the cases name every origin with every signal, so the phone and the desktop run the whole rule", () => {
    const named = new Set(vectors.place.map((entry) => `${entry.origin}/${entry.signal}`));
    const missing = CHAT_ORIGINS.flatMap((origin) => CHAT_SIGNALS.map((signal) => `${origin}/${signal}`)).filter((pair) => !named.has(pair));
    expect(missing).toEqual([]);
  });

  it("work never reaches the main chat as content, whoever the turn was for", () => {
    for (const origin of CHAT_ORIGINS) expect(["folded", "trace", "out"]).toContain(chatPlace(origin, "work"));
  });
});
