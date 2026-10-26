// The remote-control audit trail: one JSONL line per control action (start,
// grant, release with activity counts, stop). It never records the keys or
// text injected, only that control was held and how much happened (Loi 25
// minimisation). The audit never stops a session from closing.
import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";

import type { ControlAuditEvent } from "./remote-control-session.ts";

/** Rotate at 8 MB, keeping one previous file, so the audit cannot grow forever. */
const MAX_BYTES = 8 * 1024 * 1024;

export function createRemoteControlAudit(dataDir: string) {
  const path = join(dataDir, "remote-control.jsonl");
  mkdirSync(dataDir, { recursive: true });
  const rotateIfBig = () => {
    try {
      if (statSync(path).size >= MAX_BYTES) renameSync(path, `${path}.1`);
    } catch { /* no file yet, or rename lost a race: the next append recreates it */ }
  };
  return {
    path,
    write(event: ControlAuditEvent) {
      try {
        rotateIfBig();
        appendFileSync(path, `${JSON.stringify(event)}\n`, { mode: 0o600 });
      } catch { /* disk full, read-only */ }
    },
  };
}
