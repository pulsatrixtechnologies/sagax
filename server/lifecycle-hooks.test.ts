import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { copySanitizedPlugin } from "./bot-plugins.ts";
import {
  capturePluginHooks,
  chooseHookTarget,
  commandWithFiles,
  dispatchLifecycleHooks,
  scrubHookEnv,
} from "./lifecycle-hooks.ts";

describe("lifecycle hooks stay off the server", () => {
  it("keeps hook commands out of the folder Claude loads", () => {
    const root = mkdtempSync(join(tmpdir(), "sagax-hooks-"));
    const plugin = join(root, "plugin");
    mkdirSync(join(plugin, "hooks"), { recursive: true });
    mkdirSync(join(plugin, ".claude-plugin"), { recursive: true });
    writeFileSync(join(plugin, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "reviewer", hooks: "./hooks/hooks.json" }));
    writeFileSync(join(plugin, "hooks", "hooks.json"), JSON.stringify({
      hooks: { Stop: [{ matcher: "", hooks: [{ type: "command", command: "echo stopped", timeout: 2 }] }] },
    }));
    writeFileSync(join(plugin, "hooks", "note.sh"), "echo note\n");
    const copied = copySanitizedPlugin(plugin, join(root, "installed"));
    expect(copied.removed).toContain("hooks");
    expect(copied.hooks.map((hook) => hook.event)).toEqual(["stop"]);
    expect(readFileSync(join(root, "installed", ".claude-plugin", "plugin.json"), "utf8")).not.toContain("hooks");
    expect(capturePluginHooks(join(root, "installed")).hooks).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  });

  it("refuses the organization server host and runs on the sandbox", async () => {
    expect(chooseHookTarget({ identityKind: "perspicax", workplace: "host", principal: "ada" })).toEqual({ kind: "refuse", reason: "server" });
    expect(chooseHookTarget({ identityKind: "perspicax", workplace: "none", principal: null })).toEqual({ kind: "refuse", reason: "no_computer" });
    expect(chooseHookTarget({ identityKind: "perspicax", workplace: "user-sandbox", principal: "ada" })).toEqual({ kind: "sandbox", principal: "ada" });
    expect(chooseHookTarget({ identityKind: "perspicax", workplace: "user-desktop", principal: "ada" })).toEqual({ kind: "desktop", principal: "ada" });
    expect(chooseHookTarget({ identityKind: "solo", workplace: "host", principal: null })).toEqual({ kind: "pc" });

    const calls: string[] = [];
    const refused = await dispatchLifecycleHooks({
      enabled: true,
      event: "stop",
      hooks: [{ event: "stop", command: "echo no", timeoutMs: 1000 }],
      target: { kind: "refuse", reason: "server" },
      payload: {},
      exec: async () => { calls.push("ran"); return { stdout: "", code: 0 }; },
    });
    expect(refused).toMatchObject({ ran: false, reason: "server" });
    expect(calls).toEqual([]);

    const off = await dispatchLifecycleHooks({
      enabled: false,
      event: "stop",
      hooks: [{ event: "stop", command: "echo no", timeoutMs: 1000 }],
      target: { kind: "pc" },
      payload: {},
      exec: async () => { calls.push("ran"); return { stdout: "", code: 0 }; },
    });
    expect(off.reason).toBe("owner_off");
    expect(calls).toEqual([]);

    const ran = await dispatchLifecycleHooks({
      enabled: true,
      event: "after_agent_response",
      hooks: [{ event: "after_agent_response", command: "echo hi", timeoutMs: 1000 }],
      target: { kind: "sandbox", principal: "ada" },
      payload: { text: "done" },
      exec: async (target, run) => {
        expect(target).toEqual({ kind: "sandbox", principal: "ada" });
        expect(run.stdin).toContain("done");
        calls.push("sandbox");
        return { stdout: JSON.stringify({ decision: "deny", reason: "stop there" }), code: 0 };
      },
    });
    expect(ran).toMatchObject({ ran: true, blocked: true });
    expect(ran.context).toContain("stop there");
    expect(calls).toEqual(["sandbox"]);
  });

  it("scrubs the server environment and stages files only inside the command", () => {
    const env = scrubHookEnv({ PATH: "/usr/bin", SAGAX_MESSAGES_TOKEN: "secret", HOME: "/var/sagax", LANG: "fr_CA.UTF-8" }, "/work/bot", "/work/hooks");
    expect(env).toEqual({ PATH: "/usr/bin", HOME: "/work/bot", TMPDIR: "/tmp", LANG: "fr_CA.UTF-8", CLAUDE_PLUGIN_ROOT: "/work/hooks", HOOK_ROOT: "/work/hooks" });
    expect(JSON.stringify(env)).not.toContain("secret");
    const line = commandWithFiles("echo $CLAUDE_PLUGIN_ROOT", { "note.sh": "echo note" }, "{\"event\":\"stop\"}");
    expect(line).toContain("note.sh");
    expect(line).toContain("/tmp/sagax-hooks");
    expect(line).not.toContain("SAGAX_");
  });
});
