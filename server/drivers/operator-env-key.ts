import { readEnvName } from "../../electron/legacy-names.mjs";

// Under the desktop app these variables hold workspace keys from its encrypted
// store (electron/workspace-credentials.mjs). They reach the instances the
// workspace routes through their own `environment`, never an instance with a
// URL of its own through the server's process env (port of upstream #5280).
const DESKTOP_STORE_KEY_ENV: ReadonlySet<string> = new Set([
  "MISTRAL_API_KEY", "CEREBRAS_API_KEY", "OPENAI_COMPAT_API_KEY", "SAGAX_OPENAI_API_KEY", "SAGAX_OPENROUTER_API_KEY",
]);

/** A key an operator set in the server's environment; undefined for a desktop store key under the desktop app. */
export function operatorEnvKey(name: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.SAGAX_DESKTOP_PARENT === "1" && DESKTOP_STORE_KEY_ENV.has(name) ? undefined : readEnvName(name, env);
}
