// @ts-nocheck
/** performAsMember (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createPerformAsMember(getHost: () => Host): any {
async function performAsMember(person: MemberPerson, request: MemberRequest): Promise<{ status: number; body: unknown }> {
  const host = getHost();

  const principal = host.principals.byId(person.principalId);
  const scopes: Scope[] = person.admin && principal?.orgRole === "admin" ? ["admin", "client"] : ["client"];
  // A non-empty person.name (Bot phone stamps the human caller label) becomes
  // the session label so messageSender never falls through to the generic
  // "AI client (Perspicax)" string when the directory has no display name.
  const opened = host.sessions.actAs({
    principalId: person.principalId,
    scopes,
    label: person.name.trim().slice(0, 80) || "AI client (Perspicax)",
    ...(host.IDENTITY.kind === "perspicax" ? { idp: { iss: host.IDENTITY.issuer, sub: person.sub, role: person.admin ? "admin" : "employee" } } : {})
  });
  if (!opened) return { status: 403, body: { error: "This person cannot act on this server." } };
  const url = new URL(`http://127.0.0.1:${host.PORT}${request.path}`);
  for (const [key, value] of Object.entries(request.query ?? {})) url.searchParams.set(key, value);
  const headers = new Headers({ accept: "application/json", authorization: `Bearer ${opened.token}` });
  if (request.body !== undefined) headers.set("content-type", "application/json");
  try {
    // Same-process member replay: a hung route used to pin the AI client's
    // session until revoke. Five minutes is enough for ordinary member work.
    const response = await fetch(url, { method: request.method, headers, body: request.body === undefined ? undefined : JSON.stringify(request.body), redirect: "error", signal: AbortSignal.timeout(5 * 60_000) });
    const text = await response.text();
    let body: unknown = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { error: text.slice(0, 300) };
    }
    return { status: response.status, body };
  } catch {
    return { status: 502, body: { error: "The action could not be completed." } };
  } finally {
    host.sessions.revoke(opened.session.id);
  }

}
  return performAsMember;
}
