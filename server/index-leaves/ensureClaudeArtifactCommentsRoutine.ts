// @ts-nocheck
/** ensureClaudeArtifactCommentsRoutine (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createEnsureClaudeArtifactCommentsRoutine(getHost: () => Host): any {
function ensureClaudeArtifactCommentsRoutine(principalId: string, botId: string) {
  const host = getHost();

  if (!host.routines || !host.store.bot(botId)) return;
  const tracked = host.claudeArtifactTracked();
  const all = host.routines.listRoutines();
  const key = principalId.trim().toLowerCase();
  const known = tracked.routineFor(key);
  if (known && all.some((routine) => routine.id === known)) return;
  const existing = all.find((routine) => routine.precheck?.kind === "code"
    && (routine.precheck as { check?: string }).check === host.CLAUDE_ARTIFACT_COMMENTS_ROUTINE.check
    && (routine.runAs ?? "").trim().toLowerCase() === key);
  if (existing) { tracked.setRoutine(key, existing.id); return; }
  try {
    const created = host.routines.create({
      name: host.CLAUDE_ARTIFACT_COMMENTS_ROUTINE.name,
      prompt: host.CLAUDE_ARTIFACT_COMMENTS_ROUTINE.prompt,
      botId,
      schedule: { type: "interval", everyMinutes: host.CLAUDE_ARTIFACT_COMMENTS_ROUTINE.everyMinutes, anchorAt: Date.now() },
      precheck: { kind: "code", check: host.CLAUDE_ARTIFACT_COMMENTS_ROUTINE.check },
      overlap: "skip",
    }, undefined, { runAs: key });
    host.routines.update(created.id, { enabled: true });
    tracked.setRoutine(key, created.id);
  } catch (error) {
    console.warn(`claude artifacts: the comments routine could not be made (${error instanceof Error ? error.message : String(error)})`);
  }

}
  return ensureClaudeArtifactCommentsRoutine;
}
