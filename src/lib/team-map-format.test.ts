import { describe, expect, it } from "vitest";

import { setLocale } from "./i18n";
import { agoLabel, lastHandoffOf, orgState } from "./team-map-format";
import type { TeamMapPair } from "./team-map";

const pair = (a: string, b: string, extra: Partial<TeamMapPair> = {}): TeamMapPair => ({ sourceBotId: a, targetBotId: b, count: 1, kind: "delegates", live: null, connected: false, ...extra });

describe("team map words", () => {
  it("reads a bot's live state from the store's own fields", () => {
    expect(orgState({ id: "a", name: "A", activity: "waiting-on-you" })).toBe("waiting");
    expect(orgState({ id: "a", name: "A", busy: true })).toBe("working");
    expect(orgState({ id: "a", name: "A", activity: "working" })).toBe("working");
    expect(orgState({ id: "a", name: "A", activity: "dead" })).toBe("noSignal");
    expect(orgState({ id: "a", name: "A" })).toBe("idle");
    expect(orgState({ id: "a", name: "A", busy: true, activity: "waiting-on-you" })).toBe("waiting");
  });

  it("says how long ago, in the page's language", async () => {
    await setLocale("en");
    const now = 1_000_000_000_000;
    expect(agoLabel(now - 5 * 60_000, now)).toMatch(/5/);
    expect(agoLabel(now - 3 * 3_600_000, now)).toMatch(/3/);
    expect(agoLabel(now - 2 * 86_400_000, now)).toMatch(/2/);
  });

  it("names the latest handoff of a bot with its direction", async () => {
    await setLocale("en");
    const now = 1_000_000_000_000;
    const names: Record<string, string> = { a: "Atlas", b: "Boreas", c: "Cirrus" };
    const text = lastHandoffOf("b", [pair("a", "b", { lastAt: now - 3_600_000 }), pair("b", "c", { lastAt: now - 60_000 })], (id) => names[id], now);
    expect(text?.startsWith("→ Cirrus")).toBe(true);
    expect(lastHandoffOf("a", [pair("a", "b", { lastAt: now - 60_000 })], (id) => names[id], now)?.startsWith("→ Boreas")).toBe(true);
    expect(lastHandoffOf("b", [pair("a", "b", { lastAt: now - 60_000 })], (id) => names[id], now)?.startsWith("← Atlas")).toBe(true);
    expect(lastHandoffOf("c", [], (id) => names[id], now)).toBeNull();
  });
});
