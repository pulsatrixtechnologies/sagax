// The parser vectors the iPhone and iPad share (#4572, lot S3): the same file
// is read by ios/Tests/CompanionCoreTests/RecordCardTests.swift, so the two
// parsers agree on what a card, an answer, a link and a text are.
import { describe, expect, it } from "vitest";
import vectors from "./record-card-vectors.json" with { type: "json" };
import { parseRecordCard, parseRecordCardAnswer, parseRecordLink, withoutRecordLinks } from "./record-cards";

/** JSON round trip: what a client reads back, with no `undefined` keys. */
const wire = (value: unknown) => JSON.parse(JSON.stringify(value ?? null));

describe("record card vectors", () => {
  it("holds every kind of vector", () => {
    expect(vectors.cards.length).toBeGreaterThan(30);
    expect(vectors.answers.length).toBeGreaterThan(5);
    expect(vectors.links.length).toBeGreaterThan(5);
    expect(vectors.texts.length).toBeGreaterThan(2);
  });

  it.each(vectors.cards.map((entry) => [entry.name, entry] as const))("card: %s", (_name, entry) => {
    expect(wire(parseRecordCard(entry.raw))).toEqual(wire(entry.expected));
  });

  it.each(vectors.answers.map((entry) => [entry.name, entry] as const))("answer: %s", (_name, entry) => {
    expect(wire(parseRecordCardAnswer(entry.raw))).toEqual(wire(entry.expected));
  });

  it.each(vectors.links.map((entry) => [entry.name, entry] as const))("link: %s", (_name, entry) => {
    expect(wire(parseRecordLink(entry.href))).toEqual(wire(entry.expected));
  });

  it.each(vectors.texts.map((entry) => [entry.name, entry] as const))("text: %s", (_name, entry) => {
    expect(withoutRecordLinks(entry.text)).toBe(entry.expected);
  });
});
