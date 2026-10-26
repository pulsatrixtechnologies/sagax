import { createClaudeCloudProvider } from "./claude.ts";
import { createCodexCloudProvider } from "./codex.ts";
import { createCursorProvider } from "./cursor.ts";
import { createPerspicaxProvider, type LinkBearer, type PersonalSubscriptions } from "./perspicax.ts";
import type { CloudAgentProviderAdapter, HttpFetch } from "./types.ts";
import type { CloudAgentProviderId } from "../../../shared/cloud-agents.ts";

export interface ProviderRegistryOptions {
  fetch?: HttpFetch;
  cursorBaseUrl?: string;
  claudeBaseUrl?: string;
  /** Perspicax's origin, or null on a solo server (no Perspicax runs). */
  perspicaxBaseUrl?: () => string | null;
  /** Personal runs' subscriptions (organization server only). */
  personalSubscriptions?: () => PersonalSubscriptions | null;
  /** This server's link token, sent with every Perspicax call. */
  perspicaxLink?: LinkBearer;
}

export function createProviderRegistry(options: ProviderRegistryOptions = {}): Map<CloudAgentProviderId, CloudAgentProviderAdapter> {
  const fetchImpl = options.fetch ?? fetch;
  return new Map<CloudAgentProviderId, CloudAgentProviderAdapter>([
    ["cursor", createCursorProvider(fetchImpl, options.cursorBaseUrl)],
    ["claude", createClaudeCloudProvider(fetchImpl, options.claudeBaseUrl)],
    ["codex", createCodexCloudProvider()],
    ["perspicax", createPerspicaxProvider(fetchImpl, options.perspicaxBaseUrl ?? (() => null), options.personalSubscriptions, options.perspicaxLink)],
  ]);
}
