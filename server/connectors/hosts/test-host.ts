// The test connector host (#3348, connectors across engines L5): used by
// tests only. It never reaches a provider.
//
// It is on only when the server runs with SAGAX_TEST_CONNECTOR_HOST (a file
// the host appends each call to) and a test capability key
// (SAGAX_TEST_INTERNAL_CAPABILITY_KEY, at least 32 characters), the gate of
// the other test-only routes. It then stands for the ChatGPT apps provider,
// which lists nothing on a real server until its own host lands (L10): every
// person gets one sign-in with one connector, "Fixture Mail", whose calls
// answer a fixed marker. The marker and the calls file are the proof that a
// call reached a host, and that a declined one did not.
import { appendFileSync } from "node:fs";
import type { ConnectorAccount, ConnectorAccountRef, ConnectorProviderSource } from "../types.ts";
import { connectorAccountKey } from "../types.ts";
import type { ConnectorHost } from "./types.ts";

export const TEST_HOST_MARKER = "TEST_HOST_MARKER";
export const TEST_HOST_INSTANCE = "connector-test-host";
export const TEST_HOST_CONNECTOR = "Fixture Mail";
export const TEST_HOST_TOOLS = ["search_messages", "send_message"] as const;
const TEST_CAPABILITY_KEY_MIN = 32;

export interface TestConnectorHost {
  source: ConnectorProviderSource;
  host: ConnectorHost;
}

/** The test host and its provider, or undefined on any real server. */
export function testConnectorHostFromEnv(env: NodeJS.ProcessEnv = process.env): TestConnectorHost | undefined {
  const callsFile = env.SAGAX_TEST_CONNECTOR_HOST?.trim();
  const key = env.SAGAX_TEST_INTERNAL_CAPABILITY_KEY ?? "";
  if (!callsFile || key.length < TEST_CAPABILITY_KEY_MIN) return undefined;
  return createTestConnectorHost(callsFile);
}

export function createTestConnectorHost(callsFile: string, now: () => number = Date.now): TestConnectorHost {
  const ref: ConnectorAccountRef = { provider: "chatgpt-apps", driver: "codex", instanceId: TEST_HOST_INSTANCE, slot: "primary" };
  const account = (): ConnectorAccount => ({
    ...ref,
    key: connectorAccountKey(ref),
    label: "Test host",
    auth: "subscription",
    connectors: [{ id: "fixture_mail", name: TEST_HOST_CONNECTOR, state: "connected", tools: TEST_HOST_TOOLS.map((id) => ({ id })) }],
    at: now(),
  });
  return {
    source: {
      provider: "chatgpt-apps",
      accounts: (principalId) => (principalId.trim() ? [ref] : []),
      peek: (principalId) => (principalId.trim() ? account() : undefined),
      read: async (principalId) => (principalId.trim() ? account() : undefined),
    },
    host: {
      provider: "chatgpt-apps",
      ruleTool: (connector, tool) => `${connector.id ?? "fixture_mail"}__${tool}`,
      async call(call) {
        appendFileSync(callsFile, `${JSON.stringify({ principalId: call.principalId, engine: call.engine, connector: call.connector.name, tool: call.tool, arguments: call.arguments })}\n`);
        return { text: `${TEST_HOST_MARKER} ${call.tool} ${JSON.stringify(call.arguments)}` };
      },
    },
  };
}
