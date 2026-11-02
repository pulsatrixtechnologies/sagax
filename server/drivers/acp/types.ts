import type {
  EffortLevel,
  EngineInstall,
  McpServerSpec,
  ModelCatalog,
  ProviderErrorCode,
  ProviderSnapshot,
  RequestOutcome,
  SendTurnInput,
  TurnAccessInput,
} from "../../contracts.ts";
import type { DeviceSignIn } from "../device-auth.ts";
import type { LinkSignIn } from "../link-sign-in.ts";
import type { LogSignal } from "./quiet-status.ts";
import type { TurnLatency } from "./turn-latency.ts";
import type { ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";

/** Failures the person fixes on their provider account, not by retrying:
 * the process that reported one is healthy and stays pooled. */
export type AccountErrorCode = Extract<ProviderErrorCode,
  "invalid_credentials" | "inactive_subscription" | "insufficient_funds" | "quota_or_region_restriction" | "model_access_disabled">;

export interface AcpConfig {
  cli: string;
  fullAuto: boolean;
  /** Optional home for this instance's sessions. */
  workspace?: string;
  /** Models a custom agent lists, so each bot can pick one. */
  models?: { default: string; options: Array<{ id: string; label: string }> };
  /** Thinking levels a custom agent accepts, so each bot can pick one. */
  effortLevels?: readonly EffortLevel[];
}

/** A pending request.opened answer: the callback stored in the running
 *  turn's asks map (shared shape with the runtime Turn record). */
export type AcpAskFinish = (
  behavior: string,
  source?: "user" | "timeout" | "system",
  message?: string,
  always?: boolean,
) => RequestOutcome;

/** The running turn a pooled session is servicing — the per-turn half of
 *  the bookkeeping (Claude's Session.turn, split the same way). Server
 *  requests and updates that arrive between turns see `current: null`. */
export interface AcpTurn {
  turnId: string;
  /** the model-resolved turn (see resolveTurnModel) */
  turn: SendTurnInput;
  turnConfig: AcpConfig;
  controlsHost: boolean;
  /** Sagax approval gate on (grok-approval-gate.ts): the MCP servers this
   * turn mounted through the gate. The agent's own ask about a call to one
   * of them is answered allow-once; the gate decides (gated-mcp-ask.ts). */
  gatedServers?: ReadonlySet<string>;
  /** Every MCP server Sagax mounted for this turn: a use_tool call to any
   * other is an engine's own connector (connector-ask.ts). */
  mountedServers?: ReadonlySet<string>;
  /** this turn's stage timestamps, logged once when it settles */
  latency?: TurnLatency;
  state: {
    settled: boolean; promptSent: boolean; text: string; producedItem: boolean; startupActivity: boolean; stopped: boolean;
    /** Compaction detection: peak and last reported context size, and
     * whether a report collapsed below the peak. */
    usagePeak: number | null;
    usageLast: number | null;
    usageCompacted: boolean;
    /** The context window the agent reports beside `used` (ACP `size`). */
    usageSize?: number | null;
    /** the agent streamed something (text, thought, tool) for this prompt */
    promptActivity?: boolean;
  };
  /** inputs of this turn's tool calls by id, for onToolCompleted */
  toolInputs?: Map<string, unknown>;
  /** ConnectWise calls of this turn by id, for their widget */
  cwToolNames?: Map<string, string>;
  acknowledge: () => void;
  asks: Map<string, AcpAskFinish>;
  /** Tool calls the agent started and has not yet reported finished. A tool
   * such as `sleep` or a quiet build sends nothing while it runs, so the
   * prompt's silence watchdog waits for these as it does for asks. */
  runningTools: Set<string>;
  /** Synthetic item ids handed to `tool_call` notifications the agent sent
   * without a `toolCallId`: lifecycle consumers pair a tool's start with
   * its completion by `itemId` (the tool chip's result among them), so an
   * unkeyed call must still carry one stable id across both events. */
  unkeyedToolIds: string[];
  /** Tool items already completed this turn: ACP v1 may name a finished call again, which must not end it twice. */
  endedToolIds: Set<string>;
  interruptTimer: ReturnType<typeof setTimeout> | null;
  /** ends the quiet-status watch started with the prompt */
  stopQuietWatch: (() => void) | null;
  flushAssistantText: () => void;
  /** fold a session config snapshot into sessionConfigResult + the picker */
  receiveModelVariants: (result: any) => void;
}

/** A live JSON-RPC-2.0 connection over one agent child's stdio: pending
 *  request bookkeeping, UTF-8-safe line framing, and native logging. */
export interface AcpConnection {
  send(obj: unknown): void;
  /** `timeoutMs` is a hard deadline from the request; `idleMs` is the prompt
   *  only (the one request that legitimately streams for minutes) and restarts
   *  on every inbound line, so it trips solely on total silence. `idleMessage`
   *  becomes the rejection error. */
  request(
    method: string,
    params: unknown,
    timeoutMs?: number,
    receive?: (result: any) => void,
    idleMs?: number,
    idleMessage?: string | (() => string),
  ): Promise<any>;
  /** when the child last wrote a line */
  readonly lastInboundAt: number;
  /** restart every idle deadline: proof of life from outside the wire */
  touch(): void;
  failAll(error: Error): void;
  /** stop dispatching child output — pending RPCs reject, nothing parses */
  close(): void;
}

/** One live ACP agent process per thread, kept across turns. The spawn
 *  handshake (initialize/authenticate) and the native session are paid once;
 *  later turns prompt the live session. The pool shape is the Claude
 *  driver's: spawn contract in, quiet-timeout out, crash drops the record. */
export interface AcpSession {
  child: ChildProcessByStdio<Writable, Readable, Readable>;
  acp: AcpConnection;
  launch: { command: string; args?: string[] };
  /** the environment the child was spawned with */
  env: Record<string, string | undefined>;
  cwd: string;
  /** the spawn contract — a different one means a fresh process */
  contractKey: string;
  /** the establishment inputs (mcpServers) the live native session was built
   *  with. They ride session/new and session/load, not the process argv, and
   *  the harness rotates integration bearer tokens every turn — so a change
   *  here re-establishes the session on the same child instead of respawning. */
  sessionKey: string | null;
  /** the live native session id, or null until one is established */
  sessionId: string | null;
  /** the agent's last config-option snapshot; persists across turns so an
   *  unchanged model skips the session/set_config_option RPC */
  sessionConfigResult: any;
  /** initialize's result — requested once per process */
  initResult: any;
  /** authenticate answered on this process; a turn that skips subscription
   *  auth neither checks nor marks it */
  authenticated: boolean;
  idleTimer: ReturnType<typeof setTimeout> | null;
  closing: boolean;
  /** the child exited — the record is dropped and the next turn respawns */
  dead: boolean;
  stderr: string;
  /** the running turn, or null between turns */
  current: AcpTurn | null;
  /** the last model fallback reported on this process ("wanted\nused"), so
   * a pooled conversation says it once rather than on every turn */
  fallbackNotice?: string;
  /** the model the process was told to start sessions on (sessionModelEnv) */
  launchModel?: string;
  /** A background session/prompt that writes the call's system prefix into
   * the provider cache. The spoken turn joins it briefly. `current` stays
   * null, so its chunks are not a turn. */
  cachePrime?: Promise<void>;
  cachePrimed?: boolean;
}

/** Per-harness specifics — everything that differs between Grok, Gemini, … */
export interface AcpSupport {
  /** Verified native catalog parameters, applied before both new and restored sessions. */
  toolScopeSessionParams?(turn: SendTurnInput, initializeResult: unknown, hasMcp: boolean,
    context: { config: AcpConfig; env: Record<string, string | undefined>; cwd: string }): Record<string, unknown>;
  /** Existing native restrictions also participate in scoped session reuse. */
  toolScopeCacheKey?(context: { config: AcpConfig; env: Record<string, string | undefined>; cwd: string }): string;
  driverKind: string;
  displayName: string;
  /** Omit for subscription CLIs (the default). Custom-only CLIs sit below
   *  the picker-rail divider and have no first-party cloud catalog. */
  access?: "subscription" | "custom";
  models: { default: string; options: Array<{ id: string; label: string }> };
  /** Effort levels this harness's CLI accepts, ascending. Omit when it has
   * no reasoning-effort control. Static for the same reason `models` is:
   * describe() runs before any session exists, so there is no _meta to read
   * — eventually both should come from initialize's _meta.modelState. */
  effortLevels?: readonly EffortLevel[];
  /** The spawned command and the session profile withhold this CLI's own
   * shell, file and web tools when the turn sets withholdHostTools. */
  withholdsHostTools?: boolean;
  /** A withheld turn runs in this folder instead of the turn's: an empty
   * one Sagax owns, so no workspace file (settings, hooks, MCP servers,
   * context) of the turn's folder is read by an engine that would load it
   * (server/drivers/host-tools.ts withheldWorkspace). */
  withheldWorkspace?(): string;
  /** Discover and select opaque model variants through ACP config options. */
  modelVariants?: boolean;
  /** Default CLI binary name if the instance config doesn't override it. */
  defaultCli: string;
  /** Optional live model catalog. A failed lookup keeps the last usable catalog.
   *  `config` is the instance decode so a support can ask the same binary it
   *  will spawn (custom `cli` paths), not whatever happens to be named on PATH. */
  resolveModels?(
    environment: Record<string, string | undefined>,
    config: AcpConfig,
    instanceId: string,
  ): ModelCatalog | Promise<ModelCatalog>;
  /** Some managed agents are intentionally not probed during app startup.
   * Their explicit Refresh action remains the only network/process boundary. */
  resolveModelsOnCreate?: boolean;
  /** Native-protocol log label, e.g. "grok.acp". */
  nativeSource: string;
  /** Whether models behind this ACP harness can consume a referenced image.
   * Most coding agents can open local files; opt out for text-only agents. */
  images?: boolean;
  /** Narrow compatibility exception for a CLI with verified native image
   * transport but a defective initialize capability (never a path fallback). */
  acceptsUnadvertisedImages?(initializeResult: unknown): boolean;
  /** Message shown when the CLI is present but not signed in. */
  loginNote: string;
  /** How a user installs this harness's CLI; surfaced by the setup UI. */
  install?: EngineInstall;
  /** The CLI's own device-code login (`grok login --device-auth`), offered
   * in the app wherever this engine reads signed out. It runs with the same
   * binary and environment as the turns, and is confirmed by isAuthenticated's
   * own evidence (device-auth.ts). */
  deviceSignIn?: DeviceSignIn;
  /** A CLI sign-in that prints a page and no one-time code (Cursor). */
  linkSignIn?: LinkSignIn;
  /** CLI argv AFTER the binary name to enter ACP stdio mode. */
  spawnArgs(config: AcpConfig, turn: SendTurnInput, launch?: { approvalGate: boolean }): string[];
  /** Sagax gates this turn's MCP calls itself (mcp-gate-approval.ts): every
   * MCP server is mounted through the gate with an approval socket, and
   * only `approvalReadOnly` tools run unasked. Decided once per turn; the
   * same decision reaches spawnArgs as `launch.approvalGate`. */
  approvalGate?(config: AcpConfig, turn: SendTurnInput, context?: { env: Record<string, string | undefined>; cwd: string }): boolean;
  /** The reviewed read-only tools of one mounted server (upstream names). */
  approvalReadOnly?(server: { name: string; builtin: boolean; spec?: McpServerSpec }, botId?: string): string[];
  /** Provider credential variables this ACP child is allowed to inherit. */
  credentialEnv?: readonly string[];
  /** Select the model through a session config option instead of argv, for
   *  harnesses whose ACP subcommand takes no -m (opencode). The agent must
   *  CONFIRM the requested model before we prompt: silently running a model
   *  other than the one the picker shows is the failure this guards. */
  selectModel?: { configId: string };
  /** With `selectModel`: the model a turn runs when it asked for none, or for
   * one this live session does not offer (a retired id saved on an old bot).
   * Receives the session's config snapshot and the instance catalog default;
   * returns an offered model, or null to keep today's strict behaviour. A
   * replaced, non-empty request is reported to the person as a notice. */
  fallbackModel?(sessionConfig: unknown, catalogDefault: string): string | null;
  /** The environment variable this runtime reads its new-session default
   * model from. Set at spawn to the turn's model so session/new already runs
   * it and the separate model switch is skipped. It is not part of the spawn
   * contract: a later model change still goes over the wire. The runtime
   * takes any id from it unchecked (Antigravity even adds it to the session's
   * list), and the switch it replaces was the only check, so it is set only
   * for a model this account has itself offered: in the discovered catalog,
   * or in a session list from a process started without it. */
  sessionModelEnv?: string;
  /** Part of the spawn contract beside the environment: state outside it
   * that a running process never reads again (OpenCode's auth.json), so a
   * conversation whose process predates a change gets a fresh one. */
  spawnFingerprint?(env: Record<string, string | undefined>, config: AcpConfig): string;
  /** The approval mode is applied to the session on every turn (in
   * configureSession) and nothing about the process depends on it, so an
   * approval change must not respawn the process. The pooled session may
   * still hold an earlier turn's looser mode, so configureSession must set
   * this turn's mode and throw unless the runtime confirms it; the core then
   * sends no prompt and discards the process (see approvalUnconfirmed). */
  sessionScopedApproval?: boolean;
  /** False when this engine cannot run memory upkeep's one-shot text call
   * cleanly (generateMemoryText, ./background-text.ts). On by default. */
  backgroundText?: false;
  /** Mutate the child env in place: strip a key, inject a policy. Receives the
   *  instance config so a support can vary with fullAuto, and the instance
   *  environment so it can tell a key the server put there on purpose from
   *  one riding along in the server's own env. */
  transformEnv?(
    env: Record<string, string | undefined>,
    config: AcpConfig,
    instanceId: string,
    instanceEnvironment: Readonly<Record<string, string>>,
  ): void;
  /** Resolve a managed or account-scoped executable just before use. */
  resolveCommand?(
    env: Record<string, string | undefined>,
    config: AcpConfig,
    instanceId: string,
  ): Promise<{ command: string; args?: string[]; env?: Record<string, string | undefined> }>;
  /** Snapshot override for agents whose binary has no conventional --version. */
  snapshot?(
    env: Record<string, string | undefined>,
    config: AcpConfig,
    instanceId: string,
  ): Promise<ProviderSnapshot>;
  /** Google Antigravity resumes through session/resume, not session/load. */
  resumeMethod?: "load" | "resume";
  /** After a successful session/load|resume: whether the restored native
   * session can serve this turn as asked. False when the runtime keeps the
   * stored session's own settings on load (Grok restores the session's model
   * and ignores the new profile's model) and switching them in place is not
   * safe. The core then opens a fresh native session on the same process,
   * with the same establishment inputs, and carries the thread's history in
   * the prompt (session.started says `rebuilt`), as when the session is gone. */
  acceptsLoadedSession?(ctx: { turn: SendTurnInput; currentModelId?: string }): boolean;
  /** Some agents acknowledge a live load without applying new MCP credentials. */
  restartOnMcpChange?: boolean;
  /** sendTurn honours warmOnly (a voice call being accepted): the pooled
   * process is started and pays initialize, authenticate and session/load
   * (or session/new) with no prompt and no turn events, so the call's first
   * spoken turn is a bare session/prompt. Opt-in per harness. */
  warmSession?: boolean;
  /** Route workspace file access through ACP so edits retain approval cards. */
  clientFileSystem?: boolean;
  /** Sent as `clientCapabilities._meta` on initialize, where agents read vendor capabilities. */
  clientCapabilitiesMeta?: Record<string, unknown>;
  /** Do not retain stderr from providers that may place OAuth material there. */
  redactStderr?: boolean;
  /** The agent's own debug log for a native session, read while a prompt is
   * quiet: any new line proves the process alive, and `parse` picks out what
   * is worth telling the person (a retry, a compression). Return null when
   * this process keeps no log. */
  statusLog?: {
    path(env: Record<string, string | undefined>, sessionId: string): string | null;
    parse(line: string): LogSignal | null;
  };
  /** Bound provider-native tool payloads before writing diagnostic logs. */
  sanitizeToolPayload?: boolean;
  /** Whether a use_tool target is one of the cloud connectors of the account
   * the session runs on (Grok's managed gateway, from the session's own
   * `_x.ai/mcp/list`). Such an ask says so (`accountConnector`), so a read
   * of the person's own connector passes with no card (index.ts). Unknown:
   * false, the ask keeps the level's card. */
  accountConnectorTool?(sessionId: string | undefined, tool: string): boolean;
  /** Mutate the child env after the turn model is known. Catalog refresh and
   *  snapshot share `transformEnv` and must not see a per-turn overlay. */
  applyTurnEnv?(
    env: Record<string, string | undefined>,
    ctx: { model?: string; requestedModel?: string; fullAuto: boolean; botId?: string; cwd: string; toolScope?: SendTurnInput["toolScope"]; withholdHostTools?: boolean; accountConnectors?: boolean; approvalGated?: boolean; localKeyPrincipal?: string; threadId: string; mcpServers: Array<{ name: string; command: string; args: string[]; env: Array<{ name: string; value: string }> }> },
  ): void;
  /** Organization server (SendTurnInput.access): point this one turn's child
   *  at the payer's own home and key, never the server's own login.
   *  `instanceEnvironment` holds the organization's key for an org-key turn.
   *  Without this hook a support runs every access on its own environment. */
  applyAccess?(
    env: Record<string, string | undefined>,
    access: TurnAccessInput,
    instanceEnvironment: Record<string, string> | undefined,
  ): void;
  /** Pick the ACP authenticate methodId from initialize's advertised
   * authMethods (and the child's env, for a key that needs a method of its
   * own); return null to skip the authenticate step. `env` is the
   * environment the agent process was spawned with. */
  pickAuthMethod(authMethods: Array<{ id?: string }>, env: Record<string, string | undefined>): string | null;
  /** "fail": abort if auth is missing/errors (subscription CLIs).
   * "fail-request": cached API credentials need no method, but a requested
   * OAuth login must succeed. "continue": proceed on an ambient login. */
  authFailure: "fail" | "fail-request" | "continue";
  /** snapshot(): can this harness actually run a turn? (env already carries the
   *  merged config). May be async for harnesses that have to ask the CLI. */
  isAuthenticated(
    env: Record<string, string | undefined>,
    config: AcpConfig,
    instanceId: string,
  ): boolean | Promise<boolean>;
  /** Refuse a first-party cloud turn before spawning when snapshot auth is
   * false. Local injected models deliberately bypass this subscription gate. */
  requireAuthenticationBeforeSpawn?: boolean;
  /** Classify provider-native failures without coupling the core to messages. */
  classifyError?(error: unknown): ProviderErrorCode | undefined;
  /** Plain words for an account failure (bad key, no credit, a used-up
   * quota, no subscription) in place of the provider's raw RPC text. */
  describeAccountError?(code: AccountErrorCode, model?: string): string;
  /** Compose the session/prompt text. Default prepends the persona. */
  buildPromptText?(turn: SendTurnInput): string;
  /** A standing line appended to the stable system half (and the full
   * system prompt), delivered with it once per native session. */
  stableSystemHint?: string;
  /** The agent skips MCP tool names it cannot qualify as `server__tool`
   * (Grok: a second `__`, a dot, a key over 256). Every MCP server is then
   * mounted through the gate, which registers each tool under an admissible
   * alias and maps calls back (server/mcp-tool-names.ts). */
  mcpToolNames?: "grok";
  /** A context section added to the volatile half each turn. The section
   * split (prompt-split.ts) re-sends it only when its text changes. */
  volatileSection?(input: { botId?: string; serverNames: string[]; sessionId?: string; threadId?: string; accountConnectors?: boolean }): { id: string; text: string } | null;
  /** A tool call finished successfully, with the input it was started with. */
  onToolCompleted?(input: { botId?: string; rawInput: unknown }): void;
  /** Ask once more when the agent sends nothing at all (no text, thought or
   * tool call, no question) for this many ms after the prompt; 0 is off. */
  stallRetryMs?(context?: { contextTokens: number | null; promptChars: number }): number;
  /** The context size a vendor notification reports (tokens), for agents
   * that send no ACP usage_update; undefined when the message is not one. */
  roundContextUsage?(msg: any): number | undefined;
  /** Rewrite a picker id (`omlx::model`) into the CLI-native id before spawn
   * and session/select. Local inject writers live here so the child sees a
   * model it already knows. */
  resolveTurnModel?(
    model: string | undefined,
    env: Record<string, string | undefined>,
  ): string | undefined;
  /** Apply per-session settings between session/new (or session/load) and the
   * first session/prompt. Some CLIs ignore argv and take the model/mode over
   * the wire instead (droid), so this is the only place the pick can land; a
   * throw here fails the turn rather than silently running another model.
   * It may instead return the model the session actually runs, when the
   * runtime answered with another one (an id it does not offer) and said so
   * through `notice`: the turn then reports that model. */
  configureSession?(ctx: {
    request: (method: string, params: unknown, timeoutMs?: number) => Promise<any>;
    sessionId: string;
    env: Record<string, string | undefined>;
    config: AcpConfig;
    turn: SendTurnInput;
    /** `session/new` (or `session/load`) advertised model list, verbatim. Some
     * CLIs namespace their ACP model ids differently from their argv `--model`
     * slugs (Cursor answers `default[]` where the CLI calls it `auto`), so a
     * driver that only knows the argv slug cannot form a valid set_model
     * without this. Empty when the agent advertised none. */
    sessionModels: Array<{ modelId?: string; name?: string }>;
    /** Last model acknowledged by session/new/load/set_model, preserved for pooled turns. */
    currentModelId?: string;
    /** session/new's or session/load's `configOptions`, verbatim. */
    configOptions: Array<{ id?: unknown; currentValue?: unknown }>;
    /** Show the person one plain line (a runtime.notice) for this turn:
     * for instance that the session runs another model than the one picked.
     * Said once per conversation for the same message. */
    notice: (message: string) => void;
  }): Promise<void | { model?: string }>;
}
