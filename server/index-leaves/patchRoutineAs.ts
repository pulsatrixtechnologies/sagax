// @ts-nocheck
/** patchRoutineAs (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createPatchRoutineAs(getHost: () => Host): any {
function patchRoutineAs(auth: RequestAuth, req: IncomingMessage, id: string, body: any): { status: number; body: unknown } {
  const host = getHost();
  const { routineActor } = host;

  const visible = host.visibleTo(host.viewerFor(auth, `/api/routines/${id}`));
  const viewerId = host.channelFilterViewerId(auth);
  const routineResultsRefusal = (value: unknown) => host.routineResultsRefusalFor(auth, value);
  const hidden = host.hiddenRoutineTarget(body, visible);
  if (hidden) return { status: 404, body: { error: hidden } };
  if (host.routineNeedsRun(auth, host.routineBotId(id)) || host.routineNeedsRun(auth, (body as { botId?: unknown } | null)?.botId)) return { status: 403, body: host.NEEDS_RUN };
  const notYours = routineResultsRefusal(body);
  if (notYours) return { status: 403, body: { error: notYours } };
  const existingRoutine = host.routines!.listRoutines().find((candidate) => candidate.id === id);
  const runAsChoice = host.routineRunAsChoice(auth, body, existingRoutine);
  if ("refusal" in runAsChoice) return { status: runAsChoice.refusal.status, body: { error: runAsChoice.refusal.error, code: runAsChoice.refusal.code, ...(runAsChoice.refusal.permission ? { permission: runAsChoice.refusal.permission } : {}) } };
  const runAsBefore = existingRoutine ? host.effectiveRunAs(existingRoutine) : undefined;
  const wasOwners = false;
  const previous = undefined;
  // Who this edit leaves as the routine's writer: the owner when the
  // routine stays (or becomes) theirs (their fingerprint, or already
  // theirs as its writer: a template, a restore), a guest when a guest
  // edits it, else whoever wrote it before.
  // An owner writer is proof only for a routine that never had the
  // owner's fingerprint (a template, a restore, one the settlement named):
  // a fingerprint that no longer matches means someone else changed what
  // it runs, and only the owner rewriting its instructions renews it.
  const ownerWriterOnly = false;
  const ownerAuthors = host.cloudOwnerSession(auth) && (wasOwners || ownerWriterOnly ||
    (body && typeof body === "object" && "prompt" in body));
  const writer = ownerAuthors && host.CLOUD_OWNER_KEY ? host.CLOUD_OWNER_KEY
    : auth.kind === "session" && !host.cloudOwnerSession(auth) ? host.actorKey(auth)
      : previous && !host.cloudOwnerPerson(previous) ? previous : host.CLOUD_NOBODY_KEY;
  const conversation = host.routineConversationOf(req, existingRoutine, viewerId);
  const routine = host.withRoutineWriter(writer, () => host.routines!.update(id, body, undefined, { ...routineActor(auth), ...runAsChoice, ...(conversation ? { conversation } : {}) }));
  if (routine) host.auditRoutineRunAs(auth, routine, runAsBefore);
  // The owner's own edit keeps (or, when it rewrites the instructions,
  // makes) the routine theirs. Anyone else's edit, of any field (its
  // schedule, where its results go, whether it is on), makes it no longer
  // the owner's: it stops lending until the owner rewrites it.
  return routine ? { status: 200, body: { routine: host.routineOnWire(routine) } } : { status: 404, body: { error: "no such routine" } };

}
  return patchRoutineAs;
}
