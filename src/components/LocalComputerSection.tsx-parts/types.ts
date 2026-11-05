/** Shared types for LocalComputerSection and its parts. */

/** The automatic Local VM care's state, as the desktop app's own server
 * reports it (a mirror of server/computer/local-vm-auto.ts's LocalVmAutoSnapshot). */
export interface LocalVmAutoState {
  phase: "idle" | "checking" | "starting" | "running" | "stopped" | "waiting" | "problem";
  step: "runtime" | "image" | "container" | "start" | null;
  problem: "no_runtime" | "runtime_stopped" | "foreign" | "unsupported" | "image_failed" | "start_failed" | null;
  detail: string | null;
  attempts: number;
  nextRetryAt: number | null;
  stoppedByPerson: boolean;
}

export type Action = "pull" | "run" | "start" | "stop" | "remove" | "recreate";

export interface Status {
  platform: string;
  runtime: string | null;
  available: string[];
  daemonUp: boolean;
  image: boolean;
  imageMatches: boolean;
  managed: boolean;
  container: "running" | "stopped" | "missing";
  network: "loopback" | "unsafe" | "unknown";
  security: "hardened" | "unsafe" | "unknown";
  persistence: "durable" | "unsafe" | "unknown";
  desktopReady: boolean;
  ready: boolean;
  problem: string | null;
  image_ref: string;
  base_image_ref: string;
  driver_version: string;
  container_name: string;
  workspace_path: string;
  workspace_guest_path: string;
  viewer_url: string;
  idle_timeout_ms: number;
  stop_reason?: "idle" | null;
  mode: "shared" | "per-bot" | "pool";
  /** An organization server: one environment per person, no VM per bot. */
  organization?: boolean;
  max_instances: number;
  /** The automatic care's state (null on an organization or self-hosted
   * server, where nothing starts the Local VM by itself). */
  auto: LocalVmAutoState | null;
  commands: {
    install: string | null;
    runtimeStart: string | null;
    pull: string | null;
    run: string | null;
    start: string | null;
    stop: string | null;
    remove: string | null;
    view: string;
  };
}

export interface LocalVmInventoryInstance {
  botId: string;
  name: string;
  destination: "auto" | "cloud" | "vm" | "local" | "browser" | "off";
  container: "running" | "stopped";
  ready: boolean;
  managed: boolean;
  problem: string | null;
  inUse: boolean;
}

export interface LocalVmInventoryPayload {
  instances: LocalVmInventoryInstance[];
  maxInstances: number;
  available: boolean;
  problem: string | null;
}

export interface CloudComputerInventoryInstance {
  boxId: string;
  name: string;
  state: string;
  ownerBotId: string | null;
  ownerName: string | null;
  orphaned: boolean;
  inUse: boolean;
}

export interface CloudComputerInventoryPayload {
  configured: boolean;
  available: boolean;
  problem: string | null;
  instances: CloudComputerInventoryInstance[];
}

export type CloudAction = "sleep" | "delete";
export type PendingCloudAction = { boxId: string; action: CloudAction } | null;
export type CloudPostActionOverride = "deleted" | "deleting" | "sleeping";
export type CloudPostActionOverrides = Record<string, CloudPostActionOverride>;

export interface VpsComputerInventoryInstance {
  name: string;
  state: "created" | "restarting" | "running" | "removing" | "paused" | "exited" | "dead" | "unknown";
  ownerBotId: string | null;
  ownerName: string | null;
  orphaned: boolean;
  inUse: boolean;
}

export interface VpsComputerInventoryPayload {
  configured: boolean;
  available: boolean;
  sshAlias: string | null;
  problem: string | null;
  instances: VpsComputerInventoryInstance[];
}

export type ComputerInventoryRequest = "status" | "local-vms" | "cloud" | "vps";
export type ComputerApiRequest = [url: string, init: RequestInit];
export interface ComputerActionPlan {
  confirmation: string | null;
  request: ComputerApiRequest;
}

/** The badge's colour is decided by the kind, never by the label: a
 * translated label would silently stop matching `=== "Running"`. */
export type ComputerStateKind =
  | "unmanaged"
  | "in-use"
  | "stopped"
  | "running"
  | "attention"
  | "sleeping"
  | "going-to-sleep"
  | "starting"
  | "restarting"
  | "removing"
  | "paused";
