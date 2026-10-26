// Multi-provider cloud coding agents (Cursor Cloud Agents API, Claude Code
// background agents, OpenAI Codex cloud, Perspicax runs). Sagax keeps a local
// record per bot; providers speak their own HTTP APIs through
// server/cloud-agents/providers/*.
//
// `perspicax` (2026-10-18, lot P1.7, docs/superpowers/specs/2026-10-18-code-section-design.md):
// Perspicax runs the agent in its own Pod and Sagax is a client of its
// `/api/v1/agents` API, with the person's own sign-in token (no key to paste).
// Its wire types (RunState, PerspicaxRun, RunEvent, ...) are copied from the
// Perspicax contract (its spec, sections 8.0 and 10.1) at the bottom of this file.

export const CLOUD_AGENT_PROVIDERS = ["cursor", "claude", "codex", "perspicax"] as const;
export type CloudAgentProviderId = (typeof CLOUD_AGENT_PROVIDERS)[number];
/** The providers that take a key the person pastes in Settings. Perspicax
 * uses the person's sign-in instead, so it has no key row. */
export const CLOUD_AGENT_KEY_PROVIDERS = ["cursor", "claude", "codex"] as const;
export type CloudAgentKeyProviderId = (typeof CLOUD_AGENT_KEY_PROVIDERS)[number];
export function cloudAgentKeyProvider(id: CloudAgentProviderId): id is CloudAgentKeyProviderId {
  return (CLOUD_AGENT_KEY_PROVIDERS as readonly string[]).includes(id);
}

/** Normalized lifecycle across providers. */
export type CloudAgentStatus =
  | "queued"
  | "creating"
  | "running"
  | "waiting_for_approval"
  | "idle"
  | "finished"
  | "failed"
  | "cancelled"
  | "expired"
  | "archived";

export type CloudAgentFollowUpMode = "queue" | "steer" | "interrupt";

export interface CloudAgentRepoRef {
  url: string;
  ref?: string;
  prUrl?: string;
}

export interface CloudAgentLaunchInput {
  provider: CloudAgentProviderId;
  prompt: string;
  repos?: CloudAgentRepoRef[];
  model?: string;
  workOnCurrentBranch?: boolean;
  autoCreatePr?: boolean;
  name?: string;
  /** Perspicax: the environment to start from (`env_<ulid>`). Without it the
   * provider finds the environment by the repository. */
  envId?: string;
  /** Perspicax: `claude-code` or `codex` (the environment's default otherwise). */
  engine?: string;
  /** Set by the server (CloudAgentManager.launch), never by a tool call:
   * the person launching, for a personal run's subscription. */
  principalId?: string;
}

export interface CloudAgentFollowUpInput {
  text: string;
  mode: CloudAgentFollowUpMode;
}

export interface CloudAgentGitBranch {
  repoUrl?: string;
  branch?: string;
  prUrl?: string;
}

/** What a run changed so far (Perspicax `stats`). */
export interface CloudAgentStats {
  files: number;
  added: number;
  removed: number;
  commits: number;
}

export type CloudAgentPrState = "draft" | "open" | "merged" | "closed";

export interface CloudAgentPr {
  number: number;
  url: string;
  state: CloudAgentPrState;
}

/** Where a run was asked from (Perspicax `origin`). */
export type CloudAgentOrigin = "console" | "sagax" | "mcp" | "automation";

export interface CloudAgentRecord {
  /** Sagax id: `ca_<uuid>` */
  id: string;
  /** The bot that launched it. A run started outside Sagax (the console, an
   * automation, an MCP client) has none. */
  botId?: string;
  /** Thread that launched it (completion wakes here); none outside Sagax. */
  threadId?: string;
  principalId: string;
  provider: CloudAgentProviderId;
  /** Provider's agent id (e.g. bc-…). */
  externalId: string;
  name: string;
  status: CloudAgentStatus;
  createdAt: number;
  updatedAt: number;
  startedAt: number;
  endedAt?: number;
  /** Latest provider run id. */
  latestRunId?: string;
  /** Public dashboard URL when the provider offers one. */
  url?: string;
  model?: string;
  repos: CloudAgentRepoRef[];
  gitBranches: CloudAgentGitBranch[];
  /** Last assistant result text from a finished run. */
  lastResult?: string;
  error?: string;
  archived: boolean;
  /** Completion already delivered to the launching thread. */
  completionNotified: boolean;
  /** Queued follow-up while a run is active (mode queue). */
  pendingFollowUp?: { text: string; at: number };
  stats?: CloudAgentStats;
  pr?: CloudAgentPr;
  /** Not opened yet by the person who asked for it. */
  unread?: boolean;
  /** Perspicax environment id. */
  envId?: string;
  origin?: CloudAgentOrigin;
}

export interface CloudAgentArtifact {
  path: string;
  size?: number;
  contentType?: string;
}

export interface CloudAgentTranscriptLine {
  at: number;
  role: "user" | "assistant" | "system";
  text: string;
}

export interface CloudAgentProviderListing {
  provider: CloudAgentProviderId;
  label: string;
  configured: boolean;
  last4?: string;
}

/** Live SSE payload (no secrets). */
export interface CloudAgentWireItem {
  id: string;
  botId: string;
  provider: CloudAgentProviderId;
  name: string;
  status: CloudAgentStatus;
  updatedAt: number;
  threadId: string;
}

export const CLOUD_AGENT_WRITE_TOOLS = new Set([
  "launch_cloud_agent",
  "cancel_cloud_agent",
  "archive_cloud_agent",
  "cloud_agent_follow_up",
]);

export const CLOUD_AGENT_READ_TOOLS = new Set([
  "list_cloud_agents",
  "get_cloud_agent",
  "find_cloud_agent_by_pr",
  "cloud_agent_transcript",
  "list_cloud_agent_artifacts",
]);

const CLOUD_AGENT_TOOL_ACTION: Record<string, string> = {
  list_cloud_agents: "list",
  get_cloud_agent: "get",
  launch_cloud_agent: "launch",
  cloud_agent_follow_up: "follow_up",
  cancel_cloud_agent: "cancel",
  archive_cloud_agent: "archive",
  cloud_agent_transcript: "transcript",
  list_cloud_agent_artifacts: "artifacts",
  find_cloud_agent_by_pr: "find_by_pr",
};

/** Harness internal route action for a catalog tool name. */
export function cloudAgentToolAction(toolName: string): string | null {
  return CLOUD_AGENT_TOOL_ACTION[toolName] ?? null;
}

export function cloudAgentStatusActive(status: CloudAgentStatus): boolean {
  return status === "queued" || status === "creating" || status === "running"
    || status === "waiting_for_approval" || status === "idle";
}

/** One status for every provider. Perspicax's states map as its spec says
 * (section 9.4): waking, provisioning and setup are `creating`. */
export function normalizeCloudAgentStatus(raw: string): CloudAgentStatus {
  const key = raw.toUpperCase();
  if (key === "QUEUED") return "queued";
  if (key === "CREATING" || key === "PENDING" || key === "WAKING" || key === "PROVISIONING" || key === "SETUP") return "creating";
  if (key === "RUNNING" || key === "ACTIVE") return "running";
  if (key === "WAITING_FOR_APPROVAL") return "waiting_for_approval";
  if (key === "IDLE") return "idle";
  if (key === "FINISHED" || key === "SUCCEEDED" || key === "SUCCESS") return "finished";
  if (key === "FAILED" || key === "ERROR") return "failed";
  if (key === "CANCELLED" || key === "CANCELED" || key === "STOPPED") return "cancelled";
  if (key === "EXPIRED") return "expired";
  if (key === "ARCHIVED") return "archived";
  return "failed";
}

// ---------------------------------------------------------------------------
// Perspicax `/api/v1/agents` contract (Perspicax PR #372, lot P1.1). Field
// names stay as Perspicax sends them (snake_case); Sagax reads them through
// the helpers below and never trusts a field's presence.

export const RUN_STATES = [
  "queued", "waking", "provisioning", "setup", "running", "waiting_for_approval",
  "idle", "finished", "failed", "stopped", "expired", "archived",
] as const;
export type RunState = (typeof RUN_STATES)[number];

/** The states that still hold (or will hold) a Pod. */
export const RUN_ACTIVE_STATES: ReadonlySet<string> = new Set([
  "queued", "waking", "provisioning", "setup", "running", "waiting_for_approval", "idle",
]);
/** The states a run is working in (an `idle` run waits for a follow-up). */
export const RUN_WORKING_STATES: ReadonlySet<string> = new Set([
  "waking", "provisioning", "setup", "running",
]);

export interface PerspicaxRepoRef {
  provider: string;
  owner: string;
  name: string;
  default_branch: string;
}

export interface PerspicaxEnvironment {
  id: string;
  name: string;
  owner_id?: string;
  /** `personnelle`, `equipe` or `org`. */
  scope: string;
  repos: PerspicaxRepoRef[];
  engine_default: string;
  model_default: string;
  /** `org`, `personnel` or `au_choix`. */
  token_source?: string;
  client_data?: boolean;
  /** `ok`, or the setup problem the last start met. */
  health?: string;
  archived?: boolean;
}

export interface PerspicaxRun {
  id: string;
  env_id: string;
  /** `owner/name` */
  repo: string;
  base_branch: string;
  branch: string;
  title: string;
  prompt: string;
  engine: string;
  model: string;
  token_source?: string;
  origin: string;
  origin_ref?: string;
  requested_by?: string;
  runs_as?: string;
  state: string;
  /** `{}` until a PR exists: number, url, state, head_sha, checked_at. */
  pr: Record<string, unknown>;
  /** `{}` until the first commit: files, added, removed, commits, last_sha. */
  stats: Record<string, unknown>;
  usage?: Record<string, unknown>;
  error: string;
  unread: boolean;
  created_at: string;
  updated_at: string;
  started_at?: string | null;
  ended_at?: string | null;
}

/** One row of a run's event log (`GET /runs/:id/events`, `/stream`). */
export interface RunEvent {
  run_id: string;
  seq: number;
  at: string;
  /** requested, state, followup, message, tool_call, tool_result, approval, status, warning, ... */
  kind: string;
  payload: Record<string, unknown>;
}

export interface PerspicaxPage<T> {
  items: T[];
  page: number;
  page_size: number;
  total: number;
}

export interface PerspicaxMutated<T> {
  audit_id: string;
  value: T;
}

/** `POST /api/v1/agents/runs` */
export interface PerspicaxNewRun {
  env_id: string;
  prompt: string;
  repo?: string;
  base_branch?: string;
  branch?: string;
  title?: string;
  engine?: string;
  model?: string;
  token_source?: string;
  origin?: string;
  origin_ref?: string;
}

/** The engines a run can use in v1. */
export const RUN_ENGINES = ["claude-code", "codex"] as const;

const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0);

/** A run's `stats`, read leniently: absent keys are 0. */
export function runStats(run: Pick<PerspicaxRun, "stats">): CloudAgentStats | undefined {
  const stats = run.stats && typeof run.stats === "object" ? run.stats : {};
  const files = num(stats.files);
  const added = num(stats.added ?? stats.additions);
  const removed = num(stats.removed ?? stats.deletions);
  const commits = num(stats.commits);
  return files || added || removed || commits ? { files, added, removed, commits } : undefined;
}

/** A run's `pr`, or undefined while none was opened. */
export function runPr(run: Pick<PerspicaxRun, "pr">): CloudAgentPr | undefined {
  const pr = run.pr && typeof run.pr === "object" ? run.pr : {};
  const number = num(pr.number);
  const url = typeof pr.url === "string" && pr.url.startsWith("https://") ? pr.url : "";
  const state = pr.state === "draft" || pr.state === "open" || pr.state === "merged" || pr.state === "closed" ? pr.state : null;
  return number && url && state ? { number, url, state } : undefined;
}

export function runOrigin(value: string): CloudAgentOrigin | undefined {
  return value === "console" || value === "sagax" || value === "mcp" || value === "automation" ? value : undefined;
}

/** The pill a run card shows (RunCard, section 8.0 of the Perspicax spec). */
export type RunPill = "merged" | "draft" | "open" | "branch" | "running" | "waiting" | "failed" | "stopped";

export function runPill(run: Pick<PerspicaxRun, "state" | "pr" | "branch">): RunPill {
  const pr = runPr(run);
  if (pr?.state === "merged") return "merged";
  if (RUN_WORKING_STATES.has(run.state)) return "running";
  if (run.state === "queued" || run.state === "waiting_for_approval") return "waiting";
  if (run.state === "failed" || run.state === "expired") return "failed";
  if (pr?.state === "draft") return "draft";
  if (pr?.state === "open") return "open";
  if (run.state === "stopped") return "stopped";
  return "branch";
}
