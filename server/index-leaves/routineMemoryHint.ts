// @ts-nocheck
/** routineMemoryHint (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createRoutineMemoryHint(getHost: () => Host): any {
async function routineMemoryHint(run: RoutineRun, prompt: string): Promise<{ hint: RoutineMemoryHint; note: string } | null> {
  const host = getHost();

  const bot = host.store.bot(run.botId);
  if (!host.perspicaxMemory || !bot) return null;
  const runAs = run.runAs ?? host.effectiveRunAs({ botId: run.botId });
  const person = runAs ? host.perspicaxSubOf(runAs) : null;
  if (!person) return null;
  const hint = await host.perspicaxMemory.checkDuplicates({ person, text: prompt, objects: [`sagax:routine:${run.routineId}`] });
  return hint ? { hint, note: host.duplicateNote(hint) } : null;

}
  return routineMemoryHint;
}
