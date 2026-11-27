import { describe, expect, it } from "vitest";

import type { ThreadFile } from "./chat-files";
import { artifactsKeptForThreads, groupLibraryItems, libraryItems } from "./library-items";
import type { ArtifactSummary } from "../../shared/artifacts";

const now = Date.parse("2026-10-26T12:00:00Z");
const DAY = 24 * 3_600_000;
const file = (id: string, name: string, daysAgo: number, pinned = false): ThreadFile => ({
  id, messageId: "m", source: "written", path: name, name, at: now - daysAgo * DAY, size: 10, available: true, ...(pinned ? { pinned } : {}),
});
const artifact = (id: string, title: string, daysAgo: number, favorite = false, over: Partial<ArtifactSummary> = {}): ArtifactSummary => ({
  id, botId: "b", title, favorite, popped: false, createdAt: now - 30 * DAY, updatedAt: now - daysAgo * DAY, rev: 1, refresh: { state: "idle", failures: 0 }, ...over,
});

describe("library grouping", () => {
  it("mixes files and artifacts, splits this week from older, newest first", () => {
    const items = libraryItems(
      [file("a".repeat(24), "plan.md", 1), file("b".repeat(24), "export.zip", 3), file("c".repeat(24), "old.md", 12)],
      // 18 hours ago stays in this week in every time zone. 12 hours before noon UTC is local midnight, which is today.
      [artifact("art_0000001", "Dispatch email preview", 20), artifact("art_0000002", "Queue", 0.75)],
    );
    const groups = groupLibraryItems(items, now);
    expect(groups.pinned).toEqual([]);
    expect(groups.periods.map((period) => period.id)).toEqual(["thisWeek", "older"]);
    expect(groups.periods[0]!.items.map((item) => item.key)).toEqual(["artifact:art_0000002", `file:${"a".repeat(24)}`, `file:${"b".repeat(24)}`]);
    expect(groups.periods[1]!.items.map((item) => item.key)).toEqual([`file:${"c".repeat(24)}`, "artifact:art_0000001"]);
  });

  it("puts pinned files and artifacts on top, whatever their age, and not again below", () => {
    const items = libraryItems(
      [file("a".repeat(24), "plan.md", 1), file("c".repeat(24), "old.md", 40, true)],
      [artifact("art_0000001", "Preview", 30, true)],
    );
    const groups = groupLibraryItems(items, now);
    expect(groups.pinned.map((item) => item.key)).toEqual(["artifact:art_0000001", `file:${"c".repeat(24)}`]);
    expect(groups.periods).toHaveLength(1);
    expect(groups.periods[0]!.items.map((item) => item.key)).toEqual([`file:${"a".repeat(24)}`]);
  });

  it("drops a period with nothing in it, and an empty library has no groups", () => {
    expect(groupLibraryItems(libraryItems([file("a".repeat(24), "old.md", 9)], []), now).periods.map((period) => period.id)).toEqual(["older"]);
    expect(groupLibraryItems(libraryItems(null, null), now)).toEqual({ pinned: [], periods: [] });
  });

  it("orders files that share a timestamp by name, not by id", () => {
    const items = libraryItems([file("zzz", "Alpha.md", 0), file("aaa", "Zulu.md", 0)], []);
    const groups = groupLibraryItems(items, now);
    expect(groups.periods[0]!.items.map((item) => item.kind === "file" ? item.file.name : "")).toEqual(["Alpha.md", "Zulu.md"]);
  });

  it("the seven day edge belongs to older", () => {
    const groups = groupLibraryItems(libraryItems([file("a".repeat(24), "edge.md", 7), file("b".repeat(24), "inside.md", 6.99)], []), now);
    expect(groups.periods.map((period) => [period.id, period.items.length])).toEqual([["thisWeek", 1], ["older", 1]]);
  });
});

describe("artifactsKeptForThreads (#5396)", () => {
  it("keeps favorite and popped artifacts after their conversation is gone", () => {
    const kept = artifactsKeptForThreads([
      artifact("art_fav0001", "Pinned", 1, true, { threadId: "gone" }),
      artifact("art_pop0001", "Window", 1, false, { threadId: "gone", popped: true }),
      artifact("art_ord0001", "Ordinary", 1, false, { threadId: "gone" }),
      artifact("art_live001", "Live", 1, false, { threadId: "open" }),
      artifact("art_bot0001", "Bot scoped", 1, true),
    ], new Set(["open"]));
    expect(kept.map((item) => item.id)).toEqual(["art_fav0001", "art_pop0001", "art_live001", "art_bot0001"]);
  });
});

describe("Library groups with Today (2026-10-28)", () => {
  const now = Date.parse("2026-10-28T15:00:00");
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  const item = (key: string, at: number, pinned = false) => ({ kind: "file" as const, key, at, pinned, file: {} as never });

  it("puts this calendar day under Today, the rest of 7 days under This week, then Older; pinned on top", () => {
    const groups = groupLibraryItems([
      item("a", now - 60_000),
      item("b", day.getTime() - 1),
      item("c", now - 8 * 24 * 3_600_000),
      item("d", now - 2 * 24 * 3_600_000, true),
    ], now);
    expect(groups.pinned.map((i) => i.key)).toEqual(["d"]);
    expect(groups.periods.map((p) => [p.id, p.items.map((i) => i.key)])).toEqual([["today", ["a"]], ["thisWeek", ["b"]], ["older", ["c"]]]);
  });

  it("omits the periods that are empty", () => {
    expect(groupLibraryItems([item("a", now - 1000)], now).periods.map((p) => p.id)).toEqual(["today"]);
  });
});
