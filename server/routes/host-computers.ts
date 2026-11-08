// Bot computers (#2726, #2727): the host row's "Use as a bot computer"
// toggle and tags, the Computer menu choices, a bot's host choice, and the
// host_computer tool. Person isolation: only that person's enrolled hosts,
// on bots they own (no admin gate).
import { z } from "zod";

import { PASS, type RouteHandler } from "./table.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import type { InternalRouteHandler } from "./internal-route.ts";
import { HOST_COMPUTER_ACTIONS, type HostComputerRouter } from "../remote-support/host-computer-router.ts";
import type { HostComputerStore } from "../remote-support/host-computer-store.ts";
import { MAX_HOST_TAGS } from "../../shared/bot-computer-host.ts";

const LIST = "/api/host-computers";
const ONE = /^\/api\/host-computers\/(h_[0-9a-f]{32})$/;
const BOT = /^\/api\/bots\/([\w-]{1,80})\/host-computer$/;

const patchBody = z.object({
  botComputer: z.boolean().optional(),
  tags: z.array(z.string().max(64)).max(MAX_HOST_TAGS * 2).optional(),
  os: z.enum(["windows", "macos", "linux"]).nullable().optional(),
  shellOnly: z.boolean().optional(),
  /** Change a bot's isolated / as-is answer from the host settings. */
  mode: z.object({ botId: z.string().min(1).max(80), value: z.enum(["isolated", "as_is"]).nullable() }).strict().optional(),
}).strict();
const selectBody = z.object({ hostId: z.string().regex(/^h_[0-9a-f]{32}$/).nullable() }).strict();
const toolBody = z.object({
  action: z.enum(HOST_COMPUTER_ACTIONS),
  command: z.string().max(8000).optional(),
  timeout_seconds: z.number().int().min(1).max(120).optional(),
  mode: z.enum(["isolated", "as_is"]).optional(),
}).strict();

export function createHostComputersRoutes(deps: {
  router: HostComputerRouter;
  store: HostComputerStore;
  principalId(auth: RequestAuth): string | undefined;
  /** The person owns that bot (their own environment: no admin gate). */
  ownsBot(principalId: string, botId: string): boolean;
}): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const one = ONE.exec(path);
    const bot = BOT.exec(path);
    if (path !== LIST && !one && !bot) return PASS;
    const principalId = deps.principalId(auth)?.trim().toLowerCase();
    if (!principalId) return json(res, 401, { error: "Sign in to manage your bot computers." });

    if (path === LIST) {
      if (method !== "GET") return json(res, 405, { error: "method not allowed" });
      const out = await deps.router.views(principalId);
      return json(res, 200, { hosts: out.hosts, ...(out.error ? { reason: out.error } : {}) });
    }

    if (one) {
      if (method !== "PATCH") return json(res, 405, { error: "method not allowed" });
      const parsed = patchBody.safeParse(await readBody(req));
      if (!parsed.success) return json(res, 400, { error: "Send botComputer, tags, os, shellOnly or mode." });
      const hostId = one[1]!;
      const mine = (await deps.router.views(principalId)).hosts.find((host) => host.hostId === hostId);
      if (!mine) return json(res, 404, { error: "That computer is not one of your enrolled hosts." });
      const { mode, ...patch } = parsed.data;
      deps.store.update(principalId, hostId, patch);
      if (mode) {
        if (!deps.ownsBot(principalId, mode.botId)) return json(res, 403, { error: "That bot is not yours." });
        deps.store.setMode(principalId, hostId, mode.botId, mode.value);
      }
      const updated = (await deps.router.views(principalId)).hosts.find((host) => host.hostId === hostId);
      return json(res, 200, { host: updated ?? null });
    }

    const botId = bot![1]!;
    if (!deps.ownsBot(principalId, botId)) return json(res, 403, { error: "That bot is not yours." });
    if (method === "GET") {
      const hosts = await deps.router.choices(principalId);
      return json(res, 200, { hostId: deps.store.botHost(principalId, botId), hosts });
    }
    if (method === "PUT") {
      const parsed = selectBody.safeParse(await readBody(req));
      if (!parsed.success) return json(res, 400, { error: "Send hostId (h_ and 32 hex) or null." });
      const out = await deps.router.select(principalId, botId, parsed.data.hostId);
      if (!out.ok) return json(res, 404, { error: out.error });
      return json(res, 200, { hostId: parsed.data.hostId, asked: out.asked });
    }
    if (method === "DELETE") {
      await deps.router.select(principalId, botId, null);
      return json(res, 200, { hostId: null });
    }
    return json(res, 405, { error: "method not allowed" });
  };
}

/** The host_computer tool (server/drivers/agents-tools/computers.ts). */
export function createHostComputerInternalRoutes(deps: {
  router: HostComputerRouter;
  ownsThread(botId: string, threadId: string): boolean;
  /** The person speaking in this turn: the bot computer is theirs. */
  speaker(threadId: string): string | undefined;
}): InternalRouteHandler {
  return async ({ res, path, method, json, capability, readBody }) => {
    if (path !== "/api/internal/host-computer") return PASS;
    if (method !== "POST") return json(res, 405, { error: "method not allowed" });
    if (!deps.ownsThread(capability.botId, capability.threadId)) return json(res, 403, { error: "source conversation does not belong to sender" });
    const principalId = deps.speaker(capability.threadId)?.trim().toLowerCase();
    if (!principalId) return json(res, 403, { error: "No person speaks in this turn, so no host is theirs." });
    const parsed = toolBody.safeParse(await readBody());
    if (!parsed.success) return json(res, 400, { error: "Send action (exec, screenshot, vm_status, vm_provision, vm_delete, vm_rebuild, set_mode, ask_mode), and command for exec." });
    const out = await deps.router.call({
      principalId,
      botId: capability.botId,
      threadId: capability.threadId,
      action: parsed.data.action,
      ...(parsed.data.command ? { command: parsed.data.command } : {}),
      ...(parsed.data.timeout_seconds ? { timeoutMs: parsed.data.timeout_seconds * 1000 } : {}),
      ...(parsed.data.mode ? { mode: parsed.data.mode } : {}),
    });
    if ("image" in out) return json(res, 200, { text: out.text, image: out.image.toString("base64"), mimeType: "image/png" });
    return json(res, 200, { text: out.text, ...(out.isError ? { isError: true } : {}) });
  };
}
