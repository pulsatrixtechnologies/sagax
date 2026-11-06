// @ts-nocheck
/** describeInstances (#1388). Pure move from server/index.ts. */
import { reportBackgroundError } from "../background-error.ts";
import { CLAUDE_API_INSTANCE } from "../config.ts";
import { claudeAccountInfo } from "../engines/claude-accounts.ts";
export type Host = Record<string, any>;

export function createDescribeInstances(getHost: () => Host): any {
async function describeInstances() {
  const host = getHost();
  const configs = host.providerConfigs();
  // Reading the engines is where this server learns one became available
  // (an install, a sign-in, a key or a Company engine), so a bot still on the
  // removed Computer engine moves now rather than at the next start.
  void host.retryComputerEngineMove().catch(reportBackgroundError);
  const engines = host.selectableInstances(await host.registry.describe({ known: true }));
  await host.refreshUnsetModelSelections(engines);
  return engines.map((instance) => {
    const entry = configs[instance.instanceId];
    // Image pin (engines.lock.json): the client must not offer an in-place update.
    const imagePinned = host.selfCheckedEngine(instance.instanceId) !== null;
    const described = {
      ...instance,
      ...(entry?.icon ? { icon: entry.icon } : {}),
      ...(entry?.access ? { access: entry.access } : {}),
      ...(imagePinned ? { pinned: true as const } : {})
    };
    if (host.hostedModels) return { ...described, readOnly: true,
      install: undefined, authentication: undefined, cli: undefined, cliCandidates: []
    };
    const policyReason = host.policyModelRefusal(instance);
    const policy = policyReason ? { policy: { organizationName: host.managedPolicy.current()!.organizationName, reason: policyReason } } : {};
    if (host.managedDesktop.owns(instance.instanceId)) return {
      ...described, ...policy, readOnly: true, managed: host.managedDesktop.info(instance.instanceId),
      install: undefined, authentication: undefined, cli: undefined, cliCandidates: []
    };
    // Windows keeps what Antigravity's runtime unpacked whenever it is
    // stopped by force; its Settings card offers to clear that.
    if (instance.driverKind === "antigravityAgent" && process.platform === "win32") return { ...described, ...policy, freeUpSpace: true };
    if (entry?.driver !== "claudeAgent") return { ...described, ...policy };
    // Claude on the workspace API key has no account to sign in to.
    if (instance.instanceId === CLAUDE_API_INSTANCE) {
      return { ...described, ...policy, authentication: undefined, install: { ...instance.install, signInCommand: undefined } };
    }
    try {
      const claudeAccount = claudeAccountInfo(instance.instanceId, entry, instance.cli ?? instance.cliDefault ?? "claude");
      return { ...described, ...policy, claudeAccount, install: { ...instance.install, signInCommand: claudeAccount.signInCommand } };
    } catch {
      // A malformed saved config remains a repairable shadow, never takes
      // the model picker down or offers a login for the wrong directory.
      return { ...described, ...policy, install: { ...instance.install, signInCommand: undefined } };
    }
  });
}
  return describeInstances;
}
