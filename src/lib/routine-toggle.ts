import type { Routine } from "./routines";
import { t } from "./i18n";

type Dispatch = (action:
  | { type: "routinePatched"; routine: Routine }
  | { type: "error"; message: string }) => void;
type Api = (path: string, init: { method: string; body: string }) => Promise<{ routine?: Routine } | undefined>;

/** The list's on/off switch: the row changes at once, the server's routine
 * replaces it, and a refusal puts the row back with a readable message (the
 * routine's name, never its id). One request per routine at a time; a routine
 * the person may not change is left alone. */
export async function flipRoutine(routine: Routine, pending: Set<string>, api: Api, dispatch: Dispatch): Promise<void> {
  if (routine.canEdit === false || pending.has(routine.id)) return;
  pending.add(routine.id);
  dispatch({ type: "routinePatched", routine: { ...routine, enabled: !routine.enabled } });
  try {
    const response = await api(`/api/routines/${routine.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !routine.enabled }) });
    if (response?.routine) dispatch({ type: "routinePatched", routine: response.routine });
  } catch {
    dispatch({ type: "routinePatched", routine });
    dispatch({ type: "error", message: t("routines.toggleFailed", { name: routine.name }) });
  } finally {
    pending.delete(routine.id);
  }
}
