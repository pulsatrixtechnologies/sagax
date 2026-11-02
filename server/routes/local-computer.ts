/**
 * Public Local VM HTTP routes (#1388 wave 2 P6):
 *   POST /api/local-computer/interrupt
 *   GET  /api/local-computer
 *   GET  /api/local-computer/instances
 *   POST /api/local-computer/{pull,run,start,stop,remove}
 *   POST /api/local-computer/screenshot
 *   GET  /api/bots/:id/local-computer
 *   POST /api/bots/:id/local-computer/{run,start,stop,remove}
 *   POST /api/bots/:id/local-computer/screenshot
 *   POST /api/bots/:id/local-computer/join
 *
 * ensure/reset stay in local-computer-auto.ts. Registered in ROUTES after the
 * auth gate. Never imports server/index.ts.
 */
import { z } from "zod";

import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

const controlLeaseIdSchema = z.string().min(16).max(120).regex(/^[A-Za-z0-9_-]+$/);

export type LocalVmMode = "shared" | "per-bot" | "pool";

export interface LocalComputerPreviewBot {
  id: string;
  threadId: string;
}

export interface LocalComputerBot {
  id: string;
  name?: string;
}

export interface LocalComputerActionResult {
  ready?: boolean;
  runtime?: string | null;
  commands?: unknown;
  problem?: string | null;
  [key: string]: unknown;
}

export interface LocalComputerJoinStatus {
  ready?: boolean;
  managed?: boolean;
  container?: string;
  network?: string;
  viewer_url?: string;
  problem?: string | null;
}

export interface LocalComputerRouteDeps {
  interruptLocalComputerBots(): Promise<void>;
  sharedPayload(auth: RequestAuth): Promise<unknown>;
  inventoryPayload(): Promise<unknown>;
  hostRefusal(): string | undefined;
  setupBusy(): boolean;
  sharedInUse(): boolean;
  sharedActiveThread(): boolean;
  sharedLifecycleBusy(): boolean;
  mode(): LocalVmMode;
  maxInstances(): number;
  idleTimeoutMs(): number;
  runSharedAction(
    action: "pull" | "run" | "start" | "stop" | "remove",
    auth: RequestAuth,
  ): Promise<LocalComputerActionResult>;
  sharedScreenshot(): Promise<unknown>;
  touchSharedIdle(): void;
  cancelSharedIdle(): void;
  personStarted(): void;
  personStopped(): void;
  previewBot(botId: string, url: URL): LocalComputerPreviewBot | null;
  botPayload(bot: LocalComputerPreviewBot, auth: RequestAuth): Promise<unknown>;
  bot(botId: string): LocalComputerBot | null | undefined;
  boatLifecycleBusy(botId: string): boolean;
  botTargetShared(botId: string): boolean;
  botSetupBusy(botId: string): boolean;
  botProvisionBusy(): boolean;
  botInUse(botId: string): boolean;
  botActiveThread(botId: string): boolean;
  botLifecycleBusy(botId: string): boolean;
  runBotAction(
    botId: string,
    action: "run" | "start" | "stop" | "remove",
    auth: RequestAuth,
  ): Promise<LocalComputerActionResult & { overCap?: boolean; noRuntime?: boolean; cap?: number }>;
  botScreenshot(bot: LocalComputerPreviewBot, threadId: string | undefined): Promise<unknown>;
  touchBotIdle(botId: string, threadId?: string): void;
  cancelBotIdle(botId: string): void;
  previewSurface(bot: LocalComputerPreviewBot, threadId: string): Promise<"vm" | "cloud" | string>;
  controlLeaseOk(botId: string, leaseId: string): boolean;
  botJoinStatus(botId: string, threadId: string | undefined): Promise<LocalComputerJoinStatus>;
  viewerSocketPath(botId: string, threadId: string | undefined, leaseId: string): string;
}

function isJsonContentType(req: { headers: { "content-type"?: string | string[] } }): boolean {
  const raw = req.headers["content-type"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return Boolean(value && String(value).toLowerCase().startsWith("application/json"));
}

export function createLocalComputerRoutes(deps: LocalComputerRouteDeps): RouteHandler {
  return async ({ req, res, url, path, method, auth, json }) => {
    let m: RegExpMatchArray | null;

    if (method === "POST" && path === "/api/local-computer/interrupt") {
      if (!isJsonContentType(req)) {
        return json(res, 415, { error: "content-type must be application/json" });
      }
      await deps.interruptLocalComputerBots();
      return json(res, 200, { ok: true });
    }

    if (method === "GET" && path === "/api/local-computer") {
      return json(res, 200, await deps.sharedPayload(auth));
    }
    if (method === "GET" && path === "/api/local-computer/instances") {
      res.setHeader("cache-control", "private, no-store");
      return json(res, 200, await deps.inventoryPayload());
    }
    m = path.match(/^\/api\/local-computer\/(pull|run|start|stop|remove)$/);
    if (m && method === "POST") {
      if (!isJsonContentType(req)) {
        return json(res, 415, { error: "content-type must be application/json" });
      }
      const action = z.enum(["pull", "run", "start", "stop", "remove"]).parse(m[1]);
      const hostVmRefusal = action === "stop" || action === "remove" ? undefined : deps.hostRefusal();
      if (hostVmRefusal) return json(res, 403, { error: hostVmRefusal, code: "host_computer" });
      if (deps.setupBusy() || deps.sharedLifecycleBusy()) {
        return json(res, 409, { error: "another Local VM setup action is still running" });
      }
      if (deps.mode() === "per-bot" && action === "run") {
        return json(res, 409, { error: "Per-bot mode creates each desktop from that bot's Computer panel" });
      }
      if (deps.mode() === "pool" && action === "run") {
        return json(res, 409, { error: "Pool mode creates its desktops automatically from conversation turns" });
      }
      if (deps.sharedInUse() && (action === "stop" || action === "remove" || action === "run")) {
        return json(res, 409, { error: "the Local VM is being used by a bot — stop that turn first" });
      }
      if ((action === "stop" || action === "remove") && (deps.sharedActiveThread() || deps.sharedLifecycleBusy())) {
        return json(res, 409, {
          error: deps.sharedActiveThread()
            ? "the Local VM is being used by a bot — stop that turn first"
            : "another Local VM setup action is still running",
        });
      }
      const status = await deps.runSharedAction(action, auth);
      if (action === "run" || action === "start") {
        deps.touchSharedIdle();
        deps.personStarted();
      }
      if (action === "stop") deps.personStopped();
      if (action === "stop" || action === "remove") deps.cancelSharedIdle();
      return json(res, 200, {
        ...status,
        commands: status.commands,
        idle_timeout_ms: deps.idleTimeoutMs(),
        mode: deps.mode(),
        max_instances: deps.maxInstances(),
      });
    }
    if (method === "POST" && path === "/api/local-computer/screenshot") {
      deps.touchSharedIdle();
      res.setHeader("cache-control", "private, no-store");
      return json(res, 200, { image: await deps.sharedScreenshot() });
    }

    m = path.match(/^\/api\/bots\/([\w-]+)\/local-computer$/);
    if (m && method === "GET") {
      const bot = deps.previewBot(m[1], url);
      if (!bot) return json(res, 404, { error: "no such bot" });
      return json(res, 200, await deps.botPayload(bot, auth));
    }
    m = path.match(/^\/api\/bots\/([\w-]+)\/local-computer\/(run|start|stop|remove)$/);
    if (m && method === "POST") {
      if (!isJsonContentType(req)) {
        return json(res, 415, { error: "content-type must be application/json" });
      }
      const bot = deps.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      if (deps.boatLifecycleBusy(bot.id)) {
        return json(res, 409, { error: "this bot's computer is being changed or deleted — wait for it to finish" });
      }
      const action = z.enum(["run", "start", "stop", "remove"]).parse(m[2]);
      const botVmRefusal = action === "run" || action === "start" ? deps.hostRefusal() : undefined;
      if (botVmRefusal) return json(res, 403, { error: botVmRefusal, code: "host_computer" });
      if (deps.botTargetShared(bot.id)) {
        return json(res, 409, { error: "Shared mode manages this desktop in App Settings → Computers" });
      }
      if (deps.botSetupBusy(bot.id) || deps.botLifecycleBusy(bot.id)) {
        return json(res, 409, { error: "this bot's Local VM setup action is still running" });
      }
      if (action === "run" && deps.botProvisionBusy()) {
        return json(res, 409, { error: "another per-bot Local VM is being created — retry after it finishes" });
      }
      if (deps.botInUse(bot.id)) {
        return json(res, 409, { error: "this bot is using its Local VM — stop the turn first" });
      }
      if ((action === "stop" || action === "remove") && (deps.botActiveThread(bot.id) || deps.botLifecycleBusy(bot.id))) {
        return json(res, 409, {
          error: deps.botActiveThread(bot.id)
            ? "this bot is using its Local VM — stop the turn first"
            : "this bot's Local VM setup action is still running",
        });
      }
      const status = await deps.runBotAction(bot.id, action, auth);
      if (status.noRuntime) {
        return json(res, 409, { error: status.problem ?? "No container runtime is installed" });
      }
      if (status.overCap) {
        return json(res, 409, {
          error: `The per-bot Local VM limit is ${status.cap ?? deps.maxInstances()} — delete an unused bot VM or raise the limit in App Settings`,
        });
      }
      if (action === "run" || action === "start") deps.touchBotIdle(bot.id);
      if (action === "stop" || action === "remove") deps.cancelBotIdle(bot.id);
      return json(res, 200, {
        ...status,
        commands: status.commands,
        idle_timeout_ms: deps.idleTimeoutMs(),
        mode: deps.mode(),
        max_instances: deps.maxInstances(),
      });
    }
    m = path.match(/^\/api\/bots\/([\w-]+)\/local-computer\/screenshot$/);
    if (m && method === "POST") {
      const bot = deps.previewBot(m[1], url);
      if (!bot) return json(res, 404, { error: "no such bot" });
      if (url.searchParams.has("threadId") && await deps.previewSurface(bot, bot.threadId) !== "vm") {
        return json(res, 409, { error: "This conversation is not using the Local VM" });
      }
      const threadId = url.searchParams.has("threadId") ? bot.threadId : undefined;
      deps.touchBotIdle(bot.id, threadId);
      res.setHeader("cache-control", "private, no-store");
      return json(res, 200, { image: await deps.botScreenshot(bot, threadId) });
    }
    m = path.match(/^\/api\/bots\/([\w-]+)\/local-computer\/join$/);
    if (m && method === "POST") {
      if (!isJsonContentType(req)) {
        return json(res, 415, { error: "content-type must be application/json" });
      }
      const bot = deps.previewBot(m[1], url);
      if (!bot) return json(res, 404, { error: "no such bot" });
      const threadId = url.searchParams.has("threadId") ? bot.threadId : undefined;
      if (threadId && await deps.previewSurface(bot, threadId) !== "vm") {
        return json(res, 409, { error: "This conversation is not using the Local VM" });
      }
      if (deps.mode() !== "per-bot") {
        return json(res, 409, { error: "Phone control requires a per-bot Local VM. Select per-bot mode in Settings → Computers." });
      }
      const lease = controlLeaseIdSchema.safeParse(url.searchParams.get("controlLeaseId") ?? undefined);
      if (!lease.success) return json(res, 400, { error: "controlLeaseId is required" });
      if (!deps.controlLeaseOk(bot.id, lease.data)) {
        return json(res, 409, { error: "Take control of this computer first" });
      }
      const status = await deps.botJoinStatus(bot.id, threadId);
      if (!status.ready || !status.managed || status.container !== "running" || status.network !== "loopback"
        || !status.viewer_url) {
        return json(res, 409, { error: status.problem ?? "The Local VM is not ready" });
      }
      deps.touchBotIdle(bot.id, threadId);
      res.setHeader("cache-control", "private, no-store");
      if (auth.kind === "loopback") return json(res, 200, { joinUrl: status.viewer_url });
      return json(res, 200, {
        socketPath: deps.viewerSocketPath(bot.id, threadId, lease.data),
        password: new URLSearchParams(new URL(status.viewer_url).hash.slice(1)).get("password"),
      });
    }

    return PASS;
  };
}
