import { connectorCallReads } from "../../../shared/engine-connectors.ts";

export class ConnectorCallTimeout extends Error {}

/** One budget includes queueing, process startup and the upstream call.
 * Every delayed start must check remaining() before doing any work. */
export function connectorCallDeadline(tool: string, overrideMs?: number) {
  const timeoutMs = overrideMs ?? (connectorCallReads(tool) ? 30_000 : 90_000);
  const expires = Date.now() + timeoutMs;
  const timeout = () => new ConnectorCallTimeout("Connector call timed out. Its result is unknown; check before repeating a write.");
  return {
    timeoutMs,
    remaining(): number {
      const remaining = expires - Date.now();
      if (remaining <= 0) throw timeout();
      return remaining;
    },
    async run<T>(work: () => Promise<T>): Promise<T> {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(timeout()), Math.max(0, expires - Date.now())); }),
          work(),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  };
}
