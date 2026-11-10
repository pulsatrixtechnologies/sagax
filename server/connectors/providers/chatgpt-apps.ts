// ChatGPT apps in the registry (#3344): lists nothing yet. Codex's
// app-server can list them (`mcpServerStatus/list`) on a person's own
// ChatGPT sign-in; that read, its fake and its call come with the Codex
// host (design docs/design/connectors-across-engines.md, lot L10). Until
// then no account is listed, so nothing claims a ChatGPT connector.
import type { ConnectorProviderSource } from "../types.ts";

export function chatgptAppsProvider(): ConnectorProviderSource {
  return {
    provider: "chatgpt-apps",
    accounts: () => [],
    peek: () => undefined,
    read: async () => undefined,
  };
}
