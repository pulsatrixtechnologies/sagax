// Append-only audit trail for the Kubernetes sandbox backend.
// Records are one JSON object per line. The file is opened with O_APPEND and
// O_NOFOLLOW and never truncated. An optional HTTPS collector receives a
// copy (POST only). The file is the evidence; shipping is best-effort and
// a failed POST does not erase the line.
import { constants, fsyncSync, openSync, writeSync } from "node:fs";

export interface SandboxAuditEvent {
  action: string;
  outcome: "ok" | "denied";
  key?: string;
  detail?: Record<string, string | number | boolean>;
}

export interface SandboxAudit {
  record(event: SandboxAuditEvent): void;
  readonly file: string;
}

export interface SandboxAuditOptions {
  file: string;
  shipUrl?: string;
  now?: () => Date;
  fetchImpl?: typeof fetch;
}

const SHIP_TIMEOUT_MS = 5_000;

function shipAllowed(url: string): URL {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error("SAGAX_SANDBOX_AUDIT_SHIP_URL must be https:// with no credentials");
  }
  return parsed;
}

/** Open the audit file once. Later records only append. */
export function createSandboxAudit(options: SandboxAuditOptions): SandboxAudit {
  const ship = options.shipUrl ? shipAllowed(options.shipUrl) : null;
  const flags = constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW;
  const fd = openSync(options.file, flags, 0o640);
  const now = options.now ?? (() => new Date());
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    file: options.file,
    record(event: SandboxAuditEvent): void {
      const line = `${JSON.stringify({
        v: 1,
        ts: now().toISOString(),
        action: event.action,
        outcome: event.outcome,
        ...(event.key ? { key: event.key } : {}),
        ...(event.detail ? { detail: event.detail } : {}),
      })}\n`;
      writeSync(fd, line);
      fsyncSync(fd);
      if (!ship) return;
      void fetchImpl(ship, {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/x-ndjson" },
        body: line,
        signal: AbortSignal.timeout(SHIP_TIMEOUT_MS),
      }).catch((error: unknown) => {
        console.error(`sandboxd: audit ship failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    },
  };
}
