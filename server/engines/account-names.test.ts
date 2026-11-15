import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { removeTempDir } from "../testing/cleanup.ts";
import { cleanAccountName, createAccountNames } from "./account-names.ts";

describe("account names (#4376)", () => {
  it("keeps a person's name for an account across a restart, per person, and clears it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "account-names-"));
    try {
      const names = createAccountNames(dir);
      names.set("PR_Alice", "codex", "Work plan");
      expect(names.get("pr_alice", "codex")).toBe("Work plan");
      expect(names.get("pr_bob", "codex")).toBeUndefined();
      expect(createAccountNames(dir).get("pr_alice", "codex")).toBe("Work plan");
      names.set("pr_alice", "codex", "");
      expect(createAccountNames(dir).get("pr_alice", "codex")).toBeUndefined();
      expect(JSON.parse(readFileSync(join(dir, "account-names.json"), "utf8"))).toEqual({});
    } finally {
      await removeTempDir(dir);
    }
  });

  it("takes a name of 80 characters at most, without control characters", () => {
    expect(cleanAccountName("  Work plan ")).toBe("Work plan");
    expect(cleanAccountName("")).toBe("");
    expect(cleanAccountName("x".repeat(81))).toBeNull();
    expect(cleanAccountName("a\nb")).toBeNull();
    expect(cleanAccountName(3)).toBeNull();
  });
});
