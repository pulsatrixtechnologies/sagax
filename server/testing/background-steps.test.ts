// #3671: the model tools test read memory upkeep's tidy prompt as a
// person's turn, because its fake provider recorded every call. The fake
// providers now tell a bot's background one-shots apart with one rule,
// which must know every step a bot runs on its own.
import { expect, it } from "vitest";

import { CAPTURE_MARKER } from "../memory/memory-capture.ts";
import { ORGANIZE_MARKER } from "../memory/memory-organize.ts";
import { TIDY_MARKER } from "../memory/memory-tidy.ts";
import { SKILL_REVIEW_MARKER } from "../skills/skill-review.ts";
import { segmentDigestPrompt, SEGMENT_DIGEST_MARKER } from "../streams/single-stream.ts";
import { isBackgroundStepPrompt } from "./background-steps.ts";

it("knows every background step a bot runs on its own model", () => {
  for (const marker of [CAPTURE_MARKER, TIDY_MARKER, ORGANIZE_MARKER, SKILL_REVIEW_MARKER]) {
    expect(isBackgroundStepPrompt(`${marker}. Return strict JSON.`), marker).toBe(true);
  }
});

// #4105: the digest of a finished topic is drafted on the bot's model while
// the next topic's turn runs; the fake CLI wrote it over that turn's dump, so
// the fresh topic test read the digest prompt instead of the turn's.
it("knows the digest of a finished topic, drafted while the next topic's turn runs", () => {
  const prompt = segmentDigestPrompt("Audit the September invoices", [
    { id: "m1", role: "user", text: "Audit the September invoices." },
    { id: "m2", role: "assistant", text: "Done." },
  ]);
  expect(prompt.startsWith(SEGMENT_DIGEST_MARKER)).toBe(true);
  expect(isBackgroundStepPrompt(prompt)).toBe(true);
  // A person who asks for a digest in a turn is still a turn.
  expect(isBackgroundStepPrompt(`Please ${SEGMENT_DIGEST_MARKER.toLowerCase()}.`)).toBe(false);
});

it("never takes a person's turn for one", () => {
  expect(isBackgroundStepPrompt("Write the verification artifact if a structured tool is requested.")).toBe(false);
  expect(isBackgroundStepPrompt("Tell me about the memory system of this bot.")).toBe(false);
});
