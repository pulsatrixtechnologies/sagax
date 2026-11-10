// The reader's bar talks to this server's own routes, with the reader's own
// session cookie (same origin) and nothing else.
export class ReaderApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly body?: Record<string, unknown>) {
    super(message);
  }
}

export async function readerApi<T>(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? "GET",
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...init.headers },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const body = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (!res.ok) throw new ReaderApiError(typeof body.error === "string" ? body.error : `HTTP ${res.status}`, res.status, typeof body.code === "string" ? body.code : undefined, body);
  return body as T;
}
