// Dry run of every active routine, for the release cut (QA 0.8.66 F5).
//
// For each active routine the caller may run, asks the live Sagax server for
// its readiness check (POST /api/routines/<id>/check): engine, skills, MCP
// servers, Perspicax, computer and Flow, the same probes a scheduled run
// makes before its turn. No run is created, no model turn starts and nothing
// is written. A routine that would fail on its next run is listed with the
// failing check and the script exits 1.
//
//   SAGAX_URL=https://sagax.example SAGAX_TOKEN=... \
//     node --experimental-strip-types scripts/routines-dry-run.ts [--json]
//
// SAGAX_URL defaults to http://127.0.0.1:8799. The token is read from the
// environment and never printed.

export interface DryRunRoutine { id: string; name: string; botId: string; enabled: boolean; canRun?: boolean; redacted?: boolean; bot?: { name?: string } }
export interface DryRunCheck { kind: string; ok: boolean; line: string; code?: string }
export interface DryRunRow { id: string; name: string; bot: string; ok: boolean; failed: DryRunCheck[]; error?: string }
type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** Active routines the caller can run: the ones a scheduled run would start. */
export function activeRoutines(listing: unknown): DryRunRoutine[] {
  const rows = (listing as { routines?: unknown })?.routines;
  if (!Array.isArray(rows)) return [];
  return (rows as DryRunRoutine[]).filter((row) => row && row.enabled === true && row.canRun !== false && !row.redacted);
}

export async function routinesDryRun(base: string, token: string | undefined, fetcher: Fetch = fetch as unknown as Fetch): Promise<DryRunRow[]> {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const listed = await fetcher(`${base}/api/routines`, { headers });
  if (!listed.ok) throw new Error(`GET /api/routines answered ${listed.status}`);
  const rows: DryRunRow[] = [];
  for (const routine of activeRoutines(await listed.json())) {
    const row: DryRunRow = { id: routine.id, name: routine.name, bot: routine.bot?.name || routine.botId, ok: false, failed: [] };
    try {
      const answer = await fetcher(`${base}/api/routines/${encodeURIComponent(routine.id)}/check`, { method: "POST", headers });
      const body = await answer.json() as { ok?: boolean; checks?: DryRunCheck[]; error?: string };
      if (!answer.ok) row.error = `${answer.status} ${body?.error ?? ""}`.trim();
      else {
        row.failed = (body.checks ?? []).filter((check) => !check.ok);
        row.ok = body.ok === true && row.failed.length === 0;
      }
    } catch (error) {
      row.error = error instanceof Error ? error.message : String(error);
    }
    rows.push(row);
  }
  return rows;
}

export function formatDryRun(rows: readonly DryRunRow[]): string {
  if (!rows.length) return "No active routine to check.";
  const lines = rows.map((row) => {
    const head = `${row.ok ? "OK  " : "FAIL"} ${row.bot} / ${row.name}`;
    if (row.error) return `${head}\n      ${row.error}`;
    return [head, ...row.failed.map((check) => `      ${check.kind}: ${check.line}`)].join("\n");
  });
  const failed = rows.filter((row) => !row.ok).length;
  return `${lines.join("\n")}\n\n${rows.length - failed}/${rows.length} active routines ready.`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const base = (process.env.SAGAX_URL || `http://127.0.0.1:${process.env.SAGAX_PORT || 8799}`).replace(/\/+$/, "");
  const rows = await routinesDryRun(base, process.env.SAGAX_TOKEN?.trim() || undefined).catch((error: unknown) => {
    process.stderr.write(`Sagax at ${base} did not answer: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(2);
  });
  process.stdout.write(process.argv.includes("--json") ? `${JSON.stringify(rows, null, 2)}\n` : `${formatDryRun(rows)}\n`);
  process.exitCode = rows.every((row) => row.ok) ? 0 : 1;
}
