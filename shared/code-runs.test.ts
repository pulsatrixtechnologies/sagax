import { describe, expect, it } from "vitest";

import { runPill, runPr, runStats, normalizeCloudAgentStatus } from "./cloud-agents.ts";
import { diffFilesFrom, parseUnifiedDiff } from "./code-runs.ts";

const DIFF = `diff --git a/a.ts b/a.ts
index 1..2 100644
--- a/a.ts
+++ b/a.ts
@@ -1,3 +1,4 @@
 one
-two
+deux
+trois
 four
diff --git a/README.md b/README.md
new file mode 100644
--- /dev/null
+++ b/README.md
@@ -0,0 +1,1 @@
+# Titre
diff --git a/img.png b/img.png
Binary files a/img.png and b/img.png differ
`;

describe("parseUnifiedDiff", () => {
  it("reads files, statuses, counts and line numbers", () => {
    const files = parseUnifiedDiff(DIFF);
    expect(files.map((f) => [f.path, f.status, f.added, f.removed])).toEqual([
      ["a.ts", "modified", 2, 1],
      ["README.md", "added", 1, 0],
      ["img.png", "modified", 0, 0],
    ]);
    expect(files[0]!.hunks[0]!.lines).toEqual([
      { kind: "ctx", old: 1, new: 1, text: "one" },
      { kind: "del", old: 2, text: "two" },
      { kind: "add", new: 2, text: "deux" },
      { kind: "add", new: 3, text: "trois" },
      { kind: "ctx", old: 3, new: 4, text: "four" },
    ]);
    expect(files[1]!.previewable).toBe(true);
    expect(files[2]!.binary).toBe(true);
  });

  it("never throws on garbage and keeps HTML as text", () => {
    expect(parseUnifiedDiff("not a diff\n@@ nonsense")).toEqual([]);
    const files = diffFilesFrom({ files: [{ path: "x.html", hunks: [{ header: "@@", lines: [{ kind: "add", text: "<script>alert(1)</script>" }, { kind: "evil" }] }] }] });
    expect(files[0]!.hunks[0]!.lines).toEqual([{ kind: "add", text: "<script>alert(1)</script>" }]);
    expect(files[0]!.added).toBe(1);
  });
});

describe("Perspicax run helpers", () => {
  const run = (state: string, pr: Record<string, unknown> = {}, stats: Record<string, unknown> = {}) => ({ state, pr, stats, branch: "px/x" });

  it("maps every Perspicax state to a Sagax status", () => {
    expect(["queued", "waking", "provisioning", "setup", "running", "waiting_for_approval", "idle", "finished", "failed", "stopped", "expired", "archived"].map(normalizeCloudAgentStatus))
      .toEqual(["queued", "creating", "creating", "creating", "running", "waiting_for_approval", "idle", "finished", "failed", "cancelled", "expired", "archived"]);
  });

  it("picks the card pill from the PR first, then the state", () => {
    expect(runPill(run("finished", { number: 1, url: "https://x/1", state: "merged" }))).toBe("merged");
    expect(runPill(run("running"))).toBe("running");
    expect(runPill(run("waiting_for_approval"))).toBe("waiting");
    expect(runPill(run("idle", { number: 2, url: "https://x/2", state: "draft" }))).toBe("draft");
    expect(runPill(run("idle", { number: 3, url: "https://x/3", state: "open" }))).toBe("open");
    expect(runPill(run("failed"))).toBe("failed");
    expect(runPill(run("finished"))).toBe("branch");
    expect(runPill(run("stopped"))).toBe("stopped");
  });

  it("reads pr and stats leniently", () => {
    expect(runPr({ pr: { number: 4, url: "javascript:alert(1)", state: "open" } })).toBeUndefined();
    expect(runPr({ pr: {} })).toBeUndefined();
    expect(runStats({ stats: { files: 2, additions: 5, deletions: 1 } })).toEqual({ files: 2, added: 5, removed: 1, commits: 0 });
    expect(runStats({ stats: {} })).toBeUndefined();
  });
});
