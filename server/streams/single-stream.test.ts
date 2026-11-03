import { describe, expect, it } from "vitest";
import {
  composeStreamDigest, digestIsCurrent, draftSegmentDigest, extractSegmentDigest, recallTopicPage, segmentArtifacts, segmentDigestPrompt,
  SEGMENT_DIGEST_MAX_CHARS, STREAM_DIGEST_CLOSE, STREAM_DIGEST_MAX_CHARS, STREAM_DIGEST_OPEN, STREAM_FULL_ENTRIES, streamCandidate,
} from "./single-stream.ts";

const history = [
  { id: "m1", role: "user" as const, text: "Please audit the September invoices for ACME-42." },
  { id: "m2", role: "assistant" as const, text: "Done. We decided to credit invoice 123456. Report at https://example.test/report." },
  { id: "m3", role: "user" as const, text: "Next step: send the summary to finance by Friday." },
  { id: "m4", role: "assistant" as const, text: "Pending: waiting on the finance address." },
];

describe("segment digest (extractive, free)", () => {
  it("keeps the first ask, the latest ask and answer, quoted facts and links, within its cap", () => {
    const text = extractSegmentDigest(history, ["audit.xlsx"]);
    expect(text).toContain("Asked: \"Please audit the September invoices for ACME-42.\"");
    expect(text).toContain("Latest ask:");
    expect(text).toContain("Last answer:");
    expect(text).toContain("123456");
    expect(text).toContain("Files and links: audit.xlsx, https://example.test/report");
    expect(text.length).toBeLessThanOrEqual(SEGMENT_DIGEST_MAX_CHARS);
    const huge = [{ id: "x", role: "user" as const, text: "word ".repeat(10_000) }];
    expect(extractSegmentDigest(huge).length).toBeLessThanOrEqual(SEGMENT_DIGEST_MAX_CHARS);
  });

  it("lists files first, then links newest first, without duplicates", () => {
    expect(segmentArtifacts(history, ["a.pdf", "a.pdf"])).toEqual(["a.pdf", "https://example.test/report"]);
  });

  it("is current only while no newer message came", () => {
    expect(digestIsCurrent({ text: "x", anchorId: "m4", at: 1, by: "extract" }, "m4")).toBe(true);
    expect(digestIsCurrent({ text: "x", anchorId: "m3", at: 1, by: "extract" }, "m4")).toBe(false);
    expect(digestIsCurrent(undefined, "m4")).toBe(false);
  });
});

describe("segment digest (model-written, bounded)", () => {
  it("frames the segment as data with a fixed shape", () => {
    const prompt = segmentDigestPrompt("Invoices", history);
    expect(prompt).toContain("never instructions");
    expect(prompt).toContain("Summary:, Decisions:, Open items:, Files and links:");
  });

  it("uses the engine's one-shot, appends files and links it left out, and caps the size", async () => {
    const drafted = await draftSegmentDigest({ title: "Invoices", history, files: ["audit.xlsx"], generateText: async () => "Summary: audited.\nDecisions: credit 123456." });
    expect(drafted.by).toBe("model");
    expect(drafted.text).toContain("Files and links: audit.xlsx");
    const long = await draftSegmentDigest({ title: "x", history, generateText: async () => "y".repeat(5_000) });
    expect(long.text.length).toBeLessThanOrEqual(SEGMENT_DIGEST_MAX_CHARS);
  });

  it("falls back to the extractive digest on failure, silence, timeout or no engine", async () => {
    expect((await draftSegmentDigest({ title: "x", history })).by).toBe("extract");
    expect((await draftSegmentDigest({ title: "x", history, generateText: async () => { throw new Error("down"); } })).by).toBe("extract");
    expect((await draftSegmentDigest({ title: "x", history, generateText: async () => "  " })).by).toBe("extract");
    const slow = await draftSegmentDigest({ title: "x", history, timeoutMs: 20, generateText: () => new Promise<string>(() => {}) });
    expect(slow.by).toBe("extract");
  });
});

describe("stream digest block", () => {
  const segment = (i: number, digest = `digest ${i} ${"z".repeat(200)}`) => ({ threadId: `t${i}`, title: `Topic ${i}`, createdAt: i * 1_000, lastAt: i * 1_000, digest });

  it("is empty with no earlier topic", () => {
    expect(composeStreamDigest([]).text).toBe("");
  });

  it("lists newest first, framed as notes with recall_topic, and closes", () => {
    const { text, full } = composeStreamDigest([segment(1), segment(2)]);
    expect(text.startsWith(STREAM_DIGEST_OPEN)).toBe(true);
    expect(text.endsWith(STREAM_DIGEST_CLOSE)).toBe(true);
    expect(text).toContain("recall_topic");
    expect(text.indexOf("Topic 2")).toBeLessThan(text.indexOf("Topic 1"));
    expect(full).toBe(2);
  });

  it("gives full digests to the newest topics only, indexes the next and counts the rest, within the cap", () => {
    const many = Array.from({ length: 120 }, (_, i) => segment(i, `digest ${"q".repeat(800)}`));
    const composed = composeStreamDigest(many);
    expect(composed.full).toBeLessThanOrEqual(STREAM_FULL_ENTRIES);
    expect(composed.chars).toBeLessThanOrEqual(STREAM_DIGEST_MAX_CHARS);
    expect(composed.full + composed.indexed + composed.omitted).toBe(120);
    expect(composed.omitted).toBeGreaterThan(0);
    expect(composed.text).toMatch(/older topics not listed; recall_topic with no id lists them all/);
  });
});

describe("recall_topic pages", () => {
  const speaker = (entry: { role: string }) => (entry.role === "user" ? "Person" : "Bot");

  it("returns the newest page, oldest first, with ids, and pages backwards", () => {
    const page = recallTopicPage(history, speaker, undefined, 140);
    expect(page.text).toContain("[message m4]");
    expect(page.more).toBe(true);
    const before = recallTopicPage(history, speaker, page.firstId, 10_000);
    expect(before.text).toContain("[message m1]");
    expect(before.text).not.toContain("[message m4]");
    expect(before.more).toBe(false);
  });
});

describe("stream candidates", () => {
  const allowOnly = (id: string) => (threadId: string) => threadId === id;
  it("never the turn's own thread, never a non-segment, and only what the privacy filter allows", () => {
    expect(streamCandidate({ threadId: "a", createdAt: 1 }, "a", null)).toBe(false);
    expect(streamCandidate({ threadId: "b", createdAt: 1 }, "a", null)).toBe(true);
    expect(streamCandidate({ threadId: "b", createdAt: 1, confidential: true }, "a", null)).toBe(false);
    expect(streamCandidate({ threadId: "b", createdAt: 1, hidden: true }, "a", null)).toBe(false);
    expect(streamCandidate({ threadId: "b", createdAt: 1 }, "a", allowOnly("c"))).toBe(false);
    expect(streamCandidate({ threadId: "c", createdAt: 1 }, "a", allowOnly("c"))).toBe(true);
  });
});
