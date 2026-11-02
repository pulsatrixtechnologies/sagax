// Tailscale control API used to mint auth keys and read device approval.
// Production talks to api.tailscale.com. Tests inject FakeTailscaleControl.
// Answers never log secrets (auth keys, OAuth client secrets, tokens).
import { SAGAX_TAILSCALE_TAG, type BotTailscaleKeyKind } from "../shared/bot-tailscale.ts";

export interface TailscaleOAuthClient {
  clientId: string;
  clientSecret: string;
}

export interface CreateAuthKeyInput {
  /** OAuth access token, or a personal API access token. */
  accessToken: string;
  /** Tailnet id ("example.com" or organization id). "-" = default for the token. */
  tailnet?: string;
  keyKind: BotTailscaleKeyKind;
  tags: readonly string[];
  /** When true the key still needs a tailnet admin to approve the device. */
  requireApproval?: boolean;
  description?: string;
  expirySeconds?: number;
}

export interface TailscaleAuthKeyResult {
  id: string;
  /** The one-time or reusable auth key. Caller must not log it. */
  key: string;
  ephemeral: boolean;
  reusable: boolean;
  tags: string[];
}

export interface TailscaleControlDevice {
  id: string;
  name: string;
  hostName: string;
  addresses: string[];
  /** True while waiting for a tailnet admin to approve. */
  pendingApproval: boolean;
  tags: string[];
  /** Node key / machine id when present. */
  nodeId?: string;
}

export interface TailscaleControlApi {
  exchangeOAuth(client: TailscaleOAuthClient): Promise<{ accessToken: string; expiresIn: number }>;
  createAuthKey(input: CreateAuthKeyInput): Promise<TailscaleAuthKeyResult>;
  listDevices(accessToken: string, tailnet?: string): Promise<TailscaleControlDevice[]>;
  deleteDevice(accessToken: string, deviceId: string, tailnet?: string): Promise<void>;
}

export class TailscaleControlError extends Error {
  readonly code:
    | "oauth_failed"
    | "auth_key_failed"
    | "list_failed"
    | "delete_failed"
    | "bad_response"
    | "network";
  readonly status?: number;

  constructor(
    message: string,
    code:
      | "oauth_failed"
      | "auth_key_failed"
      | "list_failed"
      | "delete_failed"
      | "bad_response"
      | "network",
    status?: number,
  ) {
    super(message);
    this.name = "TailscaleControlError";
    this.code = code;
    this.status = status;
  }
}

const DEFAULT_API = "https://api.tailscale.com";

export interface HttpTailscaleControlOptions {
  /** Override the API origin (tests). */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

/** Live Tailscale API client. Never logs response bodies that may hold keys. */
export function createHttpTailscaleControl(options: HttpTailscaleControlOptions = {}): TailscaleControlApi {
  const base = (options.baseUrl ?? DEFAULT_API).replace(/\/$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;

  async function readJson(res: Response): Promise<Record<string, unknown>> {
    const text = await res.text();
    if (!text) return {};
    try {
      const parsed = JSON.parse(text) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      throw new TailscaleControlError("Tailscale returned a non-JSON answer.", "bad_response", res.status);
    }
  }

  return {
    async exchangeOAuth(client) {
      const body = new URLSearchParams({
        client_id: client.clientId,
        client_secret: client.clientSecret,
        grant_type: "client_credentials",
      });
      let res: Response;
      try {
        res = await fetchImpl(`${base}/api/v2/oauth/token`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
          body,
        });
      } catch {
        throw new TailscaleControlError("Could not reach Tailscale to sign in the OAuth client.", "network");
      }
      const json = await readJson(res);
      if (!res.ok || typeof json.access_token !== "string" || !json.access_token) {
        throw new TailscaleControlError("Tailscale refused the OAuth client.", "oauth_failed", res.status);
      }
      const expiresIn = typeof json.expires_in === "number" ? json.expires_in : 3600;
      return { accessToken: json.access_token, expiresIn };
    },

    async createAuthKey(input) {
      const tailnet = encodeURIComponent(input.tailnet?.trim() || "-");
      const payload = {
        capabilities: {
          devices: {
            create: {
              reusable: input.keyKind === "reusable",
              ephemeral: input.keyKind === "ephemeral",
              preauthorized: input.requireApproval === false,
              tags: [...input.tags],
            },
          },
        },
        expirySeconds: input.expirySeconds ?? 86_400,
        description: input.description ?? "Sagax bot computer",
      };
      let res: Response;
      try {
        res = await fetchImpl(`${base}/api/v2/tailnet/${tailnet}/keys`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${input.accessToken}`,
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify(payload),
        });
      } catch {
        throw new TailscaleControlError("Could not reach Tailscale to mint an auth key.", "network");
      }
      const json = await readJson(res);
      if (!res.ok || typeof json.key !== "string" || !json.key) {
        throw new TailscaleControlError("Tailscale refused to mint an auth key.", "auth_key_failed", res.status);
      }
      const caps = (json.capabilities as { devices?: { create?: Record<string, unknown> } } | undefined)?.devices?.create;
      return {
        id: typeof json.id === "string" ? json.id : "",
        key: json.key,
        ephemeral: Boolean(caps?.ephemeral ?? input.keyKind === "ephemeral"),
        reusable: Boolean(caps?.reusable ?? input.keyKind === "reusable"),
        tags: Array.isArray(caps?.tags) ? caps!.tags.filter((t): t is string => typeof t === "string") : [...input.tags],
      };
    },

    async listDevices(accessToken, tailnet) {
      const id = encodeURIComponent(tailnet?.trim() || "-");
      let res: Response;
      try {
        res = await fetchImpl(`${base}/api/v2/tailnet/${id}/devices`, {
          headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
        });
      } catch {
        throw new TailscaleControlError("Could not reach Tailscale to list devices.", "network");
      }
      const json = await readJson(res);
      if (!res.ok) {
        throw new TailscaleControlError("Tailscale refused to list devices.", "list_failed", res.status);
      }
      const devices = Array.isArray(json.devices) ? json.devices : [];
      return devices.map(parseDevice).filter((d): d is TailscaleControlDevice => Boolean(d));
    },

    async deleteDevice(accessToken, deviceId, tailnet) {
      const id = encodeURIComponent(tailnet?.trim() || "-");
      const device = encodeURIComponent(deviceId);
      let res: Response;
      try {
        res = await fetchImpl(`${base}/api/v2/tailnet/${id}/devices/${device}`, {
          method: "DELETE",
          headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
        });
      } catch {
        throw new TailscaleControlError("Could not reach Tailscale to remove the device.", "network");
      }
      if (!res.ok && res.status !== 404) {
        throw new TailscaleControlError("Tailscale refused to remove the device.", "delete_failed", res.status);
      }
    },
  };
}

function parseDevice(raw: unknown): TailscaleControlDevice | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id : "";
  if (!id) return null;
  const name = typeof row.name === "string" && row.name ? row.name
    : typeof row.hostname === "string" && row.hostname ? row.hostname
      : typeof row.hostName === "string" && row.hostName ? row.hostName
        : "device";
  const hostName = typeof row.hostname === "string" ? row.hostname
    : typeof row.hostName === "string" ? row.hostName
      : name;
  const addresses = Array.isArray(row.addresses)
    ? row.addresses.filter((a): a is string => typeof a === "string" && a.length > 0)
    : [];
  const tags = Array.isArray(row.tags) ? row.tags.filter((t): t is string => typeof t === "string") : [];
  const pendingApproval = Boolean(row.authorized === false || row.pending === true || row.isExternal === true && row.authorized === false);
  // Tailscale marks unauthorized devices with authorized: false.
  const authorized = row.authorized;
  const pending = typeof authorized === "boolean" ? !authorized : pendingApproval;
  return {
    id,
    name,
    hostName,
    addresses,
    pendingApproval: pending,
    tags,
    nodeId: typeof row.nodeId === "string" ? row.nodeId : typeof row.nodeKey === "string" ? row.nodeKey : undefined,
  };
}

/** In-memory control API for unit tests. */
export class FakeTailscaleControl implements TailscaleControlApi {
  tokens = new Map<string, { clientId: string }>();
  keys: Array<TailscaleAuthKeyResult & { accessToken: string; requireApproval: boolean }> = [];
  devices: TailscaleControlDevice[] = [];
  /** When set, the next createAuthKey fails with this. */
  failCreate: TailscaleControlError | null = null;
  failOAuth: TailscaleControlError | null = null;
  /** Autoincrement for synthetic ids. */
  private seq = 0;

  async exchangeOAuth(client: TailscaleOAuthClient) {
    if (this.failOAuth) throw this.failOAuth;
    if (!client.clientId.trim() || !client.clientSecret.trim()) {
      throw new TailscaleControlError("OAuth client id and secret are required.", "oauth_failed", 400);
    }
    const accessToken = `fake-token-${++this.seq}`;
    this.tokens.set(accessToken, { clientId: client.clientId });
    return { accessToken, expiresIn: 3600 };
  }

  async createAuthKey(input: CreateAuthKeyInput) {
    if (this.failCreate) throw this.failCreate;
    const id = `key-${++this.seq}`;
    const key = `tskey-auth-fake${this.seq}CNTRL`;
    const result: TailscaleAuthKeyResult = {
      id,
      key,
      ephemeral: input.keyKind === "ephemeral",
      reusable: input.keyKind === "reusable",
      tags: [...(input.tags.length ? input.tags : [SAGAX_TAILSCALE_TAG])],
    };
    this.keys.push({ ...result, accessToken: input.accessToken, requireApproval: input.requireApproval !== false });
    return result;
  }

  async listDevices(_accessToken: string, _tailnet?: string) {
    return this.devices.map((d) => ({ ...d, addresses: [...d.addresses], tags: [...d.tags] }));
  }

  async deleteDevice(_accessToken: string, deviceId: string) {
    this.devices = this.devices.filter((d) => d.id !== deviceId);
  }

  /** Test helper: a device appears as pending, then approve() clears it. */
  enrollPending(partial: Partial<TailscaleControlDevice> & { name: string }): TailscaleControlDevice {
    const device: TailscaleControlDevice = {
      id: partial.id ?? `dev-${++this.seq}`,
      name: partial.name,
      hostName: partial.hostName ?? partial.name,
      addresses: partial.addresses ?? [],
      pendingApproval: true,
      tags: partial.tags ?? [SAGAX_TAILSCALE_TAG],
      nodeId: partial.nodeId,
    };
    this.devices.push(device);
    return device;
  }

  approve(deviceId: string, addresses: string[] = ["100.64.0.10"]) {
    const device = this.devices.find((d) => d.id === deviceId);
    if (!device) return;
    device.pendingApproval = false;
    device.addresses = [...addresses];
  }
}
