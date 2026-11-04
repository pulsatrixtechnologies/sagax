import type { FleetInput } from "../fleet/fleet-cli.ts";
export interface CliOptions {
  /** No --data-dir and no SAGAX_DATA_DIR (or OMB_DATA_DIR): ~/.sagax (or an old ~/.openmausbot). */
  dataDirIsDefault?: boolean;
  command: "setup" | "start" | "serve" | "pair" | "sessions" | "status" | "login" | "logout" | "access" | "service" | "browser" | "fleet" | "backup" | "restore" | "team" | "task" | "help";
  port: number;
  dataDir: string;
  label?: string;
  publicUrl?: string;
  /** `serve --domain host`: HTTPS on your own domain through a managed Caddy. */
  domain?: string;
  tailscale: boolean;
  tunnel: boolean;
  client: boolean;
  pair: boolean;
  revoke?: string;
  /** `access list|add|remove` */
  accessAction?: "list" | "add" | "remove";
  chatOnly?: boolean;
  /** `service install|uninstall` */
  serviceAction?: "install" | "uninstall";
  email?: string;
  /** `browser install [--with-deps]` */
  browserAction?: "install" | "status";
  /** `fleet init|create|list|users|suspend|resume|delete|upgrade|agent` */
  fleetAction?: FleetInput["action"] | "agent";
  operator?: string;
  socket?: string;
  group?: string;
  slug?: string;
  admins?: string[];
  members?: string[];
  brandFile?: string;
  anthropicKeyFile?: string;
  cap?: number;
  memory?: string;
  dryRun?: boolean;
  yes?: boolean;
  keepData?: boolean;
  /** fleet upgrade --to: the exact release to install. */
  fleetVersion?: string;
  fleetUserAction?: "add" | "remove";
  withDeps?: boolean;
  json: boolean;
  /** Explicitly ignore saved remote access for this launch. */
  local?: boolean;
  open?: boolean;
  /** Internal guided-start presentation; serve remains script-friendly. */
  guided?: boolean;
  phone?: "ios" | "android";
  /** backup --output, or the archive named by restore. */
  archive?: string;
  /** restore --verify: check hashes, write nothing. */
  verify?: boolean;
  /** restore --apply: the only flag that writes the archive over the data folder. */
  apply?: boolean;
  /** `team apply FILE` */
  teamAction?: "apply";
  teamFile?: string;
  /** `task give` or `task wait` */
  taskAction?: "give" | "wait";
  taskBot?: string;
  taskText?: string;
  taskId?: string;
  timeoutSec?: number;
}
