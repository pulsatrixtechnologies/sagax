// #3315: a sign-out a turn met holds that engine for new turns and new
// conversations, a restart included; it is said once a stretch; a sign-in ends it.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

/** The module as a fresh server start sees it. */
const fresh = async () => {
  vi.resetModules();
  return import("./engine-refusals.ts");
};

const dirs: string[] = [];
const holdsFile = () => {
  const dir = mkdtempSync(join(tmpdir(), "signed-out-holds-"));
  dirs.push(dir);
  return join(dir, "signed-out-holds.json");
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("signed-out holds", () => {
  it("keeps a sign-out across a restart, and only the sign-out, never a provider's words", async () => {
    const file = holdsFile();
    const before = await fresh();
    before.persistSignedOutHolds(file, 1_000);
    before.noteEngineRefusal({ engine: "claude", account: "acct", cause: "signed_out", at: 1_000 });
    before.noteEngineRefusal({ engine: "codex", cause: "credits", at: 1_000 });
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual([{ engine: "claude", account: "acct", at: 1_000 }]);

    const after = await fresh();
    after.persistSignedOutHolds(file, 2_000);
    expect(after.signedOutHeld("claude", "acct", 2_000), "a new conversation after the restart skips it").toBe(true);
    expect(after.activeEngineRefusal("codex", undefined, 2_000), "a credit refusal stays in memory").toBeUndefined();
  });

  it("holds a signed-out engine for the re-check interval, and past it while its status still reads signed out", async () => {
    const refusals = await fresh();
    refusals.persistSignedOutHolds(null);
    refusals.noteEngineRefusal({ engine: "claude", cause: "signed_out", at: 0 });
    expect(refusals.signedOutHeld("claude", undefined, refusals.SIGNED_OUT_RECHECK_MS - 1)).toBe(true);
    expect(refusals.signedOutHeld("claude", undefined, refusals.SIGNED_OUT_RECHECK_MS), "tried again by the next turn").toBe(false);
    expect(refusals.signedOutHeld("claude", undefined, refusals.SIGNED_OUT_RECHECK_MS, true)).toBe(true);
    expect(refusals.signedOutHeld("codex", undefined, 1, true), "no refusal of its own: nothing holds it").toBe(false);
  });

  it("says a sign-out once a stretch, a repeated refusal included, and again after a sign-in ends it", async () => {
    const file = holdsFile();
    const refusals = await fresh();
    refusals.persistSignedOutHolds(file);
    refusals.noteEngineRefusal({ engine: "claude", cause: "signed_out", at: 10 });
    expect(refusals.firstSignedOut("claude", undefined, "notice:bot")).toBe(true);
    expect(refusals.firstSignedOut("claude", undefined, "notice:bot")).toBe(false);
    expect(refusals.firstSignedOut("claude", undefined, "notice:other")).toBe(true);
    refusals.noteEngineRefusal({ engine: "claude", cause: "signed_out", at: 20 });
    expect(refusals.firstSignedOut("claude", undefined, "notice:bot"), "the same stretch").toBe(false);

    const restarted = await fresh();
    restarted.persistSignedOutHolds(file, 30);
    expect(restarted.firstSignedOut("claude", undefined, "notice:bot"), "said already before the restart").toBe(false);
    expect(restarted.clearSignedOut("claude")).toBe(1);
    expect(restarted.signedOutHeld("claude", undefined, 31)).toBe(false);
    expect(restarted.firstSignedOut("claude", undefined, "notice:bot"), "no sign-out kept").toBe(false);
    restarted.noteEngineRefusal({ engine: "claude", cause: "signed_out", at: 40 });
    expect(restarted.firstSignedOut("claude", undefined, "notice:bot"), "a new stretch").toBe(true);
  });

  it("ends only the accounts a sign-in names", async () => {
    const refusals = await fresh();
    refusals.persistSignedOutHolds(null);
    refusals.noteEngineRefusal({ engine: "claude", account: "server", cause: "signed_out", at: 0 });
    refusals.noteEngineRefusal({ engine: "claude", account: "person", cause: "signed_out", at: 0 });
    expect(refusals.clearSignedOut("claude", (account) => account === "server")).toBe(1);
    expect(refusals.signedOutHeld("claude", "server", 1)).toBe(false);
    expect(refusals.signedOutHeld("claude", "person", 1)).toBe(true);
  });

  it("forgets a sign-out past its stretch, on disk too", async () => {
    const file = holdsFile();
    const refusals = await fresh();
    refusals.persistSignedOutHolds(file);
    refusals.noteEngineRefusal({ engine: "claude", cause: "signed_out", at: 0 });
    const after = await fresh();
    after.persistSignedOutHolds(file, refusals.SIGNED_OUT_STRETCH_MS);
    expect(after.activeEngineRefusal("claude", undefined, refusals.SIGNED_OUT_STRETCH_MS)).toBeUndefined();
  });
});
