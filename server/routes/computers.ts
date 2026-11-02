/**
 * Public computers HTTP routes (#1388 wave 2 P6):
 *   GET  /api/computers/boxes
 *   POST /api/computers/boxes/:id/{sleep,delete}
 *   GET  /api/computers/vps
 *   POST /api/computers/vps/:id/remove
 *   GET  /api/bots/:id/computer
 *   GET|POST /api/bots/:id/computer/control
 *   POST /api/bots/:id/computer/viewer-close
 *   POST /api/bots/:id/computer/{provision,join,sleep,exec,screenshot,remove}
 *
 * /api/team-computers stays with P1. Registered in ROUTES after the auth gate.
 * Never imports server/index.ts.
 */
import { z } from "zod";

import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

const controlLeaseIdSchema = z.string().min(16).max(120).regex(/^[A-Za-z0-9_-]+$/);

export type RemoteComputerProvider = "box" | "vps";

export interface ComputersBot {
  id: string;
  name: string;
  threadId: string;
  computer?: string;
  cloudBackend?: string;
  autoStartVps?: boolean;
  busy?: boolean;
  ownerUserId?: unknown;
}

export interface ComputersTeamComputer {
  id: string;
  name: string;
}

export interface ComputersRouteDeps {
  listBoxes(): Promise<unknown>;
  sleepBox(id: string): Promise<unknown>;
  deleteBox(id: string, confirmName: string): Promise<unknown>;
  listVps(): Promise<unknown>;
  removeVps(id: string, confirmName: string): Promise<unknown>;
  providerTransitioning(provider: RemoteComputerProvider): boolean;
  providerTransitionMessage(provider: RemoteComputerProvider): string;
  claimBoxInventory(id: string): () => void;
  claimVpsMutation(id: string): () => void;

  previewBot(botId: string, url: URL): ComputersBot | null;
  bot(botId: string): ComputersBot | null | undefined;
  previewSurface(bot: ComputersBot, threadId: string): Promise<"cloud" | "vm" | string>;
  isOrganization(): boolean;
  sandboxConfigured(): boolean;
  inheritedTeamComputer(bot: ComputersBot): ComputersTeamComputer | undefined;
  /** Owner key for a team computer (teamComputerOwner in index). */
  teamOwnerKey(computerId: string): string;
  boatStatus(ownerKey: string): Promise<object>;
  vpsStatus(botId: string): Promise<object>;

  /** Panel GET: resolves bot id through botComputerControlSnapshot. */
  botControlSnapshot(botId: string): object;
  /** Raw control-key snapshot (team owner key or bot id). */
  controlSnapshot(key: string): object;
  controlTake(key: string): object;
  controlRelease(key: string): object;
  controlDismissHelp(key: string): object;
  controlAcquireLease(key: string, leaseId: string): { snapshot: object; owned: boolean; acquired: boolean };
  controlReleaseLease(key: string, leaseId: string): { snapshot: object; released: boolean };
  controlOwnsLease(key: string, leaseId: string): boolean;
  controlKey(bot: ComputersBot): string;
  boatLifecycleBusy(key: string): boolean;

  closeSessionViewers(sessionId: string, botId: string): number;
  closeVpsTunnel(botId: string): unknown;

  isComputerOwner(auth: RequestAuth): boolean;
  memberOwnsBot(auth: RequestAuth, bot: ComputersBot): boolean;
  orgComputerRefusal(): { error: string; code: string } | null;
  claimBotLifecycle(botId: string, allowPreview?: boolean): () => void;
  claimTeamLifecycle(computer: ComputersTeamComputer): () => void;
  teamComputerBusy(key: string): boolean;
  teamJoin(key: string): Promise<unknown>;
  teamScreenshot(key: string): Promise<unknown>;
  teamSleep(key: string): Promise<unknown>;

  waitVpsJoin(botId: string): Promise<void>;
  beginVpsJoin(botId: string): () => void;
  vpsScreenshot(botId: string): Promise<unknown>;
  vpsJoin(botId: string, remote: boolean): Promise<{ joinUrl?: string; [key: string]: unknown }>;
  vpsAction(action: "provision" | "remove" | "stop", botId: string): Promise<unknown>;
  botHasActiveTurn(botId: string): boolean;
  activeVpsThread(botId: string): boolean;
  desktopViewerUrl(target: string, threadId?: string): string;
  maxRemoteCommandLength(): number;
  boatProvision(botId: string, name: string): Promise<unknown>;
  boatJoinReady(botId: string): Promise<unknown>;
  boatJoin(botId: string): Promise<unknown>;
  boatSleep(botId: string): Promise<unknown>;
  boatExec(botId: string, command: string): Promise<unknown>;
  boatScreenshot(botId: string): Promise<unknown>;
  cloudBusyError: string;
}

function isJsonContentType(req: { headers: { "content-type"?: string | string[] } }): boolean {
  const raw = req.headers["content-type"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return Boolean(value && String(value).toLowerCase().startsWith("application/json"));
}

export function createComputersRoutes(deps: ComputersRouteDeps): RouteHandler {
  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    let m: RegExpMatchArray | null;

    // Account-wide Boat inventory is a Settings surface, never a provisioning
    // path. Listing remains read-only; lifecycle changes require explicit
    // JSON actions and are revalidated against a fresh provider listing.
    // The REST path keeps its historical /boxes segment.
    if (method === "GET" && path === "/api/computers/boxes") {
      res.setHeader("cache-control", "private, no-store");
      return json(res, 200, await deps.listBoxes());
    }
    m = path.match(/^\/api\/computers\/boxes\/([\w-]+)\/(sleep|delete)$/);
    if (m && method === "POST") {
      if (!isJsonContentType(req)) {
        return json(res, 415, { error: "content-type must be application/json" });
      }
      const body = await readBody(req) as { confirmName?: unknown };
      if (deps.providerTransitioning("box")) {
        return json(res, 409, { error: deps.providerTransitionMessage("box") });
      }
      const releaseInventoryRequest = deps.claimBoxInventory(m[1]);
      try {
        if (m[2] === "sleep") {
          return json(res, 200, await deps.sleepBox(m[1]));
        }
        if (typeof body?.confirmName !== "string" || body.confirmName.length > 100) {
          return json(res, 400, { error: "confirmName must be the cloud computer name shown in Settings" });
        }
        return json(res, 202, await deps.deleteBox(m[1], body.confirmName));
      } finally {
        releaseInventoryRequest();
      }
    }
    if (method === "GET" && path === "/api/computers/vps") {
      res.setHeader("cache-control", "private, no-store");
      return json(res, 200, await deps.listVps());
    }
    m = path.match(/^\/api\/computers\/vps\/([\w-]+)\/remove$/);
    if (m && method === "POST") {
      if (!isJsonContentType(req)) {
        return json(res, 415, { error: "content-type must be application/json" });
      }
      const body = await readBody(req) as { confirmName?: unknown };
      if (deps.providerTransitioning("vps")) {
        return json(res, 409, { error: deps.providerTransitionMessage("vps") });
      }
      if (typeof body?.confirmName !== "string" || body.confirmName.length > 100) {
        return json(res, 400, { error: "confirmName must be the VPS computer name shown in Settings" });
      }
      const releaseComputerLifecycle = deps.claimVpsMutation(m[1]);
      try {
        return json(res, 200, await deps.removeVps(m[1], body.confirmName));
      } finally {
        releaseComputerLifecycle();
      }
    }

    // ── the bot's cloud computer (Boat) ──
    m = path.match(/^\/api\/bots\/([\w-]+)\/computer$/);
    if (m && method === "GET") {
      const bot = deps.previewBot(m[1], url);
      if (!bot) return json(res, 404, { error: "no such bot" });
      const surface = url.searchParams.has("threadId") ? await deps.previewSurface(bot, bot.threadId) : "cloud";
      if (surface !== "cloud") return json(res, 200, { surface, configured: false, backend: bot.cloudBackend === "vps" ? "vps" : "box" });
      if (deps.isOrganization()) return json(res, 200, { surface, configured: deps.sandboxConfigured(), backend: "sandbox" });
      const teamComputer = deps.inheritedTeamComputer(bot);
      if (teamComputer) {
        return json(res, 200, {
          surface,
          backend: "box",
          teamComputer: { id: teamComputer.id, name: teamComputer.name },
          ...(await deps.boatStatus(deps.teamOwnerKey(teamComputer.id))),
        });
      }
      return bot.cloudBackend === "vps"
        ? json(res, 200, { surface, backend: "vps", ...(await deps.vpsStatus(bot.id)) })
        : json(res, 200, { surface, backend: "box", ...(await deps.boatStatus(bot.id)) });
    }
    // Who is driving this bot's computer. GET is the panel's initial read;
    // POST take/release/dismiss-help are the person's three moves. The bot
    // has no verb here at all — its only voice is the internal help plea.
    m = path.match(/^\/api\/bots\/([\w-]+)\/computer\/control$/);
    if (m) {
      const bot = deps.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      if (method === "GET") return json(res, 200, deps.botControlSnapshot(bot.id));
      if (method === "POST") {
        if (!isJsonContentType(req)) {
          return json(res, 415, { error: "content-type must be application/json" });
        }
        const body = await readBody(req) as { action?: unknown; controlLeaseId?: unknown };
        const currentBot = deps.bot(bot.id);
        if (!currentBot) return json(res, 404, { error: "no such bot" });
        const controlKey = deps.controlKey(currentBot);
        const leaseResult =
          body.controlLeaseId === undefined
            ? null
            : controlLeaseIdSchema.safeParse(body.controlLeaseId);
        if (leaseResult && !leaseResult.success) {
          return json(res, 400, { error: "controlLeaseId is invalid" });
        }
        const controlLeaseId = leaseResult?.data;
        const action = String(body.action ?? "");
        if (action === "take" && (deps.boatLifecycleBusy(bot.id) || deps.boatLifecycleBusy(controlKey))) {
          return json(res, 409, { error: "this bot's cloud computer is being changed — wait before taking control" });
        }
        if (action === "take" && controlLeaseId) {
          const result = deps.controlAcquireLease(controlKey, controlLeaseId);
          return json(res, 200, {
            ...result.snapshot,
            owned: result.owned,
            acquired: result.acquired,
          });
        }
        if (action === "release" && controlLeaseId) {
          const result = deps.controlReleaseLease(controlKey, controlLeaseId);
          return json(res, 200, { ...result.snapshot, released: result.released });
        }
        if (action === "check" && controlLeaseId) {
          return json(res, 200, {
            ...deps.controlSnapshot(controlKey),
            owned: deps.controlOwnsLease(controlKey, controlLeaseId),
          });
        }
        if (action === "take") return json(res, 200, deps.controlTake(controlKey));
        if (action === "release") return json(res, 200, deps.controlRelease(controlKey));
        if (action === "dismiss-help") return json(res, 200, deps.controlDismissHelp(controlKey));
        return json(res, 400, { error: "action must be take, release, check, or dismiss-help" });
      }
      return json(res, 405, { error: "method not allowed" });
    }
    m = path.match(/^\/api\/bots\/([\w-]+)\/computer\/viewer-close$/);
    if (m && method === "POST") {
      const bot = deps.previewBot(m[1], url);
      if (!bot) return json(res, 404, { error: "no such bot" });
      if (!isJsonContentType(req)) {
        return json(res, 415, { error: "content-type must be application/json" });
      }
      const closedViewers = auth.kind === "session" ? deps.closeSessionViewers(auth.session.id, bot.id) : 0;
      if (bot.cloudBackend === "vps") return json(res, 200, deps.closeVpsTunnel(bot.id));
      return json(res, 200, { closed: closedViewers > 0 });
    }
    m = path.match(/^\/api\/bots\/([\w-]+)\/computer\/(provision|join|sleep|exec|screenshot|remove)$/);
    if (m && method === "POST") {
      const botId = m[1];
      const previewOnly = m[2] === "screenshot" || m[2] === "join";
      const bot = previewOnly ? deps.previewBot(botId, url) : deps.bot(botId);
      if (!bot) return json(res, 404, { error: "no such bot" });
      if (auth.kind === "session" && !auth.scopes.includes("admin") && !(previewOnly && (deps.isComputerOwner(auth) || deps.memberOwnsBot(auth, bot)))) {
        return json(res, 403, { error: "forbidden: only the bot owner or an admin can open its computer", code: "bot_computer_open_owner_only" });
      }
      const orgComputer = deps.orgComputerRefusal();
      if (orgComputer) return json(res, 409, orgComputer);
      const threadPreview = previewOnly && url.searchParams.has("threadId");
      if (threadPreview && await deps.previewSurface(bot, bot.threadId) !== "cloud") {
        return json(res, 409, { error: "This conversation is not using the cloud computer" });
      }
      if (!isJsonContentType(req)) {
        return json(res, 415, { error: "content-type must be application/json" });
      }
      if (m[2] === "join" && bot.cloudBackend === "vps") {
        await deps.waitVpsJoin(botId);
      }
      const remoteProvider: RemoteComputerProvider = bot.cloudBackend === "vps" ? "vps" : "box";
      if (deps.providerTransitioning(remoteProvider)) {
        return json(res, 409, { error: deps.providerTransitionMessage(remoteProvider) });
      }
      if (deps.boatLifecycleBusy(botId)) {
        return json(res, 409, { error: "this bot's cloud computer is being changed — wait for it to finish" });
      }
      const teamComputer = deps.inheritedTeamComputer(bot);
      if (teamComputer) {
        const key = deps.teamOwnerKey(teamComputer.id);
        if (deps.teamComputerBusy(key)) return json(res, 409, { error: "This team computer is being changed; wait for it to finish" });
        if (m[2] === "provision" || m[2] === "remove") return json(res, 409, { error: "Manage this shared computer from the Team map" });
        if (m[2] === "exec") return json(res, 409, { error: "Use the bot's scoped computer tools for this shared desktop" });
        if (m[2] === "join" && !(deps.controlSnapshot(key) as { held?: boolean }).held) {
          return json(res, 409, { error: "Take control before opening this shared desktop" });
        }
        const release = m[2] === "sleep" ? deps.claimTeamLifecycle(teamComputer) : deps.claimBotLifecycle(key);
        try {
          if (m[2] === "join") return json(res, 200, await deps.teamJoin(key));
          if (m[2] === "screenshot") {
            res.setHeader("cache-control", "private, no-store");
            return json(res, 200, await deps.teamScreenshot(key));
          }
          return json(res, 200, await deps.teamSleep(key));
        } finally { release(); }
      }
      if (bot.cloudBackend === "vps") {
        if (m[2] === "screenshot") {
          res.setHeader("cache-control", "private, no-store");
          return json(res, 200, await deps.vpsScreenshot(botId));
        }
        const releaseComputerLifecycle = deps.claimBotLifecycle(botId, m[2] === "join");
        const endJoin = m[2] === "join" ? deps.beginVpsJoin(botId) : undefined;
        try {
          if (m[2] === "exec") {
            return json(res, 409, { error: "the VPS console is available to the bot through its scoped computer tools" });
          }
          if (m[2] === "provision" && bot.computer !== "cloud" && !bot.autoStartVps) {
            return json(res, 409, { error: "Auto may start this VPS only after Start VPS automatically is enabled" });
          }
          if ((m[2] === "sleep" || m[2] === "remove") && (bot.busy || deps.activeVpsThread(botId))) {
            return json(res, 409, { error: "the VPS computer is being used by this bot — interrupt the turn first" });
          }
          if (m[2] === "join") {
            const remote = auth.kind !== "loopback";
            const result = await deps.vpsJoin(botId, remote);
            return json(res, 200, {
              ...result,
              joinUrl: remote ? deps.desktopViewerUrl(`vps/${botId}`, bot.threadId) : result.joinUrl,
            });
          }
          const action = m[2] === "provision" ? "provision" : m[2] === "remove" ? "remove" : "stop";
          return json(res, 200, await deps.vpsAction(action, botId));
        } finally {
          releaseComputerLifecycle();
          endJoin?.();
        }
      }
      const activeBoatTurn = deps.botHasActiveTurn(botId);
      if (["provision", "sleep"].includes(m[2]) && activeBoatTurn) {
        return json(res, 409, { error: deps.cloudBusyError });
      }
      let boatCommand: string | undefined;
      if (m[2] === "exec") {
        const body = await readBody(req) as { command?: unknown };
        boatCommand = String(body?.command ?? "");
        if (boatCommand.length > deps.maxRemoteCommandLength()) {
          return json(res, 400, {
            error: `command is too long (maximum ${deps.maxRemoteCommandLength()} characters)`,
          });
        }
      }
      if (bot.computer !== "cloud" && !threadPreview) {
        return json(res, 409, {
          error: "Choose Cloud computer before changing or opening this cloud computer. Auto only checks existing computer state.",
        });
      }
      if (m[2] === "remove") {
        return json(res, 409, { error: "a cloud computer has no container to remove — put it to sleep instead" });
      }
      const releaseComputerLifecycle = deps.claimBotLifecycle(botId);
      try {
        switch (m[2]) {
          case "provision":
            return json(res, 200, await deps.boatProvision(botId, bot.name));
          case "join":
            return json(res, 200, await (activeBoatTurn || threadPreview ? deps.boatJoinReady(botId) : deps.boatJoin(botId)));
          case "sleep":
            return json(res, 200, await deps.boatSleep(botId));
          case "exec":
            return json(res, 200, await deps.boatExec(botId, boatCommand ?? ""));
          case "screenshot":
            res.setHeader("cache-control", "private, no-store");
            return json(res, 200, await deps.boatScreenshot(botId));
        }
      } finally {
        releaseComputerLifecycle();
      }
    }

    return PASS;
  };
}
