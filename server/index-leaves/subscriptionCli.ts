// @ts-nocheck
/** subscriptionCli (#1388). Pure move from server/index.ts. */
import { instanceConfigs } from "../config.ts";
import { ENGINE_DRIVER } from "../cloud-agents/subscription-access.ts";
export type Host = Record<string, any>;

export function createSubscriptionCli(getHost: () => Host): any {
function subscriptionCli(engine: RunEngine): { cli: string; environment: Record<string, string | undefined> } | null {
  const host = getHost();
  const { loginCliFor } = host;

  const driver = ENGINE_DRIVER[engine];
  for (const [instanceId, entry] of Object.entries(instanceConfigs(host.cfg))) {
    if (entry.driver !== driver) continue;
    const configured = (entry.config as { cli?: unknown } | undefined)?.cli;
    const cli = loginCliFor(entry.driver, configured, host.registry.cliTarget(instanceId)?.cli);
    if (cli) return { cli, environment: entry.environment ?? {} };
  }
  const cli = loginCliFor(driver, undefined, undefined);
  return cli ? { cli, environment: {} } : null;

}
  return subscriptionCli;
}
