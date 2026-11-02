// Person-scoped Tailscale connection for bot computers. Credentials are
// sealed with the vault key under the person's directory (or the data dir
// on a solo install) and never returned. Joins run inside the person's
// sandbox only (userspace networking).
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import {
  AUTH_KEY_PREFIX,
  emptyBotTailscaleView,
  looksLikeAuthKey,
  phaseFromDevice,
  SAGAX_TAILSCALE_TAG,
  secretHint,
  tailscaleHostname,
  type BotTailscaleComputerOption,
  type BotTailscaleCredKind,
  type BotTailscaleDeviceView,
  type BotTailscaleJoinInput,
  type BotTailscaleKeyKind,
  type BotTailscaleSetupInput,
  type BotTailscaleView,
} from "../shared/bot-tailscale.ts";
import { writeFileAtomic } from "./atomic.ts";
import {
  FakeTailscaleControl,
  TailscaleControlError,
  createHttpTailscaleControl,
  type TailscaleControlApi,
} from "./bot-tailscale-control.ts";
import {
  joinSandboxTailnet,
  leaveSandboxTailnet,
  readSandboxTailnet,
  type SandboxTailscaleExec,
} from "./bot-tailscale-sandbox.ts";
import { resolveVaultKey, type VaultKeySource } from "./mcp-oauth.ts";

const AAD = Buffer.from("sagax bot-tailscale v1");
const FILE = "bot-tailscale.enc";
const PRINCIPAL = /^[a-z0-9][a-z0-9_.:-]{0,80}$/;

export type BotTailscaleScope = { organization: false } | { organization: true; principalId: string };

export function botTailscaleScope(organization: boolean, principalId: string | null | undefined): BotTailscaleScope | null {
  if (!organization) return { organization: false };
  const id = principalId?.trim().toLowerCase() ?? "";
  return PRINCIPAL.test(id) && !id.includes("..") ? { organization: true, principalId: id } : null;
}

interface StoredCredentials {
  kind: BotTailscaleCredKind;
  /** Auth key plaintext, or empty when oauth. */
  authKey?: string;
  clientId?: string;
  clientSecret?: string;
  tags: string[];
  hint: string;
}

interface StoredJoin {
  computerId: string;
  computerLabel: string;
  computerPlace: BotTailscaleComputerOption["place"];
  keyKind: BotTailscaleKeyKind;
  hostname: string;
  device: BotTailscaleDeviceView | null;
  error: string | null;
  /** Cached OAuth access token (short lived). Never returned. */
  accessToken?: string;
  accessTokenExpiresAt?: number;
}

interface StoredState {
  credentials: StoredCredentials | null;
  join: StoredJoin | null;
}

export class BotTailscaleError extends Error {
  readonly code:
    | "not_setup"
    | "invalid_input"
    | "unknown_computer"
    | "join_failed"
    | "control_failed"
    | "busy";

  constructor(
    message: string,
    code:
      | "not_setup"
      | "invalid_input"
      | "unknown_computer"
      | "join_failed"
      | "control_failed"
      | "busy",
  ) {
    super(message);
    this.name = "BotTailscaleError";
    this.code = code;
  }
}

export interface BotTailscaleServiceOptions {
  dataDir: string;
  keySource?: () => VaultKeySource;
  control?: TailscaleControlApi;
  /** Resolve an exec handle for a computer id the person owns. */
  sandboxExecFor?: (computerId: string, scope: BotTailscaleScope) => Promise<SandboxTailscaleExec | null>;
  /** List computers this person may join. */
  listComputers?: (scope: BotTailscaleScope) => BotTailscaleComputerOption[] | Promise<BotTailscaleComputerOption[]>;
  now?: () => number;
}

function scopeDir(dataDir: string, scope: BotTailscaleScope): string {
  return scope.organization ? join(dataDir, "principals", scope.principalId) : dataDir;
}

function refuseSymlink(path: string): void {
  try {
    if (lstatSync(path).isSymbolicLink()) throw new Error("bot-tailscale store is a link");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function seal(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(AAD);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

function unseal(blob: string, key: Buffer): string {
  const buf = Buffer.from(blob, "base64");
  if (buf.length < 28) throw new Error("bot-tailscale ciphertext too short");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(AAD);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

export class BotTailscaleService {
  private readonly dataDir: string;
  private readonly keySource: () => VaultKeySource;
  private readonly control: TailscaleControlApi;
  private readonly sandboxExecFor: BotTailscaleServiceOptions["sandboxExecFor"];
  private readonly listComputers: BotTailscaleServiceOptions["listComputers"];
  private readonly now: () => number;
  private readonly busy = new Set<string>();

  constructor(
    dataDir: string,
    options: Omit<BotTailscaleServiceOptions, "dataDir"> = {},
  ) {
    this.dataDir = dataDir;
    this.keySource = options.keySource ?? (() => resolveVaultKey(dataDir));
    this.control = options.control ?? createHttpTailscaleControl();
    this.sandboxExecFor = options.sandboxExecFor;
    this.listComputers = options.listComputers;
    this.now = options.now ?? Date.now;
  }

  private scopeKey(scope: BotTailscaleScope): string {
    return scope.organization ? scope.principalId : "local";
  }

  private path(scope: BotTailscaleScope): string {
    return join(scopeDir(this.dataDir, scope), FILE);
  }

  private vaultKey(): Buffer {
    const source = this.keySource();
    if (source.kind !== "key") throw new Error("vault key is not ready");
    return source.key;
  }

  private read(scope: BotTailscaleScope): StoredState {
    const path = this.path(scope);
    refuseSymlink(path);
    try {
      const raw = readFileSync(path, "utf8").trim();
      if (!raw) return { credentials: null, join: null };
      const json = JSON.parse(unseal(raw, this.vaultKey())) as StoredState;
      return {
        credentials: json.credentials ?? null,
        join: json.join ?? null,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { credentials: null, join: null };
      throw error;
    }
  }

  private write(scope: BotTailscaleScope, state: StoredState): void {
    const dir = scopeDir(this.dataDir, scope);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const path = this.path(scope);
    refuseSymlink(path);
    const payload = seal(JSON.stringify(state), this.vaultKey());
    writeFileAtomic(path, `${payload}\n`, { mode: 0o600 });
  }

  private async computers(scope: BotTailscaleScope): Promise<BotTailscaleComputerOption[]> {
    if (!this.listComputers) {
      // Default: the person's own sandbox is always a candidate.
      const id = scope.organization ? `sandbox:${scope.principalId}` : "sandbox:local";
      return [{ id, label: "Bot computer", place: "sandbox" }];
    }
    return this.listComputers(scope);
  }

  async view(scope: BotTailscaleScope): Promise<BotTailscaleView> {
    const computers = await this.computers(scope);
    const state = this.read(scope);
    if (!state.credentials) return emptyBotTailscaleView(computers);
    // Refresh pending devices when we can talk to the sandbox.
    if (state.join && (state.join.device?.pendingApproval || !state.join.device) && this.sandboxExecFor) {
      try {
        const exec = await this.sandboxExecFor(state.join.computerId, scope);
        if (exec) {
          const current = await readSandboxTailnet(exec);
          if (current) {
            state.join.device = current;
            state.join.error = null;
            this.write(scope, state);
          }
        }
      } catch {
        // Keep the last known device; the person can retry.
      }
    }
    return this.viewSync(scope, state, computers);
  }

  async setup(scope: BotTailscaleScope, input: BotTailscaleSetupInput): Promise<BotTailscaleView> {
    const tags = normalizeTags(input.tags);
    const computers = await this.computers(scope);
    if (input.mode === "authKey") {
      const authKey = input.authKey?.trim() ?? "";
      if (!looksLikeAuthKey(authKey)) {
        throw new BotTailscaleError(
          `Paste an auth key that starts with ${AUTH_KEY_PREFIX}.`,
          "invalid_input",
        );
      }
      const state = this.read(scope);
      state.credentials = {
        kind: "authKey",
        authKey,
        tags,
        hint: secretHint(authKey),
      };
      // Fresh credentials clear a prior join error but keep a live device.
      if (state.join) state.join.error = null;
      this.write(scope, state);
      return this.viewSync(scope, state, computers);
    }

    const clientId = input.clientId?.trim() ?? "";
    const clientSecret = input.clientSecret?.trim() ?? "";
    if (!clientId || !clientSecret) {
      throw new BotTailscaleError("OAuth client id and secret are both required.", "invalid_input");
    }
    const state = this.read(scope);
    state.credentials = {
      kind: "oauth",
      clientId,
      clientSecret,
      tags,
      hint: secretHint(clientId),
    };
    if (state.join) {
      state.join.error = null;
      state.join.accessToken = undefined;
      state.join.accessTokenExpiresAt = undefined;
    }
    this.write(scope, state);
    return this.viewSync(scope, state, computers);
  }

  /** Forget credentials and disconnect the current join. */
  async clear(scope: BotTailscaleScope): Promise<BotTailscaleView> {
    const state = this.read(scope);
    if (state.join && this.sandboxExecFor) {
      try {
        const exec = await this.sandboxExecFor(state.join.computerId, scope);
        if (exec) await leaveSandboxTailnet(exec);
      } catch {
        // Still wipe local state.
      }
    }
    const path = this.path(scope);
    try {
      rmSync(path, { force: true });
    } catch {
      this.write(scope, { credentials: null, join: null });
    }
    return emptyBotTailscaleView(await this.computers(scope));
  }

  async disconnect(scope: BotTailscaleScope): Promise<BotTailscaleView> {
    const state = this.read(scope);
    if (!state.credentials) return emptyBotTailscaleView(await this.computers(scope));
    if (state.join && this.sandboxExecFor) {
      try {
        const exec = await this.sandboxExecFor(state.join.computerId, scope);
        if (exec) await leaveSandboxTailnet(exec);
      } catch (error) {
        state.join.error = error instanceof Error ? error.message : "Disconnect failed.";
        this.write(scope, state);
        throw new BotTailscaleError(state.join.error, "join_failed");
      }
    }
    state.join = null;
    this.write(scope, state);
    return this.viewSync(scope, state, await this.computers(scope));
  }

  async join(scope: BotTailscaleScope, input: BotTailscaleJoinInput): Promise<BotTailscaleView> {
    const key = this.scopeKey(scope);
    if (this.busy.has(key)) throw new BotTailscaleError("A join is already in progress.", "busy");
    const state = this.read(scope);
    if (!state.credentials) throw new BotTailscaleError("Connect Tailscale first.", "not_setup");
    const computers = await this.computers(scope);
    const computer = computers.find((c) => c.id === input.computerId);
    if (!computer) throw new BotTailscaleError("Choose one of your bot computers.", "unknown_computer");
    const keyKind: BotTailscaleKeyKind = input.keyKind === "reusable" ? "reusable" : "ephemeral";
    const hostname = tailscaleHostname(input.hostname?.trim() || computer.label);

    this.busy.add(key);
    try {
      const authKey = await this.mintAuthKey(scope, state, keyKind, hostname);
      const join: StoredJoin = {
        computerId: computer.id,
        computerLabel: computer.label,
        computerPlace: computer.place,
        keyKind,
        hostname,
        device: null,
        error: null,
        accessToken: state.join?.accessToken,
        accessTokenExpiresAt: state.join?.accessTokenExpiresAt,
      };
      state.join = join;
      this.write(scope, state);

      const exec = this.sandboxExecFor ? await this.sandboxExecFor(computer.id, scope) : null;
      if (!exec) {
        // No sandbox exec here: record a pending device so the UI can show
        // Waiting (tests drive approval through status / the fake API).
        join.device = {
          name: hostname,
          addresses: [],
          pendingApproval: true,
        };
        this.write(scope, state);
      } else {
        try {
          const device = await joinSandboxTailnet(exec, {
            authKey,
            hostname,
            tags: state.credentials.tags,
          });
          join.device = device;
          join.error = null;
          this.write(scope, state);
        } catch (error) {
          join.error = error instanceof Error ? error.message : "Join failed.";
          this.write(scope, state);
          throw new BotTailscaleError(join.error, "join_failed");
        }
      }
    } finally {
      this.busy.delete(key);
    }
    return this.viewSync(scope, this.read(scope), computers);
  }

  /** Poll and refresh a pending device (UI polls while Waiting). */
  async refresh(scope: BotTailscaleScope): Promise<BotTailscaleView> {
    return this.view(scope);
  }

  private async mintAuthKey(
    scope: BotTailscaleScope,
    state: StoredState,
    keyKind: BotTailscaleKeyKind,
    hostname: string,
  ): Promise<string> {
    const creds = state.credentials!;
    if (creds.kind === "authKey" && creds.authKey) return creds.authKey;

    try {
      let accessToken = state.join?.accessToken;
      let expiresAt = state.join?.accessTokenExpiresAt ?? 0;
      if (!accessToken || expiresAt < this.now() + 60_000) {
        const exchanged = await this.control.exchangeOAuth({
          clientId: creds.clientId!,
          clientSecret: creds.clientSecret!,
        });
        accessToken = exchanged.accessToken;
        expiresAt = this.now() + exchanged.expiresIn * 1000;
        if (!state.join) {
          // Placeholder until join() fills computer fields.
          state.join = {
            computerId: "",
            computerLabel: "",
            computerPlace: "sandbox",
            keyKind,
            hostname,
            device: null,
            error: null,
            accessToken,
            accessTokenExpiresAt: expiresAt,
          };
        } else {
          state.join.accessToken = accessToken;
          state.join.accessTokenExpiresAt = expiresAt;
        }
        this.write(scope, state);
      }
      const minted = await this.control.createAuthKey({
        accessToken,
        keyKind,
        tags: creds.tags,
        requireApproval: true,
        description: `Sagax ${hostname}`,
      });
      return minted.key;
    } catch (error) {
      if (error instanceof TailscaleControlError) {
        throw new BotTailscaleError(error.message, "control_failed");
      }
      throw error;
    }
  }

  private viewSync(scope: BotTailscaleScope, state: StoredState, computers?: BotTailscaleComputerOption[]): BotTailscaleView {
    const list = computers ?? [];
    if (!state.credentials) return emptyBotTailscaleView(list);
    const device = state.join?.device ?? null;
    let phase = phaseFromDevice(device, true);
    if (state.join?.error) phase = "error";
    else if (this.busy.has(this.scopeKey(scope))) phase = "joining";
    else if (state.join && device?.pendingApproval) phase = "pending_approval";
    else if (state.join && device && !device.pendingApproval) phase = "connected";
    else if (state.join && !device) phase = "joining";
    return {
      phase,
      credentials: {
        kind: state.credentials.kind,
        hint: state.credentials.hint,
        tags: [...state.credentials.tags],
      },
      computer: state.join && state.join.computerId
        ? {
            id: state.join.computerId,
            label: state.join.computerLabel,
            place: state.join.computerPlace,
          }
        : null,
      keyKind: state.join?.keyKind ?? null,
      device,
      error: state.join?.error ?? null,
      computers: list,
    };
  }
}

function normalizeTags(tags: string[] | undefined): string[] {
  const list = (tags?.length ? tags : [SAGAX_TAILSCALE_TAG])
    .map((t) => t.trim())
    .filter(Boolean);
  const unique = [...new Set(list.map((t) => (t.startsWith("tag:") ? t : `tag:${t}`)))];
  return unique.length ? unique : [SAGAX_TAILSCALE_TAG];
}

export { FakeTailscaleControl, createHttpTailscaleControl };
