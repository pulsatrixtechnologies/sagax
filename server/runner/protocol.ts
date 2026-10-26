// The runner's side of the cloud agents control protocol (MVP phase 1):
// plain outbound HTTPS to Perspicax, never a listening port (CA-3). One
// client per Pod, authenticated by the run token the provisioner mounts
// (server/sandboxd-runs-spec.ts, PX_RUN_TOKEN_FILE).
//
// Routes, all under PX_CONTROL_URL:
//   GET  /api/v1/agents/runner/bootstrap
//   GET  /api/v1/agents/runner/secrets          (once per Pod; 409 after)
//   POST /api/v1/agents/runner/events           ({events}, <= 256 and 1 MiB)
//   GET  /api/v1/agents/runner/commands?after=&wait=  (long poll, wait <= 25)
//   POST /api/v1/agents/runner/bundle           (git bundle, octet-stream)
// A 401 on any of them means the token is dead (run ended or revoked): the
// runner stops cleanly (RunnerUnauthorized).

export const RUNNER_API = "/api/v1/agents/runner";
export const MAX_EVENTS_PER_BATCH = 256;
export const MAX_BATCH_BYTES = 1024 * 1024;
export const MAX_TERMINAL_BYTES = 16 * 1024;
/** The contract allows a 2 MiB diff event, but a batch is at most 1 MiB:
 * the runner keeps each diff under what one batch can carry. */
export const MAX_DIFF_BYTES = MAX_BATCH_BYTES - 16 * 1024;
export const MAX_COMMAND_WAIT_SEC = 25;

export type RunnerEngineName = "claude-code" | "codex";

export interface RunnerBootstrap {
  run_id: string;
  env_id: string;
  title: string;
  prompt: string;
  engine: RunnerEngineName;
  model: string | null;
  effort: string | null;
  repo: { owner: string; name: string };
  base_branch: string;
  branch: string;
  existing_branch: boolean;
  setup: string;
  verify: string[];
  git_url: string;
  model_proxy: { anthropic: string; openai: string };
  followup: { text: string; mode: FollowupMode } | null;
  resume: { session_id: string | null; summary: string } | null;
  limits: { max_duration_sec: number };
  /** Commands a previous Pod already consumed: the long poll starts here. */
  commands_after: number;
  base_sha: string | null;
  last_pushed_sha: string | null;
  author: { name: string; email: string } | null;
  approval_level: RunnerApprovalLevel;
}

export const APPROVAL_LEVELS = ["ask", "edits", "auto", "full"] as const;
export type RunnerApprovalLevel = (typeof APPROVAL_LEVELS)[number];
const SHA_RE = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

export interface RunnerSecret {
  name: string;
  value: string;
  setup_only: boolean;
}

export type RunState = "setup" | "running" | "waiting_for_approval" | "idle" | "finished" | "failed";
export type FollowupMode = "queue" | "steer" | "interrupt";

export interface DiffLine { kind: "ctx" | "add" | "del"; old?: number; new?: number; text: string }
export interface DiffHunk { header: string; lines: DiffLine[] }
export interface DiffFile {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  added: number;
  removed: number;
  hunks: DiffHunk[];
  binary?: boolean;
  previewable?: boolean;
}

export type RunnerEvent =
  | { kind: "state"; data: { state: RunState; error?: string } }
  | { kind: "message"; data: { role: "assistant" | "user"; text: string } }
  | { kind: "tool_call"; data: { id: string; name: string; input_summary: string } }
  | { kind: "tool_result"; data: { id: string; ok: boolean; output_summary: string } }
  | { kind: "terminal"; data: { text: string } }
  | { kind: "approval"; data: { approval_id: string; title: string; detail: string; choices: string[] } }
  | { kind: "stats"; data: { files: number; added: number; removed: number; commits: number; head_sha: string } }
  | { kind: "diff"; data: { files: DiffFile[] } }
  | { kind: "commits"; data: { commits: Array<{ sha: string; title: string; author: string; at: string }> } }
  | { kind: "verify"; data: { commands: Array<{ cmd: string; ok: boolean; exit_code: number | null; tail: string }> } }
  | { kind: "session"; data: { session_id: string } }
  | { kind: "warning"; data: { text: string } };

export type RunnerCommand =
  | { seq: number; kind: "followup"; data: { text: string; mode: FollowupMode } }
  | { seq: number; kind: "approve"; data: { approval_id: string; option: string } }
  | { seq: number; kind: "stop"; data: Record<string, never> }
  /** An admin extended the run's duration: what this Pod has left now. */
  | { seq: number; kind: "limits"; data: { max_duration_sec: number } };

/** The hard cap of a run (Perspicax: 12 h). */
export const RUN_HARD_MAX_SEC = 12 * 3600;

export interface BundleResult {
  status: "received" | "pushed" | "refused";
  head_sha?: string;
  pr?: { number: number; url: string; state: string } | null;
  reason?: string;
}

/** The token is dead: the run ended or was revoked. Stop, do not retry. */
export class RunnerUnauthorized extends Error {
  constructor(route: string) {
    super(`Perspicax refused the run token on ${route} (401)`);
    this.name = "RunnerUnauthorized";
  }
}

/** Any other answer the runner cannot use. `status` 0 = no answer at all. */
export class RunnerHttpError extends Error {
  readonly route: string;
  readonly status: number;

  constructor(route: string, status: number, detail: string) {
    super(`${route}: ${status === 0 ? "no answer" : `HTTP ${status}`}${detail ? ` (${detail})` : ""}`);
    this.name = "RunnerHttpError";
    this.route = route;
    this.status = status;
  }
}

/** Plain HTTP only to a loopback host (tests, a local proxy); HTTPS otherwise.
 * The run token never travels in clear over a network. */
export function controlBase(raw: string | undefined): URL {
  const text = (raw ?? "").trim();
  if (!text) throw new Error("PX_CONTROL_URL is required");
  let url: URL;
  try { url = new URL(text); } catch { throw new Error("PX_CONTROL_URL is not a URL"); }
  const loopback = url.hostname === "localhost" || url.hostname === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
  if (url.username || url.password || url.search || url.hash) throw new Error("PX_CONTROL_URL must not carry credentials, a query or a fragment");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) throw new Error("PX_CONTROL_URL must be https");
  return url;
}

/** True when `candidate` is on the same origin as the control URL and under
 * its path: the run token is only ever sent there. */
export function sameControlOrigin(base: URL, candidate: string): boolean {
  let url: URL;
  try { url = new URL(candidate); } catch { return false; }
  if (url.origin !== base.origin || url.username || url.password) return false;
  const prefix = base.pathname.replace(/\/+$/, "");
  return url.pathname === prefix || url.pathname.startsWith(`${prefix}/`);
}

const ENGINES: readonly RunnerEngineName[] = ["claude-code", "codex"];
const FOLLOWUP_MODES: readonly FollowupMode[] = ["queue", "steer", "interrupt"];

function str(value: unknown, field: string, { empty = false, max = 1_000_000 } = {}): string {
  if (typeof value !== "string" || (!empty && !value.trim()) || value.length > max) throw new Error(`bootstrap: ${field} is missing or invalid`);
  return value;
}

/** Validate the bootstrap: every URL the token goes to is Perspicax's. */
export function parseBootstrap(raw: unknown, base: URL): RunnerBootstrap {
  if (!raw || typeof raw !== "object") throw new Error("bootstrap: not an object");
  const o = raw as Record<string, unknown>;
  const engine = o.engine as RunnerEngineName;
  if (!ENGINES.includes(engine)) throw new Error(`bootstrap: engine ${JSON.stringify(o.engine)} is not supported by this runner`);
  const repo = (o.repo ?? {}) as Record<string, unknown>;
  const proxy = (o.model_proxy ?? {}) as Record<string, unknown>;
  const limits = (o.limits ?? {}) as Record<string, unknown>;
  const verify = Array.isArray(o.verify) ? o.verify : [];
  if (verify.some((cmd) => typeof cmd !== "string")) throw new Error("bootstrap: verify must be a list of commands");
  const gitUrl = str(o.git_url, "git_url");
  if (!sameControlOrigin(base, gitUrl)) throw new Error("bootstrap: git_url is not on PX_CONTROL_URL; the run token is never sent elsewhere");
  const anthropic = str(proxy.anthropic, "model_proxy.anthropic");
  const openai = str(proxy.openai, "model_proxy.openai");
  for (const url of [anthropic, openai]) {
    if (!sameControlOrigin(base, url)) throw new Error("bootstrap: model_proxy is not on PX_CONTROL_URL; the run token is never sent elsewhere");
  }
  let followup: RunnerBootstrap["followup"] = null;
  if (o.followup && typeof o.followup === "object") {
    const f = o.followup as Record<string, unknown>;
    const mode = (FOLLOWUP_MODES.includes(f.mode as FollowupMode) ? f.mode : "queue") as FollowupMode;
    followup = { text: str(f.text, "followup.text"), mode };
  }
  let resume: RunnerBootstrap["resume"] = null;
  if (o.resume && typeof o.resume === "object") {
    const r = o.resume as Record<string, unknown>;
    resume = {
      session_id: typeof r.session_id === "string" && r.session_id.trim() ? r.session_id : null,
      summary: typeof r.summary === "string" ? r.summary : "",
    };
  }
  const maxDuration = Number(limits.max_duration_sec);
  const sha = (value: unknown, field: string): string | null => {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value !== "string" || !SHA_RE.test(value.toLowerCase())) throw new Error(`bootstrap: ${field} is not a commit id`);
    return value.toLowerCase();
  };
  const after = Number(o.commands_after ?? 0);
  if (!Number.isSafeInteger(after) || after < 0) throw new Error("bootstrap: commands_after is invalid");
  let author: RunnerBootstrap["author"] = null;
  if (o.author && typeof o.author === "object") {
    const a = o.author as Record<string, unknown>;
    const name = typeof a.name === "string" ? a.name.trim() : "";
    const email = typeof a.email === "string" ? a.email.trim() : "";
    // Values git takes as an identity: no angle brackets or line breaks.
    if (name && email && name.length <= 200 && email.length <= 320 && !/[<>\n\r\0]/.test(name + email) && email.includes("@")) author = { name, email };
    else throw new Error("bootstrap: author is invalid");
  }
  const level = o.approval_level ?? "auto";
  if (!APPROVAL_LEVELS.includes(level as RunnerApprovalLevel)) throw new Error(`bootstrap: approval_level ${JSON.stringify(level)} is not supported`);
  return {
    run_id: str(o.run_id, "run_id", { max: 128 }),
    env_id: str(o.env_id, "env_id", { max: 128 }),
    title: typeof o.title === "string" ? o.title : "",
    prompt: str(o.prompt, "prompt"),
    engine,
    model: typeof o.model === "string" && o.model.trim() ? o.model.trim() : null,
    effort: typeof o.effort === "string" && o.effort.trim() ? o.effort.trim() : null,
    repo: { owner: str(repo.owner, "repo.owner", { max: 200 }), name: str(repo.name, "repo.name", { max: 200 }) },
    base_branch: str(o.base_branch, "base_branch", { max: 255 }),
    branch: str(o.branch, "branch", { max: 255 }),
    existing_branch: o.existing_branch === true,
    setup: typeof o.setup === "string" ? o.setup : "",
    verify: (verify as string[]).filter((cmd) => cmd.trim()),
    git_url: gitUrl.replace(/\/+$/, ""),
    model_proxy: { anthropic: anthropic.replace(/\/+$/, ""), openai: openai.replace(/\/+$/, "") },
    followup,
    resume,
    limits: { max_duration_sec: Number.isFinite(maxDuration) && maxDuration > 0 ? maxDuration : 4 * 3600 },
    commands_after: after,
    base_sha: sha(o.base_sha, "base_sha"),
    last_pushed_sha: sha(o.last_pushed_sha, "last_pushed_sha"),
    author,
    approval_level: level as RunnerApprovalLevel,
  };
}

export function parseSecrets(raw: unknown): RunnerSecret[] {
  const list = raw && typeof raw === "object" ? (raw as { secrets?: unknown }).secrets : undefined;
  if (!Array.isArray(list)) throw new Error("secrets: the answer has no secrets list");
  return list.map((entry, index) => {
    const s = (entry ?? {}) as Record<string, unknown>;
    if (typeof s.name !== "string" || typeof s.value !== "string") throw new Error(`secrets: entry ${index} is malformed`);
    // setup_only is the default (spec CA-6): only an explicit false exposes
    // a secret to the agent.
    return { name: s.name, value: s.value, setup_only: s.setup_only !== false };
  });
}

/** The commands the runner knows, and the highest seq seen (unknown kinds
 * from a newer Perspicax included, so the cursor moves past them). */
export function parseCommands(raw: unknown): { commands: RunnerCommand[]; lastSeq: number | null } {
  const list = raw && typeof raw === "object" ? (raw as { commands?: unknown }).commands : undefined;
  if (!Array.isArray(list)) return { commands: [], lastSeq: null };
  const out: RunnerCommand[] = [];
  let lastSeq: number | null = null;
  for (const entry of list) {
    const c = (entry ?? {}) as Record<string, unknown>;
    const seq = Number(c.seq);
    if (!Number.isSafeInteger(seq)) continue;
    lastSeq = lastSeq === null ? seq : Math.max(lastSeq, seq);
    const data = (c.data && typeof c.data === "object" ? c.data : {}) as Record<string, unknown>;
    if (c.kind === "followup" && typeof data.text === "string") {
      const mode = (FOLLOWUP_MODES.includes(data.mode as FollowupMode) ? data.mode : "queue") as FollowupMode;
      out.push({ seq, kind: "followup", data: { text: data.text, mode } });
    } else if (c.kind === "approve" && typeof data.approval_id === "string" && typeof data.option === "string") {
      out.push({ seq, kind: "approve", data: { approval_id: data.approval_id, option: data.option } });
    } else if (c.kind === "stop") {
      out.push({ seq, kind: "stop", data: {} });
    } else if (c.kind === "limits") {
      const sec = data.max_duration_sec;
      if (typeof sec === "number" && Number.isSafeInteger(sec) && sec >= 1 && sec <= RUN_HARD_MAX_SEC) {
        out.push({ seq, kind: "limits", data: { max_duration_sec: sec } });
      }
    }
  }
  return { commands: out.sort((a, b) => a.seq - b.seq), lastSeq };
}

export interface ControlClientOptions {
  base: URL;
  token: string;
  fetchImpl?: typeof fetch;
  /** Per call, outside the long poll. */
  timeoutMs?: number;
}

/** The HTTP client. Never logs a header or a body. */
export class ControlClient {
  readonly base: URL;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: ControlClientOptions) {
    this.base = options.base;
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  url(path: string): string {
    return `${this.base.href.replace(/\/+$/, "")}${RUNNER_API}${path}`;
  }

  private async call(route: string, init: RequestInit & { timeoutMs?: number; signal?: AbortSignal }): Promise<Response> {
    const timeout = AbortSignal.timeout(init.timeoutMs ?? this.timeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await this.fetchImpl(this.url(route), {
        ...init,
        redirect: "error",
        signal,
        headers: { ...(init.headers as Record<string, string> | undefined), authorization: `Bearer ${this.token}` },
      });
    } catch (error) {
      if (init.signal?.aborted) throw error;
      throw new RunnerHttpError(route, 0, error instanceof Error ? error.name : "");
    }
    if (response.status === 401) {
      await response.body?.cancel().catch(() => undefined);
      throw new RunnerUnauthorized(route);
    }
    return response;
  }

  private async json(route: string, response: Response): Promise<unknown> {
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new RunnerHttpError(route, response.status, text.slice(0, 200));
    }
    try { return await response.json(); } catch { throw new RunnerHttpError(route, response.status, "not JSON"); }
  }

  async bootstrap(): Promise<unknown> {
    return this.json("/bootstrap", await this.call("/bootstrap", { method: "GET" }));
  }

  /** null = 409, the secrets were already handed to this Pod. */
  async secrets(): Promise<unknown | null> {
    const response = await this.call("/secrets", { method: "GET" });
    if (response.status === 409) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    return this.json("/secrets", response);
  }

  async postEvents(events: RunnerEvent[]): Promise<number> {
    const response = await this.call("/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ events }),
    });
    const body = await this.json("/events", response) as { accepted?: unknown };
    return Number(body?.accepted ?? 0);
  }

  async commands(after: number, waitSec: number, signal?: AbortSignal): Promise<{ commands: RunnerCommand[]; lastSeq: number | null }> {
    const wait = Math.max(0, Math.min(MAX_COMMAND_WAIT_SEC, Math.floor(waitSec)));
    const route = `/commands?after=${encodeURIComponent(String(after))}&wait=${wait}`;
    const response = await this.call(route, { method: "GET", timeoutMs: (wait + 15) * 1000, signal });
    return parseCommands(await this.json("/commands", response));
  }

  async bundle(bytes: Uint8Array): Promise<BundleResult> {
    const response = await this.call("/bundle", {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: bytes,
      timeoutMs: 5 * 60_000,
    });
    const body = await this.json("/bundle", response) as Record<string, unknown>;
    // {status: received|pushed|refused, head_sha, pr?, reason?}. Anything
    // else is read as refused (nothing counts as pushed by accident).
    const status = body?.status === "received" || body?.status === "pushed" ? body.status : "refused";
    return {
      status,
      head_sha: typeof body?.head_sha === "string" ? body.head_sha : undefined,
      pr: body?.pr && typeof body.pr === "object" ? body.pr as BundleResult["pr"] : null,
      reason: typeof body?.reason === "string" ? body.reason.slice(0, 500) : undefined,
    };
  }
}
