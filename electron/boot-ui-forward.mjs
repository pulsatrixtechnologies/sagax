// Boot UI takes over the http scheme while the packaged server loads
// (electron/boot-ui.mjs). Those requests never reach session.webRequest, so
// the desktop owner capability would be missing on the first API calls the
// renderer makes through the forward path (Ubuntu hard-death smoke, #5320).
// Re-apply the same header the webRequest rule adds once http is handed back.

import { DESKTOP_MUTATION_HEADER, desktopServerHeaders } from "./desktop-server-auth.cjs";

/**
 * Forward a boot-ui request to the network with the per-launch owner
 * capability. `fetch` is Electron `net.fetch` (or a fixture).
 */
export function forwardBootUiRequest(request, init, { fetch, token }) {
  const headers = desktopServerHeaders(
    Object.fromEntries(new Headers(request.headers).entries()),
    { packaged: true, token },
  );
  return fetch(new Request(request, { headers }), init);
}

export { DESKTOP_MUTATION_HEADER };
