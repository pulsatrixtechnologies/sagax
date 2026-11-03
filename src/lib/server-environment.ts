// Settings > Organization > Your server environment: the signed-in person's
// own isolated Linux environment on the server, shared by all their bots
// (server/sandbox/user-sandbox-routes.ts).
import { api, ApiError } from "@/state/store";
import { formatPanelBytes as formatBytes } from "../../shared/format-bytes";

export { formatBytes };

export interface ServerEnvironmentStatus {
  configured: boolean;
  state?: "missing" | "stopped" | "running" | "paused" | "unavailable";
  lastUsedAt?: number | null;
  workspaceBytes?: number | null;
  overQuota?: boolean;
  limits?: { memoryMb: number; cpus: number; pids: number; diskMb: number; tmpMb: number } | null;
  idleMinutes?: number | null;
  pendingDeletionAt?: number | null;
  error?: string;
  /** The environments' cluster is waking (it slept while idle):
   * since when on the server, and for how long so far. */
  waking?: { since: number; elapsedMs: number };
  /** The environment's Pod is on its way up (a node being added, the
   * volume attaching, the image pulling): starting, not off. */
  starting?: true;
}

export function loadServerEnvironment(): Promise<ServerEnvironmentStatus> {
  return api<ServerEnvironmentStatus>("/api/me/server-environment");
}

export function resetServerEnvironment(): Promise<ServerEnvironmentStatus> {
  return api<ServerEnvironmentStatus>("/api/me/server-environment/reset", { method: "POST", body: JSON.stringify({ confirm: true }) });
}

export type PowerAction = "start" | "shutdown" | "pause" | "resume";

/** Start, shut down (keeps /workspace), pause or resume the person's own
 * environment. Shutdown and pause under a running turn need `confirm`:
 * without it the server answers "confirm_running" and this returns null. */
export async function powerServerEnvironment(action: PowerAction, confirm = false): Promise<ServerEnvironmentStatus | null> {
  try {
    return await api<ServerEnvironmentStatus>("/api/me/server-environment/power", { method: "POST", body: JSON.stringify({ action, ...(confirm ? { confirm: true } : {}) }) });
  } catch (error) {
    if (error instanceof ApiError && error.status === 409 && error.body?.code === "confirm_running") return null;
    throw error;
  }
}

export interface ServerEnvironmentStats {
  state: "missing" | "stopped" | "running" | "paused";
  cpuPercent: number | null;
  memoryBytes: number | null;
  memoryLimitBytes: number;
  workspaceBytes: number | null;
  workspaceQuotaBytes: number;
  /** The /workspace volume itself (df), when the provisioner measured it. */
  workspaceFreeBytes?: number;
  workspaceTotalBytes?: number;
  os: string | null;
  arch: string | null;
  image: string;
}

export function loadServerEnvironmentStats(signal?: AbortSignal): Promise<ServerEnvironmentStats> {
  return api<ServerEnvironmentStats>("/api/me/server-environment/stats", signal ? { signal } : {});
}

/** What the Computer tab's chip says. */
export type PowerState = "off" | "starting" | "running" | "paused" | "unavailable";

export function powerState(state: ServerEnvironmentStatus["state"] | undefined, pending: PowerAction | null): PowerState {
  if (pending === "start" || pending === "resume") return "starting";
  if (state === "running") return "running";
  if (state === "paused") return "paused";
  if (state === "missing" || state === "stopped") return "off";
  return "unavailable";
}


