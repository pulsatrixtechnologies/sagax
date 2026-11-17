// The call every folder action makes (POST /api/routines/folders), and the move of
// routines into a folder from any list: the bot panel's folder list, the Routines
// page's grouped table and a row's "Move to folder" in every view (2026-11-17).
import { api } from "@/state/store";
import type { Routine } from "@/lib/routines";
import type { Action } from "@/state/store";
import { t } from "@/lib/i18n";
import { featureMissingOnServer } from "@/lib/server-route";
import { routineFolderKey, type RoutineFolderAction, type RoutineFolderUndo } from "../../shared/routine-folders";

export interface FolderAnswer { folders: string[]; routines: Routine[]; undo?: RoutineFolderUndo }
export type FolderPost = { ok: true; answer: FolderAnswer } | { ok: false; missing: boolean };

/** Posts one folder action and patches the store with its answer. A server without folders answers
 * `missing`; any other failure is told once through the store's error line. */
export async function postFolderAction(dispatch: (action: Action) => void, body: RoutineFolderAction): Promise<FolderPost> {
  try {
    const answer = await api<FolderAnswer>("/api/routines/folders", { method: "POST", body: JSON.stringify(body) });
    for (const routine of answer.routines) dispatch({ type: "routinePatched", routine });
    dispatch({ type: "routineFoldersPatched", botId: body.botId, folders: answer.folders });
    return { ok: true, answer };
  } catch (failure) {
    if (featureMissingOnServer("routineFolders", failure)) return { ok: false, missing: true };
    dispatch({ type: "error", message: failure instanceof Error && failure.message ? failure.message : t("routineFolders.failed") });
    return { ok: false, missing: false };
  }
}

/** Files routines into a folder (null: out of any folder). The rows move at once; a failed call puts them back. */
export async function moveRoutinesToFolder(dispatch: (action: Action) => void, botId: string, routines: readonly Routine[], folder: string | null): Promise<FolderAnswer | null> {
  for (const routine of routines) {
    const { folder: _old, ...rest } = routine;
    dispatch({ type: "routinePatched", routine: folder === null ? rest : { ...rest, folder } });
  }
  const result = await postFolderAction(dispatch, { action: "move", botId, routineIds: routines.map((routine) => routine.id), folder });
  if (!result.ok) for (const routine of routines) dispatch({ type: "routinePatched", routine });
  return result.ok ? result.answer : null;
}

/** A routine's Move to folder entries: one per other folder of its bot, and one to take it out. */
export function folderMoveTargets(routine: Routine, folders: readonly string[], move: (folder: string | null) => void): Array<{ key: string; label: string; onSelect: () => void }> {
  return [
    ...folders.filter((name) => !routine.folder || routineFolderKey(name) !== routineFolderKey(routine.folder)).map((name) => ({ key: `move-${name}`, label: t("routineFolders.moveTo", { name }), onSelect: () => move(name) })),
    ...(routine.folder ? [{ key: "move-out", label: t("routineFolders.moveOut"), onSelect: () => move(null) }] : []),
  ];
}
