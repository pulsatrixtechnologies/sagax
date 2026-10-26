import { readEnvName } from "../electron/legacy-names.mjs";
import { augmentedPath } from "./env-path.ts";
import { prepareVpsSsh } from "./vps-ssh.ts";
import { isValidSshAlias, type AppConfig } from "./config.ts";
import { createTerminalAuditLog } from "./terminal-audit.ts";
import { TerminalResourceRegistry } from "./terminal-resources/registry.ts";
import { testTerminalAdapter } from "./terminal-resources/adapters/test.ts";
import { createSshAliasAdapter, type SshAliasTerminalHost } from "./terminal-resources/adapters/ssh-alias.ts";
import { createPersonalTerminalAdapter, type PersonalTerminalDeps } from "./terminal-resources/adapters/personal.ts";
import type { TerminalAccess } from "./terminal-resources/types.ts";
import { createTerminalSessionManager } from "./terminal-sessions.ts";
import { createTerminalRequestService, type TerminalWorkPlace } from "./terminal-requests.ts";
import { createTerminalRoutes } from "./routes/terminal.ts";
import { createTerminalInternalRoutes } from "./routes/terminal-internal.ts";
import type { InternalRouteHandler } from "./routes/internal-route.ts";
import type { Store } from "./store.ts";
import type { RequestAuth } from "./request-auth.ts";
import type { IncomingMessage } from "node:http";
import type { RouteHandler } from "./routes/table.ts";

export interface TerminalFeature {
  registry: TerminalResourceRegistry;
  sessions: ReturnType<typeof createTerminalSessionManager>;
  requests: ReturnType<typeof createTerminalRequestService>;
  /** The bot's tools, for INTERNAL_ROUTES (behind the turn's capability). */
  internalRoute: InternalRouteHandler;
  wire(
    routes: RouteHandler[],
    options: {
      upgrade(req: IncomingMessage): { socket: import("node:net").Socket; head: Buffer; release(): void } | undefined;
      live(auth: RequestAuth): boolean;
    },
  ): void;
}

function sshArgv(dataDir: string, alias: string) {
  const ssh = prepareVpsSsh(dataDir, augmentedPath());
  const args = ["-tt", alias];
  if (ssh.configPath) args.unshift("-F", ssh.configPath);
  return { command: "ssh", args, env: { ...process.env, PATH: ssh.path } };
}

export function configuredHosts(cfg: AppConfig): { ssh: SshAliasTerminalHost[]; unraid: SshAliasTerminalHost[] } {
  const ssh: SshAliasTerminalHost[] = [];
  const unraid: SshAliasTerminalHost[] = [];
  const raw = cfg.terminalShell?.hosts;
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (!entry || typeof entry !== "object") continue;
      const id = String((entry as { id?: unknown }).id ?? "").trim();
      const alias = String((entry as { alias?: unknown }).alias ?? "").trim();
      const label = String((entry as { label?: unknown }).label ?? id).trim();
      const hostLabel = String((entry as { hostLabel?: unknown }).hostLabel ?? alias).trim();
      const provider = String((entry as { provider?: unknown }).provider ?? "ssh").trim();
      if (!id || !isValidSshAlias(alias)) continue;
      const host = { id, alias, label, hostLabel };
      if (provider === "unraid") unraid.push(host);
      else ssh.push(host);
    }
  }
  const unraidAlias = readEnvName("SAGAX_UNRAID_SSH_ALIAS") || cfg.terminalShell?.unraidSshAlias;
  if (isValidSshAlias(unraidAlias) && !unraid.some((host) => host.alias === unraidAlias)) {
    unraid.push({
      id: "default",
      alias: unraidAlias,
      label: "Serveur unRAID",
      hostLabel: unraidAlias,
    });
  }
  const vpsAlias = cfg.vps?.sshAlias;
  if (isValidSshAlias(vpsAlias)) {
    ssh.push({
      id: `vps:${vpsAlias}`,
      alias: vpsAlias,
      label: "Serveur distant",
      hostLabel: vpsAlias,
    });
  }
  return { ssh, unraid };
}

export function installTerminalFeature(deps: {
  dataDir: string;
  store: Store;
  cfg: () => AppConfig;
  principalId: (auth: RequestAuth) => string | undefined;
  /** What this person may open for this bot (index.ts terminalAccessFor). */
  access: (principalId: string, botId: string) => TerminalAccess;
  /** Where the bot works now, for the card's default. */
  workPlace?: (botId: string, threadId: string, principalId: string) => TerminalWorkPlace;
  /** Whose conversation it is when the task names nobody. */
  owner?: (botId: string, threadId: string) => string;
  /** The bot owns this conversation (internal routes). */
  ownsThread: (botId: string, threadId: string) => boolean;
  /** 2026-10-19: Always allow kept for a terminal offer (terminal-requests.ts). */
  keptRule?: (principalId: string, botId: string, candidate: { tool: string; scope: Record<string, string> }, threadId: string) => { id: string } | null;
  journalRule?: (input: { threadId: string; botId: string; requestId: string; summary: string; rule: string }) => void;
  /** The person's own environments, when this server has them. */
  personal?: Partial<Record<"sandbox" | "local-vm" | "desktop", PersonalTerminalDeps>>;
  now?: () => number;
  /** When the person asks for a shell and a Tailcat session is already
   * connected, open it instead of a workplace card. Null: no session. */
  openRemoteShell?(args: { botId: string; threadId: string }): Promise<{ hostLabel: string; messageId: string } | { error: string } | null>;
}): TerminalFeature {
  const now = deps.now ?? (() => Date.now());
  const audit = createTerminalAuditLog(deps.dataDir);
  const registry = new TerminalResourceRegistry();
  if (process.env.VITEST === "true" || process.env.SAGAX_TERMINAL_TEST === "1") {
    registry.register(testTerminalAdapter);
  }
  const hosts = () => configuredHosts(deps.cfg());
  registry.register(createSshAliasAdapter("ssh", () => hosts().ssh, (alias) => sshArgv(deps.dataDir, alias)));
  registry.register(createSshAliasAdapter("unraid", () => hosts().unraid, (alias) => sshArgv(deps.dataDir, alias)));
  for (const kind of ["sandbox", "local-vm", "desktop"] as const) {
    const personal = deps.personal?.[kind];
    if (personal) registry.register(createPersonalTerminalAdapter(kind, personal));
  }

  const sessions = createTerminalSessionManager({ registry, audit, now });
  const requests = createTerminalRequestService({
    store: deps.store,
    registry,
    sessions,
    principalId: deps.principalId,
    audit,
    now,
    access: deps.access,
    ...(deps.workPlace ? { workPlace: deps.workPlace } : {}),
    ...(deps.owner ? { owner: deps.owner } : {}),
    ...(deps.keptRule ? { keptRule: deps.keptRule } : {}),
    ...(deps.journalRule ? { journalRule: deps.journalRule } : {}),
  });

  return {
    registry,
    sessions,
    requests,
    internalRoute: createTerminalInternalRoutes({
      requests,
      ownsThread: deps.ownsThread,
      ...(deps.openRemoteShell ? { openRemoteShell: deps.openRemoteShell } : {}),
    }),
    wire(routes, options) {
      routes.push(createTerminalRoutes({ requests, sessions, principalId: deps.principalId, upgrade: options.upgrade, live: options.live }));
    },
  };
}
