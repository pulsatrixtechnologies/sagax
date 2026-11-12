// @ts-nocheck
/** routineWatchPlace (#1388). Pure move from server/index.ts. */
import { chooseHookTarget } from "../hooks/lifecycle-hooks.ts";
export type Host = Record<string, any>;

export function createRoutineWatchPlace(getHost: () => Host): any {
function routineWatchPlace(routine: WatchRoutine) {
  const host = getHost();
  const { containerComputerStatus, containerExec, workspaceDir } = host;
  const bot = host.store.bot(routine.botId);
  if (!bot) return { kind: "refuse", reason: "The bot of this routine is gone" };
  if (host.IDENTITY.kind === "perspicax") {
    const principal = host.effectiveRunAs({ botId: routine.botId, ...(routine.runAs ? { runAs: routine.runAs } : {}) })?.trim().toLowerCase() || null;
    const decision = host.decideWorkplace({ desktopTargeted: false, routine: true, principal, personAsked: false });
    const target = chooseHookTarget({ identityKind: host.IDENTITY.kind, workplace: decision.target, principal: decision.principal ?? principal });
    if (target.kind === "refuse") {
      return { kind: "refuse", reason: target.reason === "server" ? "A watch never runs on this server: it reads where the bot works (your server environment or your computer)" : "This bot has no computer to watch" };
    }
    if (target.kind === "sandbox") {
      return {
        kind: "remote", label: "Your server environment",
        awake: async () => Boolean(host.userSandbox) && (await host.userSandbox!.status(target.principal, bot.id)).state === "running",
        wake: () => { void host.userSandbox?.prewake(target.principal, bot.id); },
        exec: async (command, options) => {
          if (!host.userSandbox) return { exitCode: null, stdout: "", truncated: false, timedOut: false };
          // #4081: the check reads the bot's own Perspicax connection
          // through the bridge (routine delegation, reads only), its token
          // ended with the check (server/perspicax/sandbox-bridge.ts).
          const bridge = host.sandboxBridgeWatch?.({
            botId: bot.id, principalId: target.principal, ownerPrincipalId: host.effectiveBotOwner(bot), ttlMs: options.timeoutMs + 5_000
          }) ?? null;
          // In the bot's own folder, like its commands (server/sandbox/sandbox-bot-folder.ts).
          // Only SAGAX_* names cross into an environment (sandboxd-core.ts
          // EXEC_ENV_KEY_RE): LANG here made every check a bad_exec; the
          // image sets LANG=C.UTF-8 itself.
          const input = {
            argv: ["/bin/sh", "-c", command], ...(bridge ? { env: bridge.env } : {}),
            timeoutSec: Math.max(1, Math.floor(options.timeoutMs / 1000)), maxOutputBytes: options.maxOutputBytes
          };
          const folder = host.sandboxBotFolder(bot.id);
          try {
            const result = await host.userSandbox.exec(target.principal, folder ? host.inBotFolder(input, folder) : input, bot.id);
            return { exitCode: result.exitCode, stdout: result.stdout, truncated: result.truncated, timedOut: result.timedOut };
          } finally {
            bridge?.end();
          }
        }
      };
    }
    if (target.kind === "desktop") {
      return {
        kind: "remote", label: "Your computer",
        awake: async () => host.desktopBridges.connected(target.principal),
        exec: async (command, options) => {
          const desktop = host.desktopBridges.current(target.principal);
          if (!desktop || desktop.platform === "win32") return { exitCode: null, stdout: "", truncated: false, timedOut: false };
          const answer = await host.desktopBridges.request(target.principal, {
            action: "run_command", command, timeout_seconds: Math.max(1, Math.floor(options.timeoutMs / 1000))
          }, () => true) as { isError?: boolean; content?: Array<{ text?: string }> } | null;
          const stdout = answer?.content?.map((part) => part.text ?? "").join("\n") ?? "";
          return { exitCode: answer?.isError ? 1 : 0, stdout: stdout.slice(0, options.maxOutputBytes), truncated: stdout.length > options.maxOutputBytes, timedOut: false };
        }
      };
    }
    return { kind: "refuse", reason: "This bot has no computer to watch" };
  }
  if (bot.computer === "off") return { kind: "refuse", reason: "This bot's computer is off" };
  if (routine.runOn === "cloud" || host.cloudOnlyBot(bot.id) || bot.computer === "cloud") {
    return {
      kind: "remote", label: "The bot's cloud computer",
      awake: async () => {
        const status = await host.boat.boatStatus(host.cfg, bot.id).catch(() => null);
        return Boolean(status?.box && ["idle", "ready", "running"].includes(status.box.state));
      },
      wake: () => { void host.boat.readyBoat(host.cfg, bot.id).catch(() => null); },
      exec: async (command, options) => {
        // Never wakes the computer (409 when it is asleep), short deadline.
        const out = await host.boat.runDesktopScript(host.cfg, bot.id, command);
        return { exitCode: out.ok ? 0 : 1, stdout: out.stdout.slice(0, options.maxOutputBytes), truncated: out.stdout.length > options.maxOutputBytes, timedOut: false };
      }
    };
  }
  if (bot.computer === "vm") {
    const target = host.localVmTargetForBot(bot.id);
    return {
      kind: "remote", label: "The bot's Local VM",
      awake: async () => {
        if (host.botComputerControlSnapshot(bot.id).held) return false;
        const status = await containerComputerStatus(undefined, undefined, target, { probeDesktop: false }).catch(() => null);
        return Boolean(status?.runtime && status.container === "running");
      },
      exec: async (command, options) => {
        const out = await containerExec(target, command, { timeoutSeconds: Math.max(1, Math.floor(options.timeoutMs / 1000)) });
        return { exitCode: out.exitCode, stdout: out.stdout.slice(0, options.maxOutputBytes), truncated: out.stdout.length > options.maxOutputBytes, timedOut: Boolean(out.timedOut) };
      }
    };
  }
  return { kind: "host", cwd: bot.cwd ?? workspaceDir(bot.id) };

}
  return routineWatchPlace;
}
