// #3043 (QA 2026-11-08): a plain browser refuses Web Audio until the person
// has clicked or typed in the page, and every AudioContext made before that
// prints a console warning ("The AudioContext was not allowed to start").
// The sound would be silent anyway, so the app's chimes ask here first. The
// desktop shell lets audio play without a gesture, so it always may.

/** True when a Web Audio context made now may play. */
export function webAudioAllowed(): boolean {
  if (typeof window !== "undefined" && window.ogb) return true;
  const activation = typeof navigator !== "undefined"
    ? (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation
    : undefined;
  return activation ? activation.hasBeenActive : true;
}
