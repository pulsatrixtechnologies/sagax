// "Connect Microsoft Teams" from the chat (shared/connector-setup.ts).
//
// Bot route (INTERNAL_ROUTES, behind the turn's capability):
//   POST /api/internal/connector-setup/open    open_connector_setup: post the card
// Person route (ROUTES), for the person the card is for only:
//   POST /api/connector-setup/:id/check        "J'ai terminé" or back from the browser:
//        the card says "Connecté" only on evidence
//
// No token passes through here: the sign-in happens on grok.com or
// claude.ai in the person's own browser.
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

import {
  chooseConnectorSetupRoute,
  claudeInventoryShowsConnected,
  connectorProofMatches,
  connectorSetupText,
  isConnectorSetupUrl,
  resolveConnectorSetupTarget,
  type ConnectorSetupProof,
  type ConnectorSetupView,
} from "../../shared/connector-setup.ts";
import type { RequestAuth } from "../request-auth.ts";
import type { InternalRouteHandler } from "./internal-route.ts";
import { PASS, type RouteHandler } from "./table.ts";

const CHECK = /^\/api\/connector-setup\/(cs_[a-f0-9]{18})\/check$/;

/** The person a card is for, as an opaque digest: the card is stored and
 * sent with the message, the person's id never is. */
export function connectorSetupOwner(principalId: string): string {
  return createHash("sha256").update(`connector-setup\0${principalId.trim().toLowerCase()}`).digest("hex").slice(0, 16);
}

export interface ConnectorSetupContext {
  engine: "grok" | "claude" | "other";
  /** server/harness-connectors.ts accountConnectorsForTurn */
  account: "own" | "foreign" | "none";
}

/** The tool calls that settled in each conversation, with whose turn and
 * which bot they were (review of #966): a Grok card is proven only by a
 * call of its own person on its own bot. In memory, bounded; after a
 * restart a card waits for the next call (it never claims, it waits). */
export interface ConnectorSetupProofs {
  record(input: { threadId: string; botId: string | undefined; principalId: string | undefined; name: string; input?: string; ok: boolean; at: number }): void;
  list(threadId: string): readonly ConnectorSetupProof[];
}

export function createConnectorSetupProofs(options: { perThread?: number; threads?: number } = {}): ConnectorSetupProofs {
  const perThread = options.perThread ?? 64;
  const maxThreads = options.threads ?? 500;
  const byThread = new Map<string, ConnectorSetupProof[]>();
  return {
    record({ threadId, botId, principalId, name, input, ok, at }) {
      // a failed call proves nothing; a turn with no person is nobody's proof
      if (!ok || !botId || !principalId?.trim() || !name) return;
      const list = byThread.get(threadId) ?? [];
      byThread.delete(threadId);
      list.push({ name: name.slice(0, 200), ...(input ? { input: input.slice(0, 2_000) } : {}), ok, at, owner: connectorSetupOwner(principalId), botId });
      if (list.length > perThread) list.splice(0, list.length - perThread);
      byThread.set(threadId, list);
      if (byThread.size > maxThreads) byThread.delete(byThread.keys().next().value!);
    },
    list: (threadId) => byThread.get(threadId) ?? [],
  };
}

interface Shared {
  /** The setup cards of a conversation. */
  cards(threadId: string): Array<{ messageId: string; view: ConnectorSetupView }>;
  proofs(): ConnectorSetupProofs;
  /** The bot whose conversation this is. */
  botOf(threadId: string): string | undefined;
  patch(threadId: string, messageId: string, view: ConnectorSetupView): void;
  now?(): number;
}

const openBody = z.object({
  connector: z.string().trim().min(1).max(120),
  via: z.enum(["grok", "claude"]).optional(),
  language: z.enum(["fr", "en"]).optional(),
}).strict();

const REFUSALS = {
  foreign: "This bot's engine runs on an account that is not the person's own (the bot owner's or another person's sign-in), so its connectors are not theirs to connect here. Say so in one sentence; they can use a bot on their own engine account.",
  not_on_engine: "That connector is not one of Grok's cloud connectors. Say so in one sentence.",
  no_route: "This bot's engine brings no connectors of the person's own account. Say so in one sentence; a bot on Claude or Grok (organization server) can connect it.",
} as const;

function check(view: ConnectorSetupView, proofs: readonly ConnectorSetupProof[], botId: string | undefined, claude: Array<{ name: string; status: string }> | null, now: number): ConnectorSetupView {
  const target = resolveConnectorSetupTarget(view.label);
  // Grok: a call of the card's own person on the card's bot; Claude: that person's inventory only
  const evidence = view.provider === "grok"
    ? Boolean(botId) && proofs.some((proof) => connectorProofMatches(view, proof, botId!))
    : Boolean(claude) && Boolean(target) && claudeInventoryShowsConnected(claude!, target!);
  return { ...view, status: evidence ? "connected" : "pending", checkedAt: now };
}

export function createConnectorSetupInternalRoutes(deps: Shared & {
  ownsThread(botId: string, threadId: string): boolean;
  /** The person speaking in this turn. */
  principal(botId: string, threadId: string): string | undefined;
  /** The bot's engine and whose account it runs on, for this person. */
  context(botId: string, threadId: string, principalId: string): ConnectorSetupContext | null;
  post(input: { botId: string; threadId: string; view: ConnectorSetupView; text: string }): void;
  newId?(): string;
}): InternalRouteHandler {
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? (() => `cs_${randomBytes(9).toString("hex")}`);
  return async ({ res, path, method, json, capability, readBody }) => {
    if (path !== "/api/internal/connector-setup/open") return PASS;
    if (method !== "POST") return json(res, 405, { error: "method not allowed" });
    if (!deps.ownsThread(capability.botId, capability.threadId)) {
      return json(res, 403, { error: "source conversation does not belong to sender" });
    }
    const principalId = deps.principal(capability.botId, capability.threadId)?.trim().toLowerCase();
    if (!principalId) return json(res, 403, { error: "No person speaks in this turn, so there is nobody to sign in. Answer in words." });
    const parsed = openBody.safeParse(await readBody());
    if (!parsed.success) return json(res, 400, { error: "connector names the app (\"Microsoft Teams\", \"Gmail\"); via is grok or claude; language is fr or en." });
    const target = resolveConnectorSetupTarget(parsed.data.connector);
    if (!target) return json(res, 400, { error: "Name the connector to connect." });
    const context = deps.context(capability.botId, capability.threadId, principalId);
    if (!context) return json(res, 409, { error: "This bot has no engine right now. Answer in words." });
    const route = chooseConnectorSetupRoute({ target, ...context, ...(parsed.data.via ? { prefer: parsed.data.via } : {}) });
    if ("refusal" in route) return json(res, 409, { error: REFUSALS[route.refusal] });
    if (!isConnectorSetupUrl(route.url)) return json(res, 500, { error: "no setup page for that connector" });
    const owner = connectorSetupOwner(principalId);
    const existing = deps.cards(capability.threadId).find(({ view }) => view.owner === owner && view.provider === route.route && view.connector === target.id);
    if (existing) {
      const view = existing.view.status === "connected" ? existing.view : check(existing.view, deps.proofs().list(capability.threadId), deps.botOf(capability.threadId), null, now());
      if (view !== existing.view && view.status !== existing.view.status) deps.patch(capability.threadId, existing.messageId, view);
      return json(res, 200, { ok: true, route: route.route, label: target.label, status: view.status, card: "existing" });
    }
    const view: ConnectorSetupView = {
      id: newId(),
      connector: target.id,
      label: target.label,
      provider: route.route,
      url: route.url,
      status: "waiting",
      owner,
      createdAt: now(),
    };
    deps.post({ botId: capability.botId, threadId: capability.threadId, view, text: connectorSetupText(view, parsed.data.language ?? "en") });
    return json(res, 200, { ok: true, route: route.route, label: target.label, status: view.status, card: "posted" });
  };
}

export function createConnectorSetupRoutes(deps: Shared & {
  principalId(auth: RequestAuth): string | undefined;
  /** This person's claude.ai connectors read again (the cache refreshed), or null when unknown. */
  claudeConnectors(principalId: string): Promise<Array<{ name: string; status: string }> | null>;
}): RouteHandler {
  const now = deps.now ?? Date.now;
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const match = CHECK.exec(path);
    if (!match) return PASS;
    if (method !== "POST") return json(res, 405, { error: "method not allowed" });
    const principalId = deps.principalId(auth)?.trim().toLowerCase();
    if (!principalId) return json(res, 401, { error: "Sign in to check this connection." });
    const body = await readBody(req, 4096).catch(() => null) as { threadId?: unknown } | null;
    const threadId = typeof body?.threadId === "string" ? body.threadId : "";
    const card = threadId ? deps.cards(threadId).find(({ view }) => view.id === match[1]) : undefined;
    // an unknown card and someone else's answer the same
    if (!card || card.view.owner !== connectorSetupOwner(principalId)) return json(res, 404, { error: "gone" });
    if (card.view.status === "connected") return json(res, 200, { view: card.view });
    const claude = card.view.provider === "claude" ? await deps.claudeConnectors(principalId).catch(() => null) : null;
    const view = check(card.view, deps.proofs().list(threadId), deps.botOf(threadId), claude, now());
    deps.patch(threadId, card.messageId, view);
    return json(res, 200, { view });
  };
}
