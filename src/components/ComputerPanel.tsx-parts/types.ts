import { z } from "zod";

export interface VpsComputerStatus {
  configured: boolean;
  imageMatches: boolean;
  managed: boolean;
  container: "running" | "stopped" | "missing";
  ready: boolean;
  problem: string | null;
}

export type Phase =
  | "checking"
  | "unconfigured"
  | "starting"
  | "busy-boat"
  | "ready"
  | "vm"
  | "vm-unavailable"
  | "vps-unconfigured"
  | "vps-incompatible"
  | "vps-stopped"
  | "local"
  | "local-unavailable"
  | "auto-unavailable"
  | "team-boat"
  | "show-ready-boat"
  | "show-sleeping-boat"
  | "show-pending-boat"
  | "cloud-new"
  | "cloud-asleep"
  | "browser"
  | "off"
  | "error";

export interface LocalVmStatus {
  /** Optional: a hosted server can lag behind this app. */
  resumable?: boolean;
  stop_reason?: "idle" | null;
  mode: "shared" | "per-bot" | "pool";
  max_instances: number;
  image: boolean;
  create_supported: boolean;
  container: "running" | "stopped" | "missing";
  imageMatches: boolean;
  managed: boolean;
  network: "loopback" | "unsafe" | "unknown";
  security: "hardened" | "unsafe" | "unknown";
  persistence: "durable" | "unsafe" | "unknown";
  desktopReady: boolean;
  ready: boolean;
  problem: string | null;
  viewer_url: string;
}

export type ComputerPending =
  | "join"
  | "sleep"
  | "provision"
  | "vps-replace"
  | "vm-start"
  | "vm-create"
  | "vm-recreate"
  | "vm-delete"
  | null;

export const computerControlSnapshotSchema = z.object({
  held: z.boolean().optional().default(false),
  helpReason: z.string().nullable().optional().default(null),
}).passthrough();

export const PANEL_WIDTH_KEY = "omb-settings-panel-width";
export const PANEL_MIN_WIDTH = 320;
export const PANEL_MAX_WIDTH = 720;
export const PANEL_DEFAULT_WIDTH = 420;
export const PANEL_RESIZE_STEP = 40;

export function readPanelWidth(): number {
  try {
    const stored = Number(localStorage.getItem(PANEL_WIDTH_KEY));
    if (Number.isFinite(stored) && stored >= PANEL_MIN_WIDTH && stored <= PANEL_MAX_WIDTH) return stored;
  } catch {
    /* storage blocked — default width */
  }
  return PANEL_DEFAULT_WIDTH;
}
