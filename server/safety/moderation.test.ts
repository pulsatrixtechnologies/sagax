import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { TERMS_VERSION, createModerationStore, moderationPersonKey } from "./moderation.ts";

const dirs: string[] = [];
function dir(): string {
  const created = mkdtempSync(join(tmpdir(), "sagax-moderation-"));
  dirs.push(created);
  return created;
}
afterEach(() => {
  for (const created of dirs.splice(0)) rmSync(created, { recursive: true, force: true });
});

const report = {
  threadId: "t-room",
  messageId: "m-1",
  groupId: "g-1",
  groupName: "Launch",
  reportedId: "pr_sam",
  reportedName: "Sam",
  reportedKind: "person" as const,
  reason: "harassment" as const,
  reporterId: "pr_alex",
  reporterName: "Alex",
};

describe("moderation store", () => {
  it("keeps reports newest first, cuts the note and the excerpt, and marks one handled once", () => {
    let now = 1_000;
    let ids = 0;
    const store = createModerationStore(dir(), { now: () => now, newId: () => `rep_${++ids}` });
    store.addReport({ ...report, note: `  ${"n".repeat(2_000)}  `, excerpt: "x".repeat(3_000) });
    now = 2_000;
    store.addReport({ ...report, messageId: "m-2", reason: "spam" });
    const [newest, oldest] = store.reports();
    expect(newest).toMatchObject({ id: "rep_2", messageId: "m-2", status: "open" });
    expect(oldest!.note).toHaveLength(1_000);
    expect(oldest!.excerpt).toHaveLength(1_000);
    now = 3_000;
    expect(store.resolveReport("rep_1", "Admin")).toMatchObject({ status: "resolved", resolvedAt: 3_000, resolvedBy: "Admin" });
    now = 4_000;
    expect(store.resolveReport("rep_1", "Someone else")).toMatchObject({ resolvedAt: 3_000, resolvedBy: "Admin" });
    expect(store.resolveReport("rep_404", "Admin")).toBeNull();
  });

  it("drops the oldest handled report first when the list is full", () => {
    let ids = 0;
    const store = createModerationStore(dir(), { now: () => 1, newId: () => `rep_${++ids}`, maxReports: 10 });
    for (let index = 0; index < 10; index++) store.addReport(report);
    store.resolveReport("rep_7", "Admin");
    store.addReport(report);
    const kept = store.reports().map((entry) => entry.id);
    expect(kept).toHaveLength(10);
    expect(kept).not.toContain("rep_7");
    expect(kept).toContain("rep_1");
  });

  it("blocks are personal: one person's list never changes another's", () => {
    const store = createModerationStore(dir(), { now: () => 5 });
    expect(store.block("PR_ALEX", { id: "pr_sam", name: "Sam" })).toEqual([{ id: "pr_sam", name: "Sam", at: 5 }]);
    // the same person again only refreshes the name
    expect(store.block("pr_alex", { id: "PR_SAM", name: "Sam Rivera" })).toEqual([{ id: "pr_sam", name: "Sam Rivera", at: 5 }]);
    expect(store.blocks("pr_sam")).toEqual([]);
    expect(() => store.block("pr_alex", { id: "pr_alex", name: "me" })).toThrow(/yourself/);
    expect(store.unblock("pr_alex", "pr_sam")).toEqual([]);
    expect(store.blocks("pr_alex")).toEqual([]);
  });

  it("remembers the terms once per person, with the date, across a restart", () => {
    const data = dir();
    let now = 10;
    const store = createModerationStore(data, { now: () => now });
    expect(store.terms("pr_alex")).toBeNull();
    expect(store.acceptTerms("pr_alex", TERMS_VERSION)).toEqual({ version: TERMS_VERSION, acceptedAt: 10 });
    now = 20;
    expect(store.acceptTerms("pr_alex", TERMS_VERSION)).toEqual({ version: TERMS_VERSION, acceptedAt: 10 });
    store.block("pr_alex", { id: "pr_sam", name: "Sam" });
    const file = join(data, "moderation.json");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const again = createModerationStore(data, { now: () => 30 });
    expect(again.terms("pr_alex")).toEqual({ version: TERMS_VERSION, acceptedAt: 10 });
    expect(again.blocks("pr_alex")).toHaveLength(1);
    again.forgetPerson("pr_alex");
    expect(again.terms("pr_alex")).toBeNull();
    expect(again.blocks("pr_alex")).toEqual([]);
    expect(JSON.parse(readFileSync(file, "utf8")).terms).toEqual({});
  });

  it("starts empty from a damaged file and refuses keys that are not a person", () => {
    const data = dir();
    writeFileSync(join(data, "moderation.json"), "{not json");
    const store = createModerationStore(data);
    expect(store.reports()).toEqual([]);
    expect(moderationPersonKey("  PR_Alex ")).toBe("pr_alex");
    expect(moderationPersonKey("")).toBeNull();
    expect(moderationPersonKey("a/b")).toBeNull();
    expect(moderationPersonKey("x".repeat(201))).toBeNull();
    expect(() => store.blocks("")).toThrow(/not a person/);
  });
});
