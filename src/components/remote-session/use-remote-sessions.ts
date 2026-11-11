import { useCallback, useEffect, useState } from "react";

import type { RemoteSessionView } from "../../../shared/remote-session";
import { api } from "@/state/store";

/** Connected sessions for this bot. Polls while the panel that calls it is mounted. */
export function useRemoteSessions(botId: string | undefined): { rows: RemoteSessionView[]; reload: () => void } {
  const [rows, setRows] = useState<RemoteSessionView[]>([]);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((value) => value + 1), []);
  useEffect(() => {
    if (!botId) return;
    let stop = false;
    const load = () => {
      api<{ sessions?: RemoteSessionView[] }>(`/api/bots/${encodeURIComponent(botId)}/remote-sessions`)
        .then((body) => {
          if (stop) return;
          const next = Array.isArray(body.sessions) ? body.sessions : [];
          // the same answer keeps the list it had: a poll that brings
          // nothing new renders nothing (#3624)
          setRows((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
        })
        .catch(() => { /* keep the last list; the next poll retries */ });
    };
    load();
    const timer = setInterval(load, 4000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [botId, tick]);
  return { rows, reload };
}
