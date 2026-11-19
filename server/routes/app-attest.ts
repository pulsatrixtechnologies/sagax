// App Attest (DeviceCheck), docs/ios-push.md "App Attest":
//
//   POST /api/attest/challenge  -> { configured, challenge }   one use, 5 minutes
//   POST /api/attest/register   { keyId, attestation, challenge, appVersion?, deviceName? }
//                               verify the attestation, keep the key for this person
//   POST /api/attest/assert     { keyId, assertion, challenge }
//                               verify an assertion made with a kept key
//
// Log only, never a lock (owner, 2026-11-17): a phone that cannot attest (a
// simulator, an old device) still works, and a failed check is a log line
// (and { ok: false } for the app), never a refused sign-in or request.
import { randomBytes } from "node:crypto";
import { z } from "zod";

import type { RequestAuth } from "../auth/request-auth.ts";
import { maskSecret } from "../push/config.ts";
import type { AppAttestStore } from "../attest/store.ts";
import { verifyAssertion, verifyAttestation } from "../attest/verify.ts";
import { PASS, type RouteHandler } from "./table.ts";

export const ATTEST_PATH_PREFIX = "/api/attest/";
export const CHALLENGE_TTL_MS = 5 * 60_000;
const MAX_OPEN_CHALLENGES = 500;

export interface AppAttestRouteDeps {
  person(auth: RequestAuth): string | undefined;
  store: AppAttestStore;
  /** teamId.bundleId; none: the server cannot verify and says so. */
  appId(): string | undefined;
  now?: () => number;
  warn?: (line: string) => void;
  rootPem?: string;
}

const KEY_ID = z.string().trim().min(20).max(100).regex(/^[A-Za-z0-9+/=]+$/);
const B64 = z.string().trim().min(1).max(32_768).regex(/^[A-Za-z0-9+/=]+$/);
const CHALLENGE = z.string().trim().min(16).max(128).regex(/^[A-Za-z0-9_-]+$/);

const registerBody = z.object({
  keyId: KEY_ID, attestation: B64, challenge: CHALLENGE,
  appVersion: z.string().trim().max(40).default(""), deviceName: z.string().trim().max(80).default(""),
}).strict();
const assertBody = z.object({ keyId: KEY_ID, assertion: B64, challenge: CHALLENGE }).strict();

export function createAppAttestRoutes(deps: AppAttestRouteDeps): RouteHandler {
  const now = deps.now ?? Date.now;
  const warn = deps.warn ?? ((line: string) => console.warn(line));
  const open = new Map<string, { person: string; expires: number }>();

  const issue = (person: string) => {
    const at = now();
    for (const [challenge, entry] of open) if (entry.expires <= at) open.delete(challenge);
    while (open.size >= MAX_OPEN_CHALLENGES) open.delete(open.keys().next().value as string);
    const challenge = randomBytes(24).toString("base64url");
    open.set(challenge, { person, expires: at + CHALLENGE_TTL_MS });
    return challenge;
  };
  const take = (person: string, challenge: string) => {
    const entry = open.get(challenge);
    open.delete(challenge);
    return Boolean(entry && entry.person === person && entry.expires > now());
  };

  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (!path.startsWith(ATTEST_PATH_PREFIX)) return PASS;
    const action = path.slice(ATTEST_PATH_PREFIX.length);
    if (!["challenge", "register", "assert"].includes(action)) return PASS;
    res.setHeader("cache-control", "no-store");
    if (method !== "POST") return json(res, 405, { error: "POST only" });
    const person = deps.person(auth);
    if (!person) return json(res, 403, { error: "Only a signed-in person attests a phone.", code: "session_required" });
    const appId = deps.appId();
    if (action === "challenge") {
      return json(res, 200, appId ? { configured: true, challenge: issue(person) } : { configured: false });
    }
    if (!appId) return json(res, 200, { ok: false, configured: false });
    const body = await readBody(req);
    if (action === "register") {
      const parsed = registerBody.safeParse(body);
      if (!parsed.success) return json(res, 400, { error: "send { keyId, attestation, challenge, appVersion?, deviceName? }" });
      if (!take(person, parsed.data.challenge)) return json(res, 200, { ok: false, reason: "challenge" });
      try {
        const verified = verifyAttestation({ attestation: parsed.data.attestation, keyId: parsed.data.keyId, clientData: parsed.data.challenge, appId, now: now(), ...(deps.rootPem ? { rootPem: deps.rootPem } : {}) });
        deps.store.add(person, { keyId: verified.keyId, publicKeyPem: verified.publicKeyPem, environment: verified.environment, appVersion: parsed.data.appVersion, deviceName: parsed.data.deviceName });
        return json(res, 200, { ok: true, environment: verified.environment });
      } catch (error) {
        warn(`app-attest: attestation of key ${maskSecret(parsed.data.keyId)} refused (${error instanceof Error ? error.message : "error"}); the phone keeps working`);
        return json(res, 200, { ok: false, reason: "attestation" });
      }
    }
    const parsed = assertBody.safeParse(body);
    if (!parsed.success) return json(res, 400, { error: "send { keyId, assertion, challenge }" });
    if (!take(person, parsed.data.challenge)) return json(res, 200, { ok: false, reason: "challenge" });
    const device = deps.store.find(person, parsed.data.keyId);
    if (!device) return json(res, 200, { ok: false, reason: "unknown_key" });
    try {
      const counter = verifyAssertion({ assertion: parsed.data.assertion, clientData: parsed.data.challenge, publicKeyPem: device.publicKeyPem, lastCounter: device.counter, appId });
      deps.store.accept(person, device.keyId, counter);
      return json(res, 200, { ok: true });
    } catch (error) {
      warn(`app-attest: assertion of key ${maskSecret(parsed.data.keyId)} refused (${error instanceof Error ? error.message : "error"}); the phone keeps working`);
      return json(res, 200, { ok: false, reason: "assertion" });
    }
  };
}
