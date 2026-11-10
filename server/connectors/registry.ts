// One registry of a person's connectors (#3344, part of #3286; design:
// docs/design/connectors-across-engines.md, part P1, invariant I1).
//
// For one person it lists, over all of that person's own sign-ins (Claude,
// the first and second Grok account, added accounts, Codex), each connector
// with its provider, its account, its state and its tools. Facts come from
// the providers (server/connectors/providers/): what this process already
// knows in memory, else what the last read wrote to disk. A sign-in never
// read is listed as unknown and read once in the background; nothing here
// waits on a CLI unless asked to (`refresh`).
//
// On disk: `${DATA_DIR}/connectors/<principalId>.json` (0600), names and
// states only. Never a token, an address or an email: a loaded file keeps
// only the fields of ConnectorAccount, so nothing else can ride along.
// Only the person's own sign-ins are ever listed: `accounts(principalId)`
// of each provider reads that person's own sign-in markers, and a file of
// one person is never read for another.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomicIfChanged } from "../atomic.ts";
import { reportBackgroundError } from "../background-error.ts";
import type { ConnectorAccountChange } from "../engines/principal-engine-logins.ts";
import {
  CONNECTOR_PROVIDERS,
  PROVIDER_DRIVER,
  connectorAccountKey,
  type ConnectorAccount,
  type ConnectorAccountAuth,
  type ConnectorAccountRef,
  type ConnectorEntry,
  type ConnectorProvider,
  type ConnectorProviderSource,
  type ConnectorState,
  type ConnectorTool,
} from "./types.ts";

export const CONNECTORS_DIR = "connectors";
const FILE_VERSION = 1;
const NAME = /^[^\p{Cc}]{1,120}$/u;
const TOOL = /^[^\s\p{Cc}]{1,256}$/u;
const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const INSTANCE = /^[A-Za-z0-9][\w.-]{0,127}$/;
const AUTHS: readonly ConnectorAccountAuth[] = ["subscription", "key", "none", "unknown"];
const STATES: readonly ConnectorState[] = ["connected", "needs-sign-in", "failed", "unknown"];
const MAX_CONNECTORS = 256;
const MAX_TOOLS = 1024;
const TOOL_DESCRIPTION_MAX = 1_000;
const TOOL_SCHEMA_MAX = 8_000;

/** The file of a person: their id when it is a plain one, else a hash, so
 * a path never comes from free text. */
export function connectorsFileName(principalId: string): string {
  const id = principalId.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_.-]{0,127}$/.test(id) ? `${id}.json` : `h-${createHash("sha256").update(id).digest("hex").slice(0, 40)}.json`;
}

/** #3353: a tool's description and input schema, when its provider lists
 * them (ChatGPT apps), bounded so one tool never weighs on the file. */
function cleanTool(id: string, raw: Record<string, unknown>): ConnectorTool {
  const description = typeof raw.description === "string" ? raw.description.replace(/\p{Cc}+/gu, " ").trim().slice(0, TOOL_DESCRIPTION_MAX) : "";
  const schema = raw.inputSchema && typeof raw.inputSchema === "object" && !Array.isArray(raw.inputSchema) ? raw.inputSchema as Record<string, unknown> : undefined;
  const schemaFits = schema !== undefined && JSON.stringify(schema).length <= TOOL_SCHEMA_MAX;
  return { id, ...(description ? { description } : {}), ...(schemaFits ? { inputSchema: schema } : {}) };
}

function cleanEntry(raw: unknown): ConnectorEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (!NAME.test(name)) return null;
  const state = STATES.includes(value.state as ConnectorState) ? value.state as ConnectorState : "unknown";
  const tools = Array.isArray(value.tools)
    ? value.tools.flatMap((tool) => {
      const id = tool && typeof tool === "object" && typeof (tool as { id?: unknown }).id === "string" ? (tool as { id: string }).id : "";
      return TOOL.test(id) ? [cleanTool(id, tool as Record<string, unknown>)] : [];
    }).slice(0, MAX_TOOLS)
    : [];
  const id = typeof value.id === "string" && ID.test(value.id) ? value.id : undefined;
  return { ...(id ? { id } : {}), name, state, tools };
}

/** A ConnectorAccount with only its own fields, or null. */
export function cleanConnectorAccount(raw: unknown): ConnectorAccount | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const provider = value.provider as ConnectorProvider;
  if (!CONNECTOR_PROVIDERS.includes(provider)) return null;
  const instanceId = typeof value.instanceId === "string" ? value.instanceId : "";
  if (!INSTANCE.test(instanceId)) return null;
  const slot = value.slot === "second" ? "second" : "primary";
  const label = typeof value.label === "string" && NAME.test(value.label.trim()) ? value.label.trim() : "";
  if (!label) return null;
  const auth = AUTHS.includes(value.auth as ConnectorAccountAuth) ? value.auth as ConnectorAccountAuth : "unknown";
  const kind = value.kind === "personal" || value.kind === "team" ? value.kind : undefined;
  const at = typeof value.at === "number" && Number.isFinite(value.at) && value.at > 0 ? value.at : 0;
  const connectors = Array.isArray(value.connectors) ? value.connectors.flatMap((entry) => cleanEntry(entry) ?? []).slice(0, MAX_CONNECTORS) : [];
  const ref = { provider, driver: PROVIDER_DRIVER[provider], instanceId, slot } as const;
  return {
    ...ref,
    key: connectorAccountKey(ref),
    label,
    ...(kind ? { kind } : {}),
    auth,
    ...(typeof value.gateway === "boolean" ? { gateway: value.gateway } : {}),
    connectors,
    at,
  };
}

/** The connectors of an account a turn may use: connected ones only. */
export function connectedConnectorNames(account: Pick<ConnectorAccount, "auth" | "connectors"> | undefined): string[] {
  if (!account || account.auth !== "subscription") return [];
  return account.connectors.filter((entry) => entry.state === "connected").map((entry) => entry.name);
}

export interface ConnectorRegistryOptions {
  dataDir: string;
  providers: readonly ConnectorProviderSource[];
  /** The sign-in an engine instance runs on, as the providers name it:
   * several instances of one engine share the person's own folder, an added
   * account has its own (#2384). Default: the instance id itself. */
  accountInstance?: (provider: ConnectorProvider, instanceId: string) => string;
  now?: () => number;
}

type RefFilter = Partial<Pick<ConnectorAccountRef, "provider" | "driver" | "instanceId" | "slot">>;

/** A listed account: what is known of it, or the empty unknown one. */
function unknownAccount(ref: ConnectorAccountRef, label: string): ConnectorAccount {
  return { ...ref, key: connectorAccountKey(ref), label, auth: "unknown", connectors: [], at: 0 };
}

export class ConnectorRegistry {
  private readonly dir: string;
  private readonly providers: readonly ConnectorProviderSource[];
  private readonly accountInstance: (provider: ConnectorProvider, instanceId: string) => string;
  /** what each person's file holds, read once per process */
  private readonly loaded = new Map<string, Map<string, ConnectorAccount>>();
  /** sign-ins read in the background this process, and when */
  private readonly warmed = new Map<string, number>();
  private readonly now: () => number;

  constructor(options: ConnectorRegistryOptions) {
    this.dir = join(options.dataDir, CONNECTORS_DIR);
    this.providers = options.providers;
    this.accountInstance = options.accountInstance ?? ((_provider, instanceId) => instanceId);
    this.now = options.now ?? Date.now;
  }

  /** An engine instance's sign-in as this provider names it (#3351: the
   * prompt's list matches a turn's native mount to its own account). */
  accountInstanceOf(provider: ConnectorProvider, instanceId: string): string {
    return this.accountInstance(provider, instanceId);
  }

  /** A filter with its instance named as the providers name it. */
  private normalized<T extends RefFilter>(filter: T): T {
    if (filter.instanceId === undefined) return filter;
    const providers = filter.provider ? [filter.provider] : CONNECTOR_PROVIDERS;
    // without a provider, the instance is mapped by each one alike
    return { ...filter, instanceId: this.accountInstance(providers[0]!, filter.instanceId) };
  }

  private static matches(filter: RefFilter | undefined, ref: ConnectorAccountRef): boolean {
    if (!filter) return true;
    return (Object.keys(filter) as Array<keyof RefFilter>).every((field) => filter[field] === undefined || filter[field] === ref[field]);
  }

  private file(principalId: string): string {
    return join(this.dir, connectorsFileName(principalId));
  }

  private stored(principalId: string): Map<string, ConnectorAccount> {
    const person = principalId.trim().toLowerCase();
    let accounts = this.loaded.get(person);
    if (accounts) return accounts;
    accounts = new Map();
    try {
      const path = this.file(person);
      if (existsSync(path)) {
        const parsed = JSON.parse(readFileSync(path, "utf8")) as { version?: unknown; accounts?: unknown };
        if (parsed && parsed.version === FILE_VERSION && Array.isArray(parsed.accounts)) {
          for (const raw of parsed.accounts) {
            const account = cleanConnectorAccount(raw);
            if (account) accounts.set(account.key, account);
          }
        }
      }
    } catch {
      /* an unreadable file is an empty one: the providers read again */
    }
    this.loaded.set(person, accounts);
    return accounts;
  }

  private save(principalId: string): void {
    const person = principalId.trim().toLowerCase();
    const accounts = this.stored(person);
    const path = this.file(person);
    if (!accounts.size) {
      rmSync(path, { force: true });
      return;
    }
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const body = { version: FILE_VERSION, accounts: [...accounts.values()].sort((a, b) => a.key.localeCompare(b.key)) };
    writeFileAtomicIfChanged(path, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
  }

  private source(provider: ConnectorProvider): ConnectorProviderSource | undefined {
    return this.providers.find((entry) => entry.provider === provider);
  }

  /** Keep what a read found for one of the person's sign-ins. A sign-in
   * the person does not have (any more) is never kept. */
  record(principalId: string, account: ConnectorAccount): void {
    const clean = cleanConnectorAccount(account);
    if (!clean) return;
    const own = this.source(clean.provider)?.accounts(principalId).some((ref) => connectorAccountKey(ref) === clean.key) ?? false;
    if (!own) return;
    const accounts = this.stored(principalId);
    const before = accounts.get(clean.key);
    if (before && before.at > clean.at) return;
    accounts.set(clean.key, clean);
    this.save(principalId);
  }

  /** Every sign-in of the person's, with what is known of its connectors:
   * this process's memory when it is newer, else the disk. A sign-in with
   * nothing known is listed as unknown and read once in the background.
   * Sign-ins gone since the file was written are dropped from it. */
  accounts(principalId: string): ConnectorAccount[] {
    const person = principalId.trim().toLowerCase();
    if (!person) return [];
    const accounts = this.stored(person);
    const out: ConnectorAccount[] = [];
    const seen = new Set<string>();
    let changed = false;
    for (const source of this.providers) {
      for (const ref of source.accounts(person)) {
        const key = connectorAccountKey(ref);
        if (seen.has(key)) continue;
        seen.add(key);
        const disk = accounts.get(key);
        const memory = source.peek(person, ref);
        let account = disk;
        if (memory && (!disk || memory.at > disk.at)) {
          const clean = cleanConnectorAccount(memory);
          if (clean) {
            accounts.set(key, clean);
            account = clean;
            changed = true;
          }
        }
        const stale = account && source.maxAgeMs !== undefined && this.now() - account.at >= source.maxAgeMs;
        if (!account || account.at === 0 || stale) this.warm(person, ref, source.maxAgeMs);
        out.push(account ?? unknownAccount(ref, memory?.label ?? this.defaultLabel(ref)));
      }
    }
    for (const key of accounts.keys()) {
      if (seen.has(key)) continue;
      accounts.delete(key);
      changed = true;
    }
    if (changed) this.save(person);
    return out;
  }

  /** One sign-in of the person's, or undefined when they have none such. */
  account(principalId: string, ref: Pick<ConnectorAccountRef, "provider" | "instanceId" | "slot">): ConnectorAccount | undefined {
    const key = connectorAccountKey(this.normalized(ref));
    return this.accounts(principalId).find((account) => account.key === key);
  }

  /** The person's sign-ins of one provider, first sign-in first. */
  accountsOf(principalId: string, provider: ConnectorProvider): ConnectorAccount[] {
    return this.accounts(principalId)
      .filter((account) => account.provider === provider)
      .sort((a, b) => Number(a.slot === "second") - Number(b.slot === "second"));
  }

  /** Read the person's sign-ins again through their own CLIs (all of them,
   * or the ones matching `only`), keep what came back, and answer the list. */
  async refresh(principalId: string, only?: RefFilter, force = true): Promise<ConnectorAccount[]> {
    const person = principalId.trim().toLowerCase();
    if (!person) return [];
    const filter = only ? this.normalized(only) : undefined;
    const reads: Array<Promise<void>> = [];
    for (const source of this.providers) {
      for (const ref of source.accounts(person)) {
        if (!ConnectorRegistry.matches(filter, ref)) continue;
        reads.push(source.read(person, ref, force).then((account) => { if (account) this.record(person, account); }, () => {}));
      }
    }
    await Promise.all(reads);
    return this.accounts(person);
  }

  /** A sign-in left: its connectors are forgotten (all of the person's
   * when no sign-in is named, the console's Reset access). */
  forget(principalId: string, ref?: RefFilter): void {
    const person = principalId.trim().toLowerCase();
    if (!person) return;
    const accounts = this.stored(person);
    const filter = ref ? this.normalized(ref) : undefined;
    for (const [key, account] of accounts) {
      if (!ConnectorRegistry.matches(filter, account)) continue;
      accounts.delete(key);
      this.warmed.delete(`${person}/${key}`);
    }
    if (!ref) for (const key of this.warmed.keys()) if (key.startsWith(`${person}/`)) this.warmed.delete(key);
    this.save(person);
  }

  /** A sign-in of the person's came or went (principal-engine-logins.ts
   * onConnectorAccountChanged): read it, or forget it. A Grok sign-in is
   * said once its reach was probed, so it is read from memory; a Claude one
   * is read again through its CLI. */
  followSignIn(principalId: string, change: ConnectorAccountChange): Promise<void> {
    if ("cleared" in change) {
      this.forget(principalId);
      return Promise.resolve();
    }
    const provider = CONNECTOR_PROVIDERS.find((entry) => PROVIDER_DRIVER[entry] === change.driver);
    if (!provider) return Promise.resolve();
    const ref = { provider, instanceId: change.instanceId, slot: change.slot };
    if (!change.signedIn) {
      this.forget(principalId, ref);
      return Promise.resolve();
    }
    return this.refresh(principalId, ref, provider === "claude-ai").then(() => undefined);
  }

  /** #3357: the connector accounts a sign-in change touches, as the hosts
   * key them (`<provider>:<instanceId>:<slot>`); null when the change is a
   * reset of every sign-in of the person. */
  accountsOfSignIn(change: ConnectorAccountChange): Array<{ provider: ConnectorProvider; accountKey: string }> | null {
    if ("cleared" in change) return null;
    return CONNECTOR_PROVIDERS.filter((provider) => PROVIDER_DRIVER[provider] === change.driver).map((provider) => ({
      provider,
      accountKey: connectorAccountKey({ provider, instanceId: this.accountInstance(provider, change.instanceId), slot: change.slot }),
    }));
  }

  /** Read one sign-in in the background: once per process, or once per
   * `maxAgeMs` for a provider that ages. */
  private warm(principalId: string, ref: ConnectorAccountRef, maxAgeMs?: number): void {
    const key = `${principalId}/${connectorAccountKey(ref)}`;
    const last = this.warmed.get(key);
    if (last !== undefined && (maxAgeMs === undefined || this.now() - last < maxAgeMs)) return;
    this.warmed.set(key, this.now());
    const source = this.source(ref.provider);
    if (!source) return;
    void source.read(principalId, ref, false)
      .then((account) => { if (account) this.record(principalId, account); })
      .catch(reportBackgroundError);
  }

  private defaultLabel(ref: ConnectorAccountRef): string {
    return ref.provider === "claude-ai" ? "Claude" : ref.provider === "grok-com" ? "Grok" : "ChatGPT";
  }
}
