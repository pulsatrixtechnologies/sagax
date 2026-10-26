// A client of Perspicax's cloud agents API (`/api/v1/agents`, Perspicax PR
// #372, lot P1.1; its spec section 10.1). There is no key to paste and none
// is stored here. Every call carries two credentials (2026-10-19, as the
// other link routes do): `Authorization: Bearer <link token>` says which
// server calls, `x-perspicax-subject-token: <sign-in token>` says who acts:
// the person who speaks in a conversation, the bot's owner for a routine
// (the record's principal), never anyone else. A person's sign-in token
// alone as a Bearer is refused by Perspicax.
//
// Rules, none optional:
//   - tokens go in those two headers only, never in a URL, an error or a
//     log line; a 401 re-reads the link token once (it may have rotated);
//   - every call has a timeout; a non-2xx answer becomes a ProviderHttpError
//     with Perspicax's own message (quota refusals are shown as they are);
//   - ids are checked before they reach a path;
//   - the artifact routes (diff, commits, files) and `approve` belong to
//     Perspicax lot P1.5: a 404 or 405 there is "not available yet", not an
//     error. Until they are served, the diff and the commits are read from
//     the run's own `diff` and `commits` events (runner protocol), the latest
//     of each;
//   - lists are `Page<T>` (`items`, `page`, `page_size` at most 200, `total`):
//     every page is read, up to a cap;
//   - an error body is `{ code, message, details }`.
import type {
  PerspicaxEnvironment,
  PerspicaxNewRun,
  PerspicaxPage,
  PerspicaxRun,
  RunEvent,
} from "../../shared/cloud-agents.ts";
import { commitsFrom, diffFilesFrom, type CodeArtifact, type CodeCommit, type CodeFileEntry, type DiffFile, type FollowUpMode } from "../../shared/code-runs.ts";
import { createHash } from "node:crypto";

import { SUBJECT_TOKEN_HEADER } from "../perspicax-link.ts";
import { ProviderHttpError } from "./providers/http.ts";
import type { HttpFetch } from "./providers/types.ts";

export const PERSPICAX_AGENTS_PATH = "/api/v1/agents";
export const PERSPICAX_TIMEOUT_MS = 10_000;
const ANSWER_MAX_BYTES = 4 * 1024 * 1024;
const ID = /^[A-Za-z0-9_-]{1,80}$/;
/** Perspicax's page size ceiling (`Paging::clamp`). */
const PAGE_SIZE = 200;
/** Rows a list reads at most (Perspicax keeps 2000 runs per list). */
const LIST_MAX = 2000;
/** One `GET /events` answer holds at most this many rows. */
const EVENTS_PAGE = 1000;
/** Events read at most when the whole log is needed (diff fallback, transcript). */
const EVENTS_MAX = 20_000;
/** How long one log read serves the diff and commits fallbacks. */
const LOG_SHARE_MS = 3_000;

export interface PerspicaxAccess {
  /** Perspicax's origin (the issuer). */
  baseUrl: string;
  /** The acting person's Sagax sign-in access token (who). */
  token: string;
  /** This server's link token (which server), or null when not linked. */
  link: () => string | null;
  /** The link token read again from its file after a 401. */
  relink?: () => string | null;
}

function checkId(id: string): string {
  if (!ID.test(id)) throw new ProviderHttpError(400, "bad_id", "Invalid run or environment id.");
  return encodeURIComponent(id);
}

export class PerspicaxAgentsClient {
  private readonly fetchImpl: HttpFetch;
  private readonly timeoutMs: number;
  /** One read of a run's log shared by the diff and commits fallbacks
   * asked together (a few seconds; keyed by a digest, never the token). */
  private readonly logReads = new Map<string, { at: number; read: Promise<RunEvent[]> }>();
  constructor(fetchImpl: HttpFetch = fetch, timeoutMs = PERSPICAX_TIMEOUT_MS) {
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  private url(access: PerspicaxAccess, path: string): string {
    const base = new URL(access.baseUrl);
    return new URL(`${PERSPICAX_AGENTS_PATH}${path}`, base.origin).toString();
  }

  /** The two credentials of a call. */
  private headers(link: string, access: PerspicaxAccess, extra: Record<string, string>): Record<string, string> {
    return { authorization: `Bearer ${link}`, [SUBJECT_TOKEN_HEADER]: access.token, ...extra };
  }

  /** One request with the link token, and once more with a fresh one after a 401.
   * Never follows a redirect: fetch would drop Authorization on another origin
   * but keep x-perspicax-subject-token, the person's sign-in. */
  private async send(access: PerspicaxAccess, url: string, initIn: { method?: string; headers: Record<string, string>; body?: string; signal: AbortSignal }): Promise<Response> {
    const init = { ...initIn, redirect: "error" as const };
    const link = access.link();
    if (!link) throw new ProviderHttpError(501, "not_linked", "This Sagax server is not linked to Perspicax.");
    let res = await this.fetchImpl(url, { ...init, headers: this.headers(link, access, init.headers) });
    if (res.status === 401 && access.relink) {
      const again = access.relink();
      if (again && again !== link) {
        await res.body?.cancel().catch(() => {});
        res = await this.fetchImpl(url, { ...init, headers: this.headers(again, access, init.headers) });
      }
    }
    return res;
  }

  private async call<T>(access: PerspicaxAccess, method: string, path: string, body?: unknown, optional = false): Promise<T | null> {
    let res: Response;
    try {
      res = await this.send(access, this.url(access, path), {
        method,
        headers: {
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (error instanceof ProviderHttpError) throw error;
      throw new ProviderHttpError(502, "unreachable", "Perspicax did not answer.");
    }
    if (optional && (res.status === 404 || res.status === 405 || res.status === 501)) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    const text = await readCapped(res);
    if (!res.ok) {
      let message = `Perspicax answered ${res.status}.`;
      try {
        const parsed = JSON.parse(text) as { error?: unknown; message?: unknown };
        const said = typeof parsed.message === "string" ? parsed.message : typeof parsed.error === "string" ? parsed.error : "";
        if (said.trim()) message = said.trim().slice(0, 500);
      } catch {}
      throw new ProviderHttpError(res.status, res.status === 409 ? "conflict" : "perspicax", message);
    }
    if (!text) return {} as T;
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("json")) return text as unknown as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ProviderHttpError(502, "bad_answer", "Perspicax sent an unreadable answer.");
    }
  }

  private async must<T>(access: PerspicaxAccess, method: string, path: string, body?: unknown): Promise<T> {
    return (await this.call<T>(access, method, path, body)) as T;
  }

  /** A run, or a `{ value: run }` mutation answer, checked for its id. */
  private async runAnswer(access: PerspicaxAccess, method: string, path: string, body?: unknown, wrapped = false): Promise<PerspicaxRun> {
    const answer = await this.must<unknown>(access, method, path, body);
    const run = wrapped && answer && typeof answer === "object" ? (answer as { value?: unknown }).value : answer;
    if (!run || typeof run !== "object" || typeof (run as { id?: unknown }).id !== "string") {
      throw new ProviderHttpError(502, "bad_answer", "Perspicax sent an unreadable run.");
    }
    return run as PerspicaxRun;
  }

  /** Every page of a `Page<T>` list, in order, up to `LIST_MAX` rows. */
  private async pages<T>(access: PerspicaxAccess, path: string, params: URLSearchParams): Promise<T[]> {
    const out: T[] = [];
    for (let page = 1; out.length < LIST_MAX; page++) {
      params.set("page", String(page));
      params.set("page_size", String(PAGE_SIZE));
      const answer = await this.must<PerspicaxPage<T>>(access, "GET", `${path}?${params}`);
      const items = Array.isArray(answer?.items) ? answer.items : [];
      out.push(...items);
      const total = typeof answer?.total === "number" ? answer.total : out.length;
      if (items.length === 0 || out.length >= total) break;
    }
    return out.slice(0, LIST_MAX);
  }

  /** Whether this Perspicax serves the cloud agents API at all (#372). A
   * Perspicax without it answers 404 (or 405, 501) on the environments list:
   * that is "not available", never an error. Other failures throw. */
  async servesAgents(access: PerspicaxAccess): Promise<boolean> {
    const answer = await this.call<unknown>(access, "GET", "/environments?page=1&page_size=1", undefined, true);
    return answer !== null;
  }

  /** The environments this person may see (Perspicax leaves the archived
   * ones out unless asked). */
  async environments(access: PerspicaxAccess): Promise<PerspicaxEnvironment[]> {
    const rows = await this.pages<PerspicaxEnvironment>(access, "/environments", new URLSearchParams());
    return rows.filter((env) => !env.archived);
  }

  /** Runs newest first (`created_at`). `mine` keeps the ones the person asked
   * for or that run with their rights, whatever started them (Sagax, the
   * console, an MCP client, an automation). */
  async runs(access: PerspicaxAccess, query: { mine?: boolean; envId?: string; state?: string } = {}): Promise<PerspicaxRun[]> {
    const params = new URLSearchParams();
    if (query.mine) params.set("mine", "true");
    if (query.envId) params.set("env_id", query.envId);
    if (query.state) params.set("state", query.state);
    return this.pages<PerspicaxRun>(access, "/runs", params);
  }

  async run(access: PerspicaxAccess, id: string): Promise<PerspicaxRun> {
    return this.runAnswer(access, "GET", `/runs/${checkId(id)}`);
  }

  async create(access: PerspicaxAccess, input: PerspicaxNewRun): Promise<PerspicaxRun> {
    return this.runAnswer(access, "POST", "/runs", input, true);
  }

  /** One answer of the event log: at most `EVENTS_PAGE` rows after `after`. */
  async events(access: PerspicaxAccess, id: string, after = 0): Promise<RunEvent[]> {
    const list = await this.must<RunEvent[]>(access, "GET", `/runs/${checkId(id)}/events?after=${Math.max(0, Math.floor(after))}&limit=${EVENTS_PAGE}`);
    return Array.isArray(list) ? list : [];
  }

  /** The whole event log after `after`, page by page, up to `EVENTS_MAX`. */
  async allEvents(access: PerspicaxAccess, id: string, after = 0): Promise<RunEvent[]> {
    const out: RunEvent[] = [];
    let cursor = Math.max(0, Math.floor(after));
    while (out.length < EVENTS_MAX) {
      const page = await this.events(access, id, cursor);
      out.push(...page);
      const last = page.at(-1)?.seq;
      if (page.length < EVENTS_PAGE || typeof last !== "number" || last <= cursor) break;
      cursor = last;
    }
    return out;
  }

  async markRead(access: PerspicaxAccess, id: string): Promise<PerspicaxRun> {
    return this.runAnswer(access, "POST", `/runs/${checkId(id)}/read`, {});
  }

  async followUp(access: PerspicaxAccess, id: string, text: string, mode: FollowUpMode): Promise<PerspicaxRun> {
    return this.runAnswer(access, "POST", `/runs/${checkId(id)}/followup`, { text, mode }, true);
  }

  /** `POST /runs/:id/approve` (Perspicax P1.5). Before it is served, a 404
   * is a clear "not available yet", never a raw error. */
  async approve(access: PerspicaxAccess, id: string, approvalId: string, option: string): Promise<void> {
    const answer = await this.call<unknown>(access, "POST", `/runs/${checkId(id)}/approve`, { approval_id: approvalId, option }, true);
    if (answer === null) throw new ProviderHttpError(501, "not_available", "Perspicax does not take approvals from Sagax yet.");
  }

  async stop(access: PerspicaxAccess, id: string): Promise<PerspicaxRun> {
    return this.runAnswer(access, "POST", `/runs/${checkId(id)}/stop`, {}, true);
  }

  async archive(access: PerspicaxAccess, id: string): Promise<PerspicaxRun> {
    return this.runAnswer(access, "POST", `/runs/${checkId(id)}/archive`, {}, true);
  }

  private sharedLog(access: PerspicaxAccess, id: string): Promise<RunEvent[]> {
    const now = Date.now();
    for (const [key, entry] of this.logReads) if (now - entry.at > LOG_SHARE_MS) this.logReads.delete(key);
    const key = createHash("sha256").update(`${access.baseUrl}\n${access.token}\n${id}`).digest("hex");
    const hit = this.logReads.get(key);
    if (hit) return hit.read;
    const read = this.allEvents(access, id);
    read.catch(() => this.logReads.delete(key));
    this.logReads.set(key, { at: now, read });
    return read;
  }

  /** The run's diff: `GET /runs/:id/diff` once Perspicax serves it, else the
   * latest `diff` event of the log (`{files: [DiffView.files]}`). Neither:
   * not available. */
  async diff(access: PerspicaxAccess, id: string): Promise<CodeArtifact<DiffFile>> {
    const answer = await this.call<unknown>(access, "GET", `/runs/${checkId(id)}/diff`, undefined, true);
    if (answer !== null) return { available: true, items: diffFilesFrom(answer) };
    const event = lastOfKind(await this.sharedLog(access, id), "diff");
    return event ? { available: true, items: diffFilesFrom(event.payload) } : { available: false, items: [] };
  }

  /** The run's commits: `GET /runs/:id/commits`, else the latest `commits`
   * event (`{commits: [{sha, title, author, at}]}`). */
  async commits(access: PerspicaxAccess, id: string): Promise<CodeArtifact<CodeCommit>> {
    const answer = await this.call<unknown>(access, "GET", `/runs/${checkId(id)}/commits`, undefined, true);
    if (answer !== null) return { available: true, items: commitsFrom(answer) };
    const event = lastOfKind(await this.sharedLog(access, id), "commits");
    return event ? { available: true, items: commitsFrom(event.payload) } : { available: false, items: [] };
  }

  async files(access: PerspicaxAccess, id: string): Promise<CodeArtifact<CodeFileEntry>> {
    const answer = await this.call<unknown>(access, "GET", `/runs/${checkId(id)}/files`, undefined, true);
    if (answer === null) return { available: false, items: [] };
    const rows = Array.isArray(answer) ? answer : Array.isArray((answer as { items?: unknown }).items) ? (answer as { items: unknown[] }).items : [];
    const items: CodeFileEntry[] = rows.flatMap((row) => {
      if (!row || typeof row !== "object") return [];
      const f = row as Record<string, unknown>;
      if (typeof f.path !== "string") return [];
      return [{ path: f.path, kind: f.kind === "dir" ? "dir" as const : "file" as const, ...(typeof f.size === "number" ? { size: f.size } : {}) }];
    });
    return { available: true, items };
  }

  /** The run's live events (`/runs/:id/stream`), parsed from SSE. Ends when
   * Perspicax closes the stream or `signal` aborts. */
  async *stream(access: PerspicaxAccess, id: string, after: number, signal: AbortSignal): AsyncGenerator<RunEvent> {
    let res: Response;
    const cursor = Math.max(0, Math.floor(after));
    // The headers must come within the call timeout; the body then streams
    // until `signal` aborts or Perspicax closes it.
    const opening = new AbortController();
    const stopOpening = () => opening.abort();
    signal.addEventListener("abort", stopOpening, { once: true });
    const headersDue = setTimeout(stopOpening, this.timeoutMs);
    try {
      // `after` and `Last-Event-ID` both: Perspicax resumes after the larger.
      res = await this.send(access, this.url(access, `/runs/${checkId(id)}/stream?after=${cursor}`), {
        headers: { accept: "text/event-stream", ...(cursor > 0 ? { "last-event-id": String(cursor) } : {}) },
        signal: opening.signal,
      });
    } catch (error) {
      signal.removeEventListener("abort", stopOpening);
      if (signal.aborted) return;
      if (error instanceof ProviderHttpError) throw error;
      throw new ProviderHttpError(502, "unreachable", "Perspicax did not answer.");
    } finally {
      clearTimeout(headersDue);
    }
    if (!res.ok || !res.body) {
      await res.body?.cancel().catch(() => {});
      throw new ProviderHttpError(res.status || 502, "perspicax", `Perspicax answered ${res.status}.`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let cut: number;
        while ((cut = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          const data = frame.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).replace(/^ /, "")).join("\n");
          if (!data) continue;
          try {
            const event = JSON.parse(data) as RunEvent;
            if (event && typeof event.seq === "number" && typeof event.kind === "string") yield event;
          } catch {}
        }
        if (buffer.length > ANSWER_MAX_BYTES) buffer = "";
      }
    } catch (error) {
      if (signal.aborted) return;
      throw new ProviderHttpError(502, "unreachable", error instanceof Error && error.name === "AbortError" ? "Perspicax stream aborted." : "Perspicax stream broke.");
    } finally {
      reader.releaseLock();
      signal.removeEventListener("abort", stopOpening);
      try { await res.body.cancel(); } catch {}
    }
  }
}

function lastOfKind(events: readonly RunEvent[], kind: string): RunEvent | undefined {
  for (let i = events.length - 1; i >= 0; i--) if (events[i]!.kind === kind) return events[i];
  return undefined;
}

async function readCapped(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > ANSWER_MAX_BYTES) {
      await reader.cancel();
      throw new ProviderHttpError(502, "too_large", "Perspicax sent too large an answer.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
