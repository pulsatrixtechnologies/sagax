// Content encryption settings from the environment (docs/content-encryption.md).
//   SAGAX_CONTENT_ENCRYPTION      on (default) | off: off opens every sealed
//                                 row back to plain, a little at a time
//   SAGAX_CONTENT_KEY_PROVIDER    local (default) | azure-keyvault
//   SAGAX_CONTENT_KEY_AZURE_*     see content-key-azure.ts
import { azureKeyVaultProvider } from "./content-key-azure.ts";
import type { KekProvider } from "./content-keys.ts";
import { contentEncryptionModeFromEnv, type ContentEncryptionMode } from "../message-db.ts";

export interface ContentEncryptionEnv {
  mode: ContentEncryptionMode;
  /** absent: the local vault key */
  provider?: KekProvider;
}

export function contentEncryptionFromEnv(env: NodeJS.ProcessEnv = process.env, fetcher?: typeof fetch): ContentEncryptionEnv {
  const mode = contentEncryptionModeFromEnv(env);
  const provider = env.SAGAX_CONTENT_KEY_PROVIDER?.trim().toLowerCase() || "local";
  if (provider === "local") return { mode };
  if (provider === "azure-keyvault") {
    const keyUrl = env.SAGAX_CONTENT_KEY_AZURE_KEY_URL?.trim();
    if (!keyUrl) throw new Error("SAGAX_CONTENT_KEY_PROVIDER=azure-keyvault needs SAGAX_CONTENT_KEY_AZURE_KEY_URL (https://<vault>/keys/<name>).");
    return { mode, provider: azureKeyVaultProvider({ keyUrl, algorithm: env.SAGAX_CONTENT_KEY_AZURE_ALG, env, ...(fetcher ? { fetch: fetcher } : {}) }) };
  }
  throw new Error("SAGAX_CONTENT_KEY_PROVIDER must be local or azure-keyvault.");
}
