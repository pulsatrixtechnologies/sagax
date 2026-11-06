// @ts-nocheck
/** botComputerShell (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createBotComputerShell(getHost: () => Host): any {
function botComputerShell(bot: BotRecord) {
  const host = getHost();
  const { containerExec } = host;

  // Organization server: the phone does not drive a shared computer.
  // The person's environment is their own, opened from the Computer tab.
  if (host.IDENTITY.kind === "perspicax") return null;
  const team = host.inheritedTeamComputer(bot);
  if (team) {
    const key = host.teamComputerOwner(team.id);
    return { kind: "team", maxScript: 3_500, run: (script) => host.boat.runDesktopScript(host.cfg, key, script) };
  }
  if (bot.computer === "vm") {
    // An organization server never drives a desktop on itself.
    if (host.hostComputerRefusal()) return null;
    const target = host.localVmTargetForStatus(bot.id, bot.threadId);
    return {
      kind: "vm", maxScript: 15_000,
      run: async (script) => {
        const out = await containerExec(target, script, { timeoutSeconds: 20 });
        return { ok: out.exitCode === 0, stdout: out.stdout, stderr: out.stderr };
      }
    };
  }
  if (bot.computer !== "cloud" && bot.computer !== undefined) return null;
  if (bot.cloudBackend === "vps") {
    if (!vpsSshAlias(host.cfg)) return null;
    return { kind: "vps", maxScript: 15_000, run: (script) => host.vps.vpsDesktopScript(host.cfg, bot.id, script) };
  }
  if (!host.boat.boatConfigured(host.cfg)) return null;
  return { kind: "cloud", maxScript: 3_500, run: (script) => host.boat.runDesktopScript(host.cfg, bot.id, script) };

}
  return botComputerShell;
}
