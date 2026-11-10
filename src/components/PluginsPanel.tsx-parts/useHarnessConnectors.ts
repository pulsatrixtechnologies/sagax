import { useCallback, useEffect, useState } from "react";
import { api } from "@/state/store";
import { GROK_CLOUD_CONNECTORS } from "../../../shared/grok-cloud-connectors";
import type { connectorGroups } from "../plugins/HarnessConnectorGroups";
import type { HarnessAnswer } from "./types";

/** What the connector sections are built from (`connectorGroups`), as the
 * server's registry of the person's connectors answers it (#3358): Claude's
 * own account, each of the person's Grok sign-ins with the real state of
 * its connectors, and the ChatGPT apps of their Codex sign-in. A server that
 * lists no Grok sign-in (older, solo) leaves Grok on the xAI catalog when a
 * Grok engine is set up. */
export function harnessGroupsInput(answer: HarnessAnswer | null, loading: boolean, grokConfigured: boolean): Parameters<typeof connectorGroups>[0] {
  const claude = answer?.claude;
  return {
    claude: claude ? { available: claude.available, reason: claude.reason, connectors: claude.connectors ?? [], manageUrl: answer.manageUrl } : null,
    claudeLoading: loading && !answer,
    grok: answer?.grok ? { accounts: answer.grok.accounts ?? [] } : grokConfigured ? { connectors: GROK_CLOUD_CONNECTORS } : null,
    codex: answer?.codex ?? null,
  };
}

/** The connectors of the person's own accounts (GET /api/me/harness-connectors,
 * read from the connector registry): Providers lists them by engine, and
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
