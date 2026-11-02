// Canonical harness contracts — ported from upstream
// (apps/server/src/provider/ProviderDriver.ts, Services/ProviderAdapter.ts,
// packages/contracts/src/{provider,providerInstance,providerRuntime}.ts),
// de-Effect-ed: Promises instead of Effect, listener callbacks instead of
// Stream. The shapes and names are kept so the two codebases stay mutually
// readable.

import type { ApprovalMode } from "../shared/approval-mode.ts";
import type { ToolScope } from "../shared/tool-scope.ts";
import type { EffortLevel } from "../shared/wire.ts";
import type { HarnessCommand } from "../shared/harness-commands.ts";
import type {
  DriverKind, InstanceId, ModelVariantOption, RuntimeEventListener, ThreadId, TurnId,
} from "../shared/runtime-events.ts";
import type { ProviderIcon } from "../shared/provider-icon.ts";
import type { ModelListIssue } from "../shared/azure-openai.ts";

// These contract types live in shared/wire.ts now (part of the wire model);
// re-exported here so existing server-side importers keep working.
export type { CloudBackend, EffortLevel, ModelSelection } from "../shared/wire.ts";
// Runtime-event wire shapes live in shared/runtime-events.ts now (part of
// the wire model); re-exported here so existing importers keep working.
export type {
  DriverKind, InstanceId, ModelVariantOption, ModelVariantState, RuntimeEvent,
  RuntimeEventBase, RuntimeEventListener, ThreadId, TurnId,
} from "../shared/runtime-events.ts";


export type ProviderErrorCode =
  | "missing_cli"
  | "invalid_credentials"
  | "inactive_subscription"
  /** The account has no credit left for a pay-as-you-go model. */
  | "insufficient_funds"
  | "quota_or_region_restriction"
  /** #1450: the paying account has this model turned off; another model
   * of the same engine may still run. */
  | "model_access_disabled"
  | "upstream_outage"
  | "model_catalog_outage";

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;

  constructor(code: ProviderErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ProviderError";
    this.code = code;
  }
}

/** The driver proved this attempt never reached a prompt or client-side action,
 * and its owned process has stopped. The harness may safely recover it. */
export class TurnNotStartedError extends Error {
  readonly turnId: TurnId;

  constructor(turnId: TurnId, message: string) {
    super(message);
    this.name = "TurnNotStartedError";
    this.turnId = turnId;
  }
}


/** The CLI refused sign-in before any model or tool activity, and its process stopped. */
export class TurnAuthenticationRefusedError extends TurnNotStartedError {
  override readonly name = "TurnAuthenticationRefusedError";
}

/** Variants are opaque provider IDs, not the cross-engine effort enum. */
export function isModelVariant(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256 &&
    value.trim() === value && !/\p{Cc}/u.test(value);
}

// ── model selection ────────────────────────────────────────────────────
// "Which model" is a data value carried on the request, never a service
// binding (upstream ModelSelectionWire). instanceId is the routing key.

/** An image already admitted to Sagax's private attachment store.
 * Drivers receive this structured value instead of learning a host path from
 * prompt text. The harness validates the path and size before constructing it. */
export interface TurnImageInput {
  path: string;
  mime: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  bytes: number;
}

// ── instance configuration envelope ────────────────────────────────────
// `driver` is any slug — NOT validated against known drivers; unknown
// drivers round-trip and surface as unavailable shadow snapshots so a
// config from a newer build downgrades safely.
export interface InstanceConfig {
  driver: DriverKind;
  displayName?: string;
  accentColor?: string;
  /** Presentation override for this instance only. Driver branding stays
   * unchanged and custom images are admitted as bounded local data URLs. */
  icon?: ProviderIcon;
  environment?: Record<string, string>;
  enabled?: boolean;
  /** Picker group for this instance, over its driver's default: an
   * `openai-compat` instance on a provider's own key is "api", not "custom". */
  access?: EngineAccess;
  config?: unknown;
}

export type InstanceConfigMap = Record<InstanceId, InstanceConfig>;

// ── canonical runtime events ───────────────────────────────────────────
/** What became of an answer to an ask. `allowed-once` grants only the
 * asked-about action — broadening ("always allow") stays a separate,
 * explicit step. `unavailable` is the fail-closed default: no answerer,
 * no action. */
export type RequestOutcome = "allowed-once" | "rejected" | "answered" | "unavailable";

// ── adapter contract (upstream ProviderAdapterShape, promise-flavored) ──
// The conversation runtime every provider is flattened into. streamEvents
// becomes onEvent(listener) → unsubscribe; sessions start implicitly on
// the first turn (the agentcal per-turn-process model) with resumeCursor
// carrying the provider-native continuation (e.g. a claude session id).
/** See SendTurnInput.access. `identity` is a non-secret label
 * (subscription:<pid>, owner-key:<pid>:<fingerprint>,
 * speaker-key:<pid>:<fingerprint>, server, org-key); a driver never reuses
 * a process started under another identity. `owner-key` and `speaker-key`
 * are both a person's own key from Perspicax (the bot's owner's, or the
 * person who spoke's). */
export interface TurnAccessInput {
  via: "subscription" | "owner-key" | "speaker-key" | "server" | "org-key";
  identity: string;
  environment?: Record<string, string>;
  /** File-backed key sealed for this person (engine-api-keys.ts). */
  localKeyPrincipal?: string;
  claudeConfigDir?: string;
  codexHome?: string;
  codexOwnerKey?: boolean;
  /** Grok Build, Kimi Code, Gemini CLI, pi: the payer's own home for the
   * engine (HOME, KIMI_CODE_HOME, GEMINI_CLI_HOME, PI_CODING_AGENT_DIR). */
  engineHome?: string;
}

/** #1276: Claude Code, local or cloud, sends a compact tool list. The
 * stable prefix is every engine (server/compact-prompt.ts). */
export interface CompactPromptInput {
  /** Claude Code's auto memory folder: one per bot and person, the same for
   * every conversation, so the system prompt does not change between them. */
  memoryDir?: string;
  /** The agents catalog: "default" lists what Claude Code loads up front,
   * "used" the heart of a chat turn; `pinned` adds the bot's most used tools. */
  agents: { core: "default" | "used"; pinned: string[] };
  /** Per MCP server the bot owns: its tools listed whole (the bot's most
   * used); a big catalog is searched for the rest. */
  pinned: Record<string, string[]>;
}

export interface SendTurnInput {
  threadId: ThreadId;
  /** #1276: compact tool list for this turn (Claude Code). Absent: the
   * full tools/list, as before. */
  compactPrompt?: CompactPromptInput;
  /** The bot this turn belongs to. threadIds are meant to be unique per bot
   * task, but a driver's process-level resource maps (permission-broker
   * socket, CLI session) key off threadId alone — botId lets a driver namespace
   * those resources so a threadId that unexpectedly coincides across two
   * bots (e.g. a delegation still holding its own broker open) can never
   * collide with another bot's live session or broker (see #1017). */
  botId?: string;
  text: string;
  /** When the person's message behind this turn was stored (epoch ms), for
   * the driver's per-turn latency line (drivers/acp/turn-latency.ts). */
  receivedAt?: number;
  /** Organization server (slice 4, server/engine-credentials.ts): which
   * credentials this one turn runs with. Absent in solo mode: the instance's
   * own configuration, as always. */
  access?: TurnAccessInput;
  /** 2026-10-26 (server/credential-command-env.ts): API keys the person
   * exposed to this bot's commands, by the names they chose. A driver whose
   * engine runs commands in its own shell adds them to that process's
   * environment, and starts a fresh process when they change. */
  commandEnvironment?: Record<string, string>;
  /** The automatic recall block the harness put in front of the person's
   * message inside `text`. It informs this turn only, so a driver that
   * replays the turn as sent later can leave it out. */
  recalled?: string;
  /** Per-bot approval policy, reasserted by providers on every turn so a
   * resumed native session cannot retain a stale, more permissive mode. */
  approvalMode?: ApprovalMode;
  /** Fresh owner selection, independent of execution approval and resume state. */
  toolScope?: ToolScope;
  /** A guest drives this turn on an OMB Cloud home: it runs with no shell
   * or command execution and reads nothing outside its own folder. Sent
   * only to a driver whose capabilities.guestTurns is "confined"; the harness
   * refuses the turn for any other (docs/cloud-pro.md). */
  guestConfined?: boolean;
  /** Why this turn is confined, in the owner's words, for a refusal to end
   * with (on a personal Cloud home, what came before it: a routine or a
   * conversation from before this update). */
  confinedWhy?: string;
  /** Images attached to this user turn only. They are deliberately kept out
   * of replay transcripts: the provider's native session owns earlier image
   * context, while a fresh replay retains the visible attachment marker. */
  images?: TurnImageInput[];
  model?: string;
  effort?: EffortLevel;
  variant?: string;
  resumeCursor?: unknown;
  /** Start without the previous native context, including any retained idle
   * process. Takes precedence over resumeCursor. The runtime supplies the
   * active conversation in text/transcript when rebuilding a session. */
  sessionReset?: boolean;
  /** Hold the startup ACK until prompt dispatch; a safely retired transient
   * setup failure may reject with TurnNotStartedError instead of completing. */
  startupRecovery?: boolean;
  /** The turn with the conversation so far replayed inline, attached only
   * alongside resumeCursor. A cursor-resuming driver sends it once, on a
   * fresh session, when the provider refuses the cursor before reading the
   * prompt (server/resume-recovery.ts) — so a session the provider lost
   * does not brick the thread, and the new session is not blank. */
  recoveryText?: string;
  /** Prior turns for transcript-replay providers (API-backed drivers). */
  transcript?: Array<{ role: "user" | "assistant"; text: string }>;
  /** Bot persona (name/title/description) as a system prompt. */
  system?: string;
  /** `system` split at the sections that legitimately change mid-conversation
   * (the sections in VOLATILE_SECTIONS, system-prompt.ts): `systemStable` is
   * everything else, `systemVolatile` is those sections' text. A driver that keeps one CLI process per thread keys
   * that process on the stable half, so a memory edit no longer respawns the
   * session and makes the provider re-cache the entire prompt; the changed half
   * is delivered inside the next turn instead. Drivers that rebuild their
   * request every turn keep only the stable half in their system message and
   * carry the volatile half inside the newest user message, so the resent
   * prefix stays byte-identical. */
  systemStable?: string;
  systemVolatile?: string;
  /** systemVolatile by section (id and text, in prompt order). A session
   * driver re-sends only the sections that changed (prompt-split.ts). */
  systemVolatileSections?: Array<{ id: string; text: string }>;
  /** True when this turn's user message tags teammates: the mentions part of
   * systemVolatile describes this turn even when its text is unchanged from
   * the previous turn, so digest-based delivery must not suppress the note. */
  mentionTurn?: boolean;
  /** The thread is on a live voice call: keep the engine process warm from
   * turn to turn. A driver that pools one process per thread hands per-turn
   * credentials to it through files it rewrites each turn, so a new turn's
   * token never forces a relaunch (docs/voice-mode-xai.md, "Latency"). */
  keepWarm?: boolean;
  /** Start (or keep) the pooled engine process without a user turn. No
   * prompt is written and no turn events are emitted, unless `cachePrime`
   * asks for one background prompt that only fills the provider cache.
   * A call warms the process when it is accepted so the first spoken turn
   * reuses it. Drivers that cannot start without a prompt leave
   * `warmSession` unset and the harness does not send them this flag. */
  warmOnly?: boolean;
  /** With warmOnly, on a voice call: after the session exists, send one
   * background prompt of the system prefix so the first spoken turn can
   * read it from the provider cache. Not awaited, and not a turn. */
  cachePrime?: boolean;
  /** Aborted when the call ends before that warm process is needed. The
   * driver closes the idle process this warm started. A process a real
   * turn already owns stays up. */
  warmSignal?: AbortSignal;
  /** Coordinated teammate turns may resume a Claude conversation whose
   * earlier system prompt contained a different assignment. Refresh that
   * prompt when the provider supports it; the current brief also arrives
   * in this turn's text. */
  refreshSystemPrompt?: boolean;
  /** The built-in browser is this conversation's place, so the bot will very
   * likely browse: a driver may load its tools up front instead of behind a
   * tool search, which costs the first browser action a model step. */
  preloadBrowserTools?: boolean;
  /** Per-bot integrations the driver may hand to the agent as tools. */
  integrations?: {
    /** Direct stdio connection to a computer MCP server: Cua Driver (host,
     * sandbox, or VPS) or the harness's own cloud computer server (a Boat).
     * Every engine reaches every computer this way, on its own model.
     * `scope` is set only for the user's host desktop; isolated and
     * remote computers intentionally omit it so host-only approval rules
     * cannot change their semantics. */
    localComputer?: {
      command: string;
      args: string[];
      env: Record<string, string>;
      platform?: "darwin" | "linux" | "win32";
      generation?: string;
      scope?: "local-computer";
    };
    /** Engine lifecycle hooks (Claude Code hooks today): the harness's
     * loopback URL and a turn-scoped bearer the engine's hook helper presents
     * on POST /api/internal/hook. A driver that declares `capabilities.hooks`
     * registers the helper with its engine; the harness only ever observes
     * and injects context through this channel, never decides state. */
    hooks?: { url: string; token: string };
    /** Peer-agent comms: an MCP proxy (list_bots / ask_bot) that routes back
     * through the harness so this bot can message other bots. The harness
     * owns turns, permissions, and recursion limits; the proxy only forwards. */
    agents?: { command: string; args: string[]; env: Record<string, string> };
    /** Physical Android phone tools over authorized USB debugging. */
    phone?: { command: string; args: string[]; env: Record<string, string> };
    /** Messages on the solo Mac where this process runs. Never mounted on
     * an organization server, and never a desktop-bridge operation. */
    messages?: { command: string; args: string[]; env: Record<string, string> };
    /** The app's built-in browser: an MCP proxy (server/harness-mcp-proxy browser)
     * that forwards to the Electron-owned WebContentsView the Browser tab
     * shows. One tab per bot, in its own persistent session partition. */
    browser?: { command: string; args: string[]; env: Record<string, string> };
    /** The Data tools (server/data): an MCP proxy (server/harness-mcp-proxy
     * data) that forwards to the harness, where DuckDB runs on this bot's
     * own database and the Computer panel's Data tab shows the sheet. */
    data?: { command: string; args: string[]; env: Record<string, string> };
    /** dweb network daemon: an MCP proxy exposing dweb status, repo, and
     * opencode model access as tools. url is the dweb HTTP base. */
    dweb?: { url: string };
    /** User-configured MCP servers (config.json `mcpServers`), already
     * validated and normalized by customMcpServers(). Mounted WITHOUT any
     * pre-allow: their tools ride each driver's normal permission flow.
     * A server is either a command this machine runs (stdio) or a server
     * reached at a URL; a driver that cannot speak to one kind skips it. */
    custom?: Record<string, McpServerSpec>;
    /** Per-server result budget for `custom` (config.json
     * `mcpServers.<name>.resultBudget`): characters of one tool result
     * allowed into context, 0 = never trim. A name missing here uses the app
     * default (mcp-gate-config.ts resultBudget). Kept apart from the specs so
     * a server mounted as it is never carries a field its engine rejects. */
    customResultBudgets?: Record<string, number>;
  };
  cwd?: string;
  /** Let the engine also load the MCP servers from the person's own CLI
   * setup (Claude Code's user-scope servers and claude.ai connectors). Off
   * by default: a bot gets the servers its owner gave it, and each extra
   * tool costs tokens on every model call. Codex already reads its own
   * config.toml and ignores this; the Claude driver drops
   * --strict-mcp-config for the turn. */
  mcpFromUserConfig?: boolean;
  /** Per-call ceiling (ms) for this turn's MCP tools, from the server config
   * `mcp.callTimeoutMinutes`. Absent = the driver's default (10 min). */
  mcpCallTimeoutMs?: number;
  /** Times an API-model turn that answers after a failed tool call is sent
   * back to re-run it (`loopGuard.correctiveRounds`); never after a denial. */
  toolErrorCorrectiveRounds?: number;
  /** Organization server: this machine is the Sagax server, nobody's
   * computer. The engine must not get its own shell, file or fetch tools
   * here; shell and files go through the person's server environment
   * (integrations.custom["sagax-environment"]). Only a driver declaring
   * capabilities.withholdsHostTools may receive such a turn. */
  withholdHostTools?: boolean;
  /** Organization server, desktop bridge: the engine's own network traffic
   * (remote MCP servers, tool HTTP calls) leaves through the person's
   * computer for this turn (server/desktop-egress.ts). The driver sets
   * HTTP(S)_PROXY to `url` and NO_PROXY to its own model hosts plus
   * `noProxy`, so the engine's model traffic never goes through it. */
  networkProxy?: { url: string; noProxy: string[] };
  /** Keep the claude.ai connectors of the account this turn runs on (the
   * speaker's own Claude subscription, server/harness-connectors.ts). The
   * Claude driver then drops --strict-mcp-config only; other drivers ignore
   * it. Their tools ride the normal permission flow, never pre-allowed. */
  claudeAiConnectors?: boolean;
  /** Grok: load the cloud connectors of the xAI account this turn runs on,
   * which is the person's own grok.com sign-in
   * (harness-connectors.ts grokCloudConnectorsForTurn). Absent or false:
   * off, whatever the organization turn (review of #943). */
  grokCloudConnectors?: boolean;
  /** Claude Code plugins installed on the bot (server/bot-plugins.ts): one
   * folder each, already stripped of hooks, MCP and LSP servers. The Claude
   * driver loads each with --plugin-dir. Other drivers do not get these
   * folders; their turns read the same enabled skills and commands from the
   * skills section of the prompt (server/plugin-turn.ts). */
  pluginDirs?: string[];
  /** The person typed one of the engine's own slash commands
   * (shared/harness-commands.ts): `text` is that command line, verbatim.
   * Codex hands a skill's file with the text (`path`); Claude reads the
   * leading slash itself. */
  harnessCommand?: { name: string; args: string; path?: string };
}

/** What a bot's turns will load, for listing the engine's slash commands
 * (ProviderInstance.listCommands): the same folder and isolation a turn
 * gets, so the list holds only what a turn can run. */
export interface HarnessCommandScope {
  cwd?: string;
  withholdHostTools?: boolean;
  mcpFromUserConfig?: boolean;
  /** The bot whose live sessions may add to the list (MCP prompts of its
   * own servers, the terminal-only commands the CLI reports). */
  botId?: string;
  /** Organization server: the speaker's own subscription when their turns
   * run on it (their login directory: their user skills, plugins and
   * claude.ai account). Never a key: a key does not change the list. */
  access?: TurnAccessInput;
  /** The turn keeps the claude.ai connectors of the account it runs on
   * (server/harness-connectors.ts), so their MCP prompts are listed. */
  claudeAiConnectors?: boolean;
  /** The bot's Claude Code plugins (server/bot-plugins.ts). Claude lists
   * their commands and skills from these folders. Other engines read the
   * same enabled skills and commands from the turn prompt. */
  pluginDirs?: string[];
}

/** An MCP server this machine starts and talks to over stdio. */
export interface StdioMcpSpec {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** An MCP server reached over HTTP: streamable HTTP (`http`, the current
 * transport) or the older SSE transport. Header values are credentials
 * (`Authorization: Bearer …`) and travel like env values: never on argv. */
export interface RemoteMcpSpec {
  type: "http" | "sse";
  url: string;
  headers: Record<string, string>;
}

export type McpServerSpec = StdioMcpSpec | RemoteMcpSpec;

export interface TurnStartResult {
  turnId: TurnId;
  /** The turn went to an engine process that was already running (no cold
   * start). Reported by drivers that pool a process per thread; absent
   * elsewhere. Diagnostics only (server/voice-latency.ts). */
  reused?: boolean;
}

export interface ProviderAdapter {
  readonly provider: DriverKind;
  readonly capabilities: {
    sessionModelSwitch: "in-session" | "unsupported";
    /** True when the driver mounts turn.integrations.agents as MCP tools —
     * the harness only offers agents tooling (and prompts about it) to
     * drivers that can actually hand it to the agent. */
    agentsMcp?: boolean;
    /** True when the driver mounts isolated computer MCP descriptors (the
     * screenshot/click tools). Same rule as agentsMcp: a bot must never be
     * told it has a computer whose tools its driver cannot mount — it
     * burns turns hunting for tools that aren't there. */
    computerMcp?: boolean;
    /** True when the driver can mount the first-party physical-phone MCP. */
    phoneMcp?: boolean;
    /** True when the driver can mount the built-in browser MCP. Same rule:
     * a bot must never be told it has a browser its driver cannot hand it. */
    browserMcp?: boolean;
    /** True when the driver can mount the Data tools MCP (the same stdio
     * proxy shape as the browser). Same rule: never tell a bot it has data
     * tools its driver cannot hand it. */
    dataMcp?: boolean;
    /** True when this engine accepts images in the prompt — gates image
     * paste in the composer. Same rule as computerMcp: never offer an
     * attachment an engine cannot open (a bot told it has an image it
     * cannot read burns the turn). */
    images?: boolean;
    /** True only when sendTurn consumes `images` as structured provider
     * input. Image-capable legacy drivers may instead read the attachment
     * path kept in `text`; central dispatch strips that tag only here. */
    nativeImageInput?: boolean;
    /** Effort levels this driver can pass to its CLI, ascending. Absent =
     * the driver cannot set effort, so the app never offers the control —
     * same rule as computerMcp: never show a knob the driver cannot turn. */
    effortLevels?: readonly EffortLevel[];
    /** The driver validates and applies model-specific variant IDs per session. */
    modelVariants?: boolean;
    /** True when the driver keeps a live session across turns and can take
     * a user message MID-TURN (delivered before the model's next call —
     * "steer"). The composer stays open during a turn on such an engine;
     * others keep the queue-one-and-wait behaviour. Same rule as the other
     * flags: never show a control the driver cannot honour. */
    queueing?: boolean;
    /** True only when local MCP calls can reach the human approval channel.
     * Full-auto/bypass provider instances must leave this false. */
    localComputerMcp?: boolean;
    /** True when the driver mounts turn.integrations.custom (the user's own
     * MCP servers from config). Same rule as computerMcp: an entry in the
     * config says the servers exist, not that this engine can reach them. */
    customMcp?: boolean;
    /** True when a turn given a resumeCursor runs in that exact native
     * session, or, if the provider refuses the session before accepting the
     * prompt, fails or starts a new session from recoveryText — never a blank
     * session that silently lacks the history; session.started says `rebuilt`
     * for that new session. The harness then keeps such a session across
     * externally appended messages and sends only those. */
    strictResume?: boolean;
    /** True when sendTurn can register the harness's hook helper with the
     * engine (integrations.hooks). Only Claude Code today; other engines
     * deliver the same information through their protocols. */
    hooks?: boolean;
    /** True when the driver honours SendTurnInput.withholdHostTools (or its
     * engine never runs anything on this machine). Organization servers
     * refuse turns on any other engine. */
    withholdsHostTools?: boolean;
    /** How a guest-driven turn on an OMB Cloud home can run on this engine:
     * "confined" = sendTurn honours `guestConfined` (no shell or command
     * execution, no reads outside its folder). Absent: such a turn is
     * refused. */
    guestTurns?: "confined";
    /** True when sendTurn honours warmOnly: the pooled process starts, no
     * prompt is written, and no turn is emitted. Absent: a warm is a no-op.
     * No hidden prompt is sent to an engine that cannot start without one. */
    warmSession?: boolean;
  };
  sendTurn(input: SendTurnInput): Promise<TurnStartResult>;
  interruptTurn(threadId: ThreadId, turnId?: TurnId): Promise<void>;
  /** #1373: the person changed Ask, Edits or Auto while this thread works.
   * Resolves true when the running turn's next tool call is at `mode`: the
   * engine took the new level (Claude's set_permission_mode), or it keeps no
   * copy of the level and asks Sagax, which answers at the live level. False,
   * or no method at all, means the engine still holds the old level for this
   * turn: the harness then stops the turn when the change is stricter, so no
   * tool call runs at a level the person just left. */
  applyApprovalMode?(threadId: ThreadId, mode: ApprovalMode): Promise<boolean>;
  /** Answer a pending ask. Resolves with what actually happened — never
   * throws for an ask that is no longer there: `unavailable` means nobody
   * could take the answer (the turn ended, the broker died, the driver
   * has no asks), and the caller treats it as a deny. Callers branch on the
   * outcome, not on prose. */
  respondToRequest(
    threadId: ThreadId,
    requestId: string,
    decision: {
      behavior: "allow" | "deny" | "answer";
      message?: string;
      /** "Always allow this session": hand the provider its own remembered
       * approval (Claude's suggested permission rules, ACP `allow_always`)
       * so it stops asking about this operation for the rest of the
       * session. The app keeps no grant of its own. */
      always?: boolean;
    },
  ): Promise<RequestOutcome>;
  /** Deliver a user message into the RUNNING turn on this thread. Only
   * drivers with `capabilities.queueing` implement it.
   *
   * - "steered" — the engine accepted the input into the live turn.
   * - "refused" — provably NOT delivered (no live turn, explicit RPC
   *   refusal, failed stdin write): the caller may queue it for the next
   *   turn without risk of running it twice.
   * - "indeterminate" — delivered, but the outcome is unknown (the RPC
   *   timed out after accept, transport failed, or the turn settled while
   *   the answer was in flight). The caller must NOT re-queue: the words
   *   may already be running, and replaying them would execute them twice.
   *
   * `steerId` names this input: a driver that learns when a model call takes
   * it in (Claude's --replay-user-messages echo) emits `steer.received` with
   * it, so the harness counts the words as received instead of offering
   * them again on the next turn as a message "you may already have". */
  steer?(threadId: ThreadId, text: string, options?: { steerId?: string }): Promise<SteerOutcome>;
  hasSession(threadId: ThreadId): boolean;
  /** Close an idle warm process on this thread. A process whose turn is
   * already running is left alone. */
  releaseWarmSession?(threadId: ThreadId): void;
  /** Size on disk of the saved session a resume of this cursor would load
   * (Claude's session file), for server/stale-session.ts. Undefined when the
   * engine cannot tell, or when a live process already holds that session
   * (nothing would be loaded). */
  sessionBytes?(threadId: ThreadId, resumeCursor: unknown): number | undefined;
  stopAll(): Promise<void>;
  onEvent(listener: RuntimeEventListener): () => void;
  /** Prompt-cache keep-warm (server/cache-keepwarm.ts). Only drivers that
   * keep a live native session per thread and can send one tool-less,
   * forked request over its transcript implement it (Claude Code today).
   * `ping` never changes the thread's own session; `hold` keeps that live
   * session open until `until` (epoch ms), or releases the hold with null,
   * and says whether a live session exists to hold. */
  cacheKeepWarm?: {
    ping(threadId: ThreadId, options?: { signal?: AbortSignal }): Promise<CacheWarmPingResult>;
    hold(threadId: ThreadId, until: number | null): boolean;
  };
}

/** One keep-warm ping as the engine reported it. Tokens are the request's
 * own: `cacheRead` re-read from the prompt cache, `cacheWrite` written to it,
 * `input` uncached input. `costUsd` is the engine's figure (on a subscription
 * an equivalent, not a charge). A refusal says why; `busy` means the thread
 * had a turn running and nothing was sent; `limit` means the account's usage
 * limit refused the call. */
export type CacheWarmPingResult =
  | { ok: true; input: number; cacheRead: number; cacheWrite: number; output: number; costUsd: number | null; model: string | null }
  | { ok: false; reason: string; busy?: boolean; limit?: boolean };

/** The tri-state result of Adapter.steer — see the contract above. */
export type SteerOutcome = "steered" | "refused" | "indeterminate";

// ── provider snapshot (upstream ServerProviderShape, reduced) ────────────
export interface ProviderSnapshot {
  /** Separate, explicitly authorized ChatGPT-plan billing (not Codex login). */
  chatgptPlan?: boolean;
  authenticationUnavailableReason?: string;
  state: "available" | "unavailable";
  reason?: string;
  authenticated?: boolean;
  /** Vetted display identity from the provider CLI, never credentials.
   * `method` says how it is signed in when the CLI reports it: a personal
   * login, or the workspace API key. */
  account?: { email?: string; organization?: string; method?: "login" | "api-key" };
  version?: string | null;
  /** A non-blocking provider update that unlocks newer capabilities. The
   * engine remains usable; renderer surfaces the exact terminal command. */
  update?: {
    title: string;
    message: string;
    command: string;
  };
  /** How this instance is paid for, when the driver can tell: a reported
   * cost on a subscription is notional and the UI labels it as such. */
  billing?: "metered" | "subscription";
  /** A standing condition worth a look but with nothing to run: the engine
   * works, and something about how it is set up is costing the person
   * without their asking. Shown beside the update notice on Engines. */
  warning?: {
    title: string;
    message: string;
  };
}

// ── engine install descriptor ───────────────────────────────────────────
// How a user gets this engine onto their machine. Declared by the driver so
// that adding a provider stays "one file in drivers/ plus a registration":
// onboarding, the model picker, and settings all render from this instead of
// hardcoding per-engine copy in the UI.
//
// Installing is rarely the whole job — most CLIs then need an interactive
// sign-in, which is why signInCommand exists and why the UI sends people to a
// terminal rather than trying to shell out silently. A CLI with a device-code
// login (Codex, Grok) signs in from the app instead (drivers/device-auth.ts),
// and signInCommand stays its terminal route.
export interface EngineInstall {
  /** Added by the registry: commands run on this server, not its web client. */
  platform?: "darwin" | "win32" | "linux";
  /** One-liner per platform. Omit a platform that has no such command —
   * the UI falls back to docsUrl rather than offering something that
   * cannot work there (a curl|bash line is not a Windows command). */
  command?: Partial<Record<"darwin" | "win32" | "linux", string>>;
  /** Docs or download page. The only route for GUI-installed engines. */
  docsUrl?: string;
  /** Interactive sign-in run after installing, when install isn't enough. */
  signInCommand?: string;
  /** `command` needs npm on PATH, so the UI can say so when Node is absent. */
  needsNode?: boolean;
  /** The app downloads and verifies a pinned provider runtime itself. */
  managed?: {
    label: string;
    downloadBytes: number;
  };
  /** Set up inside the app rather than in a terminal: the engine needs a key
   * saved under Settings → API keys, and the setup card links there. */
  settings?: "connections";
  /** The setup card takes a masked access key and stores it as a secret. */
  apiKey?: boolean;
  /** Settings can install or update this engine on the machine running the
   * server, as the server's own user, into a directory the app owns. Set by
   * the registry when the install one-liner is an npm package and npm is on
   * PATH; never something a client chooses. */
  server?: { package: string };
}

export interface ProviderAuthenticationStart {
  phase: "waiting" | "succeeded";
  flowId: string | null;
  authorizationUrl: string | null;
  expiresAt: string | null;
  /** A short-lived code to enter only at the provider's authorization URL. */
  userCode?: string;
}

export interface ProviderAuthenticationStatus extends Omit<ProviderAuthenticationStart, "phase"> {
  phase: "waiting" | "succeeded" | "failed" | "expired" | "cancelled";
  /** Safe, actionable copy; never unfiltered CLI output or credentials. */
  message?: string;
}

// ── driver SPI (upstream ProviderDriver — a plain record, not a service) ─
// `create` owns ALL per-instance state; two create calls share nothing.
// Failures must reject, never throw synchronously — the registry downgrades
// a rejection to an unavailable shadow snapshot.
export interface ModelCatalog {
  default: string;
  /** The endpoint's own list could not be read, or was empty, and why
   * (an OpenAI-compatible endpoint, Azure among them). Absent: it was read. */
  issue?: ModelListIssue;
  options: Array<{
    id: string;
    label: string;
    custom?: boolean;
    loaded?: boolean;
    /** A model served on a local machine (a `host::model` inject row): this
     * server's loopback, or the person's own computer through the desktop
     * bridge. The picker lists these under Local (shared/local-model-engines.ts). */
    local?: boolean;
    /** A desktop local row whose server answered /v1/messages on the desktop's
     * probe, so Claude Code can run it (shared/local-model-engines.ts). */
    anthropic?: boolean;
    /** Only when two servers of one computer expose the same model name: the
     * server's label (Local models), shown as a quiet sub-line. The row's
     * `label` is the model name alone, never prefixed by host or port. */
    server?: string;
    /** A model from another person's computer: that person's display name. */
    sharedBy?: string;
    /** upstream provider id (e.g. "zai", "nous") when the engine can report
     * it — the picker shows it as a muted badge so BYOK duplicates of the
     * same model id stay distinguishable. */
    provider?: string;
    /** total context window in tokens, when the driver knows it — sizes
     * the model-facing rebuild (server/context-rebuild.ts). Unknown falls
     * back to a pattern table over the model id, then a conservative default. */
    contextWindow?: number;
    /** Discovery hints; the native session revalidates these before each turn. */
    variants?: ModelVariantOption[];
    /** Reasoning levels this model takes, as its engine reports them
     * (shared/model-capabilities.ts). `[]`: no effort control. Absent:
     * unknown, the driver's `capabilities.effortLevels` apply. */
    effortLevels?: EffortLevel[];
    /** The level the engine runs this model at when none is sent. */
    defaultEffort?: EffortLevel;
  }>;
}

/** The picker label for a model id when the catalog row carries no display
 * name: split on the word breaks the catalog treats as separators and
 * capitalize each part ("gpt-5.4-mini" → "Gpt 5.4 Mini"). Each harness
 * passes its own break class so existing labels stay byte-for-byte. */
export function titleCaseModelId(id: string, wordBreaks: RegExp): string {
  return id
    .split(wordBreaks)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** A picker label that carries a second facet — a display name, a provider
 * host — beside the model id, unless the facet is already what the id says.
 * `redundantWhen` decides what counts as "already said" and `decorate` how
 * the facet is appended, so every harness's labels stay exactly what they
 * were while the shape is written once. */
export function qualifiedModelLabel(
  id: string,
  qualifier: string | null | undefined,
  options: {
    redundantWhen?: (id: string, qualifier: string) => boolean;
    decorate?: (qualifier: string) => string;
  } = {},
): string {
  const { redundantWhen = () => false, decorate = (facet) => ` — ${facet}` } = options;
  if (!qualifier || redundantWhen(id, qualifier)) return id;
  return `${id}${decorate(qualifier)}`;
}

export interface DriverCreateInput<Config> {
  instanceId: InstanceId;
  displayName: string | undefined;
  environment: Record<string, string>;
  enabled: boolean;
  config: Config;
}

export interface TextGenerationUsage {
  model: string;
  input?: number;
  output?: number;
  cachedInput?: number;
  costUsd?: number;
}

export interface TextGenerationOptions {
  signal?: AbortSignal;
  onUsage?: (usage: TextGenerationUsage) => void;
  /** Override the helper's own model. The voice opener uses the engine's
   * smallest fast row for the first sentence only. */
  model?: string;
  /** A stable system prefix. Kept out of the user message so a provider
   * can cache it across openers. */
  system?: string;
  /** Streamed assistant text, when the driver can stream this call. */
  onDelta?: (delta: string) => void;
  /** Cap the completion. The opener asks for a sentence, not an essay. */
  maxTokens?: number;
  /** No extended thinking: an extraction step (memory capture) gains
   * nothing from it, and a capture of several conversations spent 3,000 to
   * 4,000 thinking tokens and ran past its 60 s limit. Drivers without a
   * switch ignore it. */
  noThinking?: boolean;
}

export interface ProviderInstance {
  readonly instanceId: InstanceId;
  readonly driverKind: DriverKind;
  readonly displayName: string | undefined;
  readonly enabled: boolean;
  readonly models: ModelCatalog;
  /** Refresh a live catalog without recreating the provider instance. */
  readonly refreshModels?: () => Promise<void>;
  /** Set on a later start while the catalog served from the last run is
   * still refreshing. A turn awaits it; listen does not. */
  readonly startupModelRefresh?: Promise<void>;
  /** Optional first-party runtime installation and account setup. */
  readonly installRuntime?: () => Promise<void>;
  readonly startAuthentication?: () => Promise<ProviderAuthenticationStart>;
  readonly authenticationMethod?: "browser-pkce" | "open-link";
  readonly getAuthentication?: (flowId: string) => Promise<ProviderAuthenticationStatus>;
  readonly completeAuthentication?: (flowId: string, callbackUrl: string) => Promise<void>;
  readonly cancelAuthentication?: () => Promise<void>;
  /** Remove the sign-in the provider CLI stores on this server, so a
   * different account can connect. Never touches another instance's home. */
  readonly signOut?: () => Promise<void>;
  readonly adapter: ProviderAdapter;
  snapshot(): Promise<ProviderSnapshot>;
  /** Cheap one-shot text call (upstream TextGeneration) — titles, summaries.
   * The signal is a best-effort cap: drivers that can honor it abort the
   * underlying provider call; the rest keep their own timeout. */
  generateText?(prompt: string, options?: TextGenerationOptions): Promise<string>;
  /** A one-shot text call for memory upkeep only, on an engine whose turns
   * are a whole agent process (the ACP family). It starts a fresh tool-free
   * session on the engine's own provider, so it is never offered to titles or
   * compaction, which would then spawn a process for every new chat. */
  generateMemoryText?(prompt: string, options?: TextGenerationOptions): Promise<string>;
  /** Isolated, tool-free permission review on this same provider. Kept
   * separate from generateText so the UI never infers a security capability
   * from a generic helper that may expose prompts in argv or lack approvals. */
  reviewPermission?(prompt: string, signal?: AbortSignal): Promise<string>;
  /** The engine's own slash commands for turns in this scope, read without
   * a model call (shared/harness-commands.ts). */
  listCommands?(scope: HarnessCommandScope): Promise<HarnessCommand[]>;
  dispose(): Promise<void>;
}

/** How an engine is presented in the picker rail.
 *  `subscription` — first-party cloud catalog; Custom is extra.
 *  `custom` — no subscription catalog; Custom is the product.
 *  `api` — a cloud model catalog billed through an API key. */
export type EngineAccess = "subscription" | "custom" | "api";

export interface ProviderDriver<Config = unknown> {
  readonly driverKind: DriverKind;
  readonly metadata: {
    displayName: string;
    supportsMultipleInstances?: boolean;
    access?: EngineAccess;
  };
  /** How to get this engine installed. Omit for engines that need no local
   * binary (API-key drivers), which is what makes it optional. */
  readonly install?: EngineInstall;
  /** Decode the opaque config envelope; throw on invalid (→ shadow). */
  decodeConfig(raw: unknown): Config;
  defaultConfig(): Config;
  readonly models: ModelCatalog;
  create(input: DriverCreateInput<Config>): Promise<ProviderInstance>;
}

export type AnyProviderDriver = ProviderDriver<any>;

let eventCounter = 0;
export const newEventId = () => `ev-${Date.now().toString(36)}-${(eventCounter++).toString(36)}`;
export const newId = () => crypto.randomUUID();
