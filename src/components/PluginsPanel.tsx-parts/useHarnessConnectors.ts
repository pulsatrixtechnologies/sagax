import { useCallback, useEffect, useState } from "react";
import { api } from "@/state/store";
import type { HarnessAnswer } from "./types";

/** The connectors of the person's own Claude account
 * (GET /api/me/harness-connectors): Providers lists them by engine, and
 * "N connected" counts the connected ones. */
export function useHarnessConnectors() {
  const [answer, setAnswer] = useState<HarnessAnswer | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    try {
      setAnswer(await api<HarnessAnswer>(`/api/me/harness-connectors${refresh ? "?refresh=1" : ""}`, { timeoutMs: 90_000 }));
    } catch {
      // no answer (an older server, a timeout): the Claude section says so
      // and offers to read again, it never vanishes (2026-10-28)
      setAnswer((current) => current ?? { claude: { available: false, reason: "unknown", connectors: [] } });
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const connectors = answer?.claude?.available ? answer.claude.connectors ?? [] : [];
  return { answer, loading, load, connected: connectors.filter((connector) => connector.status === "connected").length };
}
