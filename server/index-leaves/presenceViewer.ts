// @ts-nocheck
/** presenceViewer (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createPresenceViewer(getHost: () => Host): any {
function presenceViewer(auth: RequestAuth) {
  const host = getHost();

  const id = auth.kind === "session" ? auth.session.principalId?.trim() : undefined;
  if (host.IDENTITY.kind !== "perspicax" || auth.kind !== "session" || !id) return { ok: false, code: "session_required" };
  const principal = host.principals.byId(id);
  if (!principal?.subject || principal.subject.iss !== host.IDENTITY.issuer || principal.disabledAt != null || principal.consoleDisabled || principal.mergedInto) {
    return { ok: false, code: "other_organization" };
  }
  // Before the first directory sync the issuer is the only word there is.
  const directory = host.perspicaxDirectory?.directory();
  if (directory) {
    const listed = directory.people.find((entry) => entry.sub === principal.subject!.sub);
    if (!listed || listed.status === "disabled") return { ok: false, code: "other_organization" };
    if (listed.kind === "service" || listed.type === "service") return { ok: false, code: "service_account" };
  }
  return { ok: true, id: principal.id, sessionId: auth.session.id };

}
  return presenceViewer;
}
