// The Perspicax role / profile slug the current turn acts as (routine
// act-as, profile_use, identity_switch). Grok's gateway catalog uses it to
// keep Sagax agent tools on that connector when several Perspicax accounts
// expose the same names (Perspicax #1050, Sagax #2258).
//
// Resolved through a setter so drivers (grok.ts) stay free of the
// PerspicaxMcp singleton in index.ts, same pattern as turn-reach.

export type TurnActiveProfileResolver = (threadId: string, botId?: string) => string | undefined;

let resolve: TurnActiveProfileResolver | undefined;

/** Wired once from index.ts when Perspicax MCP is constructed. */
export function setTurnActiveProfileResolver(fn: TurnActiveProfileResolver | undefined): void {
  resolve = fn;
}

/** The active Perspicax profile slug for this thread, or undefined on "Moi"
 * / no live connection (the catalog then keeps the first connector). */
export function turnActiveProfileFor(threadId: string | undefined, botId?: string): string | undefined {
  if (!threadId || !resolve) return undefined;
  try {
    const slug = resolve(threadId, botId)?.trim();
    return slug || undefined;
  } catch {
    return undefined;
  }
}

/** Test seam. */
export function resetTurnActiveProfileResolver(): void {
  resolve = undefined;
}
