// @ts-nocheck
/** execLifecycleHook (#1388). Pure move from server/index.ts. */
import { join } from "node:path";
import { commandWithFiles } from "../hooks/lifecycle-hooks.ts";
export type Host = Record<string, any>;

export function createExecLifecycleHook(getHost: () => Host): any {
async function execLifecycleHook(botId: string, target: Exclude<HookTarget, { kind: "refuse" }>, run: HookRun) {
  const host = getHost();
  const { DATA_DIR, workspaceDir } = host;

  if (target.kind === "pc") return host.spawnPcHook(run, workspaceDir(botId), join(DATA_DIR, "bot-plugins", botId, "computer-hooks"));
  const command = Object.keys(run.files).length ? commandWithFiles(run.command, run.files, run.stdin) : run.command;
  const stdin = Object.keys(run.files).length ? "" : run.stdin;
  if (target.kind === "sandbox") {
    if (!host.userSandbox) return { stdout: "", code: 1 };
    const result = await host.userSandbox.exec(target.principal, {
      argv: ["/bin/sh", "-c", command],
      stdinBase64: Buffer.from(stdin, "utf8").toString("base64"),
      timeoutSec: Math.max(1, Math.ceil(run.timeoutMs / 1000)),
      env: { LANG: "C.UTF-8" },
      maxOutputBytes: 16_000
    }, botId);
    return { stdout: result.stdout, code: result.exitCode ?? 1 };
  }
  const desktop = host.desktopBridges.current(target.principal);
  if (!desktop || desktop.platform === "win32") return { stdout: "", code: 1 };
  const line = commandWithFiles(run.command, run.files, run.stdin);
  const result = await host.desktopBridges.request(target.principal, {
    action: "run_command", command: line, timeout_seconds: Math.max(1, Math.ceil(run.timeoutMs / 1000))
  }, () => true) as { isError?: boolean; content?: Array<{ text?: string }> } | null;
  return { stdout: result?.content?.map((part) => part.text ?? "").join("\n") ?? "", code: result?.isError ? 1 : 0 };

}
  return execLifecycleHook;
}
