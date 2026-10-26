// Settings > Organization > Your server environment: the signed-in person's
// own isolated Linux environment on the server, shared by all their bots
// (server/user-sandbox-routes.ts).
import { api, ApiError } from "@/state/store";

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

/** "1.2 GiB" style, for the usage panel. */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return "?";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
  return `${Math.round(bytes / 1024 ** 2)} MiB`;
}
