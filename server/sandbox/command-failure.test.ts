// #4146 (2026-11-13, production): a command that failed in the bot's
// environment read "The tool failed and returned no error message". A failed
// command now says why (exit code, end of stderr then stdout, cut short) in
// the row's Result and in the text the bot reads, and a command naming a
// path of the server's own data folder takes the environment's path or stops
// before it runs, with a line naming the path.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { toolFailureText } from "../../shared/tool-failure-text.ts";
import { toolFailurePreview } from "../tools/tool-summary.ts";
import { commandForEnvironment, serverOnlyPathLine, serverPathInCommand } from "./sandbox-server-path.ts";
import type { SandboxExecInput, SandboxExecOutput } from "./sandboxd-core.ts";
import { sandboxdClient } from "./user-sandbox-client.ts";
import { callUserSandboxTool, handleUserSandboxMcp, type ToolExec } from "./user-sandbox-tools.ts";

/** Runs the command for real (a stand-in for the environment): the test
 * scripts exit non-zero before they print, print only to stderr, or both. */
function localExec(calls: SandboxExecInput[] = []): ToolExec {
  return {
    exec: async (input) => {
      calls.push(input);
      const run = spawnSync(input.argv[0]!, input.argv.slice(1), { encoding: "utf8", timeout: 10_000 });
      return { exitCode: run.status, stdout: run.stdout ?? "", stderr: run.stderr ?? "", truncated: false, timedOut: false } satisfies SandboxExecOutput;
    },
    overQuota: async () => false,
  };
}

/** The first four lines of what the row's Result reads (src/components/ToolActivity.tsx
 * reads them through stepResult; src/components/ToolActivity.test.ts renders it). */
function rowLines(output: string | undefined): string | undefined {
  return (toolFailureText(output) ?? output)?.split("\n").slice(0, 4).join("\n");
}

type Block = { type: string; text?: string };
const textOf = (result: { content: Block[] }) => result.content.map((block) => block.text ?? "").join("\n");
const firstText = (result: { content: Block[] }) => (result.content[0] as Block).text ?? "";

describe("a failed command says why (#4146)", () => {
  it("a script that exits non-zero before printing gives its exit code to the bot and the row", async () => {
    const result = await callUserSandboxTool("run_command", { command: "exit 3; echo never" }, localExec());
    expect(result.isError).toBe(true);
    expect(result.content[0]).toEqual({ type: "text", text: "The command failed with exit code 3. It printed nothing." });
    const preview = toolFailurePreview(result);
    expect(preview).toBe("The command failed with exit code 3. It printed nothing.");
    expect(rowLines(preview)).toBe("The command failed with exit code 3. It printed nothing.");
  });

  it("shows the end of stderr, cut to a readable length, before the whole output", async () => {
    const command = "echo started; for i in $(seq 1 40); do echo \"trace line $i\" >&2; done; echo 'FileNotFoundError: /srv/data missing' >&2; exit 2";
    const result = await callUserSandboxTool("run_command", { command }, localExec());
    expect(result.isError).toBe(true);
    const first = firstText(result);
    expect(first.startsWith("The command failed with exit code 2. End of its error output:\n<<<UNTRUSTED source=\"tool\">>>\n")).toBe(true);
    expect(first).toContain("trace line 39\ntrace line 40\nFileNotFoundError: /srv/data missing");
    expect(first).not.toContain("trace line 38");
    expect(first).not.toContain("started");
    // the bot still reads the whole output after it
    expect(textOf(result)).toContain("trace line 1\n");
    expect(textOf(result)).toContain("started");
    // the row's four lines: the exit code, then the last lines of stderr
    expect(rowLines(toolFailurePreview(result))).toBe("The command failed with exit code 2. End of its error output:\ntrace line 39\ntrace line 40\nFileNotFoundError: /srv/data missing");
  });

  it("falls back to the end of stdout when stderr is empty, and cuts a long line from its end", async () => {
    const long = "x".repeat(500);
    const result = await callUserSandboxTool("run_command", { command: `echo ${long}; echo 'final: bad input'; exit 1` }, localExec());
    const first = firstText(result);
    expect(first).toContain("The command failed with exit code 1. End of its output:");
    expect(first).toContain("final: bad input");
    expect(first.split("\n")[2]!.length).toBeLessThanOrEqual(300);
  });

  it("names the time limit when the command was stopped", async () => {
    const exec: ToolExec = {
      exec: async () => ({ exitCode: 124, stdout: "", stderr: "", truncated: false, timedOut: true }),
      overQuota: async () => false,
    };
    const result = await callUserSandboxTool("run_command", { command: "sleep 999", timeout_seconds: 5 }, exec);
    expect(firstText(result)).toBe("The command was stopped: it reached its time limit of 5 s (exit 124). It printed nothing.");
  });

  it("an exec that throws with no words still says which tool failed", async () => {
    const exec: ToolExec = { exec: async () => { throw new Error(""); }, overQuota: async () => false };
    const result = await callUserSandboxTool("run_command", { command: "true" }, exec);
    expect(result).toEqual({ content: [{ type: "text", text: "run_command failed in your server environment before it answered (Error)." }], isError: true });
  });

  it("a successful command keeps its output as before", async () => {
    const result = await callUserSandboxTool("run_command", { command: "echo ok" }, localExec());
    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toBe("<<<UNTRUSTED source=\"tool\">>>\nok\n\n<<<END UNTRUSTED>>>\n[exit 0]");
  });
});

const DATA = "/data/.sagax";
const paths = {
  dataRoots: [DATA, "/mnt/disk/.sagax"],
  plugins: [{ name: "helper", dir: `${DATA}/plugins/org/helper` }, { name: "helper-tools", dir: "/opt/plugins/helper-tools" }],
  folder: "/workspace/bots/nova",
};

describe("a command that names a path of the server's data folder (#4146)", () => {
  it("takes the environment's path for a plugin folder, its turn copy and its data folder", () => {
    expect(commandForEnvironment(`python3 ${DATA}/plugins/org/helper/scripts/run.py --data ${DATA}/principals/p1/claude/plugins/data/helper-market`, paths))
      .toEqual({ command: "python3 /workspace/sagax-plugins/helper/scripts/run.py --data /workspace/sagax-plugin-data/helper" });
    expect(commandForEnvironment(`bash ${DATA}/engine-policies/plugin-agents/abc123/def456/helper/x.sh`, paths))
      .toEqual({ command: "bash /workspace/sagax-plugins/helper/x.sh" });
    // the longest plugin name wins; the linked spelling of the data folder too
    expect(commandForEnvironment(`cat "/mnt/disk/.sagax/principals/p1/claude/plugins/data/helper-tools-market/state.json"`, paths))
      .toEqual({ command: `cat "/workspace/sagax-plugin-data/helper-tools/state.json"` });
    expect(commandForEnvironment("ls /opt/plugins/helper-tools/bin", paths)).toEqual({ command: "ls /workspace/sagax-plugins/helper-tools/bin" });
  });

  it("stops before it runs when the path has no place in the environment, naming the path", () => {
    expect(commandForEnvironment(`ls ${DATA}/principals/p1/claude && echo "exit=$?"`, paths))
      .toEqual({ refusal: serverOnlyPathLine(`${DATA}/principals/p1/claude`, "/workspace/bots/nova"), command: `ls ${DATA}/principals/p1/claude && echo "exit=$?"` });
    expect(serverOnlyPathLine(`${DATA}/principals/p1`, null)).toBe(`Not run: ${DATA}/principals/p1 is a path on the Sagax server, not in your environment, so the command cannot use it there. Your files are in /workspace; installed plugins are in /workspace/sagax-plugins/<plugin> and their data in /workspace/sagax-plugin-data/<plugin>.`);
    expect(commandForEnvironment(`cat ${DATA}/principals/p1/claude/plugins/data/unknown-market/a`, paths)).toHaveProperty("refusal");
  });

  it("leaves other commands alone: the environment's own paths and a longer path that only contains the folder", () => {
    for (const command of ["ls /workspace/sagax-plugins/helper", `ls /workspace${DATA}/x`, `ls ${DATA}x/y`, "echo hello"]) {
      expect(commandForEnvironment(command, paths)).toEqual({ command });
    }
  });

  it("runs the rewritten command in the environment and nothing for a refused one", async () => {
    const calls: SandboxExecInput[] = [];
    const exec: ToolExec = {
      ...localExec(calls),
      exec: async (input) => { calls.push(input); return { exitCode: 0, stdout: "", stderr: "", truncated: false, timedOut: false }; },
      environmentCommand: (command) => commandForEnvironment(command, paths),
      serverPathAnswer: (value, kind) => (kind === "command" ? serverPathInCommand(value, { roots: [`${DATA}/workspaces/b1`], folder: paths.folder }) : null),
    };
    await callUserSandboxTool("run_command", { command: `python3 ${DATA}/plugins/org/helper/run.py` }, exec);
    expect(calls.map((call) => call.argv)).toEqual([["bash", "-lc", "python3 /workspace/sagax-plugins/helper/run.py"]]);
    const refused = await callUserSandboxTool("run_command", { command: `cat ${DATA}/principals/p1/x` }, exec);
    expect(refused).toEqual({ content: [{ type: "text", text: serverOnlyPathLine(`${DATA}/principals/p1/x`, paths.folder) }], isError: true });
    // the bot's own server folder keeps its line naming its folder
    const own = await callUserSandboxTool("run_command", { command: `ls ${DATA}/workspaces/b1` }, exec);
    expect(firstText(own)).toBe("That path is on the Sagax server, not in your environment. Your folder is /workspace/bots/nova/.");
    expect(calls).toHaveLength(1);
  });

  it("lets the plugin refusal and the misuse guard judge a server path first, so their verdict and audit come before the line", async () => {
    const calls: SandboxExecInput[] = [];
    const judged: string[] = [];
    const exec: ToolExec = {
      ...localExec(calls),
      exec: async (input) => { calls.push(input); return { exitCode: 0, stdout: "", stderr: "", truncated: false, timedOut: false }; },
      environmentCommand: (command) => commandForEnvironment(command, paths),
      commandRefusal: (command) => {
        judged.push(command);
        return /bots\.json|principals\/p2/.test(command) ? "Refused: platform_exfiltration" : null;
      },
    };
    const botsFile = await callUserSandboxTool("run_command", { command: `cat ${DATA}/bots.json` }, exec);
    expect(botsFile).toEqual({ content: [{ type: "text", text: "Refused: platform_exfiltration" }], isError: true });
    const other = await callUserSandboxTool("run_command", { command: `ls ${DATA}/principals/p2/claude` }, exec);
    expect(firstText(other)).toBe("Refused: platform_exfiltration");
    // the guard lets it through: the line naming the server path
    const own = await callUserSandboxTool("run_command", { command: `ls ${DATA}/principals/p1/claude` }, exec);
    expect(firstText(own)).toBe(serverOnlyPathLine(`${DATA}/principals/p1/claude`, paths.folder));
    // the rewritten command is judged too when it differs
    await callUserSandboxTool("run_command", { command: `python3 ${DATA}/plugins/org/helper/run.py ${DATA}/principals/p1/x` }, exec);
    expect(judged.slice(-2)).toEqual([
      `python3 ${DATA}/plugins/org/helper/run.py ${DATA}/principals/p1/x`,
      `python3 /workspace/sagax-plugins/helper/run.py ${DATA}/principals/p1/x`,
    ]);
    expect(calls).toHaveLength(0);
  });
});

describe("an error of the provisioner with empty words gives its status (#4146)", () => {
  it("names the provisioner's answer instead of an empty message", async () => {
    const fakeFetch = (async () => new Response(JSON.stringify({ error: "", code: "" }), { status: 503, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    const client = sandboxdClient("http://sandboxd:8791", () => "a".repeat(64), fakeFetch);
    await expect(client.exec("0".repeat(32), { argv: ["true"], timeoutSec: 5 })).rejects.toMatchObject({ message: "the provisioner answered 503", code: "error" });
  });
});

describe("run_command never runs on the server itself (#4146)", () => {
  it("has no way to start a process on the host: every command is one exec in the environment", async () => {
    const source = readFileSync(new URL("./user-sandbox-tools.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/node:child_process|from "child_process"|spawn\(|execFile\(|execSync\(/);
    const calls: SandboxExecInput[] = [];
    const exec: ToolExec = {
      exec: async (input) => { calls.push(input); return { exitCode: 1, stdout: "", stderr: "", truncated: false, timedOut: false }; },
      overQuota: async () => false,
    };
    const answer = await handleUserSandboxMcp("tools/call", { name: "run_command", arguments: { command: "ls /" } }, exec) as { isError?: boolean };
    expect(answer.isError).toBe(true);
    expect(calls).toEqual([{ argv: ["bash", "-lc", "ls /"], timeoutSec: 120 }]);
  });
});
