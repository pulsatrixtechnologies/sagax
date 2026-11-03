// One person's account, whether it is sealed here (solo) or in Perspicax.
// A remote import never replaces an account the person already maintains.
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { ProviderAccountsView, PersonalProviderServer } from "../../shared/provider-accounts.ts";
import { writeFileAtomic } from "../atomic.ts";
import { isKeyProvider, type PerspicaxDirectory, type KeyProvider, type ProviderKeyResult } from "../perspicax/perspicax-link.ts";
import { ProviderKeysStore, type ProviderKeyScope } from "./provider-keys.ts";

const INSTANCE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const serverSchema = z.object({
  instanceId: z.string().regex(INSTANCE),
  name: z.string().trim().min(1).max(120),
  url: z.string().url().refine((value) => {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.hash;
  }),
  protocol: z.enum(["openai", "anthropic"]),
  // Control bytes cannot be part of a model identifier sent in a request.
  // eslint-disable-next-line no-control-regex
  models: z.array(z.object({ id: z.string().trim().min(1).refine((value) => !/[\x00-\x1f\x7f]/.test(value)), label: z.string().trim() })),
});
const viewSchema = z.object({
  keys: z.array(z.object({ provider: z.string().refine(isKeyProvider), last4: z.string().nullable() })),
  servers: z.array(serverSchema),
});
export type ProviderAccountOwner = { principalId: string; sub: string };
export class ProviderAccountsError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(status = 503, message = "Your provider accounts could not be saved. Try again.", code?: string) { super(message); this.status = status; this.code = code; }
}

interface ProviderAccountsOptions {
  dataDir: string;
  directory?: Pick<PerspicaxDirectory, "linkPostJson" | "invalidate" | "rememberProviderKeys" | "resolveProviderKey">;
  store?: ProviderKeysStore;
  soloKeys?(): Record<string, string>;
  /** True when this provider uses the installation's existing config. */
  saveSoloKey?(provider: string, value: string | null): boolean;
}

export class ProviderAccounts {
  private pending = new Map<string, Promise<unknown>>();
  private readonly options: ProviderAccountsOptions;
  constructor(options: ProviderAccountsOptions) { this.options = options; }

  private get store(): ProviderKeysStore { return this.options.store ?? new ProviderKeysStore(this.options.dataDir); }
  private scope(owner?: ProviderAccountOwner): ProviderKeyScope { return owner ? { principalId: owner.principalId } : {}; }

  private async serial<T>(owner: ProviderAccountOwner | undefined, work: () => Promise<T>): Promise<T> {
    const id = owner?.principalId ?? "solo";
    const before = this.pending.get(id) ?? Promise.resolve();
    const next = before.catch(() => {}).then(work);
    this.pending.set(id, next);
    try { return await next; }
    finally { if (this.pending.get(id) === next) this.pending.delete(id); }
  }

  private async post(owner: ProviderAccountOwner, route: string, value: object): Promise<unknown> {
    const directory = this.options.directory;
    if (!directory) throw new ProviderAccountsError();
    const result = await directory.linkPostJson(`/api/v1/pulsabot/${route}`, { sub: owner.sub, ...value }, { subject: owner.sub, timeoutMs: 10_000, maxBytes: 1024 * 1024 });
    if (!result.ok) {
      if (result.status === 404 || result.status === 405) throw new ProviderAccountsError(409,
        "Your organization server needs an update to manage provider accounts.", "provider_accounts_update_required");
      throw new ProviderAccountsError(result.status === 400 ? 400 : result.status === 403 ? 403 : 503);
    }
    return result.body;
  }

  private async migrate(owner: ProviderAccountOwner): Promise<void> {
    const scope = this.scope(owner);
    // Read all files before the first import. A corrupt file leaves every
    // source intact, and retrying a partial import is harmless.
    const keys = { ...this.store.legacy(scope), ...this.store.keys(scope) };
    for (const [provider, key] of Object.entries(keys)) {
      if (!isKeyProvider(provider)) throw new ProviderAccountsError();
      const ack = await this.post(owner, "provider-keys/save", { provider, value: key, import: true });
      if (!ack || typeof ack !== "object" || (ack as Record<string, unknown>).provider !== provider || (ack as Record<string, unknown>).configured !== true) throw new ProviderAccountsError();
      this.options.directory?.invalidate(owner.sub, provider);
    }
    this.store.retireImported(scope);
  }

  private localServers(): PersonalProviderServer[] {
    const path = join(this.options.dataDir, "provider-servers.json");
    try {
      if (lstatSync(path).isSymbolicLink()) throw new ProviderAccountsError();
      return z.array(serverSchema).parse(JSON.parse(readFileSync(path, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new ProviderAccountsError();
    }
  }

  private async listInner(owner?: ProviderAccountOwner): Promise<ProviderAccountsView> {
    if (!owner) return {
      keys: Object.entries({ ...this.store.keys(), ...this.options.soloKeys?.() }).map(([provider, key]) => ({ provider, last4: key.length >= 12 ? key.slice(-4) : null })),
      servers: this.localServers(),
    };
    const result = viewSchema.safeParse(await this.post(owner, "provider-keys/list", {}));
    if (!result.success) throw new ProviderAccountsError();
    this.options.directory?.rememberProviderKeys(owner.sub, result.data.keys.map((key) => key.provider));
    return result.data;
  }

  list(owner?: ProviderAccountOwner): Promise<ProviderAccountsView> {
    return this.serial(owner, async () => { if (owner) await this.migrate(owner); return this.listInner(owner); });
  }

  setKey(owner: ProviderAccountOwner | undefined, provider: string, value: string | null): Promise<ProviderAccountsView> {
    if (!isKeyProvider(provider)) return Promise.reject(new ProviderAccountsError(400, "Unknown provider."));
    // Reject control bytes explicitly, including bytes outside JS whitespace.
    // eslint-disable-next-line no-control-regex
    if (value !== null && (value.length < 8 || value.length > 512 || /[\s\x00-\x1f\x7f]/.test(value))) return Promise.reject(new ProviderAccountsError(400, "Enter the key as a single line, between 8 and 512 characters."));
    return this.serial(owner, async () => {
      if (owner) {
        await this.migrate(owner);
        const ack = await this.post(owner, "provider-keys/save", { provider, value });
        if (!ack || typeof ack !== "object" || (ack as Record<string, unknown>).provider !== provider || (ack as Record<string, unknown>).configured !== (value !== null)) throw new ProviderAccountsError();
        this.options.directory?.invalidate(owner.sub, provider);
      } else {
        const current = this.store.keys();
        const saved = this.options.saveSoloKey?.(provider, value);
        if (!saved || Object.hasOwn(current, provider)) this.store.set({}, provider, saved ? null : value);
      }
      return this.listInner(owner);
    });
  }

  setServer(owner: ProviderAccountOwner | undefined, instanceId: string, value: PersonalProviderServer | null): Promise<ProviderAccountsView> {
    if (!INSTANCE.test(instanceId)) return Promise.reject(new ProviderAccountsError(400, "Invalid server identifier."));
    const parsed = value === null ? null : serverSchema.safeParse(value);
    if (parsed && (!parsed.success || parsed.data.instanceId !== instanceId)) return Promise.reject(new ProviderAccountsError(400, "Check the server name, URL and models."));
    const server = parsed?.success ? parsed.data : null;
    return this.serial(owner, async () => {
      if (owner) {
        await this.migrate(owner);
        await this.post(owner, "provider-servers/save", { instanceId, server });
        if (server === null) this.options.directory?.invalidate(owner.sub, `compat:${instanceId}`);
      } else {
        const servers = this.localServers().filter((entry) => entry.instanceId !== instanceId);
        if (server) servers.push(server);
        writeFileAtomic(join(this.options.dataDir, "provider-servers.json"), JSON.stringify(servers), { mode: 0o600 });
        if (!server) this.store.set({}, `compat:${instanceId}`, null);
      }
      return this.listInner(owner);
    });
  }

  async key(owner: ProviderAccountOwner | undefined, provider: string): Promise<string | undefined> {
    if (!isKeyProvider(provider)) return undefined;
    if (!owner) return this.options.soloKeys?.()[provider] ?? this.store.keys()[provider];
    const result = await this.resolve(owner, provider);
    return result?.ok ? result.key : undefined;
  }

  async resolve(owner: ProviderAccountOwner, provider: KeyProvider): Promise<ProviderKeyResult> {
    try { await this.serial(owner, () => this.migrate(owner)); }
    catch (error) {
      if (!(error instanceof ProviderAccountsError) || error.code !== "provider_accounts_update_required") return { ok: false, error: "unreachable" };
      // An older organization host can still resolve its existing provider
      // keys. Keep a pending local import usable until that host is updated;
      // a disabled person or missing link never falls back to a local key.
      const remote = await this.options.directory?.resolveProviderKey(owner.sub, provider);
      if (remote?.ok || remote?.error === "user_inactive" || remote?.error === "link") return remote;
      const key = this.store.keys(this.scope(owner))[provider] ?? this.store.legacy(this.scope(owner))[provider];
      if (key) return { ok: true, key, fingerprint: createHash("sha256").update(key).digest("hex") };
      return remote ?? { ok: false, error: "link" };
    }
    return this.options.directory?.resolveProviderKey(owner.sub, provider) ?? { ok: false, error: "link" };
  }
}
