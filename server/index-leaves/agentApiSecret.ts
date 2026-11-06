// @ts-nocheck
/** agentApiSecret (#1388). Pure move from server/index.ts. */
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
export type Host = Record<string, any>;

export function createAgentApiSecret(getHost: () => Host): any {
function agentApiSecret() {
  const host = getHost();
  const { DATA_DIR } = host;
  try {
    const existing = readFileSync(host.AGENT_API_KEY_FILE);
    if (existing.length >= 32) return existing;
  } catch {
    // first boot: make one below
  }
  const key = randomBytes(32);
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(host.AGENT_API_KEY_FILE, key, { mode: 0o600 });
  return key;

}
  return agentApiSecret;
}