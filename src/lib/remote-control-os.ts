import type { RemoteSessionOs } from "../../shared/remote-session";

/** OSes where live control is offered. Windows only for now; the server's
 * control manager is the authority and refuses the rest, but the UI uses this
 * to show the toggle (and the view-only note otherwise). Keep in step with
 * server/remote-control-helper.ts controlSupported. */
export function controlSupportedOs(os: RemoteSessionOs): boolean {
  return os === "windows";
}
