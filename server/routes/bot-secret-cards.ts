import { PASS, type RouteHandler } from "./table.ts";
import { z } from "zod";
import type { AppConfig } from "../config.ts";
import type { Message } from "../store.ts";
import { PHONE_SECRET_PROTOCOL_VERSION, type PhoneSecretContext } from "../phone/phone-secret.ts";
import {
  credentialIsConfigured,
  credentialResumeOutcome,
  isCredentialTargetId,
  PRODUCT_KEY_TARGET,
} from "../../shared/credential-request.ts";
import { VAULT_LOGIN_TARGET } from "../../shared/credential-vault.ts";
import { SECRET_VALUE_MAX_BYTES } from "../secret-vault.ts";
import { isCustomSecret } from "../host/custom-secrets.ts";
import { PRODUCT_KEY_VALUE_MAX_BYTES } from "../../shared/person-products.ts";
import type { RequestAuth } from "../auth/request-auth.ts";

const phoneSecretEnvelopeSchema = z.object({
  version: z.literal(PHONE_SECRET_PROTOCOL_VERSION),
  threadId: z.string().regex(/^[\w-]{1,128}$/),
  keyId: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
  deviceId: z.string().regex(/^[\w-]{1,128}$/),
  target: z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,63}$/),
  requestKey: z.string().regex(/^[\w-]{1,128}$/),
  encapsulatedKey: z.string().regex(/^[A-Za-z0-9_-]{87}$/),
  ciphertext: z.string().regex(/^[A-Za-z0-9_-]{23,5483}$/)
}).strict();

function secretSaved(cfg: AppConfig, secret: NonNullable<Message["secret"]>): boolean {
  if (isCustomSecret(secret)) return secret.savedAt !== undefined;
  if (secret.target === PRODUCT_KEY_TARGET) return secret.result?.ok === true;
  if (!isCredentialTargetId(secret.target)) return false;
  return credentialIsConfigured(cfg, secret.target);
}

export interface BotSecretCardRouteDeps {
  getConfig: () => AppConfig;
  provideSecretFromPhone: (context: PhoneSecretContext, deviceId: string) => Promise<{ provided: boolean; resumed: boolean }>;
  secretMessage: (botId: string, threadId: string, messageId: string) => Message | null;
  phoneSecretSubmissions: { has(key: string): boolean };
  phoneSecretSubmissionKey: (threadId: string, messageId: string, requestKey: string) => string;
  resumeSecretCard: (botId: string, threadId: string, messageId: string, outcome: "provided" | "dismissed") => boolean;
  currentSecretState: (botId: string, threadId: string, messageId: string) => { provided: boolean; resumed: boolean } | null;
  /** Keep a custom secret behind the card and resume the turn. */
  saveCustomSecret?: (botId: string, threadId: string, messageId: string, value: unknown) => { status: number; body: Record<string, unknown> };
  /** #4185: a product key card's values, sent to Perspicax as the person the
   * card was raised for, then tested; never kept here. */
  saveProductKey?: (auth: RequestAuth, botId: string, threadId: string, messageId: string, values: unknown) => Promise<{ status: number; body: Record<string, unknown> }>;
}

export function createBotSecretCardRoutes(deps: BotSecretCardRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const { getConfig, provideSecretFromPhone, secretMessage, phoneSecretSubmissions, phoneSecretSubmissionKey, resumeSecretCard, currentSecretState } = deps;

    // A custom secret typed in the app: JSON only, value never echoed.
    let m = path.match(/^\/api\/bots\/([\w-]+)\/secret-cards\/([\w-]+)\/save$/);
    if (m && method === "POST") {
      const mediaType = String(req.headers["content-type"] ?? "").split(";", 1)[0]!.trim().toLowerCase();
      if (mediaType !== "application/json") {
        json(res, 415, { error: "content-type must be application/json" });
        return;
      }
      if (!deps.saveCustomSecret) {
        json(res, 501, { error: "custom secrets are unavailable on this server" });
        return;
      }
      const raw = await readBody(req, SECRET_VALUE_MAX_BYTES * 4);
      const fields = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
      const threadId = String(fields.threadId ?? "");
      const result = deps.saveCustomSecret(m[1]!, threadId, m[2]!, fields.value);
      json(res, result.status, result.body);
      return;
    }

    // #4185: a product key typed on its card: JSON only, values never echoed,
    // stored or logged; the answer is `no-store`.
    m = path.match(/^\/api\/bots\/([\w-]+)\/secret-cards\/([\w-]+)\/product-key$/);
    if (m && method === "POST") {
      res.setHeader("cache-control", "no-store");
      const mediaType = String(req.headers["content-type"] ?? "").split(";", 1)[0]!.trim().toLowerCase();
      if (mediaType !== "application/json") {
        json(res, 415, { error: "content-type must be application/json" });
        return;
      }
      if (!deps.saveProductKey) {
        json(res, 404, { error: "product keys are unavailable on this server" });
        return;
      }
      let raw: unknown;
      try {
        raw = await readBody(req, PRODUCT_KEY_VALUE_MAX_BYTES * 2);
      } catch {
        json(res, 413, { error: "This key is too large." });
        return;
      }
      const fields = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
      const result = await deps.saveProductKey(auth, m[1]!, String(fields.threadId ?? ""), m[2]!, fields.values);
      json(res, result.status, result.body);
      return;
    }

    // Phone credential entry arrives as an HPKE envelope bound to the exact
    // paired device, bot, task, card and allowlisted target. The companion
    // authenticates the bearer and supplies the device id; only the embedded
    // Electron server has the private key needed to open the envelope.
    m = path.match(/^\/api\/bots\/([\w-]+)\/secret-cards\/([\w-]+)\/provide$/);
    if (m && method === "POST") {
      if (req.headers["x-openmausbot-companion"] !== "1") {
        json(res, 403, { error: "Secure phone entry must come from a paired phone" });
        return;
      }
      const rawDeviceId = req.headers["x-openmausbot-companion-device"];
      const authenticatedDeviceId = Array.isArray(rawDeviceId) ? "" : String(rawDeviceId ?? "");
      if (!/^[\w-]{1,128}$/.test(authenticatedDeviceId)) {
        json(res, 401, { error: "This paired phone could not be verified" });
        return;
      }
      if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
        json(res, 415, { error: "content-type must be application/json" });
        return;
      }
      const parsed = phoneSecretEnvelopeSchema.safeParse(await readBody(req, 16_384));
      // Custom secrets from a phone need a sealed open path not wired here yet; only allowlisted keys.
      if (!parsed.success || !isCredentialTargetId(parsed.data?.target)) {
        json(res, 400, { error: "The encrypted credential request is invalid" });
        return;
      }
      const state = await provideSecretFromPhone({
        ...parsed.data,
        botId: m[1],
        messageId: m[2],
        target: parsed.data.target
      }, authenticatedDeviceId);
      json(res, 200, state);
      return;
    }

    // Desktop credential cards never send the credential through this route.
    // Electron saves it through the OS-backed store first; these actions only
    // verify configured state, update card metadata, and resume the turn.
    m = path.match(/^\/api\/bots\/([\w-]+)\/secret-cards\/([\w-]+)\/(provided|resume|dismiss)$/);
    if (m && method === "POST") {
      const body = await readBody(req);
      const threadId = String(body.threadId ?? "");
      const message = secretMessage(m[1], threadId, m[2]);
      if (!message?.secret) {
        json(res, 404, { error: "no such credential request" });
        return;
      }
      // A vault login card is answered on its own routes (server/routes/credential-vault.ts).
      if (message.secret.target === VAULT_LOGIN_TARGET) {
        json(res, 409, { error: "answer this login request on its card" });
        return;
      }
      if (phoneSecretSubmissions.has(
        phoneSecretSubmissionKey(threadId, message.id, message.secret.requestKey),
      )) {
        json(res, 409, { error: "this credential is currently being saved from a phone" });
        return;
      }
      if (m[3] === "provided") {
        if (message.secret.dismissed) {
          json(res, 409, { error: "this credential request was dismissed" });
          return;
        }
        if (message.secret.superseded) {
          json(res, 409, { error: "this credential request was superseded by a newer one" });
          return;
        }
        if (!secretSaved(getConfig(), message.secret)) {
          json(res, 409, { error: `${message.secret.label} was not saved yet` });
          return;
        }
        if (!resumeSecretCard(m[1], threadId, message.id, "provided")) {
          json(res, 409, { error: "this credential request is no longer available" });
          return;
        }
        const state = currentSecretState(m[1], threadId, message.id);
        if (!state) {
          json(res, 409, { error: "this credential request is no longer available" });
          return;
        }
        json(res, 200, state);
        return;
      }
      if (m[3] === "resume") {
        if (message.secret.superseded) {
          json(res, 409, { error: "this credential request was superseded by a newer one" });
          return;
        }
        const outcome = credentialResumeOutcome(message.secret);
        if (!outcome) {
          json(res, 409, { error: "this credential request is not ready to resume" });
          return;
        }
        if (outcome === "provided" && !secretSaved(getConfig(), message.secret)) {
          json(res, 409, { error: `${message.secret.label} is no longer configured` });
          return;
        }
        if (!resumeSecretCard(m[1], threadId, message.id, outcome)) {
          json(res, 409, { error: "this credential request is no longer available" });
          return;
        }
        const state = currentSecretState(m[1], threadId, message.id);
        if (!state) {
          json(res, 409, { error: "this credential request is no longer available" });
          return;
        }
        json(res, 200, { resumed: state.resumed });
        return;
      }
      if (message.secret.superseded) {
        json(res, 409, { error: "this credential request was superseded by a newer one" });
        return;
      }
      if (!message.secret.provided && !resumeSecretCard(m[1], threadId, message.id, "dismissed")) {
        json(res, 409, { error: "this credential request is no longer available" });
        return;
      }
      const state = currentSecretState(m[1], threadId, message.id);
      if (!state) {
        json(res, 409, { error: "this credential request is no longer available" });
        return;
      }
      json(res, 200, { dismissed: true, resumed: state.resumed });
      return;
    }
    return PASS;
  };
}
