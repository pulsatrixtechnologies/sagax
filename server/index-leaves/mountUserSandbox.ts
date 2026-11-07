// @ts-nocheck
/** mountUserSandbox (#1388). Pure move from server/index.ts. */
import { AUTO_COMPUTER_MCP_NAME } from "../computer/auto-computer.ts";
import { USER_SANDBOX_MCP_NAME } from "../sandbox/user-sandbox-routing.ts";
export type Host = Record<string, any>;

export function createMountUserSandbox(getHost: () => Host): any {
function mountUserSandbox(   integrations: NonNullable<SendTurnInput["integrations"]>,   input: { botId: string; threadId: string; generation: string; customMcp: boolean; decision: WorkplaceDecision; staging: TurnWorkplace["staging"]; auto?: AutoComputerState | null }, ) {
  const host = getHost();

  const { decision } = input;
  const auto = input.auto ?? undefined;
  host.turnWorkplaces.set(input.threadId, { generation: input.generation, botId: input.botId, decision, staging: input.staging, ...(auto ? { auto } : {}) });
  // Organization server: an Apple app On in the person's Plugins > This Mac
  // reaches their bots whatever the engine or the computer the turn works
  // on. Calls go through their desktop app; offline, the tools stay listed
  // and say the Mac is offline (2026-11-06).
  if (decision.principal && !integrations.messages && host.IDENTITY.kind === "perspicax" && host.desktopBridges.macAppsOn(decision.principal).length) {
    integrations.messages = host.messagesIntegration(input.botId, input.threadId, input.generation, decision.principal);
  }
  if (!input.customMcp || !decision.principal) return;
  // 2026-10-16: the servers Sagax mounts here are the person's environment
  // for this turn, recorded on the turn's workplace: the approval path
  // recognizes the owner's own environment by this mount, never by a
  // server's name alone (member-environment.ts ownEnvironmentCall).
  const mounted = new Set<string>();
  const sandbox = () => { mounted.add(USER_SANDBOX_MCP_NAME); return host.userSandboxIntegration(input.botId, input.threadId, input.generation, decision.principal!); };
  const desktop = () => { mounted.add(host.DESKTOP_BRIDGE_MCP_NAME); return host.userDesktopIntegration(input.botId, input.threadId, input.generation, decision.principal!); };
  if (decision.target === "user-sandbox") {
    integrations.custom = { ...integrations.custom, [USER_SANDBOX_MCP_NAME]: sandbox() };
  } else if (decision.target === "user-desktop" && host.desktopBridges.connected(decision.principal)) {
    integrations.custom = { ...integrations.custom, [host.DESKTOP_BRIDGE_MCP_NAME]: desktop() };
  }
  // Auto: the bot picks the computer per step (computer_select); a fixed
  // Works on gets the tool too, and it says the setting is fixed.
  if (auto) {
    integrations.custom = { ...integrations.custom, [AUTO_COMPUTER_MCP_NAME]: host.workplaceIntegration(input.botId, input.threadId, input.generation) };
    if (auto.auto && auto.desktopMounted && !integrations.custom[host.DESKTOP_BRIDGE_MCP_NAME]) {
      integrations.custom = { ...integrations.custom, [host.DESKTOP_BRIDGE_MCP_NAME]: desktop() };
    }
    // Started on their computer: the cloud stays one switch away.
    if (auto.auto && auto.sandboxConfigured && decision.target === "user-desktop" && !integrations.custom[USER_SANDBOX_MCP_NAME]) {
      integrations.custom = { ...integrations.custom, [USER_SANDBOX_MCP_NAME]: sandbox() };
    }
  }
  const workplace = host.turnWorkplaces.get(input.threadId);
  if (workplace && workplace.generation === input.generation && mounted.size) workplace.ownEnvironmentServers = mounted;
  if (workplace && workplace.generation === input.generation && auto) workplace.computerChoice = true;

}
  return mountUserSandbox;
}
