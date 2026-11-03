// Azure Key Vault as the key-encryption key of content encryption
// (docs/content-encryption.md): an organization server wraps each person's
// content key with wrapKey and opens it with unwrapKey (Key Vault REST API
// 7.4), so the key that opens transcripts never sits on the server's disk.
//
// Configuration is the server operator's, by environment only, and nothing
// here names a vault, tenant or organization:
//   SAGAX_CONTENT_KEY_PROVIDER=azure-keyvault
//   SAGAX_CONTENT_KEY_AZURE_KEY_URL=https://<vault>.vault.azure.net/keys/<name>[/<version>]
//   SAGAX_CONTENT_KEY_AZURE_ALG=RSA-OAEP-256 (default), RSA-OAEP or A256KW
// Credentials, the standard Azure variables, first match wins:
//   client secret      AZURE_TENANT_ID, AZURE_CLIENT_ID and
//                      SAGAX_CONTENT_KEY_AZURE_CLIENT_SECRET (or AZURE_CLIENT_SECRET)
//   workload identity  AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_FEDERATED_TOKEN_FILE
//                      (AZURE_AUTHORITY_HOST optional), as AKS sets them
//   managed identity   IDENTITY_ENDPOINT + IDENTITY_HEADER (App Service,
//                      Container Apps), else the instance metadata service;
//                      AZURE_CLIENT_ID picks a user-assigned identity
// The access token is cached in memory until shortly before it expires. No
// token, secret or key value is ever logged or put in an error.
import { readFileSync } from "node:fs";

import type { KekProvider, WrappedKey } from "./content-keys.ts";

const API_VERSION = "7.4";
const ALGORITHMS = new Set(["RSA-OAEP-256", "RSA-OAEP", "A256KW"]);
const IMDS = "http://169.254.169.254/metadata/identity/oauth2/token";

export interface AzureKeyVaultOptions {
  keyUrl: string;
  algorithm?: string;
  env?: NodeJS.ProcessEnv;
  /** injected by tests: no network call in the suite */
  fetch?: typeof fetch;
  readFile?: (path: string) => string;
  now?: () => number;
  timeoutMs?: number;
}

export class AzureKeyVaultError extends Error {
  constructor(message: string) {
    super(message);
  }
}

const b64url = (buffer: Buffer): string => buffer.toString("base64url");

/** The key URL without a trailing slash, checked: https, /keys/<name>[/<version>]. */
export function parseKeyUrl(value: string): { url: string; scope: string } {
  let parsed: URL;
  try { parsed = new URL(value.trim()); } catch { throw new AzureKeyVaultError("SAGAX_CONTENT_KEY_AZURE_KEY_URL is not a URL."); }
  if (parsed.protocol !== "https:" || parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new AzureKeyVaultError("SAGAX_CONTENT_KEY_AZURE_KEY_URL must be an https Key Vault key URL.");
  }
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts[0] !== "keys" || parts.length < 2 || parts.length > 3) {
    throw new AzureKeyVaultError("SAGAX_CONTENT_KEY_AZURE_KEY_URL must name a key: https://<vault>/keys/<name>[/<version>].");
  }
  // myvault.vault.azure.net -> https://vault.azure.net (sovereign clouds alike)
  const scope = `https://${parsed.hostname.split(".").slice(1).join(".")}`;
  return { url: `${parsed.origin}/${parts.join("/")}`, scope };
}

export function azureKeyVaultProvider(options: AzureKeyVaultOptions): KekProvider {
  const { url, scope } = parseKeyUrl(options.keyUrl);
  const algorithm = options.algorithm?.trim() || "RSA-OAEP-256";
  if (!ALGORITHMS.has(algorithm)) throw new AzureKeyVaultError("SAGAX_CONTENT_KEY_AZURE_ALG must be RSA-OAEP-256, RSA-OAEP or A256KW.");
  const env = options.env ?? process.env;
  const fetcher = options.fetch ?? fetch;
  const readFile = options.readFile ?? ((path: string) => readFileSync(path, "utf8"));
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 15_000;
  let token: { value: string; expiresAt: number } | null = null;

  const call = async (target: string, init: RequestInit, what: string): Promise<Record<string, unknown>> => {
    let response: Response;
    try { response = await fetcher(target, { ...init, signal: AbortSignal.timeout(timeoutMs) }); }
    catch { throw new AzureKeyVaultError(`Azure ${what} could not be reached.`); }
    let body: unknown = null;
    try { body = await response.json(); } catch { /* not JSON */ }
    if (!response.ok) throw new AzureKeyVaultError(`Azure ${what} answered ${response.status}.`);
    if (!body || typeof body !== "object") throw new AzureKeyVaultError(`Azure ${what} answered without a JSON body.`);
    return body as Record<string, unknown>;
  };

  const accessToken = async (): Promise<string> => {
    if (token && token.expiresAt - 300_000 > now()) return token.value;
    const tenant = env.AZURE_TENANT_ID?.trim();
    const client = env.AZURE_CLIENT_ID?.trim();
    const secret = (env.SAGAX_CONTENT_KEY_AZURE_CLIENT_SECRET ?? env.AZURE_CLIENT_SECRET)?.trim();
    const federated = env.AZURE_FEDERATED_TOKEN_FILE?.trim();
    const authority = (env.AZURE_AUTHORITY_HOST?.trim() || "https://login.microsoftonline.com").replace(/\/+$/, "");
    let body: Record<string, unknown>;
    if (tenant && client && (secret || federated)) {
      const form = new URLSearchParams({ grant_type: "client_credentials", client_id: client, scope: `${scope}/.default` });
      if (secret) form.set("client_secret", secret);
      else {
        let assertion: string;
        try { assertion = readFile(federated!).trim(); } catch { throw new AzureKeyVaultError("AZURE_FEDERATED_TOKEN_FILE could not be read."); }
        form.set("client_assertion_type", "urn:ietf:params:oauth:client-assertion-type:jwt-bearer");
        form.set("client_assertion", assertion);
      }
      body = await call(`${authority}/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form.toString(),
      }, "sign-in");
    } else if (env.IDENTITY_ENDPOINT?.trim() && env.IDENTITY_HEADER?.trim()) {
      const target = new URL(env.IDENTITY_ENDPOINT.trim());
      target.searchParams.set("api-version", "2019-08-01");
      target.searchParams.set("resource", scope);
      if (client) target.searchParams.set("client_id", client);
      body = await call(target.toString(), { headers: { "X-IDENTITY-HEADER": env.IDENTITY_HEADER.trim() } }, "managed identity");
    } else {
      const target = new URL(IMDS);
      target.searchParams.set("api-version", "2018-02-01");
      target.searchParams.set("resource", scope);
      if (client) target.searchParams.set("client_id", client);
      body = await call(target.toString(), { headers: { Metadata: "true" } }, "managed identity");
    }
    const value = typeof body.access_token === "string" ? body.access_token : "";
    if (!value) throw new AzureKeyVaultError("Azure sign-in answered without an access token.");
    const seconds = Number(body.expires_in ?? 0) || 0;
    const expiresOn = Number(body.expires_on ?? 0) || 0;
    token = { value, expiresAt: seconds > 0 ? now() + seconds * 1000 : expiresOn > 0 ? expiresOn * 1000 : now() + 600_000 };
    return value;
  };

  const keyOperation = async (target: string, operation: "wrapkey" | "unwrapkey", value: Buffer, alg: string): Promise<Record<string, unknown>> => {
    const bearer = await accessToken();
    return call(`${target}/${operation}?api-version=${API_VERSION}`, {
      method: "POST",
      headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
      body: JSON.stringify({ alg, value: b64url(value) }),
    }, operation === "wrapkey" ? "Key Vault wrapKey" : "Key Vault unwrapKey");
  };

  return {
    id: "azure-keyvault",
    async wrap(dek: Buffer): Promise<WrappedKey> {
      const body = await keyOperation(url, "wrapkey", dek, algorithm);
      const kid = typeof body.kid === "string" ? body.kid : "";
      const value = typeof body.value === "string" ? body.value : "";
      if (!value) throw new AzureKeyVaultError("Key Vault wrapKey answered without a value.");
      // the key version that wrapped it, so a rotated key still unwraps
      const ref = `${algorithm} ${kid ? parseKeyUrl(kid).url : url}`;
      return { provider: "azure-keyvault", ref, wrapped: Buffer.from(value, "base64url") };
    },
    async unwrap(wrapped: WrappedKey): Promise<Buffer> {
      const [alg, target] = wrapped.ref.split(" ");
      if (!alg || !ALGORITHMS.has(alg) || !target) throw new AzureKeyVaultError("A wrapped content key has no Key Vault reference.");
      // only a key of the configured vault: a row naming another host is refused
      if (new URL(target).origin !== new URL(url).origin) throw new AzureKeyVaultError("A wrapped content key names another Key Vault.");
      const body = await keyOperation(parseKeyUrl(target).url, "unwrapkey", wrapped.wrapped, alg);
      const value = typeof body.value === "string" ? body.value : "";
      const raw = Buffer.from(value, "base64url");
      if (raw.length !== 32) throw new AzureKeyVaultError("Key Vault unwrapKey answered with a key of the wrong size.");
      return raw;
    },
  };
}
