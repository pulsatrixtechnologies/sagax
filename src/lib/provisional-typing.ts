/** Launch drawing (src/lib/ui-snapshot.ts, App ProvisionalInputGuard).
 * Plain typing into a text field while the drawing is up: kept, so what
 * the person types is not lost. Enter, shortcuts and line breaks still stop,
 * since they send or act. */
export function typingIntoField(event: Event): boolean {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;
  const field = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable;
  if (!field) return false;
  if (event instanceof KeyboardEvent) return event.key !== "Enter" && !event.metaKey && !event.ctrlKey;
  if (event.type === "beforeinput") {
    const kind = (event as InputEvent).inputType;
    return kind.startsWith("insertText") || kind.startsWith("deleteContent") || kind === "insertCompositionText" || kind === "insertReplacementText";
  }
  return false;
}
