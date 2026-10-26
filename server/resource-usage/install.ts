// Wires the resource usage card into the server with what index.ts already
// has: its access rules, the terminal hosts, the Tailcat sessions. index.ts
// only builds this once and lists its two routes.
import { hostname } from "node:os";

import type { ResourceUsageView } from "../../shared/resource-usage.ts";
import { augmentedPath } from "../env-path.ts";
import { flowHome, readTunnel } from "../remote-session-probe.ts";
import type { RemoteSessionService } from "../remote-sessions.ts";
import type { InternalRouteHandler } from "../routes/internal-route.ts";
import { createResourceUsageInternalRoutes, createResourceUsageRoutes } from "../routes/resource-usage.ts";
import type { RouteHandler } from "../routes/table.ts";
import type { RequestAuth } from "../request-auth.ts";
import { resolveTailcatBinary } from "../tailcat-bin.ts";
import { configuredHosts } from "../terminal-install.ts";
import type { TerminalAccess } from "../terminal-resources/types.ts";
import type { AppConfig } from "../config.ts";
import { prepareVpsSsh } from "../vps-ssh.ts";
import { createResourceSamplers } from "./sampler.ts";
import { containerSource, localSource, sshSource, tailcatSource } from "./sources.ts";
import { resolveResourceTarget, type ResourceHostEntry, type ResourceSessionEntry, type ResourceTargetDeps } from "./targets.ts";

export interface ResourceUsageFeature {
  route: RouteHandler;
  internalRoute: InternalRouteHandler;
  close(): void;
}

export function installResourceUsage(deps: {
  dataDir: string;
  cfg(): AppConfig;
  organization(): boolean;
  desktopManaged: boolean;
  access(principalId: string, botId: string): TerminalAccess;
  principalId(auth: RequestAuth): string | undefined;
  remoteSessions: Pick<RemoteSessionService, "list" | "principalFor">;
  supportDir: string;
  /** The person speaking in this turn (their rights, their sessions). */
  speaker(threadId: string): string | undefined;
  ownsThread(botId: string, threadId: string): boolean;
  /** The person's own message that started this turn (generation), or undefined. */
  personText(threadId: string, generation: string): string | undefined;
  /** Appends the card as a bot message of this conversation. */
  post(input: { botId: string; threadId: string; view: ResourceUsageView }): void;
  /** The bot's Local VM container on this computer, when it runs (solo). */
  localVm?(botId: string, threadId: string): Promise<{ runtime: string; container: string } | null>;
}): ResourceUsageFeature {
  const samplers = createResourceSamplers();
  const tunnelFor = (entry: ResourceSessionEntry, principalId: string, botId: string) =>
    readTunnel(flowHome(), { id: entry.id, code: entry.code, principalId, botId }, deps.supportDir);

  const targets: ResourceTargetDeps = {
    organization: deps.organization,
    desktopManaged: () => deps.desktopManaged,
    access: deps.access,
    owner: (botId, threadId) => deps.remoteSessions.principalFor(botId, threadId),
    localHostname: () => hostname(),
    localSource: () => localSource(),
    hosts: () => {
      const hosts = configuredHosts(deps.cfg());
      return [
        ...hosts.ssh.map((host): ResourceHostEntry => ({ ...host, provider: "ssh" })),
        ...hosts.unraid.map((host): ResourceHostEntry => ({ ...host, provider: "unraid" })),
      ];
    },
    sshSource: (alias) => sshSource(alias, () => prepareVpsSsh(deps.dataDir, augmentedPath())),
    remoteSessions: (principalId, botId) => deps.remoteSessions.list(principalId, botId).map((view) => ({
      id: view.id,
      code: view.code,
      os: view.os,
      ...(view.hostname ? { hostname: view.hostname } : {}),
      ...(view.focused ? { focused: true } : {}),
    })),
    // owned(principal, bot, id) is the list above; tunnelOf is readTunnel with that row
    tailcatSource: (entry, principalId, botId) => {
      if (!tunnelFor(entry, principalId, botId)) return null;
      return tailcatSource(() => {
        const tunnel = tunnelFor(entry, principalId, botId);
        return tunnel ? { bin: resolveTailcatBinary() ?? "tailcat", ...tunnel } : null;
      }, entry.os === "windows" ? "windows" : "posix");
    },
    ...(deps.localVm
      ? {
        botComputer: async (botId: string, threadId: string) => {
          const vm = await deps.localVm!(botId, threadId).catch(() => null);
          return vm ? { hostLabel: "VM locale", source: containerSource(vm.runtime, vm.container) } : null;
        },
      }
      : {}),
  };

  return {
    route: createResourceUsageRoutes({ samplers, principalId: deps.principalId }),
    internalRoute: createResourceUsageInternalRoutes({
      samplers,
      ownsThread: deps.ownsThread,
      principal: (botId, threadId) => deps.speaker(threadId) || deps.remoteSessions.principalFor(botId, threadId) || undefined,
      personText: deps.personText,
      resolve: (request) => resolveResourceTarget(targets, request),
      post: deps.post,
    }),
    close: () => samplers.close(),
  };
}
