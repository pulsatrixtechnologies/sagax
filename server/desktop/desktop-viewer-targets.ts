import type { ContainerComputerStatus, LocalVmTarget } from "../computer/container-computer.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { desktopViewerUrl, type DesktopTarget } from "../routes/desktop-viewer.ts";
import type { UserSandboxManager } from "../sandbox/user-sandbox-manager.ts";
import { UserSandboxUnavailable } from "../sandbox/user-sandbox-manager.ts";

export const viewerTargetId = (target: { key: string }) => `local/${target.key.replace(":", "-")}`;

/** Native owner windows keep the existing direct viewer and cookie isolation. */
export function localVmViewerStatus<T extends { target_key: string; viewer_url: string }>(status: T, auth: RequestAuth): T {
  return auth.kind === "loopback" ? status : {
    ...status,
    viewer_url: status.viewer_url ? desktopViewerUrl(viewerTargetId({ key: status.target_key })) : "",
  };
}

export function localDesktopTarget(target: LocalVmTarget, deps: {
  status: (target: LocalVmTarget) => Promise<ContainerComputerStatus>;
  touch: (target: LocalVmTarget) => void;
}): DesktopTarget {
  return {
    key: target.key,
    async resolve() {
      const status = await deps.status(target);
      if (!status.managed || !status.imageMatches || status.network !== "loopback" || status.container !== "running"
        || !status.viewer_url) {
        throw Object.assign(new Error("Local VM unavailable"), { status: 409 });
      }
      return {
        port: status.viewer_port ?? 0,
        password: new URLSearchParams(new URL(status.viewer_url).hash.slice(1)).get("password"),
        touch: () => deps.touch(target),
      };
    },
  };
}

const unavailable = (error: unknown) => {
  const code = error instanceof UserSandboxUnavailable ? error.code : "";
  const status = code === "person_out" ? 403 : code === "not_running" || code === "paused" || code === "outdated" ? 409 : code === "capacity" || code === "busy" ? 429 : 502;
  return Object.assign(new Error("Server environment desktop unavailable"), { status, code });
};

/** The signed-in person's own server environment desktop (organization
 * mode). Only that person's session opens it; the target is built from the
 * caller's principal, so no request can name someone else's. Opening the
 * view (config) starts the environment and its desktop and sets fresh VNC
 * passwords: the view-only one unless the person took control. The
 * WebSocket never starts anything: a stopped environment closes the view. */
export function sandboxDesktopTarget(
  manager: Pick<UserSandboxManager, "openDesktop" | "desktopStream" | "pendingDeletionAt">,
  principalId: string,
  /** The person took control: bots' computer use there is refused while a
   * control view stays open (returns the release). */
  holdControl: (principalId: string) => () => void = () => () => {},
): DesktopTarget {
  const present = () => manager.pendingDeletionAt(principalId) === null;
  return {
    key: `sandbox:${principalId}`,
    allows: (auth) => auth.kind === "session" && auth.session.principalId?.trim() === principalId,
    async resolve({ upgrade, control }) {
      if (!present()) throw Object.assign(new Error("signed out"), { status: 403 });
      const stream = async () => {
        const duplex = await manager.desktopStream(principalId, { control }).catch((error: unknown) => { throw unavailable(error); });
        if (control) duplex.once("close", holdControl(principalId));
        return duplex;
      };
      if (upgrade) return { port: 0, password: null, live: present, stream };
      let passwords: { full: string; view: string };
      try { passwords = await manager.openDesktop(principalId); } catch (error) { throw unavailable(error); }
      return { port: 0, stream, password: control ? passwords.full : passwords.view, viewOnly: !control, live: present };
    },
  };
}
