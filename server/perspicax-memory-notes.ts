// Person-scoped Perspicax memory notes client (2026-11-02).
//
// `/api/v1/memory/read/*` accepts the person's own Bearer only: a Sagax link
// token and a memory sync token are refused. This module calls Perspicax with
// the live sign-in access token already held for that person (the same trust
// path as me-avatar / org capabilities). No new Perspicax trust surface.
//
// Never logs a token or a note body. Bounded timeout and answer size.
export const MEMORY_READ_PREFIX = "/api/v1/memory/read";
export const NOTES_TIMEOUT_MS = 15_000;
export const NOTES_MAX_BYTES = 2 * 1024 * 1024;

export type NotesMethod = "GET" | "POST" | "PUT" | "DELETE";

export type NotesCallResult =
  | { ok: true; status: number; body: unknown }
  | { ok: false; error: "unreachable" | "too_large" | "refused" | "unauthorized"; status?: number; body?: unknown };

export interface NotesCallLimits {
  timeoutMs?: number;
  maxBytes?: number;
}

export interface PerspicaxMemoryNotesOptions {
  /** Perspicax origin (IDENTITY.issuer), or null when not linked. */
  baseUrl: () => string | null;
  /** The live sign-in access token of this principal, or null. */
  accessToken: (principalId: string) => Promise<string | null>;
  fetcher?: typeof fetch;
}

async function readLimited(response: Response, maxBytes: number): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

/** Thin HTTP client: Bearer = the person's access token. */
export class PerspicaxMemoryNotesClient {
  private readonly options: PerspicaxMemoryNotesOptions;
  private readonly fetcher: typeof fetch;

  constructor(options: PerspicaxMemoryNotesOptions) {
    this.options = options;
    this.fetcher = options.fetcher ?? fetch;
  }

  async call(
    principalId: string,
    method: NotesMethod,
    path: string,
    body?: unknown,
    limits: NotesCallLimits = {},
  ): Promise<NotesCallResult> {
    const base = this.options.baseUrl()?.replace(/\/+$/, "");
    if (!base) return { ok: false, error: "unreachable" };
    const token = await this.options.accessToken(principalId);
    if (!token) return { ok: false, error: "unauthorized" };
    const timeoutMs = limits.timeoutMs ?? NOTES_TIMEOUT_MS;
    const maxBytes = limits.maxBytes ?? NOTES_MAX_BYTES;
    const payload = body === undefined ? undefined : JSON.stringify(body);
    let response: Response;
    try {
      response = await this.fetcher(`${base}${path}`, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`,
          ...(payload !== undefined ? { "content-type": "application/json" } : {}),
        },
        ...(payload !== undefined ? { body: payload } : {}),
      });
    } catch {
      return { ok: false, error: "unreachable" };
    }
    let text: string | null;
    try {
      text = await readLimited(response, response.ok ? maxBytes : 8_192);
    } catch {
      return { ok: false, error: "unreachable" };
    }
    if (text === null) return { ok: false, error: "too_large", status: response.status };
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }
    if (response.status === 401) return { ok: false, error: "unauthorized", status: 401, body: parsed };
    if (!response.ok) return { ok: false, error: "refused", status: response.status, body: parsed };
    return { ok: true, status: response.status, body: parsed };
  }
}

/** Build a path under `/api/v1/memory/read` with optional query. */
export function memoryReadPath(suffix: string, query?: Record<string, string | undefined>): string {
  const clean = suffix.startsWith("/") ? suffix : `/${suffix}`;
  const url = new URL(`https://px.invalid${MEMORY_READ_PREFIX}${clean}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== "") url.searchParams.set(key, value);
    }
  }
  return `${url.pathname}${url.search}`;
}
