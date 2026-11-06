// @ts-nocheck
/** performBotActRoute (#1388). Pure move from server/index.ts. */
import { botActConsoleRouteError } from "../../shared/bot-act.ts";
export type Host = Record<string, any>;

export function createPerformBotActRoute(getHost: () => Host): any {
async function performBotActRoute(actor: PerformActor, target: RouteTarget, maxChars = 8000, mark: InternalRequestMark = {}): Promise<{ status: number; text: string }> {
  const host = getHost();

  if (target.path === "/api/internal" || target.path.startsWith("/api/internal/") || target.path === "/api/testing" || target.path.startsWith("/api/testing/")) {
    return { status: 400, text: "That path is not available." };
  }
  // #1993: the console/member APIs accept assertions minted by Perspicax
  // for one request, never the opaque Sagax session delegated below. Keep
  // their signature, audience, actor and replay checks intact.
  const consoleError = botActConsoleRouteError(target.path);
  if (consoleError) return { status: 400, text: consoleError };
  const headers = new Headers();
  headers.set("accept", "application/json");
  // narrows only: a remote session upload then keeps to the transfer folder
  headers.set(host.BOT_ACT_ROUTE_HEADER, "1");
  if (mark.onBehalf) headers.set(host.ON_BEHALF_HEADER, host.ON_BEHALF_SECRET);
  // only a confidential thread needs the token: an ordinary one takes the follow-up as before
  if (mark.continuation && host.store.isConfidentialThread(mark.continuation)) {
    headers.set(host.CONTINUATION_HEADER, host.mintOwnerContinuation(mark.continuation, mark.continuationExact ? { method: target.method.toUpperCase(), path: target.path } : undefined));
  }
  if (mark.confirmed) headers.set(host.ACT_CONFIRMED_HEADER, host.mintActConfirmation(mark.confirmed, target.method, target.path));
  let body: string | undefined;
  if (target.body !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(target.body);
  }
  let revokeId: string | null = null;
  if (actor.kind === "person") {
    const delegated = host.sessions.delegate(actor.sessionId);
    if (!delegated) return { status: 403, text: "This person's session is no longer valid." };
    headers.set("authorization", `Bearer ${delegated.token}`);
    revokeId = delegated.session.id;
  } else if (host.desktopMutationToken) {
    headers.set("x-openmausbot-desktop-owner", host.desktopMutationToken);
  }
  const url = new URL(`http://127.0.0.1:${host.PORT}${target.path}`);
  if (target.query) for (const [key, value] of Object.entries(target.query)) url.searchParams.append(key, value);
  try {
    // Loopback to this process: without a bound a stalled handler held the
    // bot's act forever. Fifteen minutes covers large transfers; the catch
    // path below is unchanged.
    const response = await fetch(url, { method: target.method, headers, body, redirect: "error", signal: AbortSignal.timeout(15 * 60_000) });
    return { status: response.status, text: (await response.text()).slice(0, maxChars) };
  } catch {
    return { status: 502, text: "The action could not be completed." };
  } finally {
    if (revokeId) host.sessions.revoke(revokeId);
  }

}
  return performBotActRoute;
}
