/** Snapshot and isolated one-shot text for an ACP instance. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { execCli, killCliTree, spawnCli } from "../../procs.ts";
import { runAcpOneShot } from "./background-text.ts";
import { versionFromProbe } from "./helpers.ts";
import { newId } from "../../contracts.ts";
import type {
  ProviderSnapshot,
  SendTurnInput,
  TextGenerationOptions,
} from "../../contracts.ts";
import type { AcpConfig, AcpSupport } from "./types.ts";

export type InstanceTextDeps = {
  support: AcpSupport;
  config: AcpConfig;
  instanceId: string;
  childEnv: (activeConfig?: AcpConfig) => Record<string, string | undefined>;
  getModels: () => { default: string; options: Array<{ id: string }> };
  getStartupModelRefresh: () => Promise<void> | null;
};

export function createInstanceText(deps: InstanceTextDeps) {
  const { support, config, instanceId, childEnv, getModels, getStartupModelRefresh } = deps;

    const snapshot = async (): Promise<ProviderSnapshot> => {
      const env = childEnv();
      if (support.snapshot) return support.snapshot(env, config, instanceId);
      const probe = await new Promise<{ version?: string; reason?: string }>((resolve) => {
        execCli(config.cli, ["--version"], { timeout: 8000, env }, (err, stdout, stderr) => {
          if (err) {
            const failure = err as NodeJS.ErrnoException & { killed?: boolean };
            const reason = failure.code === "ENOENT"
              ? `\`${config.cli}\` isn't installed, or isn't on this app's PATH. Install it for the user running Sagax or use Set CLI, then check again.`
              : failure.code === "EACCES" || failure.code === "EPERM"
                ? `\`${config.cli}\` isn't executable. Check its file permissions, then check again.`
                : failure.killed && failure.code == null
                  ? `\`${config.cli}\` version check timed out after 8 seconds. Check it in a terminal on the server, then try again.`
                  : `\`${config.cli}\` version check failed. Run it with --version on the server to diagnose the installation, then check again.`;
            // Do not echo arbitrary CLI output or its environment into Settings.
            resolve({ reason });
            return;
          }
          const version = versionFromProbe(stdout, stderr);
          resolve(version ? { version } : { reason: `\`${config.cli}\` returned no version. Check the configured executable with --version, then try again.` });
        });
      });
      if (!probe.version) return { state: "unavailable", reason: probe.reason };
      return { state: "available", version: probe.version, authenticated: await support.isAuthenticated(env, config, instanceId) };
    };

    /** Memory upkeep's one-shot call on this engine's own provider: a
     * fresh process and session, never a chat's, with no MCP servers, in
     * an empty folder, in the interactive approval mode, refusing any
     * tool, file or permission request. Off the turn path: upkeep calls
     * it after a chat goes quiet and at the nightly tidy-up. */
    const isolatedText = async (prompt: string, options: TextGenerationOptions, folder: string, clientName: string): Promise<string> => {
      const startupModelRefresh = getStartupModelRefresh();
      if (startupModelRefresh) await startupModelRefresh;
      const turnConfig: AcpConfig = { ...config, fullAuto: false };
      const env = childEnv(turnConfig);
      if (support.requireAuthenticationBeforeSpawn && !(await support.isAuthenticated(env, turnConfig, instanceId))) {
        throw new Error(support.loginNote);
      }
      const cwd = mkdtempSync(join(tmpdir(), folder));
      try {
        const turn = { threadId: `memory-text-${newId()}`, text: prompt, approvalMode: "ask", cwd } as SendTurnInput;
        support.applyTurnEnv?.(env, { fullAuto: false, cwd, threadId: turn.threadId, mcpServers: [] });
        const launch = support.resolveCommand ? await support.resolveCommand(env, turnConfig, instanceId) : { command: turnConfig.cli };
        const spawnEnv = launch.env ?? env;
        return await runAcpOneShot({
          displayName: support.displayName,
          spawn: spawnCli,
          kill: killCliTree,
          command: launch.command,
          argv: [...(launch.args ?? []), ...support.spawnArgs(turnConfig, turn)],
          env: spawnEnv,
          cwd,
          prompt,
          defaultModel: getModels().default,
          pickAuthMethod: (methods) => support.pickAuthMethod(methods, spawnEnv),
          authRequired: support.authFailure === "fail-request" ? "if-requested" : support.authFailure === "fail",
          loginNote: support.loginNote,
          clientCapabilitiesMeta: support.clientCapabilitiesMeta,
          clientName,
          ...(support.configureSession ? {
            configure: ({ request, sessionId, session }) => support.configureSession!({
              request,
              sessionId,
              env: spawnEnv,
              config: turnConfig,
              turn,
              sessionModels: Array.isArray(session?.models?.availableModels) ? session.models.availableModels : [],
              currentModelId: session?.models?.currentModelId,
              configOptions: Array.isArray(session?.configOptions) ? session.configOptions : [],
              notice: () => undefined,
            }),
          } : {}),
          options,
        });
      } finally {
        // On Windows the engine process can still hold the folder for a
        // moment after it exits; a cleanup failure must never replace the
        // one-shot's own result or error. The OS temp folder is reclaimed later.
        try { rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* left for the OS */ }
      }
    };
    const generateMemoryText = (prompt: string, options: TextGenerationOptions = {}) =>
      isolatedText(prompt, options, "omb-acp-memory-", "openmausbot_memory");
    const reviewPermission = (prompt: string, signal?: AbortSignal) =>
      isolatedText(prompt, { signal }, "omb-acp-review-", "openmausbot_review");


  return { snapshot, isolatedText, generateMemoryText, reviewPermission };
}
