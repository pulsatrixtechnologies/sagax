// @ts-nocheck
/** routineRunAsChoice (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createRoutineRunAsChoice(getHost: () => Host): any {
function routineRunAsChoice(auth: RequestAuth, body: unknown, existing?: Routine): { runAs?: string } | { refusal: { status: number; error: string; code: string; permission?: PermissionKey } } {
  const host = getHost();

  const raw = body && typeof body === "object" ? (body as { runAs?: unknown }).runAs : undefined;
  if (raw === undefined || raw === null || raw === "") return {};
  if (typeof raw !== "string" || raw.length > 64) return { refusal: { status: 400, error: "runAs must be a person's principal id", code: "run_as_invalid" } };
  if (host.IDENTITY.kind !== "perspicax") return { refusal: { status: 400, error: "Only an organization server can choose who a routine runs as.", code: "run_as_solo" } };
  const chooser = host.runAsChooserFor(auth);
  if (!chooser) return { refusal: { status: 403, error: "Sign in with Pulsatrix to choose who a routine runs as.", code: "run_as_not_allowed" } };
  const fields = body as { botId?: unknown; target?: unknown; groupId?: unknown };
  const botId = typeof fields.botId === "string" ? fields.botId : existing?.botId ?? "";
  const target = typeof fields.target === "string" ? fields.target : existing?.target;
  const groupId = typeof fields.groupId === "string" ? fields.groupId : fields.groupId === null ? undefined : existing?.groupId;
  const bot = host.store.bot(botId);
  const people = host.runAsPeople();
  const refusal = host.runAsRefusal({
    chooser,
    principalId: raw,
    person: people.find((person) => person.principalId.toLowerCase() === raw.toLowerCase()) ?? null,
    botOwnerId: bot ? host.effectiveBotOwner(bot) || undefined : undefined,
    mayRun: (principalId) => host.principalMayRunRoutine(principalId, { botId, ...(target ? { target } : {}), ...(groupId ? { groupId } : {}) })
  });
  if (!refusal) return { runAs: raw };
  if (existing && host.effectiveRunAs(existing) === raw) return {};
  return { refusal };

}
  return routineRunAsChoice;
}
