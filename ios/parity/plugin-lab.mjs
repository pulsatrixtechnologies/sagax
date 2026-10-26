// The plugins lab (PARITY_PLUGINS=1 in fixture-server.mjs), for the WP9 UI
// tests (ios/UITests/PluginsUITests.swift). Off by default: nothing of the
// reference dataset changes without it.
//
//   - a local MCP server behind a fake OAuth server (server/testing), added
//     as "oauthdocs", so Sign in runs the real server's OAuth start, callback
//     and status end to end;
//   - one bot ("Aurora").
//
//   GET /__parity/plugins  -> { botId, mcp: { tokens } }
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const PLUGIN_LAB = process.env.PARITY_PLUGINS === "1";

const lab = {
  botId: null,
  oauth: null,
};

// The managed connected-apps broker has been removed. These exports stay as
// no-ops so the fixture server keeps loading without starting a broker.
export function startPluginLabBroker() {
  return Promise.resolve(null);
}

export function pluginLabServerEnv() {
  return {};
}

/** Pass one: the OAuth MCP server and Aurora. */
export async function seedPluginLab(base, api, root, ids) {
  const { startFakeOAuthMcp } = await import(pathToFileURL(join(root, "server", "testing", "fake-oauth-mcp-server.ts")).href);
  lab.oauth = await startFakeOAuthMcp();
  await api(base, "POST", "/api/mcp/servers", { name: "oauthdocs", url: lab.oauth.mcpUrl });
  lab.botId = ids.aurora.id;
}

export async function closePluginLab() {
  await lab.oauth?.close().catch(() => {});
}

/** Handles /__parity/plugins; false for anything else. */
export async function pluginLabHook(req, res, url) {
  if (url.pathname !== "/__parity/plugins") return false;
  const send = (status, body) => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };
  if (!PLUGIN_LAB) return send(404, { error: "start the fixture with PARITY_PLUGINS=1" }), true;
  send(200, { botId: lab.botId, mcp: { tokens: lab.oauth ? [...lab.oauth.validAccess].length : 0 } });
  return true;
}
