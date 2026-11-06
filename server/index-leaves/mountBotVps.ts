// @ts-nocheck
/** mountBotVps (#1388). Pure move from server/index.ts. */
import { vpsSshAlias } from "../config.ts";
export type Host = Record<string, any>;

export function createMountBotVps(getHost: () => Host): any {
async function mountBotVps(   bot: BotRecord,   owner: TurnOwner,   opts: { start: boolean; onClaimed: (capture: () => Promise<{ png: string; format: string }>) => void; onRejected?: (failure: string) => void }, ) {
  const host = getHost();
  const { cfg } = host;

  const vpsResource = `computer:vps:${vpsSshAlias(cfg)}:${bot.id}`;
  const remote = opts.start
    ? await host.vps.vpsComputerAction("provision", host.cfg, bot.id)
    : await host.vps.inspectVpsForAuto(host.cfg, bot.id);
  if (!remote?.ready || !remote.sshAlias) return { problem: remote?.problem ?? null, reachable: remote?.daemonUp === true };
  const targetCfg = { ...cfg, vps: { sshAlias: remote.sshAlias } };
  const vpsMcp = host.vps.vpsComputerMcp(targetCfg, bot.id, remote.container_id ?? undefined);
  const vpsControl = host.controlIntegration(bot.id, owner.threadId, owner.generation);
  // Live frames only once this turn holds the desktop: a poller on a desktop
  // another turn is driving would publish that turn's screen as this one's.
  const vpsCapture = () => host.vps.vpsComputerScreenshot(targetCfg, bot.id);
  host.autoVmClaims.set(owner.threadId, {
    owner,
    lazy: true,
    label: "the VPS computer",
    onRejected: opts.onRejected,
    claim: async () => {
      await host.bindTurnComputer(owner, vpsResource, true);
      opts.onClaimed(vpsCapture);
    }
  });
  return {
    integration: {
      ...vpsMcp,
      env: { ...vpsMcp.env, SAGAX_CONTROL_URL: vpsControl.url, SAGAX_CONTROL_TOKEN: vpsControl.token }
    }
  };

}
  return mountBotVps;
}
