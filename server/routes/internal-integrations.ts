// Internal harness routes for integrations (#1388 slice I6):
// mcp-servers, github-connect, request-credential, voice-note, perspicax/mcp.
//
// Answers only behind the per-turn capability the internal block of
// server/index.ts checks first. Capability gate and refusal checks stay there.
import { randomUUID } from "node:crypto";
import {
  CREDENTIAL_TARGETS,
  CUSTOM_SECRET_TARGET,
  PRODUCT_KEY_KIND,
  PRODUCT_KEY_TARGET,
  isCredentialTargetId,
  isPendingCredentialRequest,
  isPendingCustomSecretRequest,
  type CredentialTargetId,
} from "../../shared/credential-request.ts";
import { deliveryNote, parseCustomSecretRequest } from "../host/custom-secrets.ts";
import { productCardReason, type PersonProduct } from "../../shared/person-products.ts";
import { CONFIDENTIAL_PEER_REFUSED } from "../threads/confidential-threads.ts";
import {
  botAddedMcpServerEnabled,
  isRemoteMcpServer as isRemoteMcpServerLeaf,
  type DisabledMcpServerAdd,
  type StoredMcpServer,
} from "../mcp/mcp-registry.ts";
import {
  personalMcpInputFromAgent,
  PersonConnectionsError,
  type PersonalMcpInput,
} from "../people/person-connections.ts";
import type { McpProbeResult } from "../mcp/mcp-probe.ts";
import type { InternalCapabilityView, InternalRouteHandler } from "./internal-route.ts";
import { PASS } from "./table.ts";

const MAX_TOOL_NAMES = 100;
const RESTART_WHEN = "This turn keeps talking to the old process; your next turn starts the new code.";

/** What a test shows, in plain words: that the server started and listed its tools, never that the tools work. */
export function mcpTestText(result: McpProbeResult): string {
  if (!result.ok) return `Test: it did not start: ${result.error}`;
  const names = result.tools.slice(0, MAX_TOOL_NAMES).map((tool) => tool.name);
  const total = result.total ?? result.tools.length;
  const more = total > names.length ? ` and ${total - names.length} more` : "";
  return names.length
    ? `Test: it started and listed its tools: ${names.join(", ")}${more}. That does not show what they return: call one to check.`
    : "Test: it started, but it has no tools.";
}

/** The add_mcp_server body without its action, and which action it asks for. */
function mcpAction(body: unknown): { action: "add" | "restart" | string; body: unknown; name: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { action: "add", body, name: "" };
  const { action, ...rest } = body as Record<string, unknown>;
  const name = typeof rest.name === "string" ? rest.name.trim() : "";
  return { action: action === undefined ? "add" : String(action), body: rest, name };
}

const RESTART_UNKNOWN_ACTION = "Unknown action: send add (the default) or restart.";

export type OwnerProductRead =
  | { ok: true; product: PersonProduct; for: string }
  | { ok: false; error: "unavailable" | "not_found" | "sign_in" | "unreachable" };

/** What the bot is told when no product key card could be raised (#4185). */
function ownerProductRefusal(error: Exclude<OwnerProductRead, { ok: true }>["error"], productId: string): { status: number; error: string } {
  switch (error) {
    case "unavailable": return { status: 404, error: "Product keys are not available on this deployment yet: no card can be shown. Tell the person in one line which product needs their key; they set it in Perspicax." };
    case "not_found": return { status: 404, error: `No product ${productId} for this person: call api_list for the product ids they hold.` };
    case "sign_in": return { status: 409, error: "The person's Pulsatrix sign-in has expired: ask them to sign in again, then retry." };
    default: return { status: 502, error: "Perspicax could not be reached: try again later." };
  }
}

/** The text of a product key card: what a released app that does not know
 * the card shows instead of it (shared/credential-request.ts PRODUCT_KEY_KIND). */
function productKeyHandoff(botName: string, productName: string): string {
  return `${botName} needs your key for ${productName}. Enter it securely on this card in Sagax on your computer; never paste it in the chat.`;
}

export type ProductKeyCardRaised =
  | { kind: "shown"; messageId: string; label: string }
  | { kind: "connected"; label: string }
  | { kind: "refused"; status: number; error: string };

/** #4185: the product key card of one of the bot owner's Perspicax products,
 * raised in that conversation; an older card of the same product there is
 * superseded. One function for the bot's request_product_key and for the
 * relay that saw a product tool answer a key state. The caller decides that
 * the turn is a person's own. */
export async function raiseProductKeyCard(
  deps: Pick<InternalIntegrationsDeps, "ownerProduct" | "appendMessage" | "activePath" | "patchMessage">,
  input: { bot: { id: string; name: string; color?: unknown }; threadId: string; group: boolean; productId: string },
): Promise<ProductKeyCardRaised> {
  const { bot: from, threadId, productId } = input;
  const read: OwnerProductRead = deps.ownerProduct ? await deps.ownerProduct(from.id, productId) : { ok: false, error: "unavailable" };
  if (!read.ok) return { kind: "refused", ...ownerProductRefusal(read.error, productId) };
  const product = read.product;
  const reason = productCardReason(product.state) ?? (product.actions.includes("set_own_key") || product.actions.includes("replace_key") ? "setup" : null);
  if (!reason) return { kind: "connected", label: product.name };
  const message = deps.appendMessage(threadId, {
    role: "bot",
    kind: PRODUCT_KEY_KIND,
    text: productKeyHandoff(from.name, product.name),
    ...(input.group ? { from: { botId: from.id, name: from.name, color: from.color } } : {}),
    secret: {
      target: PRODUCT_KEY_TARGET,
      label: product.name,
      description: `${from.name} needs your key for ${product.name}. It goes to Perspicax only; ${from.name} never sees it.`,
      placeholder: "",
      helpUrl: "",
      requestKey: randomUUID(),
      product: { id: product.id, name: product.name, ...(product.icon ? { icon: product.icon } : {}), reason, for: read.for },
    },
  });
  for (const prior of deps.activePath(threadId)) {
    if (prior.id === message.id) continue;
    const secret = prior.secret as { target?: unknown; product?: { id?: unknown }; provided?: unknown; dismissed?: unknown; superseded?: unknown } | undefined;
    if (prior.kind !== PRODUCT_KEY_KIND || secret?.target !== PRODUCT_KEY_TARGET || secret.product?.id !== product.id) continue;
    if (secret.provided === true || secret.dismissed === true || secret.superseded === true) continue;
    deps.patchMessage(threadId, prior.id, { secret: { ...secret, superseded: true } });
  }
  return { kind: "shown", messageId: message.id, label: product.name };
}

function credentialDesktopHandoff(label: string): string {
  return `Securely provide the ${label} from Sagax on your phone or computer. It is never added to chat.`;
}

export interface InternalIntegrationsBot {
  id: string;
  name: string;
  color: string;
  threadId?: string;
  voiceNotes?: boolean;
  voice?: string;
  ownerUserId?: unknown;
}

export type GithubProbeStatus = {
  state: string;
  login?: string;
  error?: string;
  userCode?: string;
  verificationUri?: string;
  expiresAt?: number;
  orgAccessUrl?: string;
};

export interface InternalIntegrationsDeps {
  bot(id: string): InternalIntegrationsBot | null | undefined;
  isPerspicax(): boolean;
  ownsThread(botId: string, threadId: string): { group: boolean } | null;
  vaultPrincipalForThread(threadId: string): string | null;
  principalIsOrgAdmin(principalId: string): boolean;
  principalCan(principalId: string, key: string): boolean;
  permissionRefusal(key: string): { error: string; permission: string; message: string };
  addPersonalMcpServer(principalId: string, input: PersonalMcpInput): Promise<void>;
  sourceApprovalMode(botId: string, threadId: string): string;
  setPersonalMcpEnabled(principalId: string, name: string, enabled: boolean): void;
  closePersonalStdio(principalId: string, name: string): void;
  /** Acquire the shared MCP config lock. false means another writer holds it. */
  tryBeginMcpConfigUpdate(): boolean;
  endMcpConfigUpdate(): void;
  mcpServers(): Record<string, unknown>;
  addDisabledMcpServer(current: Record<string, unknown>, body: unknown): DisabledMcpServerAdd;
  /** Bot add with folder claim / keep-in-tools (OMB #3751). Falls back to addDisabledMcpServer. */
  botAddMcpServer?(current: Record<string, unknown>, body: unknown, botId: string): DisabledMcpServerAdd & { moved?: Array<{ from: string; to: string }> };
  sharedMcpPersonalRefusal(name: string, server: StoredMcpServer): string | null;
  mcpPolicyRefusal(name: string, server: object): string | undefined;
  persistMcpServers(next: Record<string, unknown>): void;
  healthChanged?(name: string): void;
  /** Reloads an enabled command server for the next turn of every bot that uses it and tests it as this bot; null when
   * no enabled command server has that name here. */
  restartMcpServer?(name: string, botId: string): Promise<McpProbeResult | null>;
  /** A person's own server (Settings > Connections) on an organization server, as stored. */
  personalMcpServer?(principalId: string, name: string): { url?: unknown; command?: unknown; enabled?: unknown } | undefined;
  turnSpeaker(threadId: string): { origin: string; principalId?: string } | undefined;
  turnIsRoutine(threadId: string): boolean;
  turnIsInternal(threadId: string): boolean;
  turnIsAutomation(threadId: string): boolean;
  turnIsUnattended(botId: string, threadId: string): boolean;
  localPrincipalId(): string;
  personGithub(principalId: string): { token?: string; login?: string } | undefined;
  githubProbeStatus(principalId: string, current: { token?: string; login?: string } | undefined): Promise<GithubProbeStatus>;
  githubDeviceFlowAvailable(): boolean;
  githubStartDeviceFlow(principalId: string): Promise<{ userCode: string; verificationUri: string; expiresAt: number }>;
  githubTokenKind(token: string | undefined): string;
  /** #2109: post (or reuse) the GitHub sign-in card in this chat; its id. */
  githubPostCard?(principalId: string, threadId: string, start: { userCode: string; verificationUri: string; expiresAt: number }, from?: Record<string, unknown>): string | undefined;
  credentialConfigured(credentialId: CredentialTargetId): boolean;
  /** Swap secretRef values in an add_mcp_server body before it is saved. */
  redeemMcpBody?<T>(body: T, botId: string, threadId: string): { ok: true; value: T; commit(): void } | { ok: false; error: string };
  appendMessage(threadId: string, message: Record<string, unknown>): { id: string };
  activePath(threadId: string): ReadonlyArray<{
    id: string;
    kind?: unknown;
    secret?: { target?: unknown; provided?: unknown; dismissed?: unknown; superseded?: unknown };
    from?: { botId?: unknown };
  }>;
  patchMessage(threadId: string, messageId: string, patch: Record<string, unknown>): void;
  /** #4185: one of the Perspicax products of the bot's owner, read as that
   * person (`for`: their principal id). unavailable: the server is not
   * linked, or its Perspicax has no product routes yet; not_found: not one of
   * their products; sign_in: their sign-in expired; unreachable: no answer. */
  ownerProduct?(botId: string, productId: string): Promise<OwnerProductRead>;
  botForThread(botId: string, threadId: string): InternalIntegrationsBot | null | undefined;
  orgXaiMediaGiven(media: "voice", principalId: string | null, ownerPrincipalId: string): boolean;
  turnMediaPrincipal(threadId: string): string | null;
  botOwner(bot: InternalIntegrationsBot): string;
  speakVoiceNote(input: {
    text: string;
    voice: string | undefined;
    principalId: string | null;
    organizationXaiGiven: boolean;
  }): Promise<
    | { bytes: Uint8Array | Buffer; mime: string }
    | { error: { status: number; message: string; cause?: string } }
  >;
  /** Throws Error & { status: 401 } when the turn is no longer live. */
  requireActive(capability: InternalCapabilityView): void;
  liveTurnId(threadId: string): string | undefined;
  saveAudio(bytes: Buffer, mime: string): { path: string; mime: string };
  pushTurnAttachment(threadId: string, turnId: string, attachment: { kind: "audio"; path: string; mime: string; text: string }): void;
  isConfidentialThread(threadId: string): boolean;
  confidentialPerspicaxRefusal(
    capability: InternalCapabilityView,
    tool: string,
    args: Record<string, unknown> | undefined,
  ): string | null;
  misuseToolFrameText(frame: unknown): string | null;
  misuseTextRefusal(
    text: string,
    speakerId: string | undefined,
    surface: "flow" | "mcp",
    meta: { botId: string; threadId: string; tool: string },
  ): string | null;
  safetyPrincipal(threadId: string): { triage: boolean; principalId?: string };
  misuseActor(speakerId: string | undefined): { triage: boolean };
  safetyReviewer(botId: string): ((prompt: string, signal?: AbortSignal) => Promise<string>) | undefined;
  safetyToolHold(input: {
    text: string;
    surface: "flow" | "mcp";
    tool: string;
    known: boolean;
    triage: boolean;
    principalId?: string;
    threadId: string;
    botId: string;
    review?: (prompt: string, signal?: AbortSignal) => Promise<string>;
  }): Promise<string | null>;
  perspicaxMounted(capability: InternalCapabilityView): boolean;
  perspicaxRelay(input: {
    threadId: string;
    generation: string;
    botId: string;
    frame: unknown;
  }): Promise<{ status: number; body?: unknown; toolsChanged?: true }>;
}

export function createInternalIntegrationsRoutes(deps: InternalIntegrationsDeps): InternalRouteHandler {
  return async (ctx) => {
    const { res, path, method, json, capability, readBody } = ctx;
    const sender = deps.bot(capability.botId);
    if (!sender) return PASS;

    if (method === "POST" && path === "/api/internal/mcp-servers" && deps.isPerspicax()) {
      // 2026-10-28 (a member does everything in their own
      // environment): on an organization server add_mcp_server adds to the
      // speaking person's own servers (Settings > Connections): a remote URL
      // of theirs, or a command run in their own environment. The server's
      // shared list stays an admin's. A person without the permission
      // `apps.ownIntegrations` is refused as their Connections screen is.
      const threadId = capability.threadId;
      if (!deps.ownsThread(sender.id, threadId)) return json(res, 403, { error: "source conversation does not belong to sender" });
      const principalId = deps.vaultPrincipalForThread(threadId);
      if (!principalId) return json(res, 403, { error: "No person is behind this turn, so there is no server list to add to." });
      if (!deps.principalIsOrgAdmin(principalId) && !deps.principalCan(principalId, "apps.ownIntegrations")) {
        return json(res, 403, deps.permissionRefusal("apps.ownIntegrations"));
      }
      const asked = mcpAction(await readBody());
      if (asked.action === "restart") {
        // The person's own command runs through their relay: closing it makes the next call start the new code.
        const server = deps.personalMcpServer?.(principalId, asked.name);
        if (!asked.name || !server) return json(res, 404, { error: `There is no MCP server named ${asked.name || "(no name)"} in your own servers.` });
        if (typeof server.url === "string") return json(res, 400, { error: `${asked.name} is reached by its address, so it has no process to restart.` });
        if (server.enabled === false) return json(res, 403, { error: `${asked.name} is off. The person turns it on in Settings > Connections.` });
        deps.closePersonalStdio(principalId, asked.name);
        return json(res, 200, { name: asked.name, restarted: true, personal: true, text: `Restarted MCP server ${asked.name}. Its saved keys stay. ${RESTART_WHEN}` });
      }
      if (asked.action !== "add") return json(res, 400, { error: RESTART_UNKNOWN_ACTION });
      const input = personalMcpInputFromAgent(asked.body);
      if (typeof input === "string") return json(res, 400, { error: input });
      try {
        await deps.addPersonalMcpServer(principalId, input);
      } catch (error) {
        if (error instanceof PersonConnectionsError) return json(res, error.status, { error: error.message, code: error.code });
        throw error;
      }
      // Auto or Full access: on; Ask and Edits: off until the person turns it on.
      const enabled = botAddedMcpServerEnabled({
        approvalMode: deps.sourceApprovalMode(sender.id, threadId),
        organization: false,
        remote: true,
      });
      if (!enabled) {
        deps.setPersonalMcpEnabled(principalId, input.name, false);
        deps.closePersonalStdio(principalId, input.name);
      }
      const remote = "url" in input;
      return json(res, 201, {
        name: input.name, enabled, personal: true,
        transport: remote ? input.type ?? "http" : "command",
        target: remote ? input.url : input.command,
        envKeys: remote ? [] : Object.keys(input.env ?? {}).sort(),
        headerKeys: remote && input.headerName ? [input.headerName] : [],
        where: remote ? "your own servers (Settings > Connections)" : "your own servers (Settings > Connections), run in your own environment",
      });
    }

    if (method === "POST" && path === "/api/internal/mcp-servers") {
      const asked = mcpAction(await readBody());
      if (asked.action === "restart") {
        // Restart runs what is already on, as the next turn would anyway: no secretRef is spent and the saved keys,
        // sign-in included, stay as they are.
        const stored = asked.name ? deps.mcpServers()[asked.name] : undefined;
        if (!stored || typeof stored !== "object") return json(res, 404, { error: `There is no MCP server named ${asked.name || "(no name)"}.` });
        if (typeof (stored as { url?: unknown }).url === "string") {
          return json(res, 400, { error: `${asked.name} is reached by its address, so it has no process to restart.` });
        }
        if ((stored as { enabled?: unknown }).enabled !== true) {
          return json(res, 403, { error: `${asked.name} is off. The person turns it on in MCP server settings.` });
        }
        const tested = await deps.restartMcpServer?.(asked.name, sender.id);
        if (!tested) return json(res, 404, { error: `${asked.name} does not run here, so there is no process to restart.` });
        return json(res, 200, {
          name: asked.name,
          restarted: true,
          text: `Restarted MCP server ${asked.name}. Its saved keys stay. ${mcpTestText(tested)} ${RESTART_WHEN}`,
        });
      }
      // Same single-flight lock as POST /api/mcp/servers: two writers must
      // not interleave a read of cfg.mcpServers with a save.
      if (!deps.tryBeginMcpConfigUpdate()) return json(res, 409, { error: "MCP servers are already being updated." });
      try {
        if (asked.action !== "add") return json(res, 400, { error: RESTART_UNKNOWN_ACTION });
        let body = asked.body;
        let commitRedeem: (() => void) | undefined;
        if (deps.redeemMcpBody) {
          const redeemed = deps.redeemMcpBody(body, sender.id, capability.threadId);
          if (!redeemed.ok) return json(res, 400, { error: redeemed.error });
          body = redeemed.value;
          commitRedeem = redeemed.commit;
        }
        const added = deps.botAddMcpServer
          ? deps.botAddMcpServer(deps.mcpServers(), body, sender.id)
          : deps.addDisabledMcpServer(deps.mcpServers(), body);
        if (!added.ok) return json(res, added.status, { error: added.error });
        const personalRefusal = deps.sharedMcpPersonalRefusal(added.name, added.server);
        if (personalRefusal) return json(res, 400, { error: personalRefusal });
        const refusal = deps.mcpPolicyRefusal(added.name, added.server);
        if (refusal) return json(res, 403, { error: refusal, code: "managed_policy" });
        const server = added.server;
        const remote = isRemoteMcpServerLeaf(server);
        // 2026-10-27 (#1098): a bot on Auto or Full access adds the server
        // switched on; Ask and Edits keep it off until the person turns it
        // on. On an organization server a command (stdio) would run on the
        // shared host, so it stays off there whatever the level; a remote
        // URL is switched on. The list itself stays where it was.
        const enabled = botAddedMcpServerEnabled({
          approvalMode: deps.sourceApprovalMode(sender.id, capability.threadId),
          organization: deps.isPerspicax(),
          remote,
        });
        const stored = enabled ? { ...server, enabled: true } : server;
        deps.persistMcpServers({ ...added.next, [added.name]: stored });
        commitRedeem?.();
        deps.healthChanged?.(added.name);
        if (remote) {
          return json(res, 201, {
            name: added.name,
            enabled,
            transport: server.type,
            target: server.url,
            envKeys: [],
            headerKeys: Object.keys(server.headers).sort(),
          });
        }
        return json(res, 201, {
          name: added.name,
          enabled,
          ...(!remote && "bot" in server && server.bot ? { own: true } : {}),
          ...("moved" in added && Array.isArray(added.moved) && added.moved.length
            ? { keptIn: added.moved.map((entry: { to: string }) => entry.to) }
            : {}),
          transport: "command",
          target: server.command,
          envKeys: Object.keys(server.env).sort(),
          headerKeys: [],
        });
      } finally {
        deps.endMcpConfigUpdate();
      }
    }

    if (method === "POST" && path === "/api/internal/github-connect") {
      // The turn's own person connects their GitHub (device flow), like gh
      // auth login: the code and link go back to the bot to show; the device
      // code and the token stay on the server (server/github/github-connect.ts).
      const body = await readBody();
      const owner = deps.ownsThread(sender.id, capability.threadId);
      if (!owner) return json(res, 403, { error: "source conversation does not belong to sender" });
      // #2109: from any chat, a group included; the card
      // binds the code to the person who asked, never to the group.
      // Only a person's own turn: never a routine, an automation or another
      // bot's hop (whose speaker falls back to the bot's owner), so a code
      // is never bound to someone who did not ask for it.
      const turnSpeaker = deps.turnSpeaker(capability.threadId);
      const ghThread = capability.threadId;
      // #2806: the operator at this computer (the desktop app, no session)
      // is the person too; their principal is the local one below.
      const byPerson = turnSpeaker?.origin === "person" || turnSpeaker?.origin === "operator";
      if (!turnSpeaker || !byPerson || deps.turnIsRoutine(ghThread) || deps.turnIsInternal(ghThread)
        || deps.turnIsAutomation(ghThread) || deps.turnIsUnattended(sender.id, ghThread)) {
        return json(res, 200, { state: "not_person" });
      }
      const speaker = ("principalId" in turnSpeaker ? turnSpeaker.principalId : undefined) || (!deps.isPerspicax() ? deps.localPrincipalId() : "");
      if (!speaker) return json(res, 403, { error: "GitHub is connected by a signed-in person." });
      const principalId = speaker.trim().toLowerCase();
      // No admin door (#2109): a person connects their own
      // GitHub account for their own environment.
      const current = deps.personGithub(principalId);
      const status = await deps.githubProbeStatus(principalId, current);
      const orgAccessUrl = status.state === "connected" ? status.orgAccessUrl : undefined;
      const reconnect = body?.reconnect === true;
      // A stored token that GitHub still accepts: no new device flow unless reconnect
      // or a fine-grained token that cannot cover organizations.
      if (status.state === "connected" && !reconnect && deps.githubTokenKind(current?.token) !== "fine_grained") {
        return json(res, 200, { state: "connected", login: status.login, ...(orgAccessUrl ? { orgAccessUrl } : {}) });
      }
      if (status.state === "error" && status.login && !reconnect && !deps.githubDeviceFlowAvailable()) {
        return json(res, 200, { state: "error", message: status.error, login: status.login });
      }
      if (!deps.githubDeviceFlowAvailable()) {
        return json(res, 200, { state: "no_device_flow", ...(current ? { login: current.login } : {}) });
      }
      // A sign-in already waiting: the same code again, never a second one
      // (reconnect included, unless it is about to expire).
      // The code and link go into this chat as a card (Copy code, Open link)
      // that turns into "GitHub connected as @login" once approved.
      const pending = (start: { userCode: string; verificationUri: string; expiresAt: number }) => {
        const from = owner.group ? { botId: sender.id, name: sender.name, color: sender.color } : undefined;
        const cardId = deps.githubPostCard?.(principalId, capability.threadId, start, from);
        return json(res, 200, { state: "pending", userCode: start.userCode, verificationUri: start.verificationUri, expiresAt: start.expiresAt, ...(cardId ? { card: true } : {}) });
      };
      if (status.state === "pending" && status.userCode && status.verificationUri && (status.expiresAt ?? 0) - Date.now() > 60_000) {
        return pending({ userCode: status.userCode, verificationUri: status.verificationUri, expiresAt: status.expiresAt ?? 0 });
      }
      try {
        return pending(await deps.githubStartDeviceFlow(principalId));
      } catch (error) {
        return json(res, 200, {
          state: "error",
          message: error instanceof Error ? error.message : "GitHub sign-in is unavailable right now.",
        });
      }
    }

    if (method === "POST" && path === "/api/internal/request-credential") {
      const body = await readBody();
      const from = sender;
      const fromThreadId = capability.threadId;
      const owner = deps.ownsThread(from.id, fromThreadId);
      if (!owner) return json(res, 403, { error: "source conversation does not belong to sender" });
      // #4185: the person's own key for one of their Perspicax products. The
      // card names the product only; it reads the form from Perspicax.
      if (typeof body.productId === "string" && body.productId.trim()) {
        const productId = body.productId.trim().slice(0, 256);
        // a routine, or a bot asked by another bot, never raises a card for the person
        if ((capability.depth ?? 0) > 0 || deps.turnIsRoutine(fromThreadId)) return json(res, 409, { error: "A product key card is shown only in a person's own turn. Tell the person which product needs a key." });
        const raised = await raiseProductKeyCard(deps, { bot: from, threadId: fromThreadId, group: owner.group, productId });
        if (raised.kind === "refused") return json(res, raised.status, { error: raised.error });
        if (raised.kind === "connected") return json(res, 200, { alreadyConfigured: true, label: raised.label });
        return json(res, 201, { messageId: raised.messageId, label: raised.label });
      }
      // Custom secret: label + reason + delivery, kept off Settings.
      if (!isCredentialTargetId(body.credentialId)) {
        const custom = parseCustomSecretRequest(body);
        if ("error" in custom) return json(res, 400, { error: custom.error });
        const message = deps.appendMessage(fromThreadId, {
          role: "bot",
          kind: "secret",
          text: credentialDesktopHandoff(custom.label),
          ...(owner.group ? { from: { botId: from.id, name: from.name, color: from.color } } : {}),
          secret: {
            target: CUSTOM_SECRET_TARGET,
            label: custom.label,
            description: `${custom.reason} ${deliveryNote(from.name, custom.delivery)}`,
            placeholder: custom.placeholder || "Paste the secret",
            helpUrl: "",
            reason: custom.reason,
            delivery: custom.delivery,
            requestKey: randomUUID(),
          },
        });
        for (const prior of deps.activePath(fromThreadId)) {
          if (prior.id === message.id) continue;
          if (!prior.secret || !isPendingCustomSecretRequest(prior, custom.label, from.id, Boolean(owner.group))) continue;
          deps.patchMessage(fromThreadId, prior.id, { secret: { ...prior.secret, superseded: true } });
        }
        return json(res, 201, { messageId: message.id, label: custom.label, delivery: custom.delivery });
      }
      const credentialId: CredentialTargetId = body.credentialId;
      const target = CREDENTIAL_TARGETS[credentialId];
      if (deps.credentialConfigured(credentialId)) {
        return json(res, 200, { alreadyConfigured: true, label: target.label });
      }
      // A later request supersedes every still-pending card for this
      // credential instead of silently reusing it: the reason or task has
      // moved on, so the old card stops offering entry and the person gets
      // one fresh card they can act on. The fresh card is appended FIRST:
      // if persistence then fails, the prior cards stay actionable rather
      // than every pending request ending terminal with no card to act on.
      const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 240) : "";
      const message = deps.appendMessage(fromThreadId, {
        role: "bot",
        kind: "secret",
        text: credentialDesktopHandoff(target.label),
        ...(owner.group ? { from: { botId: from.id, name: from.name, color: from.color } } : {}),
        secret: {
          target: credentialId,
          label: target.label,
          description: `${reason ? `${target.description} ${reason}` : target.description} ${from.name} can use it but never read it back.`,
          placeholder: target.placeholder,
          helpUrl: target.helpUrl,
          requestKey: randomUUID(),
        },
      });
      for (const prior of deps.activePath(fromThreadId)) {
        if (prior.id === message.id) continue;
        if (!prior.secret || !isPendingCredentialRequest(prior, credentialId, from.id, Boolean(owner.group))) continue;
        deps.patchMessage(fromThreadId, prior.id, { secret: { ...prior.secret, superseded: true } });
      }
      return json(res, 201, { messageId: message.id, label: target.label });
    }

    if (method === "POST" && path === "/api/internal/voice-note") {
      const body = await readBody();
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (!text) return json(res, 400, { error: "text required" });
      if (text.length > 1000) return json(res, 413, { error: "voice notes are limited to 1000 characters" });
      // Advertisement is presentation only; the capability is re-checked
      // here so a call that reaches an unconfigured workspace answers with
      // the setup guidance instead of a provider failure.
      const voiceBot = deps.botForThread(sender.id, capability.threadId) ?? sender;
      if (voiceBot.voiceNotes === false) {
        return json(res, 403, { error: "voice notes are turned off for this bot" });
      }
      // 2026-10-16: the organization's xAI voice speaks only for the person
      // this turn is for (a routine: its owner; nobody known: the owner).
      const voiceGiven = deps.orgXaiMediaGiven(
        "voice",
        deps.turnMediaPrincipal(capability.threadId),
        deps.botOwner(sender),
      );
      const spoken = await deps.speakVoiceNote({
        text,
        voice: voiceBot.voice,
        principalId: deps.turnMediaPrincipal(capability.threadId) ?? deps.botOwner(sender),
        organizationXaiGiven: voiceGiven,
      });
      if ("error" in spoken) {
        return json(res, spoken.error.status, {
          error: spoken.error.message,
          ...(spoken.error.cause ? { cause: spoken.error.cause } : {}),
        });
      }
      // Synthesis can outlive its turn: a stop or settle during the await
      // revokes the capability and clears the live turn. Re-check both
      // before saving so the clip cannot park under the :active fallback
      // or onto a later turn's key (#1742).
      deps.requireActive(capability);
      const turnId = deps.liveTurnId(capability.threadId);
      if (!turnId) {
        return json(res, 409, { error: "this turn has not started yet or already ended" });
      }
      const saved = deps.saveAudio(Buffer.from(spoken.bytes), spoken.mime);
      deps.pushTurnAttachment(capability.threadId, turnId, {
        kind: "audio",
        path: saved.path,
        mime: saved.mime,
        text,
      });
      return json(res, 201, { attached: true });
    }

    // Slice 5: a Perspicax MCP frame from the stdio bridge of this turn
    // (server/perspicax-mcp-bridge.ts). The Perspicax token never leaves
    // this process: server/perspicax/perspicax-mcp.ts holds it and relays.
    if (method === "POST" && path === "/api/internal/perspicax/mcp") {
      if (!deps.perspicaxMounted(capability)) {
        return json(res, 403, { error: "the Perspicax connection is not mounted in this turn", code: "profile_not_mounted" });
      }
      const frame = await readBody();
      // A confidential thread's memory never reaches a team or the
      // organization, and its own tier only with the person's Allow.
      // a batch is judged call by call nowhere: from a confidential thread it is refused
      if (Array.isArray(frame) && deps.isConfidentialThread(capability.threadId)) {
        return json(res, 200, { jsonrpc: "2.0", id: null, error: { code: -32600, message: CONFIDENTIAL_PEER_REFUSED } });
      }
      const confidentialCall = frame && typeof frame === "object" && (frame as { method?: unknown }).method === "tools/call"
        ? (frame as { params?: { name?: unknown; arguments?: unknown } }).params : undefined;
      if (confidentialCall && typeof confidentialCall.name === "string") {
        const callArgs = confidentialCall.arguments && typeof confidentialCall.arguments === "object" && !Array.isArray(confidentialCall.arguments)
          ? confidentialCall.arguments as Record<string, unknown>
          : undefined;
        const refused = deps.confidentialPerspicaxRefusal(capability, confidentialCall.name, callArgs);
        if (refused) {
          const id = (frame as { id?: unknown }).id;
          return json(res, 200, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: refused }], isError: true } });
        }
      }
      const perspicaxText = deps.misuseToolFrameText(frame);
      if (perspicaxText) {
        const speakerId = capability.sandboxPrincipalId ?? capability.desktopPrincipalId;
        const perspicaxMisuse = deps.misuseTextRefusal(
          perspicaxText,
          speakerId,
          perspicaxText.includes("flow_action") ? "flow" : "mcp",
          { botId: capability.botId, threadId: capability.threadId, tool: "perspicax" },
        );
        if (perspicaxMisuse) {
          const id = frame && typeof frame === "object" && "id" in frame ? (frame as { id?: unknown }).id : undefined;
          return json(res, 200, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: perspicaxMisuse }], isError: true } });
        }
        const who = deps.safetyPrincipal(capability.threadId);
        // full-access: safety-review
        const perspicaxHeld = await deps.safetyToolHold({
          text: perspicaxText,
          surface: perspicaxText.includes("flow_action") ? "flow" : "mcp",
          tool: "perspicax",
          known: true,
          triage: who.triage || deps.misuseActor(speakerId).triage,
          ...(who.principalId || speakerId ? { principalId: who.principalId ?? speakerId } : {}),
          threadId: capability.threadId,
          botId: capability.botId,
          review: deps.safetyReviewer(capability.botId),
        });
        if (perspicaxHeld) {
          const id = frame && typeof frame === "object" && "id" in frame ? (frame as { id?: unknown }).id : undefined;
          return json(res, 200, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: perspicaxHeld }], isError: true } });
        }
      }
      const answer = await deps.perspicaxRelay({
        threadId: capability.threadId,
        generation: capability.generation,
        botId: capability.botId,
        frame,
      });
      const relayHeaders = {
        "cache-control": "no-store",
        ...(answer.toolsChanged ? { "x-sagax-mcp-tools-changed": "1" } : {}),
      };
      if (answer.body === undefined) {
        res.writeHead(answer.status, relayHeaders);
        res.end();
        return;
      }
      res.writeHead(answer.status, { "content-type": "application/json", ...relayHeaders });
      res.end(JSON.stringify(answer.body));
      return;
    }

    return PASS;
  };
}

