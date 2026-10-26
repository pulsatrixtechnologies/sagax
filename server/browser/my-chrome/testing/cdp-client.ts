// A bare DevTools client for My Chrome tests: what an engine (or the person's
// own tooling) sends, one message at a time, with every event kept.
import { WebSocket } from "ws";

export interface CdpEvent { method: string; params: Record<string, unknown>; sessionId?: string }

export class CdpClient {
  readonly events: CdpEvent[] = [];
  private readonly ws: WebSocket;
  private next = 1;
  private readonly pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }>();
  closed = false;

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on("message", (data) => {
      const message = JSON.parse(String(data)) as { id?: number; result?: Record<string, unknown>; error?: { message?: string }; method?: string; params?: Record<string, unknown>; sessionId?: string };
      if (typeof message.id === "number") {
        const call = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) call?.reject(new Error(message.error.message ?? "refused"));
        else call?.resolve(message.result ?? {});
        return;
      }
      if (message.method) this.events.push({ method: message.method, params: message.params ?? {}, ...(message.sessionId ? { sessionId: message.sessionId } : {}) });
    });
    ws.on("close", () => {
      this.closed = true;
      for (const call of this.pending.values()) call.reject(new Error("closed"));
      this.pending.clear();
    });
  }

  static async connect(url: string): Promise<CdpClient> {
    const ws = new WebSocket(url, { perMessageDeflate: false });
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
      ws.once("unexpected-response", (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    });
    return new CdpClient(ws);
  }

  send(method: string, params: Record<string, unknown> = {}, sessionId?: string, timeoutMs = 15_000): Promise<Record<string, unknown>> {
    if (this.closed) return Promise.reject(new Error("closed"));
    const id = this.next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out`)); }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  /** Evaluate in a page session and return the value. */
  async evaluate<T = unknown>(sessionId: string, expression: string): Promise<T> {
    const answer = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
    return (answer.result as { value?: T } | undefined)?.value as T;
  }

  close(): void {
    this.ws.close();
  }
}

export async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 10_000, what = "condition"): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${what}`);
}
