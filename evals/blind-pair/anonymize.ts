import type { AnonymizedSide, AssistantId, AssistantReply } from "./types.ts";

/** Seeded shuffle of the two sides so the judge never sees which fixture
 * produced which reply. The seed is recorded on the report so a sitting can
 * be replayed bit-for-bit; the assignment stays sealed unless --reveal. */

export type PairAssignment = {
  assistantA: AssistantId;
  assistantB: AssistantId;
  sides: [AnonymizedSide, AnonymizedSide];
};

/** Mulberry32: small, deterministic, good enough for a two-item coin flip. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Scrubs fixture ids and other side-identifying tokens from free text so a
 * judge reading the anonymized pair cannot tell the source by wording. */
export function scrubSideMarkers(text: string): string {
  return text
    .replace(/\bsagax-fixture\b/gi, "[assistant]")
    .replace(/\breference-fixture\b/gi, "[assistant]")
    .replace(/\bSagax\b/g, "[product]")
    .replace(/\breference assistant\b/gi, "[product]");
}

export function anonymizePair(
  left: AssistantReply,
  right: AssistantReply,
  seed: number,
): PairAssignment {
  if (left.assistantId === right.assistantId) {
    throw new Error("both sides of a blind pair must come from different assistants");
  }
  const rand = mulberry32(seed);
  const flip = rand() < 0.5;
  const first = flip ? left : right;
  const second = flip ? right : left;
  return {
    assistantA: first.assistantId,
    assistantB: second.assistantId,
    sides: [
      {
        label: "Assistant A",
        text: scrubSideMarkers(first.text),
        latencyMs: first.latencyMs,
      },
      {
        label: "Assistant B",
        text: scrubSideMarkers(second.text),
        latencyMs: second.latencyMs,
      },
    ],
  };
}
