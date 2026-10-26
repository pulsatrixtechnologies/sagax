// The phone's Bot Computer screen (iOS parity, 21) through one set of routes,
// whatever the computer is:
//
//   GET  /api/computer/status  -> { kind: "org-sandbox" | "local", configured, state,
//                                   diskState: "normal" | "almostFull" | "full",
//                                   workspaceBytes, limitBytes?, version?, problem?,
//                                   waking?: { since, elapsedMs } }
//   POST /api/computer/update  -> the same, after the update
//   POST /api/computer/reset   { confirm: true } -> the same, after the reset
//
// Organization server: the signed-in person's own server environment
// (user-sandbox): update rebuilds it from the current image and keeps
// /workspace (POST /api/me/server-environment/update), reset erases it
// (.../reset). Personal server: this computer's Local VM container, its
// owner only: update pulls the current image (POST /api/local-computer/pull),
// reset removes the container and creates it again from that image (the
// workspace folder on this computer is kept either way).
import { UserSandboxUnavailable, type UserSandboxView } from "../user-sandbox-manager.ts";
import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export type DiskState = "normal" | "almostFull" | "full";

export interface ComputerStatus {
  kind: "org-sandbox" | "local";
  configured: boolean;
  state: string;
  diskState: DiskState;
  workspaceBytes: number | null;
  limitBytes?: number;
  version?: string;
  problem?: string;
  /** The environments' cluster is waking (it was stopped outside office
   * hours): the screen says "starting" with a quiet hint, not an error. */
  waking?: { since: number; elapsedMs: number };
}

const GiB = 1024 ** 3;

/** Against a quota: full at or over it, almost full from 90%. */
export function diskStateForQuota(used: number | null, limit: number | null | undefined, overQuota = false): DiskState {
  if (overQuota) return "full";
  if (used === null || !limit || limit <= 0) return "normal";
  const ratio = used / limit;
  return ratio >= 1 ? "full" : ratio >= 0.9 ? "almostFull" : "normal";
}

/** Against the disk itself: full under 1 GiB free, almost full under 10%
 * of the disk or 5 GiB, whichever is larger. */
export function diskStateForFree(freeBytes: number | null, totalBytes: number | null): DiskState {
  if (freeBytes === null) return "normal";
  if (freeBytes < GiB) return "full";
  return freeBytes < Math.max(5 * GiB, (totalBytes ?? 0) * 0.1) ? "almostFull" : "normal";
}

export interface SandboxLike {
  status(principalId: string): Promise<UserSandboxView>;
  update(principalId: string): Promise<UserSandboxView>;
  reset(principalId: string): Promise<UserSandboxView>;
}

export interface LocalComputerLike {
  status(): Promise<Omit<ComputerStatus, "kind">>;
  update(): Promise<Omit<ComputerStatus, "kind">>;
  reset(): Promise<Omit<ComputerStatus, "kind">>;
}

export interface ComputerStatusRouteDeps {
  organization: () => boolean;
  sandbox: () => SandboxLike | null;
  local: LocalComputerLike;
  /** The owner of this computer: loopback (the paired phone included) or an admin session. */
  mayManageLocal: (auth: RequestAuth) => boolean;
  /** One update at a time per computer, never under a working bot
   * (MaintenanceScheduler claim/release/busy, keys as computerCareKey). */
  updateGuard?: {
    claim(key: string): boolean;
    release(key: string): void;
    busy(key: string): Promise<boolean>;
  };
}

export function sandboxStatus(view: UserSandboxView): ComputerStatus {
  const limitBytes = view.limits ? view.limits.diskMb * 1024 * 1024 : undefined;
  return {
    kind: "org-sandbox",
    configured: true,
    state: view.state,
    diskState: diskStateForQuota(view.workspaceBytes, limitBytes, view.overQuota),
    workspaceBytes: view.workspaceBytes,
    ...(limitBytes ? { limitBytes } : {}),
    ...(view.error ? { problem: view.error } : {}),
    ...(view.waking ? { waking: { since: view.waking.since, elapsedMs: view.waking.elapsedMs } } : {}),
  };
}

const PATHS = new Set(["/api/computer/status", "/api/computer/update", "/api/computer/reset"]);

export function createComputerStatusRoutes(deps: ComputerStatusRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (!PATHS.has(path)) return PASS;
    const action = path.slice("/api/computer/".length) as "status" | "update" | "reset";
    const expected = action === "status" ? "GET" : "POST";
    if (method !== expected) return json(res, 405, { error: `${expected} only` });
    res.setHeader("cache-control", "no-store");
    if (action !== "status" && !/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) {
      return json(res, 415, { error: "content-type must be application/json" });
    }
    if (action === "reset") {
      const body = await readBody(req) as Record<string, unknown> | null;
      if (body?.confirm !== true) return json(res, 400, { error: "Confirm the reset ({ confirm: true }).", code: "confirm" });
    }

    let held: string | null = null;
    try {
      if (deps.organization()) {
        const principalId = auth.kind === "session" ? auth.session.principalId?.trim() : undefined;
        if (!principalId) return json(res, 403, { error: "Sign in with Pulsatrix to use a server environment.", code: "identity_perspicax" });
        const manager = deps.sandbox();
        if (!manager) {
          if (action === "status") return json(res, 200, { kind: "org-sandbox", configured: false, state: "unavailable", diskState: "normal", workspaceBytes: null } satisfies ComputerStatus);
          return json(res, 409, { error: "This server has no server environments.", code: "not_configured" });
        }
        if (action !== "status") {
          const refused = await hold(`person:${principalId}`);
          if (refused) return json(res, 409, refused);
        }
        const view = action === "status" ? await manager.status(principalId) : action === "update" ? await manager.update(principalId) : await manager.reset(principalId);
        return json(res, 200, sandboxStatus(view));
      }
      if (!deps.mayManageLocal(auth)) return json(res, 403, { error: "forbidden: only this computer's owner can manage its computer" });
      if (action !== "status") {
        const refused = await hold("local");
        if (refused) return json(res, 409, refused);
      }
      const local = action === "status" ? await deps.local.status() : action === "update" ? await deps.local.update() : await deps.local.reset();
      return json(res, 200, { kind: "local", ...local } satisfies ComputerStatus);
    } catch (error) {
      if (error instanceof UserSandboxUnavailable) return json(res, 409, { error: error.message, code: error.code });
      const status = (error as { status?: unknown })?.status;
      const code = (error as { code?: unknown })?.code;
      if (typeof status === "number" && status >= 400 && status < 500) {
        return json(res, status, { error: error instanceof Error ? error.message : String(error), ...(typeof code === "string" ? { code } : {}) });
      }
      return json(res, 502, { error: `The computer could not be ${action === "status" ? "read" : action === "update" ? "updated" : "reset"}.`, code: "unavailable" });
    } finally {
      if (held) deps.updateGuard?.release(held);
    }

    /** Take the computer for this update or reset, or say why not. An
     * update also waits for no bot to be working on it (it would end the
     * bot's task); a reset was confirmed and is not held back by that. */
    async function hold(key: string): Promise<{ error: string; code: string } | null> {
      const guard = deps.updateGuard;
      if (!guard) return null;
      if (!guard.claim(key)) return { error: "The computer is already being updated. Try again when it is done.", code: "computer_updating" };
      held = key;
      if (action === "update" && await guard.busy(key)) {
        guard.release(key);
        held = null;
        return { error: "A bot is working on the computer. Try again when it is done.", code: "computer_busy" };
      }
      return null;
    }
  };
}
