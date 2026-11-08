/** #2695 follow-up: the signal gate's state (each person's count for their
 * local day, what waited for the brief) in one JSON file under DATA_DIR, so
 * a restart neither hands out a fresh budget nor loses what waited. */
import { readFileSync } from "node:fs";
import { writeFileAtomic } from "../atomic.ts";
import type { PersonSignalState, SignalGateStorage } from "../../shared/signal-levels.ts";

export function signalGateFileStorage(path: string): SignalGateStorage {
  return {
    load() {
      try {
        const parsed = JSON.parse(readFileSync(path, "utf8")) as { people?: Record<string, PersonSignalState> };
        return parsed && typeof parsed.people === "object" && parsed.people ? parsed.people : null;
      } catch {
        return null;
      }
    },
    save(people) {
      writeFileAtomic(path, JSON.stringify({ version: 1, people }), { mode: 0o600, durable: false });
    }
  };
}
