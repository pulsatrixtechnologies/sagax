// Whether the routine editor's "More options" disclosure is open for this
// person. Follows them via user-preferences sync (shared/user-preferences.ts).
// Absent or anything other than "1" means collapsed (Grok-simple default).

export const ROUTINE_EDITOR_MORE_KEY = "sagax.routineEditorMore.v1";

export function readRoutineEditorMoreOpen(): boolean {
  try {
    return globalThis.localStorage?.getItem(ROUTINE_EDITOR_MORE_KEY) === "1";
  } catch {
    return false;
  }
}

export function rememberRoutineEditorMoreOpen(open: boolean): void {
  try {
    globalThis.localStorage?.setItem(ROUTINE_EDITOR_MORE_KEY, open ? "1" : "0");
  } catch {
    // Private windows may refuse storage; the choice holds for this session.
  }
}
