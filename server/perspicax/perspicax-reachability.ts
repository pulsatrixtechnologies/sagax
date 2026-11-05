// Whether this organization server reaches its Perspicax connector (the MCP
// gateway), as the people of the organization should hear it (#2013): a calm
// notice in their app while it is unreachable, then "Reconnected".
//
// Fed by the real traffic (every request PerspicaxMcp sends: observedFetch)
// and by a light probe of the gateway's own /healthz: once a minute while
// all is well, every 10 s while it is down. A failure is only news once a
// probe still fails `debounceMs` later, so a 2-second blip says nothing.
// Any HTTP answer below 500 is "reachable": a refused token is the person's
// own card, never this notice. Clients read the state from
// GET /api/connector-status and the `connector.status` live frame.

export type ConnectorState = "ok" | "unreachable";

export interface ConnectorStatus {
  state: ConnectorState;
  /** Epoch ms of the last change of state. */
  since: number;
}

export interface PerspicaxReachabilityOptions {
  /** One light request to the gateway; true when it answered. */
  probe: () => Promise<boolean>;
  onChange: (status: ConnectorStatus) => void;
  now?: () => number;
  debounceMs?: number;
  idleProbeMs?: number;
  downProbeMs?: number;
}

export const CONNECTOR_DEBOUNCE_MS = 5_000;
export const CONNECTOR_IDLE_PROBE_MS = 60_000;
export const CONNECTOR_DOWN_PROBE_MS = 10_000;

/** A gateway answer that says it is up (anything but a 5xx). */
export function gatewayAnswered(status: number): boolean {
  return status > 0 && status < 500;
}

export class PerspicaxReachability {
  private current: ConnectorStatus;
  private failingSince: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private probing = false;
  private stopped = true;
  private readonly now: () => number;
  private readonly debounceMs: number;
  private readonly idleProbeMs: number;
  private readonly downProbeMs: number;
  private readonly options: PerspicaxReachabilityOptions;

  constructor(options: PerspicaxReachabilityOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
    this.debounceMs = options.debounceMs ?? CONNECTOR_DEBOUNCE_MS;
    this.idleProbeMs = options.idleProbeMs ?? CONNECTOR_IDLE_PROBE_MS;
    this.downProbeMs = options.downProbeMs ?? CONNECTOR_DOWN_PROBE_MS;
    this.current = { state: "ok", since: this.now() };
  }

  status(): ConnectorStatus {
    return { ...this.current };
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.schedule(this.idleProbeMs);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** One answer (or none) from the gateway. */
  observe(ok: boolean): void {
    const at = this.now();
    if (ok) {
      this.failingSince = null;
      if (this.current.state !== "ok") this.change({ state: "ok", since: at });
      if (!this.stopped && this.current.state === "ok") this.schedule(this.idleProbeMs);
      return;
    }
    if (this.current.state === "unreachable") return;
    if (this.failingSince === null) {
      this.failingSince = at;
      // confirm once the debounce has passed
      if (!this.stopped) this.schedule(this.debounceMs);
      return;
    }
    if (at - this.failingSince >= this.debounceMs) {
      this.change({ state: "unreachable", since: this.failingSince });
      if (!this.stopped) this.schedule(this.downProbeMs);
    }
  }

  /** Probe now (tests and the timer). */
  async probeNow(): Promise<void> {
    if (this.probing) return;
    this.probing = true;
    let ok = false;
    try {
      ok = await this.options.probe();
    } catch {
      ok = false;
    } finally {
      this.probing = false;
    }
    this.observe(ok);
    // a first failure scheduled its own confirmation; otherwise keep the pace
    if (!this.stopped && !(this.failingSince !== null && this.current.state === "ok")) {
      this.schedule(this.current.state === "ok" ? this.idleProbeMs : this.downProbeMs);
    }
  }

  private schedule(ms: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.probeNow(); }, ms);
    this.timer.unref?.();
  }

  private change(next: ConnectorStatus): void {
    this.current = next;
    try {
      this.options.onChange({ ...next });
    } catch {
      /* a listener never breaks the tracker */
    }
  }
}

/** A fetch whose answers (or failures) feed the tracker. A request the
 * caller aborted on purpose says nothing about the gateway. */
export function observedFetch(fetcher: typeof fetch, reach: Pick<PerspicaxReachability, "observe">): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    try {
      const response = await fetcher(input, init);
      reach.observe(gatewayAnswered(response.status));
      return response;
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      if (name !== "AbortError" && name !== "TimeoutError") reach.observe(false);
      throw error;
    }
  }) as typeof fetch;
}

/** The light probe: GET <gateway origin>/healthz, 5 s at most. */
export function gatewayProbe(endpoint: () => string | null, fetcher: typeof fetch = fetch): () => Promise<boolean> {
  return async () => {
    const url = endpoint();
    if (!url) return true;
    let origin: string;
    try { origin = new URL(url).origin; } catch { return true; }
    try {
      const response = await fetcher(`${origin}/healthz`, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(5_000) });
      void response.body?.cancel().catch(() => {});
      return gatewayAnswered(response.status);
    } catch {
      return false;
    }
  };
}
