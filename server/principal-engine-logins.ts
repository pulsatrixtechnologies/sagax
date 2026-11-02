// A person's own engine subscriptions on an organization server (slice 4,
// decision D10). Each person signs in to Claude, Codex, Grok Build or Kimi
// Code with their own account; the login lives in their own directory:
//
//   ${DATA_DIR}/principals/<principalId>/claude   (CLAUDE_CONFIG_DIR, 0700)
//   ${DATA_DIR}/principals/<principalId>/codex    (CODEX_HOME, 0700)
//   ${DATA_DIR}/principals/<principalId>/grok     (HOME of the grok CLI, 0700)
//   ${DATA_DIR}/principals/<principalId>/grok-2   (2026-10-29: a second Grok
//                                                  account, same layout)
//   ${DATA_DIR}/principals/<principalId>/kimi     (KIMI_CODE_HOME, 0700)
//
// Signed in means our marker `<dir>/.pulsabot-login.json` ({ at }, 0600),
// written when the CLI reports success and removed on sign-out; nothing else
// is trusted. The flows are the drivers' own login controllers
// (ClaudeLoginController, CodexDeviceAuthController, and the device-code
// DeviceLoginController for Grok and Kimi) pointed at that
// directory, one flow per (person, engine), owned by the session that
// started it and ended with it (provider-auth-sessions.ts).
//
// A subscription only ever serves its owner speaking (engine-credentials.ts).
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "./atomic.ts";
import { noteGrokAccountReach } from "./drivers/acp/grok-tool-catalog.ts";
import type { ProviderAuthenticationStart, ProviderAuthenticationStatus } from "./contracts.ts";
import { ClaudeLoginController } from "./drivers/claude-login-auth.ts";
import { CodexDeviceAuthController } from "./drivers/codex-device-auth.ts";
import { DeviceLoginController } from "./drivers/device-login.ts";
import { probeGrokModels, readGrokModelsCache } from "./drivers/acp/grok.ts";
import { ProviderAuthSessions } from "./provider-auth-sessions.ts";
import { isPrincipalId } from "./principals.ts";

export const LOGIN_MARKER = ".pulsabot-login.json";
/** #1533: the provider refused this sign-in and could not refresh it (a
 * turn ended in an authentication failure, or the CLI says it is signed
 * out). Written next to LOGIN_MARKER, removed by the next sign-in. The
 * marker itself stays: who pays for a turn does not change by itself. */
export const LOGIN_EXPIRED_MARKER = ".pulsabot-login-expired.json";
export type LoginDriver = "claudeAgent" | "codex" | "grokAgent" | "kimiAgent";
/** 2026-10-29: a person may keep two sign-ins on Grok (a personal grok.com
 * account and a team one), each with its own grok.com connectors. The first
 * one pays their turns; the second is reached through run_with_engine and
 * the connector switch (index.ts relayEnginesFor). */
export type LoginSlot = "primary" | "second";
export function loginSlotOf(value: unknown): LoginSlot {
  return value === "second" ? "second" : "primary";
}
/** What a Grok sign-in is, read from the CLI's own login record
 * (`principal_type`): a personal account (User) or a team (Team). */
export type GrokAccountKind = "personal" | "team" | "unknown";
export interface GrokAccountIdentity {
  kind: GrokAccountKind;
  /** the account's address, for its own person's Providers page only */
  email?: string;
}

/** Each driver's own command when the instance saved none and the registry
 * has no default yet. API engines are absent on purpose: they have no CLI,
 * and a sign-in must not borrow Claude's command. */
const DEFAULT_CLI: Readonly<Record<string, string>> = {
  claudeAgent: "claude",
  codex: "codex",
  grokAgent: "grok",
  kimiAgent: "kimi",
  geminiAgent: "gemini",
  piAgent: "pi",
  cursorAgent: "cursor-agent",
  droidAgent: "droid",
  opencodeGo: "opencode",
  hermesAgent: "hermes",
  qwenAgent: "qwen",
  antigravityAgent: "agy",
};

/** Executable for a person's subscription sign-in.
 * A saved config.cli wins, then the registry's default for that instance.
 * Otherwise the driver's own command. An engine with no command yields "",
 * never another engine's binary. */
export function loginCliFor(driver: string, configured: unknown, driverDefault: string | null | undefined): string {
  const raw = typeof configured === "string" ? configured.trim() : "";
  if (raw) return raw;
  const fallback = typeof driverDefault === "string" ? driverDefault.trim() : "";
  if (fallback) return fallback;
  return DEFAULT_CLI[driver] ?? "";
}

const LOGIN_DIR: Readonly<Record<LoginDriver, string>> = { claudeAgent: "claude", codex: "codex", grokAgent: "grok", kimiAgent: "kimi" };
/** The drivers with a second sign-in per person, and its directory. */
const SECOND_LOGIN_DIR: Readonly<Partial<Record<LoginDriver, string>>> = { grokAgent: "grok-2" };
export function secondLoginSupported(driver: string): boolean {
  return isLoginDriver(driver) && SECOND_LOGIN_DIR[driver] !== undefined;
}

/** `principal_type` and `email` of a grok login file (`<home>/.grok/auth.json`,
 * one record per issuer::principal), nothing else read, never the token. */
export function readGrokAccountIdentity(authFile: string): GrokAccountIdentity | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(authFile, "utf8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  for (const record of Object.values(parsed as Record<string, unknown>)) {
    if (!record || typeof record !== "object") continue;
    const type = (record as { principal_type?: unknown }).principal_type;
    const email = (record as { email?: unknown }).email;
    const kind: GrokAccountKind = type === "User" ? "personal" : type === "Team" ? "team" : "unknown";
    const clean = typeof email === "string" && email.length <= 254 && /^[^\s@]+@[^\s@]+$/.test(email) ? email : undefined;
    return { kind, ...(clean ? { email: clean } : {}) };
  }
  return null;
}

export interface LoginController {
  start(): Promise<ProviderAuthenticationStart>;
  get(flowId: string): Promise<ProviderAuthenticationStatus>;
  complete?(flowId: string, pasted: string): Promise<void>;
  cancel(): Promise<void>;
  signOut(): Promise<void>;
  dispose?(): Promise<void>;
}

export interface LoginInstanceFacts {
  driver: string;
  cli: string;
  /** The instance's own environment (Settings), merged over the process's. */
  environment?: Record<string, string | undefined>;
}

export interface PrincipalEngineLoginsOptions {
  dataDir: string;
  /** The instance's driver, CLI and environment, or null when unknown. */
  instance(instanceId: string): LoginInstanceFacts | null;
  /** Tests pass fakes; the default is the drivers' own controllers. */
  controller?(input: { driver: LoginDriver; cli: string; home: string; environment: () => Record<string, string | undefined>; onAuthenticated: () => Promise<void> }): LoginController;
  now?: () => number;
  /** Own Claude login succeeded for this person. */
  onClaudeLinked?: (principalId: string) => void;
  /** Any login-engine sign-in succeeded (Claude, Codex, Grok, Kimi): resume held routine runs. */
  onEngineSignedIn?: (principalId: string, driver: LoginDriver) => void;
  /** Tests pass a fake; the default asks the person's own Grok CLI. */
  probeModels?: (cli: string, env: Record<string, string | undefined>) => Promise<Array<{ id: string }> | null>;
  /** 2026-10-29: what a Grok sign-in brings through grok.com (its
   * `_x.ai/mcp/list` answer), read by a standalone probe of the person's own
   * CLI (server/drivers/acp/grok.ts probeGrokReach). Tests pass a fake. */
  probeReach?: (cli: string, env: Record<string, string | undefined>) => Promise<unknown>;
}

const failure = (message: string, status: number) => Object.assign(new Error(message), { status });

export function isLoginDriver(driver: string): driver is LoginDriver {
  return driver === "claudeAgent" || driver === "codex" || driver === "grokAgent" || driver === "kimiAgent";
}

/** #1154: how long a person's model list stays the one a turn reads. */
export const ACCOUNT_MODELS_TTL_MS = 10 * 60_000;

export class PrincipalEngineLogins {
  private readonly options: PrincipalEngineLoginsOptions;
  private readonly sessions = new ProviderAuthSessions();
  private readonly controllers = new Map<string, LoginController>();
  /** #1154: the last model list each person's own session gave, per engine. */
  private readonly knownModels = new Map<string, { at: number; ids: string[] }>();
  private readonly warming = new Set<string>();
  /** 2026-10-29: the Grok sign-ins whose reach was probed this process. */
  private readonly reachRead = new Set<string>();
  private readonly now: () => number;

  constructor(options: PrincipalEngineLoginsOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
  }

  /** The person's login directory for a driver (not created); `slot`
   * "second" is their second sign-in on a driver that keeps one (Grok). */
  loginDir(principalId: string, driver: LoginDriver, slot: LoginSlot = "primary"): string {
    if (!isPrincipalId(principalId)) throw failure("not a person", 400);
    if (slot === "second") {
      const dir = SECOND_LOGIN_DIR[driver];
      if (!dir) throw failure("This engine keeps one sign-in per person.", 400);
      return join(this.options.dataDir, "principals", principalId, dir);
    }
    return join(this.options.dataDir, "principals", principalId, LOGIN_DIR[driver]);
  }

  signedIn(principalId: string, driver: string, slot: LoginSlot = "primary"): boolean {
    if (!isLoginDriver(driver) || !isPrincipalId(principalId)) return false;
    if (slot === "second" && !SECOND_LOGIN_DIR[driver]) return false;
    return existsSync(join(this.loginDir(principalId, driver, slot), LOGIN_MARKER));
  }

  /** #1533: signed in, but the provider refused the sign-in since. */
  expired(principalId: string, driver: string, slot: LoginSlot = "primary"): boolean {
    if (!this.signedIn(principalId, driver, slot)) return false;
    return existsSync(join(this.loginDir(principalId, driver as LoginDriver, slot), LOGIN_EXPIRED_MARKER));
  }

  /** #1533: note that the provider refused this person's sign-in. Nothing
   * when they are not signed in. */
  markExpired(principalId: string, driver: string, slot: LoginSlot = "primary"): void {
    if (!this.signedIn(principalId, driver, slot)) return;
    writeFileAtomic(join(this.loginDir(principalId, driver as LoginDriver, slot), LOGIN_EXPIRED_MARKER), JSON.stringify({ at: this.now() }), { mode: 0o600 });
  }

  /** #1768: a renew restored the sign-in; drop the expired note so the next
   * turn uses the subscription again without asking to reconnect. */
  clearExpired(principalId: string, driver: string, slot: LoginSlot = "primary"): void {
    if (!isLoginDriver(driver) || !isPrincipalId(principalId)) return;
    if (slot === "second" && !SECOND_LOGIN_DIR[driver]) return;
    rmSync(join(this.loginDir(principalId, driver, slot), LOGIN_EXPIRED_MARKER), { force: true });
  }

  /** 2026-10-29: what a Grok sign-in of this person is (personal or team)
   * and its address, from the CLI's own login record; null when not signed
   * in there or unreadable. */
  grokAccountIdentity(principalId: string, slot: LoginSlot = "primary"): GrokAccountIdentity | null {
    if (!this.signedIn(principalId, "grokAgent", slot)) return null;
    return readGrokAccountIdentity(join(this.loginDir(principalId, "grokAgent", slot), ".grok", "auth.json"));
  }

  private ensureDir(principalId: string, driver: LoginDriver, slot: LoginSlot = "primary"): string {
    const personDir = join(this.options.dataDir, "principals", principalId);
    mkdirSync(personDir, { recursive: true, mode: 0o700 });
    const dir = this.loginDir(principalId, driver, slot);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
      chmodSync(personDir, 0o700);
      chmodSync(dir, 0o700);
    } catch {
      /* best effort on filesystems without modes */
    }
    return dir;
  }

  private markSignedIn(principalId: string, driver: LoginDriver, slot: LoginSlot = "primary"): void {
    const dir = this.ensureDir(principalId, driver, slot);
    writeFileAtomic(join(dir, LOGIN_MARKER), JSON.stringify({ at: this.now() }), { mode: 0o600 });
    rmSync(join(dir, LOGIN_EXPIRED_MARKER), { force: true });
  }

  private flowKey(principalId: string, instanceId: string, slot: LoginSlot = "primary"): string {
    return slot === "second" ? `${principalId}/${instanceId}#second` : `${principalId}/${instanceId}`;
  }

  private loginInstance(principalId: string, instanceId: string, slot: LoginSlot = "primary") {
    const facts = this.options.instance(instanceId);
    if (!facts || !isLoginDriver(facts.driver) || !facts.cli.trim()) throw failure("This engine has no personal sign-in.", 404);
    const driver = facts.driver;
    if (slot === "second" && !SECOND_LOGIN_DIR[driver]) throw failure("This engine keeps one sign-in per person.", 400);
    const key = this.flowKey(principalId, instanceId, slot);
    let controller = this.controllers.get(key);
    if (!controller) {
      const dir = this.ensureDir(principalId, driver, slot);
      const environment = () => {
        const env: Record<string, string | undefined> = { ...process.env, ...facts.environment };
        if (driver === "claudeAgent") {
          env.CLAUDE_CONFIG_DIR = dir;
          delete env.ANTHROPIC_API_KEY;
          delete env.ANTHROPIC_AUTH_TOKEN;
        } else if (driver === "codex") {
          env.CODEX_HOME = dir;
          delete env.OPENAI_API_KEY;
        } else {
          // the device login writes into the person's home only
          delete env.XAI_API_KEY;
          delete env.MOONSHOT_API_KEY;
          delete env.KIMI_API_KEY;
          if (driver === "grokAgent") {
            // GROK_HOME outranks $HOME/.grok. A copied server GROK_HOME must
            // not win over the overlay the device login applies next.
            env.HOME = dir;
            env.GROK_HOME = join(dir, ".grok");
          }
        }
        return env;
      };
      const onAuthenticated = async () => {
        this.markSignedIn(principalId, driver, slot);
        if (driver === "claudeAgent") this.options.onClaudeLinked?.(principalId);
        try { this.options.onEngineSignedIn?.(principalId, driver); } catch { /* best effort */ }
        // what this Grok sign-in brings through grok.com, known before its first turn
        if (driver === "grokAgent") this.warmReach(principalId, instanceId, slot, true);
      };
      controller = this.options.controller
        ? this.options.controller({ driver, cli: facts.cli, home: dir, environment, onAuthenticated })
        : driver === "claudeAgent"
          ? new ClaudeLoginController({ cli: facts.cli, environment: environment as () => NodeJS.ProcessEnv, onAuthenticated })
          : driver === "codex"
            ? new CodexDeviceAuthController({ cli: facts.cli, environment, onAuthenticated })
            : new DeviceLoginController({ engine: driver, cli: facts.cli, home: dir, environment, onAuthenticated });
      this.controllers.set(key, controller);
    }
    const bound = controller;
    return {
      driver,
      instance: {
        instanceId: key,
        startAuthentication: () => bound.start(),
        getAuthentication: async (flowId: string) => {
          const status = await bound.get(flowId);
          // The marker follows the CLI's verdict even when the callback raced.
          if (status.phase === "succeeded" && (!this.signedIn(principalId, driver, slot) || this.expired(principalId, driver, slot))) {
            this.markSignedIn(principalId, driver, slot);
            try { this.options.onEngineSignedIn?.(principalId, driver); } catch { /* best effort */ }
          }
          return status;
        },
        ...(bound.complete ? { completeAuthentication: (flowId: string, pasted: string) => bound.complete!(flowId, pasted) } : {}),
        cancelAuthentication: () => bound.cancel(),
        signOut: async () => {
          try {
            await bound.signOut();
          } catch {
            /* the directory goes below either way */
          }
          rmSync(this.loginDir(principalId, driver, slot), { recursive: true, force: true });
          this.knownModels.delete(key);
          this.reachRead.delete(key);
        },
      },
    };
  }

  /** The model ids this person's own subscription offers on an engine
   * (#1154): what their own Grok session lists, not the server's catalog.
   * Null when it is not known (not signed in, no CLI answer, an engine that
   * lists nothing per person): the picker then keeps the server's list. */
  async accountModels(principalId: string, instanceId: string): Promise<string[] | null> {
    const env = this.accountEnv(principalId, instanceId);
    if (!env) return null;
    const models = await (this.options.probeModels ?? probeGrokModels)(env.cli, env.env) ?? readGrokModelsCache(env.env);
    const ids = models?.map((model) => model.id) ?? [];
    const answer = ids.length ? ids : null;
    if (answer) this.knownModels.set(this.flowKey(principalId, instanceId), { at: this.now(), ids: answer });
    return answer;
  }

  /** #1154: what a turn may read without starting the engine: the last
   * answer of accountModels (fresh for ACCOUNT_MODELS_TTL_MS), else the
   * catalog the person's own Grok wrote in their home. Null when unknown. */
  knownAccountModels(principalId: string, instanceId: string): string[] | null {
    const env = this.accountEnv(principalId, instanceId);
    if (!env) return null;
    const memo = this.knownModels.get(this.flowKey(principalId, instanceId));
    if (memo && this.now() - memo.at < ACCOUNT_MODELS_TTL_MS) return memo.ids;
    const ids = readGrokModelsCache(env.env)?.map((model) => model.id) ?? [];
    return ids.length ? ids : memo?.ids ?? null;
  }

  /** #1154: a turn never waits on the engine. Nothing known yet: ask the
   * person's own session in the background (once at a time per person and
   * engine) so a later turn and the model menu read the answer. */
  warmAccountModels(principalId: string, instanceId: string): void {
    if (!this.accountEnv(principalId, instanceId) || this.knownAccountModels(principalId, instanceId)) return;
    const key = this.flowKey(principalId, instanceId);
    if (this.warming.has(key)) return;
    this.warming.add(key);
    void this.accountModels(principalId, instanceId).catch(() => null).finally(() => this.warming.delete(key));
  }

  private accountEnv(principalId: string, instanceId: string, slot: LoginSlot = "primary"): { cli: string; env: Record<string, string | undefined> } | null {
    const facts = this.options.instance(instanceId);
    if (!facts || facts.driver !== "grokAgent" || !facts.cli.trim() || !this.signedIn(principalId, "grokAgent", slot)) return null;
    const dir = this.loginDir(principalId, "grokAgent", slot);
    const env: Record<string, string | undefined> = { ...process.env, ...facts.environment, HOME: dir, GROK_HOME: join(dir, ".grok") };
    delete env.XAI_API_KEY;
    return { cli: facts.cli, env };
  }

  /** 2026-10-29: read what a Grok sign-in brings through grok.com (its
   * managed gateway connectors) with a standalone probe of the person's own
   * CLI, so Providers and the turns know each account's reach before its
   * first turn. Kept by the sign-in folder (grok-tool-catalog.ts
   * noteGrokAccountReach), the same key a turn on it writes. Once per
   * sign-in per process unless `force`; never awaited by a turn. */
  warmReach(principalId: string, instanceId: string, slot: LoginSlot = "primary", force = false): void {
    const probe = this.options.probeReach;
    const env = probe ? this.accountEnv(principalId, instanceId, slot) : null;
    if (!probe || !env) return;
    const key = this.flowKey(principalId, instanceId, slot);
    if (!force && this.reachRead.has(key)) return;
    this.reachRead.add(key);
    const home = this.loginDir(principalId, "grokAgent", slot);
    void probe(env.cli, env.env).then((result) => { if (result) noteGrokAccountReach(home, result, this.now()); }).catch(() => {});
  }

  async start(principalId: string, instanceId: string, sessionId: string, slot: LoginSlot = "primary"): Promise<ProviderAuthenticationStart> {
    const { instance } = this.loginInstance(principalId, instanceId, slot);
    return this.sessions.start(instance, sessionId);
  }

  async status(principalId: string, instanceId: string, sessionId: string, flowId: string, slot: LoginSlot = "primary"): Promise<ProviderAuthenticationStatus> {
    return this.sessions.status(this.flowKey(principalId, instanceId, slot), sessionId, flowId);
  }

  async complete(principalId: string, instanceId: string, sessionId: string, flowId: string, pasted: string, slot: LoginSlot = "primary"): Promise<void> {
    this.loginInstance(principalId, instanceId, slot);
    return this.sessions.complete(this.flowKey(principalId, instanceId, slot), sessionId, flowId, pasted);
  }

  async cancel(principalId: string, instanceId: string, sessionId: string, flowId: string, slot: LoginSlot = "primary"): Promise<void> {
    return this.sessions.cancel(this.flowKey(principalId, instanceId, slot), sessionId, flowId);
  }

  async signOut(principalId: string, instanceId: string, sessionId: string, slot: LoginSlot = "primary"): Promise<void> {
    const { instance } = this.loginInstance(principalId, instanceId, slot);
    await this.sessions.signOut(instance, sessionId);
  }

  /** The console's Reset access (2026-10-08): every subscription sign-in
   * this person keeps here is deleted; answers how many there were. */
  clearAll(principalId: string): number {
    if (!isPrincipalId(principalId)) return 0;
    let cleared = 0;
    for (const driver of Object.keys(LOGIN_DIR) as LoginDriver[]) {
      for (const slot of ["primary", "second"] as const) {
        if (slot === "second" && !SECOND_LOGIN_DIR[driver]) continue;
        const dir = this.loginDir(principalId, driver, slot);
        if (!existsSync(dir)) continue;
        if (existsSync(join(dir, LOGIN_MARKER))) cleared += 1;
        rmSync(dir, { recursive: true, force: true });
      }
    }
    for (const key of this.controllers.keys()) if (key.startsWith(`${principalId}/`)) this.controllers.delete(key);
    for (const key of this.knownModels.keys()) if (key.startsWith(`${principalId}/`)) this.knownModels.delete(key);
    return cleared;
  }

  /** A session ended: its flows end with it. */
  revokeOwner(sessionId: string): void {
    this.sessions.revokeOwner(sessionId);
  }
}
