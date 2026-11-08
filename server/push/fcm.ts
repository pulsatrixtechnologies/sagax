// Pushes to Android phones through Firebase Cloud Messaging, HTTP v1
// (2026-10-26, "Me joindre"), next to APNs (./apns.ts). The server signs a
// short JWT with a Firebase service account, trades it for an OAuth access
// token (cached until a minute before it ends) and posts one message per
// device. No Firebase SDK, no dependency.
//
//   SAGAX_FCM_SERVICE_ACCOUNT_PATH  the service account JSON file (read-only
//                                   mount), from the Firebase console
//   SAGAX_FCM_SERVICE_ACCOUNT_JSON  or the same JSON in the variable
//   SAGAX_FCM_PROJECT_ID            optional: else the JSON's project_id
//
// Unset: Android pushes are off with one log line; iOS and the rest are
// unchanged. Never commit the JSON, never log it or a token: only which
// variable is missing, and device tokens masked.
//
// The message is data only (`android.priority: HIGH`): the app's
// FirebaseMessagingService builds the notification itself, with the same
// keys an APNs push carries (kind, threadId, botId, requestId, prompt), so
// a tap opens the same screen.
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

import { markdownToPlainText } from "../../shared/plain-text.ts";

import { maskSecret } from "./config.ts";
import type { PushMessage } from "./payload.ts";

export const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
export const FCM_HOST = "https://fcm.googleapis.com";
export const GOOGLE_TOKEN_URI = "https://oauth2.googleapis.com/token";

export interface FcmConfig {
  projectId: string;
  clientEmail: string;
  privateKeyPem: string;
  tokenUri: string;
}

export type FcmConfigResult = { configured: true; config: FcmConfig } | { configured: false; reason: string };

const PROJECT_ID = /^[a-z][a-z0-9-]{4,61}[a-z0-9]$/;

/** Read the FCM settings. `readFile` is injected so tests never touch disk. */
export function readFcmConfig(
  env: NodeJS.ProcessEnv = process.env,
  readFile: (path: string) => string = (path) => readFileSync(path, "utf8"),
): FcmConfigResult {
  const path = env.SAGAX_FCM_SERVICE_ACCOUNT_PATH?.trim() ?? "";
  const inline = env.SAGAX_FCM_SERVICE_ACCOUNT_JSON?.trim() ?? "";
  if (!path && !inline) return { configured: false, reason: "SAGAX_FCM_SERVICE_ACCOUNT_PATH not set" };
  let raw: string;
  if (inline) raw = inline;
  else {
    try {
      raw = readFile(path);
    } catch (error) {
      return { configured: false, reason: `SAGAX_FCM_SERVICE_ACCOUNT_PATH could not be read (${(error as NodeJS.ErrnoException).code ?? "unreadable"})` };
    }
  }
  let account: Record<string, unknown>;
  try {
    account = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // never the parser's message: it could quote the key
    return { configured: false, reason: "the FCM service account is not JSON" };
  }
  const projectId = (env.SAGAX_FCM_PROJECT_ID?.trim() || (typeof account.project_id === "string" ? account.project_id : "")).trim();
  const clientEmail = typeof account.client_email === "string" ? account.client_email.trim() : "";
  const privateKeyPem = typeof account.private_key === "string" ? account.private_key : "";
  const tokenUri = typeof account.token_uri === "string" && account.token_uri.startsWith("https://") ? account.token_uri : GOOGLE_TOKEN_URI;
  if (account.type !== undefined && account.type !== "service_account") return { configured: false, reason: "the FCM JSON is not a service account" };
  if (!PROJECT_ID.test(projectId)) return { configured: false, reason: "the FCM project id is missing (SAGAX_FCM_PROJECT_ID or project_id)" };
  if (!/^[^@\s]+@[^@\s]+$/.test(clientEmail)) return { configured: false, reason: "the FCM service account has no client_email" };
  if (!/-----BEGIN PRIVATE KEY-----[\s\S]+-----END PRIVATE KEY-----/.test(privateKeyPem)) return { configured: false, reason: "the FCM service account has no private_key" };
  return { configured: true, config: { projectId, clientEmail, privateKeyPem, tokenUri } };
}

const base64url = (value: string | Buffer) => Buffer.from(value).toString("base64url");

/** The signed assertion Google trades for an access token (RS256). */
export function serviceAccountAssertion(config: FcmConfig, nowMs: number): string {
  const iat = Math.floor(nowMs / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({ iss: config.clientEmail, scope: FCM_SCOPE, aud: config.tokenUri, iat, exp: iat + 3600 }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  return `${header}.${claims}.${signer.sign(config.privateKeyPem).toString("base64url")}`;
}

/** The FCM HTTP v1 body for one device: data only, every value a string. */
export function buildFcmMessage(input: { message: PushMessage; token: string; kind?: "read" }): Record<string, unknown> {
  const { message } = input;
  const data: Record<string, string> = { kind: input.kind ?? message.kind };
  const put = (key: string, value: unknown) => {
    if (typeof value === "string" && value) data[key] = value.slice(0, 1_000);
  };
  if (input.kind !== "read") {
    put("title", message.title);
    // Android draws no Markdown either (shared/plain-text.ts)
    put("body", markdownToPlainText(message.body ?? "", { dropCode: true }));
    put("botId", message.botId);
    put("groupId", message.groupId);
    put("requestId", message.requestId);
    put("prompt", message.prompt);
    put("senderName", message.senderName);
    put("id", message.id);
    if (message.needsKey) data.needsKey = "1";
  }
  put("threadId", message.threadId);
  put("at", String(message.at));
  const collapse = message.threadId ? `t-${message.threadId}`.slice(0, 64) : undefined;
  return {
    message: {
      token: input.token,
      data,
      android: { priority: input.kind === "read" ? "NORMAL" : "HIGH", ...(collapse ? { collapse_key: collapse } : {}), ttl: "86400s" },
    },
  };
}

export type FcmOutcome = { ok: true } | { ok: false; status: number; reason: string; prune: boolean };

export type FcmFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ status: number; text(): Promise<string> }>;

export interface FcmLog {
  info(line: string): void;
  warn(line: string): void;
}

/** Sends to FCM. One access token at a time, renewed a minute before its end. */
export class FcmSender {
  private readonly config: FcmConfig;
  private readonly fetcher: FcmFetch;
  private readonly now: () => number;
  private readonly log: FcmLog;
  private access: { token: string; expiresAt: number } | null = null;
  private pending: Promise<string | null> | null = null;

  constructor(input: { config: FcmConfig; fetch?: FcmFetch; now?: () => number; log?: FcmLog }) {
    this.config = input.config;
    this.fetcher = input.fetch ?? ((url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(10_000), redirect: "error" }));
    this.now = input.now ?? Date.now;
    this.log = input.log ?? { info: (line) => console.log(line), warn: (line) => console.warn(line) };
  }

  private async accessToken(): Promise<string | null> {
    if (this.access && this.access.expiresAt - 60_000 > this.now()) return this.access.token;
    this.pending ??= (async () => {
      try {
        const body = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: serviceAccountAssertion(this.config, this.now()) }).toString();
        const response = await this.fetcher(this.config.tokenUri, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
        const parsed = JSON.parse(await response.text()) as { access_token?: unknown; expires_in?: unknown };
        if (response.status !== 200 || typeof parsed.access_token !== "string") {
          this.log.warn(`push: FCM sign-in refused (${response.status}); Android pushes skipped`);
          return null;
        }
        const life = typeof parsed.expires_in === "number" ? parsed.expires_in : 3600;
        this.access = { token: parsed.access_token, expiresAt: this.now() + life * 1000 };
        return parsed.access_token;
      } catch {
        this.log.warn("push: FCM sign-in failed; Android pushes skipped");
        return null;
      } finally {
        this.pending = null;
      }
    })();
    return this.pending;
  }

  async send(token: string, body: Record<string, unknown>): Promise<FcmOutcome> {
    const access = await this.accessToken();
    if (!access) return { ok: false, status: 401, reason: "no access token", prune: false };
    try {
      const response = await this.fetcher(`${FCM_HOST}/v1/projects/${this.config.projectId}/messages:send`, {
        method: "POST",
        headers: { authorization: `Bearer ${access}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (response.status === 200) return { ok: true };
      let reason = "";
      let fromFcmError = false;
      let tokenFieldHit = false;
      try {
        const parsed = JSON.parse(await response.text()) as {
          error?: {
            status?: string;
            message?: string;
            details?: Array<{ errorCode?: string; fieldViolations?: Array<{ field?: string }> }>;
          };
        };
        const details = parsed.error?.details ?? [];
        const fcm = details.find((detail) => detail.errorCode);
        fromFcmError = Boolean(fcm?.errorCode);
        reason = fcm?.errorCode ?? parsed.error?.status ?? "";
        // BadRequest fieldViolations (or the message) may name the registration token
        tokenFieldHit =
          /registration token/i.test(parsed.error?.message ?? "") ||
          details.some((detail) => (detail.fieldViolations ?? []).some((v) => /\btoken\b/i.test(v.field ?? "")));
      } catch { /* no body */ }
      if (response.status === 401) this.access = null;
      // Dead token: unregistered, wrong Firebase project, or INVALID_ARGUMENT aimed at the token
      // (FcmError INVALID_ARGUMENT). A BadRequest on another field (payload) must not prune.
      const prune =
        response.status === 404 ||
        reason === "UNREGISTERED" ||
        reason === "SENDER_ID_MISMATCH" ||
        (response.status === 400 && reason === "INVALID_ARGUMENT" && (fromFcmError || tokenFieldHit));
      if (!prune) this.log.warn(`push: FCM refused a push to ${maskSecret(token)} (${response.status} ${reason || "error"})`);
      return { ok: false, status: response.status, reason: reason || "error", prune };
    } catch {
      return { ok: false, status: 502, reason: "unreachable", prune: false };
    }
  }
}
