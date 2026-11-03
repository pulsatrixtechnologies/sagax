// Shadow, enforce, lockout and the activity log. The classifier's cases
// live in shared/misuse-guardrails.test.ts. Nothing here boots the server.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { adminActivityFileFor, flushAdminActivity } from "./admin-activity.ts";
import {
  misuseGuardrailMode,
  misusePathRefusal,
  misuseRefusal,
  misuseScopeFor,
  misuseToolFrameText,
  resetMisuseGuardrailsForTests,
  setMisuseAlert,
  setMisuseDataDirForTests,
  setMisuseOwnPaths,
} from "./misuse-guardrails.ts";
import { removeTempDir } from "./testing/cleanup.ts";
import { callUserSandboxTool, type ToolExec } from "./sandbox/user-sandbox-tools.ts";
import { serverPathAnswer, serverPathInCommand } from "./sandbox/sandbox-server-path.ts";
import { misuseRefusalText } from "../shared/misuse-guardrails.ts";
import {
  DEFAULT_EGRESS_DENY,
  DEFAULT_SANDBOX_LIMITS,
  sandboxContainerSpec,
  sandboxdConfigFromEnv,
  sandboxIsolationProblems,
  sandboxKeyForPrincipal,
} from "./sandbox/user-sandbox-spec.ts";

const dirs: string[] = [];

afterEach(async () => {
  delete process.env.SAGAX_MISUSE_GUARDRAILS;
  resetMisuseGuardrailsForTests();
  for (const dir of dirs.splice(0)) await removeTempDir(dir);
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "sagax-misuse-"));
  dirs.push(dir);
  setMisuseDataDirForTests(dir);
  return dir;
}

const context = { triage: false, principalId: "pr_ada", surface: "message" as const, botId: "bot1", threadId: "thread1" };

async function rows(dir: string): Promise<Array<{ action: string; category: string; after?: { category?: string; excerpt?: string } }>> {
  await flushAdminActivity(dir);
  const file = adminActivityFileFor(dir, new Date());
  return readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as { action: string; category: string; after?: { category?: string; excerpt?: string } });
}

describe("mode", () => {
  it("defaults to shadow and ignores an unknown value", () => {
    delete process.env.SAGAX_MISUSE_GUARDRAILS;
    expect(misuseGuardrailMode()).toBe("shadow");
    expect(misuseGuardrailMode({ SAGAX_MISUSE_GUARDRAILS: "sometimes" })).toBe("shadow");
    expect(misuseGuardrailMode({ SAGAX_MISUSE_GUARDRAILS: "enforce" })).toBe("enforce");
    expect(misuseGuardrailMode({ SAGAX_MISUSE_GUARDRAILS: "off" })).toBe("off");
  });

  it("records a shadow row and does not refuse", async () => {
    process.env.SAGAX_MISUSE_GUARDRAILS = "shadow";
    const dir = tempDir();
    const alerts: string[] = [];
    setMisuseAlert((alert) => alerts.push(alert.message));
    expect(misuseRefusal("sudo -i", context, 1_000)).toBeNull();
    const written = await rows(dir);
    expect(written.map((row) => row.action)).toEqual(["misuse.shadow"]);
    expect(written[0]?.category).toBe("security");
    expect(written[0]?.after?.category).toBe("privilege_escalation");
    expect(alerts).toEqual([]);
  });

  it("refuses in enforce mode and alerts the tenant admin", () => {
    process.env.SAGAX_MISUSE_GUARDRAILS = "enforce";
    tempDir();
    const alerts: string[] = [];
    setMisuseAlert((alert) => alerts.push(alert.message));
    const refusal = misuseRefusal("sudo -i", context, 1_000);
    expect(refusal).toMatchObject({ status: 403, code: "misuse_blocked" });
    expect(refusal?.message).toContain("droits d'administrateur");
    expect(alerts).toEqual([refusal?.message]);
  });

  it("does nothing when the flag is off", async () => {
    process.env.SAGAX_MISUSE_GUARDRAILS = "off";
    const dir = tempDir();
    expect(misuseRefusal("sudo -i", context, 1_000)).toBeNull();
    await flushAdminActivity(dir);
    expect(() => readFileSync(adminActivityFileFor(dir, new Date()), "utf8")).toThrow();
  });
});

describe("lockout", () => {
  it("locks the fifth attempt for fifteen minutes and still allows an ordinary message", async () => {
    process.env.SAGAX_MISUSE_GUARDRAILS = "enforce";
    const dir = tempDir();
    const start = 1_700_000_000_000;
    for (let i = 0; i < 4; i += 1) {
      expect(misuseRefusal("nmap 203.0.113.10", context, start + i)?.code).toBe("misuse_blocked");
    }
    expect(misuseRefusal("nmap 203.0.113.10", context, start + 4)?.code).toBe("misuse_locked");
    expect(misuseRefusal("nmap 203.0.113.10", context, start + 5)?.status).toBe(429);
    expect(misuseRefusal("Résume mes courriels.", context, start + 6)).toBeNull();
    const written = await rows(dir);
    expect(written.filter((row) => row.action === "misuse.lockout").length).toBeGreaterThanOrEqual(1);
    expect(misuseRefusal("nmap 203.0.113.10", context, start + 4 + 15 * 60_000)?.code).toBe("misuse_blocked");
  });

  it("counts the same window in shadow without refusing", async () => {
    process.env.SAGAX_MISUSE_GUARDRAILS = "shadow";
    const dir = tempDir();
    const start = 1_700_000_000_000;
    for (let i = 0; i < 5; i += 1) expect(misuseRefusal("sudo -i", context, start + i)).toBeNull();
    const written = await rows(dir);
    expect(written.at(-1)?.action).toBe("misuse.lockout");
  });
});

describe("surfaces", () => {
  it("lets the person act in their own environment and keeps the rest", () => {
    process.env.SAGAX_MISUSE_GUARDRAILS = "enforce";
    tempDir();
    const shell = { ...context, surface: "shell" as const, tool: "run_command" };
    expect(misuseRefusal("rm -rf ~", shell, 1_000)).toBeNull();
    expect(misuseRefusal("sudo apt-get install -y jq", shell, 1_001)).toBeNull();
    expect(misuseRefusal("history -c", shell, 1_002)).toBeNull();
    expect(misuseRefusal("fallocate -l 500G big", shell, 1_003)?.verdict.category).toBe("resource_abuse");
    expect(misuseRefusal("nsenter -t 1 -m bash", shell, 1_004)?.verdict.category).toBe("sandbox_escape");
    expect(misuseRefusal("cat /data/bots.json", shell, 1_005)?.verdict.category).toBe("platform_exfiltration");
  });

  it("keeps a lent computer and the MCP surface strict", () => {
    process.env.SAGAX_MISUSE_GUARDRAILS = "enforce";
    tempDir();
    expect(misuseRefusal("rm -rf ~", { ...context, surface: "terminal" as const }, 1_000)?.verdict.category).toBe("destruction");
    expect(misuseRefusal("sudo -i", { ...context, surface: "mcp" as const }, 1_001)?.verdict.category).toBe("privilege_escalation");
  });

  it("does not refuse destruction words in a message", () => {
    process.env.SAGAX_MISUSE_GUARDRAILS = "enforce";
    tempDir();
    expect(misuseRefusal("Planifie un reboot du serveur de test vendredi.", context, 1_000)).toBeNull();
    expect(misuseRefusal("sudo -i", context, 1_001)?.code).toBe("misuse_blocked");
  });

  it("maps each surface to its scope", () => {
    expect(misuseScopeFor("message")).toBe("message");
    expect(misuseScopeFor("shell")).toBe("own_environment");
    expect(misuseScopeFor("terminal")).toBe("default");
    expect(misuseScopeFor("file")).toBe("default");
  });
});

describe("paths, frames and the command clock", () => {
  it("follows the mode for a platform path", () => {
    process.env.SAGAX_MISUSE_GUARDRAILS = "shadow";
    expect(misusePathRefusal("/proc/1/environ", context, 1_000)).toBeNull();
    process.env.SAGAX_MISUSE_GUARDRAILS = "enforce";
    expect(misusePathRefusal("/proc/1/environ", context, 2_000)?.code).toBe("misuse_blocked");
    expect(misusePathRefusal("/workspace/notes.txt", context, 3_000)).toBeNull();
  });

  it("classifies a tools/call and ignores other frames", () => {
    const frame = { message: { method: "tools/call", params: { name: "flow_action", arguments: { command: "printenv" } } } };
    expect(misuseToolFrameText(frame)).toContain("printenv");
    expect(misuseToolFrameText({ message: { method: "tools/list" } })).toBeNull();
  });

  // 2026-11-02 (production): list_files on the bot's own server workspace
  // answers where its folder is, before the guard and the safety review
  it("answers a path of the bot's own server folder with one line, and runs nothing", async () => {
    const calls: unknown[] = [];
    const guarded: string[] = [];
    const root = "/data/.openmausbot/workspaces/5a1d0c3e-7b42-4c8e-9f10-2d3e4f5a6b7c";
    const where = { roots: [root, "/data/.openmausbot/task-workspaces/5a1d0c3e-7b42-4c8e-9f10-2d3e4f5a6b7c"], folder: "/workspace/bots/nova" };
    const exec: ToolExec = {
      exec: async (input) => {
        calls.push(input);
        return { exitCode: 0, stdout: "", stderr: "", truncated: false, timedOut: false };
      },
      overQuota: async () => false,
      serverPathAnswer: (value, kind) => (kind === "path" ? serverPathAnswer(value, where) : serverPathInCommand(value, where)),
      pathRefusal: (path) => { guarded.push(path); return misuseRefusalText("platform_exfiltration", "block"); },
      commandRefusal: (command) => { guarded.push(command); return null; },
      beforeCall: () => { guarded.push("review"); return "held"; },
    };
    const line = "That path is on the Sagax server, not in your environment. Your folder is /workspace/bots/nova/.";
    for (const [tool, args] of [
      ["list_files", { path: root }],
      ["read_file", { path: `${root}/MEMORY.md` }],
      ["write_file", { path: `${root}/notes.md`, content: "x" }],
      ["run_command", { command: `ls -la ${root}` }],
    ] as const) {
      const result = await callUserSandboxTool(tool, args as Record<string, unknown>, exec, where.folder);
      expect(result).toEqual({ content: [{ type: "text", text: line }], isError: true });
    }
    expect(calls).toEqual([]);
    expect(guarded).toEqual([]);
    // another bot's folder, a climb out and a platform file still reach the guard
    for (const path of ["/data/.openmausbot/workspaces/b2", `${root}/../b2`, "/data/.openmausbot/bots.json"]) {
      const result = await callUserSandboxTool("list_files", { path }, exec, where.folder);
      expect(result.content[0]).toMatchObject({ text: misuseRefusalText("platform_exfiltration", "block") });
    }
    expect(guarded).toEqual(["/data/.openmausbot/workspaces/b2", `${root}/../b2`, "/data/.openmausbot/bots.json"]);
  });

  it("stops a command at ten minutes", async () => {
    const calls: Array<{ timeoutSec?: number }> = [];
    const exec: ToolExec = {
      exec: async (input) => {
        calls.push(input);
        return { exitCode: 0, stdout: "", stderr: "", truncated: false, timedOut: false };
      },
      overQuota: async () => false,
    };
    await callUserSandboxTool("run_command", { command: "ls", timeout_seconds: 99_999 }, exec);
    expect(calls[0]?.timeoutSec).toBe(600);
  });
});

describe("sandbox hard limits", () => {
  it("keeps metadata and private networks unreachable, and masks host proc", () => {
    expect(DEFAULT_EGRESS_DENY).toContain("169.254.0.0/16");
    expect(DEFAULT_EGRESS_DENY).toEqual(expect.arrayContaining(["10.0.0.0/8", "127.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"]));
    expect(DEFAULT_SANDBOX_LIMITS).toMatchObject({ memoryBytes: 1536 * 1024 * 1024, nanoCpus: 1_000_000_000, pidsLimit: 512 });
    const key = sandboxKeyForPrincipal("test", "pr_00000000-0000-4000-8000-000000000001");
    const config = sandboxdConfigFromEnv({
      SAGAX_SANDBOX_IMAGE: "sagax-sandbox:test",
      SAGAX_SANDBOX_INSTANCE: "test",
    });
    const spec = sandboxContainerSpec(config, key) as { HostConfig: Record<string, unknown> };
    expect(sandboxIsolationProblems(spec, key)).toEqual([]);
    expect(spec.HostConfig.Memory).toBe(config.limits.memoryBytes);
    expect(spec.HostConfig.NanoCpus).toBe(config.limits.nanoCpus);
    expect(spec.HostConfig.PidsLimit).toBe(config.limits.pidsLimit);
    expect(spec.HostConfig.MaskedPaths).toEqual(expect.arrayContaining(["/proc/kcore", "/sys/firmware"]));
    expect(spec.HostConfig.ReadonlyPaths).toEqual(expect.arrayContaining(["/proc/sys", "/proc/sysrq-trigger"]));
    const ulimits = spec.HostConfig.Ulimits as Array<{ Name: string; Soft: number }>;
    expect(ulimits.find((limit) => limit.Name === "fsize")?.Soft).toBe(config.limits.maxFileBytes);
  });
});

// 2026-10-27 (#1098, point 33): what the harness registers as the person's own
describe("own paths from the harness (#1098)", () => {
  it("passes the person's own bot folder and an app attachment tag, and keeps another bot's refused", () => {
    process.env.SAGAX_MISUSE_GUARDRAILS = "enforce";
    setMisuseDataDirForTests(tempDir());
    setMisuseOwnPaths(({ botId, principalId }) => (botId === "b1" && principalId === "pr_alice"
      ? { roots: ["/data/.openmausbot/workspaces/b1"], attachmentsDir: "/data/.openmausbot/attachments" } : undefined));
    const who = { triage: false, principalId: "pr_alice", botId: "b1", threadId: "t1" };
    expect(misuseRefusal("ls /data/.openmausbot/workspaces/b1/memory", { ...who, surface: "shell" })).toBeNull();
    expect(misusePathRefusal("/data/.openmausbot/workspaces/b1/memory/notes.md", who)).toBeNull();
    expect(misuseRefusal('<attached-image path="/data/.openmausbot/attachments/0b6e7c1e-1f2a-4b3c-8d4e-5f6a7b8c9d0e.png" name="image.png" />', { ...who, surface: "message" })).toBeNull();
    expect(misuseRefusal("ls /data/.openmausbot/workspaces/b2/memory", { ...who, surface: "shell" })?.code).toBe("misuse_blocked");
    expect(misusePathRefusal("/data/.openmausbot/workspaces/b2/notes.md", who)?.code).toBe("misuse_blocked");
  });
});
