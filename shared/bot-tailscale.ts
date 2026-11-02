// Bot computer Tailscale join (Connect apps > Tailscale). The person's
// own bot computer joins their private tailnet after a tailnet admin
// approves the device. Credentials stay sealed; answers never carry them.
// Pure types and helpers shared by the server, the desktop UI and iOS.

/** Tag every Sagax bot computer advertises on the person's tailnet. */
export const SAGAX_TAILSCALE_TAG = "tag:sagax";

/** How the person stored Tailscale credentials (never the secret itself). */
export type BotTailscaleCredKind = "authKey" | "oauth";

/** Auth key flavour minted or pasted for a join. */
export type BotTailscaleKeyKind = "ephemeral" | "reusable";

/**
 * Public connection state for one person. Secrets never appear here.
 * Flow: disconnected → setup (credentials present) → joining / pending →
 * connected, or error.
 */
export type BotTailscalePhase =
  | "disconnected"
  | "ready"
  | "joining"
  | "pending_approval"
  | "connected"
  | "error";

export interface BotTailscaleComputerOption {
  /** Opaque id the server understands (sandbox principal, cloud box, desktop). */
  id: string;
  /** Name people read (bot or computer name). Never a UUID alone. */
  label: string;
  /** Where it runs, for the subtitle. */
  place: "sandbox" | "cloud" | "desktop" | "other";
}

export interface BotTailscaleDeviceView {
  /** Hostname on the tailnet (MagicDNS short name when present). */
  name: string;
  /** Tailnet IPv4 / IPv6 addresses the device holds. */
  addresses: string[];
  /** True while the tailnet still waits for an admin to approve it. */
  pendingApproval: boolean;
  /** Tailscale node id when known (never shown as the primary label). */
  nodeId?: string;
}

export interface BotTailscaleCredentialView {
  kind: BotTailscaleCredKind;
  /** Redacted hint (last 4 of an auth key, or OAuth client id prefix). */
  hint: string;
  /** Tags the OAuth client may mint, when kind is oauth. */
  tags: string[];
}

export interface BotTailscaleView {
  phase: BotTailscalePhase;
  /** Credentials are stored (sealed). Absent: the person still has to set them up. */
  credentials: BotTailscaleCredentialView | null;
  /** Computer chosen for the current or last join. */
  computer: BotTailscaleComputerOption | null;
  /** Key kind used for the current or last join. */
  keyKind: BotTailscaleKeyKind | null;
  /** Device on the tailnet when joining, pending or connected. */
  device: BotTailscaleDeviceView | null;
  /** Short error the person can act on. Absent when none. */
  error: string | null;
  /** Computers this person may join. */
  computers: BotTailscaleComputerOption[];
}

export interface BotTailscaleSetupInput {
  mode: BotTailscaleCredKind;
  /** Pasted auth key (tskey-auth-…). Required when mode is authKey. */
  authKey?: string;
  /** OAuth client id. Required when mode is oauth. */
  clientId?: string;
  /** OAuth client secret. Required when mode is oauth. */
  clientSecret?: string;
  /** Tags the OAuth client may assign. Defaults to [SAGAX_TAILSCALE_TAG]. */
  tags?: string[];
}

export interface BotTailscaleJoinInput {
  computerId: string;
  keyKind?: BotTailscaleKeyKind;
  /** Hostname advertised on the tailnet. Defaults from the computer label. */
  hostname?: string;
}

/** Empty public view before any setup. */
export function emptyBotTailscaleView(
  computers: readonly BotTailscaleComputerOption[] = [],
): BotTailscaleView {
  return {
    phase: "disconnected",
    credentials: null,
    computer: null,
    keyKind: null,
    device: null,
    error: null,
    computers: [...computers],
  };
}

/** Auth keys Tailscale issues start with this prefix. */
export const AUTH_KEY_PREFIX = "tskey-auth-";

export function looksLikeAuthKey(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith(AUTH_KEY_PREFIX) && trimmed.length >= AUTH_KEY_PREFIX.length + 8;
}

/** Last four characters for a redacted hint. Never the whole secret. */
export function secretHint(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 4) return "saved";
  return trimmed.slice(-4);
}

/** Sanitize a hostname for Tailscale (letters, digits, hyphens). */
export function tailscaleHostname(label: string, fallback = "sagax-bot"): string {
  const cleaned = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
  return cleaned || fallback;
}

/** Phase after a device status poll. */
export function phaseFromDevice(
  device: BotTailscaleDeviceView | null,
  hasCredentials: boolean,
): BotTailscalePhase {
  if (!hasCredentials) return "disconnected";
  if (!device) return "ready";
  if (device.pendingApproval) return "pending_approval";
  return "connected";
}
