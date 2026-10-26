// The addresses that open a screen of the app (`#approvals`, `#approvals?…`,
// `#code`, `#code/<run>`), read at load and on every hash change of an open
// tab. Any other hash (`#inbox`, a pairing `#code=…`) is left to its owner.
import { isInboxHash } from "../../shared/approvals-inbox";
import { codeHashTarget } from "@/lib/code-runs";

export type ViewHashAction = { type: "showApprovals" } | { type: "showCode"; runId?: string };

/** Opens the screen the hash names; true when it named one. The Approvals
 * screen keeps its filters in the address; `#code` leaves it. */
export function followViewHash(
  dispatch: (action: ViewHashAction) => void,
  loc: Pick<Location, "hash" | "pathname" | "search"> = location,
  historyApi: Pick<History, "replaceState" | "state"> | null = globalThis.history ?? null,
): boolean {
  if (isInboxHash(loc.hash)) {
    dispatch({ type: "showApprovals" });
    return true;
  }
  const target = codeHashTarget(loc.hash);
  if (!target) return false;
  dispatch({ type: "showCode", ...target });
  try { historyApi?.replaceState(historyApi.state, "", `${loc.pathname}${loc.search}`); } catch { /* ignore */ }
  return true;
}

/** Drops a `#approvals…` or `#code…` hash once its screen is no longer
 * shown, so following the same address again fires a hash change and opens
 * it. True when it cleared one. */
export function clearLeftViewHash(
  activeView: string,
  loc: Pick<Location, "hash" | "pathname" | "search"> = location,
  historyApi: Pick<History, "replaceState" | "state"> | null = globalThis.history ?? null,
): boolean {
  const left = (isInboxHash(loc.hash) && activeView !== "approvals") || (codeHashTarget(loc.hash) !== null && activeView !== "code");
  if (!left) return false;
  try { historyApi?.replaceState(historyApi.state, "", `${loc.pathname}${loc.search}`); } catch { /* ignore */ }
  return true;
}

/** Follows the hash now and on every later change; returns the cleanup. */
export function watchViewHash(dispatch: (action: ViewHashAction) => void): () => void {
  followViewHash(dispatch);
  const onHashChange = () => { followViewHash(dispatch); };
  window.addEventListener("hashchange", onHashChange);
  return () => window.removeEventListener("hashchange", onHashChange);
}
