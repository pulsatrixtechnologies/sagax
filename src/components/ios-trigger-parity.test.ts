// The phone's trigger words follow the desktop's (#4305): the event kinds of
// a typed trigger (`triggers.event.*` in src/locales/en.json) and the source
// types (`TRIGGER_SOURCE_TYPES` in shared/trigger-sources.ts) are mirrored in
// ios/Sources/CompanionCore/DesktopBotPanel.swift (WebhookPublicURL
// eventLabels and sourceLabel). The Swift package test
// ParityR1TriggersTests pins the same list, but it runs only after a merge:
// a lot that added a kind on the desktop (#4289) left main red. This reads
// the same three files as text, in milliseconds, so the fast gate runs it on
// any lot that touches one of them (the "source-text" line of .fast-gate).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TRIGGER_SOURCE_TYPES } from "../../shared/trigger-sources";

const root = join(__dirname, "..", "..");
const english = JSON.parse(readFileSync(join(root, "src", "locales", "en.json"), "utf8")) as Record<string, string>;
const swift = readFileSync(join(root, "ios", "Sources", "CompanionCore", "DesktopBotPanel.swift"), "utf8");

/** The `"key": "value"` pairs of a Swift block. */
function pairs(block: string, pattern: RegExp): Map<string, string> {
  return new Map([...block.matchAll(pattern)].map((m) => [m[1]!, m[2]!]));
}

function between(text: string, start: string, end: string): string {
  const from = text.indexOf(start);
  expect(from, `${start} in DesktopBotPanel.swift`).toBeGreaterThanOrEqual(0);
  const to = text.indexOf(end, from + start.length);
  expect(to).toBeGreaterThan(from);
  return text.slice(from + start.length, to);
}

describe("phone trigger parity (#4305)", () => {
  it("names every desktop event kind with the desktop's English words", () => {
    const block = between(swift, "public static let eventLabels: [String: String] = [", "\n    ]");
    // a kind written twice traps when Swift builds the dictionary
    const kinds = [...block.matchAll(/"([^"]+)":\s*"[^"]*"/g)].map((m) => m[1]!);
    expect(kinds.filter((kind, i) => kinds.indexOf(kind) !== i), "kinds written twice in eventLabels").toEqual([]);
    const phone = pairs(block, /"([^"]+)":\s*"([^"]*)"/g);
    const desktop = new Map(Object.entries(english)
      .filter(([key]) => key.startsWith("triggers.event."))
      .map(([key, value]) => [key.slice("triggers.event.".length), value]));
    const phoneByKey = new Map([...phone].map(([kind, label]) => [kind.replace(/\./g, "_"), label]));
    expect([...phoneByKey.keys()].sort(), "kinds on the phone (eventLabels) = triggers.event.* on the desktop").toEqual([...desktop.keys()].sort());
    for (const [key, label] of desktop) expect(phoneByKey.get(key), key).toBe(label);
  });

  it("names every desktop source type on the phone", () => {
    const labels = pairs(between(swift, "public static func sourceLabel(_ type: String) -> String {", "default: type"), /case\s+"([^"]+)":\s*"([^"]*)"/g);
    for (const type of TRIGGER_SOURCE_TYPES) {
      expect(labels.has(type), `sourceLabel has a case for "${type}"`).toBe(true);
      const words = english[`triggers.source.${type}`];
      // a source that is not a brand reads as the desktop's words
      if (words !== undefined) expect(labels.get(type), type).toBe(words);
    }
  });
});
