// How this app's Electron sessions and listeners meet the local Sagax server
// (port of OpenMausBot #2930). The server treats the app window as its owner
// only by the header the default session adds (main.mjs
// installRequestHeaderRules, on http: and ws: alike); no other session
// (desktop viewers, Local VM panes) may reach the server at all; and the
// server learns every port this app listens on, so its bots' browsers never
// reach them (server/browser/egress/registry.ts).
import { subscribe } from "node:diagnostics_channel";
import { isIP } from "node:net";

function loopbackHost(hostname) {
  const bare = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (bare === "localhost" || bare.endsWith(".localhost") || bare === "0.0.0.0" || bare === "::") return true;
  if (isIP(bare) === 4) return bare.startsWith("127.");
  return isIP(bare) === 6 && (bare === "::1" || /^::ffff:7f[0-9a-f]{2}:/.test(bare));
}

/** Whether `url` names this machine's server port, in any spelling that reaches it. */
export function targetsServer(url, serverPort) {
  try {
    const target = new URL(url);
    if (!["http:", "https:", "ws:", "wss:"].includes(target.protocol) || !loopbackHost(target.hostname)) return false;
    const port = Number(target.port || (target.protocol === "https:" || target.protocol === "wss:" ? 443 : 80));
    return port === serverPort;
  } catch {
    return false;
  }
}

/** The rule for one session: cancel its way to the server unless it is the
 * app window's own. `guard()` is null until the app is ready (no window has
 * loaded anything then); it shares the session's single onBeforeRequest
 * listener with the upstream-hosts block (installSessionBlock). */
export function serverRequestRefusal(created, guard) {
  return (url) => {
    const current = guard();
    return Boolean(current) && created !== current.defaultSession && targetsServer(url, current.serverPort());
  };
}

const ownPorts = new Set();
let reportTo = null;

function report() {
  try {
    reportTo?.postMessage({ type: "openmausbot:own-listeners", ports: [...ownPorts] });
  } catch {}
}

subscribe("tracing:net.server.listen:asyncEnd", ({ server }) => {
  const address = server?.address();
  if (!address || typeof address !== "object" || ownPorts.has(address.port)) return;
  ownPorts.add(address.port);
  report();
});

/** Tells a server that has just become ready which ports this app listens on, and tells it again as more open. */
export function reportOwnListeners(proc, ports = []) {
  for (const port of ports) ownPorts.add(port);
  reportTo = proc;
  report();
}
