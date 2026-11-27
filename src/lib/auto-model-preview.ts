// Auto model (docs/plans/2026-10-08-auto-model.md): what a bot on Auto would
// run this person's next turn on, from GET /api/bots/<id>/auto-model.
import { useEffect, useRef, useState } from "react";

import { api } from "@/state/store";
import type { AutoModelRecord, AutoModelPreview } from "../../shared/auto-model";

/** The dispatch candidates and configured recovery choices, including for a
 * pinned bot. Never carry a previous bot's preview into a new scope.
 * `open` (M-20261126-101): the menu that shows the answer is open. Each
 * opening reads it again, so an account that reached its limit since the
 * last reading is gone from the modes' tooltips; the last answer of the same
 * scope stays on screen meanwhile, and a closing menu reads nothing. A read
 * that fails keeps that answer too (#5421 review H2: the usage pill's pool). */
export function useAutoModelStatus(botId: string, threadId: string | undefined, enabled: boolean, revision?: string, open = false): AutoModelPreview | null {
  const scope = JSON.stringify([botId, threadId, revision]);
  const [preview, setPreview] = useState<{ scope: string; status: AutoModelPreview } | null>(null);
  // the scope whose answer was last asked for, and that request's number (a later one wins)
  const asked = useRef<{ scope: string | null; request: number }>({ scope: null, request: 0 });
  useEffect(() => {
    if (!enabled) {
      asked.current = { scope: null, request: asked.current.request + 1 };
      setPreview(null);
      return;
    }
    if (!open && asked.current.scope === scope) return;
    const request = asked.current.request + 1;
    asked.current = { scope, request };
    const query = threadId ? `?threadId=${encodeURIComponent(threadId)}` : "";
    api<AutoModelPreview>(`/api/bots/${encodeURIComponent(botId)}/auto-model${query}`)
      .then((answer) => { if (asked.current.request === request) setPreview({ scope, status: answer }); })
      .catch(() => { if (asked.current.request === request) setPreview((last) => (last?.scope === scope ? last : null)); });
  }, [botId, threadId, enabled, revision, scope, open]);
  return enabled && preview?.scope === scope ? preview.status : null;
}

export function useAutoModelPreview(botId: string, threadId: string | undefined, enabled: boolean): AutoModelRecord | null {
  const status = useAutoModelStatus(botId, threadId, enabled);
  return status?.auto ? status.pick : null;
}
