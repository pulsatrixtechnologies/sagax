import { describe, expect, it } from "vitest";
import { isOwnerOnlyProtected } from "../owner-only-acl.ts";
import { allowSavedPermission, savePermissionPass, takeMatchingPermissionPass } from "./saved-permission-pass.ts";

describe("a saved permission is used once (#4528)", () => {
  it("allows one matching call and never a second, and a safety stop does not spend it", () => {
    const host: { savedPermissionPasses?: Map<string, { threadId: string; tool: string; summary: string }> } = {};
    savePermissionPass(host, { threadId: "t", tool: "Bash", summary: "ls memory" });

    expect(allowSavedPermission(host, {
      threadId: "t", tools: ["Bash"], summary: "ls memory", safety: "stop", alreadyApproved: false, canRespond: true,
    })).toBe("keep");
    expect(host.savedPermissionPasses?.size).toBe(1);

    expect(allowSavedPermission(host, {
      threadId: "t", tools: ["Bash"], summary: "ls memory", safety: "hold", alreadyApproved: false, canRespond: true,
    })).toBe("keep");

    expect(allowSavedPermission(host, {
      threadId: "t", tools: ["other", "Bash"], summary: "rm build", safety: "ok", alreadyApproved: false, canRespond: true,
    })).toBe("keep");
    expect(host.savedPermissionPasses?.size).toBe(1);

    expect(allowSavedPermission(host, {
      threadId: "t", tools: ["Bash"], summary: "ls memory", safety: "ok", alreadyApproved: false, canRespond: false,
    })).toBe("keep");

    expect(allowSavedPermission(host, {
      threadId: "t", tools: ["shell", "Bash"], summary: "ls memory", safety: "ok", alreadyApproved: false, canRespond: true,
    })).toBe("allow");
    expect(allowSavedPermission(host, {
      threadId: "t", tools: ["Bash"], summary: "ls memory", safety: "ok", alreadyApproved: false, canRespond: true,
    })).toBe("keep");
    expect(takeMatchingPermissionPass(host, "t", ["Bash"], "ls memory")).toBeNull();
  });

  it("spends the pass when the call is already approved, so a later one still asks", () => {
    const host = {};
    savePermissionPass(host, { threadId: "t", tool: "Bash", summary: "ls memory" });
    expect(allowSavedPermission(host, {
      threadId: "t", tools: ["Bash"], summary: "ls memory", safety: "ok", alreadyApproved: true, canRespond: true,
    })).toBe("spent");
    expect(allowSavedPermission(host, {
      threadId: "t", tools: ["Bash"], summary: "ls memory", safety: "ok", alreadyApproved: false, canRespond: true,
    })).toBe("keep");
  });
});

describe("a saved permission survives a restart (#4528)", () => {
  it("is still used once after a restart, and the file keeps no words of the step", async () => {
    const { mkdtempSync, readFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "saved-permission-"));
    try {
      savePermissionPass({ DATA_DIR: dir }, { threadId: "t", tool: "Bash", summary: "SECRET_STEP ls memory" });
      const file = join(dir, "permission-passes.json");
      expect(readFileSync(file, "utf8")).not.toContain("SECRET_STEP");
      expect(isOwnerOnlyProtected(file)).toBe(true);
      // the server stops between the answer and the follow-up call
      const restarted = { DATA_DIR: dir };
      expect(allowSavedPermission(restarted, {
        threadId: "t", tools: ["Bash"], summary: "SECRET_STEP ls memory", safety: "ok", alreadyApproved: false, canRespond: true,
      })).toBe("allow");
      // once: a second restart does not bring it back
      expect(allowSavedPermission({ DATA_DIR: dir }, {
        threadId: "t", tools: ["Bash"], summary: "SECRET_STEP ls memory", safety: "ok", alreadyApproved: false, canRespond: true,
      })).toBe("keep");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
