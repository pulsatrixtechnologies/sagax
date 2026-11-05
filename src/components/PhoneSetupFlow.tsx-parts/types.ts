import type {
  CompanionEndpoint,
  CompanionPairingRoutePin,
  CompanionPairingRouteMode,
} from "../../lib/companion-pairing";
import type { PhoneSetupPhase } from "../../lib/phone-setup";
import type { CompanionAccountState } from "../../types/ogb";

export interface PhoneDevice {
  id: string;
  name: string;
  createdAt: number;
  lastSeenAt: number;
  cloudDesktopAccess: boolean;
  /** Absent on older sidecars means no browser access. */
  browserControlAccess?: boolean;
}

export interface CompanionState {
  enabled: boolean;
  keepAwake: boolean;
  port: number;
  devices: PhoneDevice[];
  connectedDeviceIds?: string[];
  pairing: { code: string; token: string; expiresAt: number } | null;
  addresses?: string[];
  tailscale?: string;
  tailnetName?: string;
  lan?: string | null;
  hosts?: string[];
  endpoints?: CompanionEndpoint[];
  secretPublicKey?: string;
  discovery?: { advertising: boolean; name: string };
  /** The Windows adapter the Wi-Fi QR's address is on ("Wi-Fi"), present
   * while a pairing window is open and Windows has that network down as
   * Public, where its firewall drops a phone's connection
   * (companion/src/windows-network.ts). */
  publicNetwork?: string;
  error?: string;
}

export type CompanionBridge = {
  state: () => Promise<CompanionState>;
  start: () => Promise<CompanionState>;
  stop: () => Promise<CompanionState>;
  keepAwake: (enabled: boolean) => Promise<CompanionState>;
  refreshTailscale: () => Promise<CompanionState>;
  pairing: (open: boolean, expectedToken?: string) => Promise<CompanionState>;
  cloudDesktop: (deviceId: string, allowed: boolean) => Promise<CompanionState>;
  browserControl: (deviceId: string, allowed: boolean) => Promise<CompanionState>;
  revoke: (deviceId: string) => Promise<CompanionState>;
};

export type AccountBridge = NonNullable<NonNullable<Window["ogb"]>["companionAccount"]>;
export type StateBridge<T> = { state: () => Promise<T> };

export interface OwnedCompanionPairingRoutePin extends CompanionPairingRoutePin {
  generation: number;
  token: string;
}

export interface PhonePairingRequest {
  routeMode: CompanionPairingRouteMode;
  accountOverride?: CompanionAccountState | null;
  generation: number;
}

export interface CompanionStateMutationEpoch {
  current: number;
}

export interface PhoneSetupController {
  state: CompanionState | null;
  account: CompanionAccountState | null;
  phase: PhoneSetupPhase;
  email: string;
  code: string;
  codeSent: boolean;
  busy: boolean;
  accountBusy: boolean;
  error: string | null;
  accountError: string | null;
  pairingLink: string | null;
  secondsLeft: number;
  address: string | undefined;
  pairingPort: number;
  /** What to type on the phone: `https://host` for hosted, `host:port` otherwise. */
  addressText: string | undefined;
  hostedReady: boolean;
  localFallback: boolean;
  tailscaleFallback: boolean;
  tailscaleAvailable: boolean;
  pairingExpired: boolean;
  setupTimedOut: boolean;
  setEmail: (email: string) => void;
  setCode: (code: string) => void;
  changeEmail: () => void;
  start: () => void;
  useLocal: () => void;
  useTailscale: () => void;
  refreshTailscale: () => void;
  requestCode: () => void;
  verifyCode: () => void;
  retryAccount: () => void;
  cancel: () => void;
  refreshCode: () => void;
  finish: () => void;
  skip: () => void;
  act: (call: (companion: CompanionBridge) => Promise<CompanionState>) => Promise<void>;
  accountAct: (call: (remote: AccountBridge) => Promise<CompanionAccountState>) => Promise<void>;
}
