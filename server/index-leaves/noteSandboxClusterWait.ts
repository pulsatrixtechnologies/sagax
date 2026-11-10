// @ts-nocheck
/** noteSandboxClusterWait (#1388). Pure move from server/index.ts.
 *
 * #3296: the row is live. It says what the turn waits for and since when,
 * is refreshed while the wait goes on (at most every
 * SANDBOX_WAKE_REFRESH_MS), and says when it ended, so a first turn after a
 * restart never sits on one notice and silence. */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { writeFileAtomic } from "../atomic.ts";
export type Host = Record<string, any>;

/** How often a waiting row's `checkedAt` is written while the wait goes on. */
export const SANDBOX_WAKE_REFRESH_MS = 30_000;

/** Per thread: the live row of the current turn (its generation). */
export type SandboxWakeRow = { generation: string; messageId: string; line: import("../../shared/sandbox-wake.ts").SandboxWakeLine; timeoutSaid?: boolean };

export function createNoteSandboxClusterWait(getHost: () => Host): any {
function noteSandboxClusterWait(event: { principalId: string; botId?: string; phase: "waiting" | "ready" | "timeout"; waitingFor?: "cluster" | "environment"; since?: number }) {
  const host = getHost();
  const { turnWorkplaces } = host;
  const now = typeof host.now === "function" ? host.now() : Date.now();

  const person = event.principalId.trim().toLowerCase();
  const running = [...turnWorkplaces.entries()].filter(([threadId, workplace]) =>
    host.workplaceUsesSandbox(workplace) && workplace.decision.principal === person
    && host.activeInternalGenerationByThread.get(threadId) === workplace.generation);
  const ofBot = event.botId ? running.filter(([, workplace]) => workplace.botId === event.botId) : [];
  for (const [threadId, workplace] of ofBot.length ? ofBot : running) {
    const known: SandboxWakeRow | undefined = host.sandboxWakeNoted.get(threadId);
    // an earlier turn's row still open here: its turn is over, so is its wait
    if (known && known.generation !== workplace.generation) host.endSandboxWakeRows?.({ threadId, generation: known.generation });
    const row = known && known.generation === workplace.generation ? known : undefined;
    const patch = (line) => {
      row.line = line;
      host.store.patchMessage(threadId, row.messageId, { tool: { name: host.SANDBOX_WAKE_NOTICE, ok: true, sandboxWake: line } });
    };
    if (event.phase === "waiting") {
      const waitingFor = event.waitingFor ?? "cluster";
      const since = event.since ?? now;
      if (!row || row.line.endedAt !== undefined) {
        // the first word of this wait (or of a new one after the last ended)
        const line = { waitingFor, since };
        if (host.sandboxWakeNoted.size > 500) pruneEndedRows(host.sandboxWakeNoted);
        const message = host.store.appendMessage(threadId, { role: "bot", kind: "activity", tool: { name: host.SANDBOX_WAKE_NOTICE, ok: true, sandboxWake: line } });
        host.sandboxWakeNoted.set(threadId, { generation: workplace.generation, messageId: message.id, line, ...(row?.timeoutSaid ? { timeoutSaid: true } : {}) });
        saveOpenRows(host);
        continue;
      }
      // what is waited for changed (the cluster answers, the Pod starts)
      if (row.line.waitingFor !== waitingFor) { patch({ waitingFor, since }); continue; }
      // the same wait goes on: said again, at most every SANDBOX_WAKE_REFRESH_MS
      if (now - (row.line.checkedAt ?? row.line.since) >= SANDBOX_WAKE_REFRESH_MS) patch({ ...row.line, checkedAt: now });
      continue;
    }
    // the live row says how its wait ended; a timeout it says is said there only
    const endsLiveRow = !!row && row.line.endedAt === undefined;
    if (endsLiveRow) {
      patch({ ...row.line, endedAt: now, outcome: event.phase });
      if (event.phase === "timeout") row.timeoutSaid = true;
      saveOpenRows(host);
    }
    if (event.phase === "timeout" && !endsLiveRow && !row?.timeoutSaid) {
      host.store.appendMessage(threadId, { role: "bot", kind: "activity", tool: { name: host.SANDBOX_WAKE_TIMEOUT_NOTICE, ok: true } });
      if (row) row.timeoutSaid = true;
      else host.sandboxWakeNoted.set(threadId, { generation: workplace.generation, messageId: "", line: { waitingFor: event.waitingFor ?? "cluster", since: now, endedAt: now, outcome: "timeout" }, timeoutSaid: true });
    }
  }

}
  return noteSandboxClusterWait;
}

/** The cache keeps the rows still open (a later event or the shutdown ends
 * them); only rows whose wait already ended are dropped when it grows. */
function pruneEndedRows(noted: Map<string, SandboxWakeRow>): void {
  for (const [threadId, row] of noted) {
    if (!row.messageId || row.line.endedAt !== undefined) noted.delete(threadId);
  }
}

/** #3296: the open wait rows on disk (host.sandboxWakeRowsFile), so a row a
 * crash left open is ended at the next start. Only ids, never words. */
type OpenRow = { threadId: string; messageId: string };

/** The rows of this process's map whose rows left open by the last process
 * were already ended (the left-open pass runs once, before the first save). */
const leftOpenSettled = new WeakSet<object>();

function saveOpenRows(host: Host): void {
  const file: string | undefined = host.sandboxWakeRowsFile;
  if (!file) return;
  settleLeftOpen(host);
  const rows: OpenRow[] = [];
  for (const [threadId, row] of host.sandboxWakeNoted as Map<string, SandboxWakeRow>) {
    if (row.messageId && row.line.endedAt === undefined) rows.push({ threadId, messageId: row.messageId });
  }
  try {
    if (rows.length) writeFileAtomic(file, JSON.stringify({ rows }), { mode: 0o600 });
    else rmSync(file, { force: true });
  } catch (error) {
    console.warn(`[sandbox] could not save the open wait rows: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readOpenRows(file: string | undefined): OpenRow[] {
  if (!file || !existsSync(file)) return [];
  try {
    const rows = (JSON.parse(readFileSync(file, "utf8")) as { rows?: unknown })?.rows;
    if (!Array.isArray(rows)) return [];
    return rows.filter((row): row is OpenRow => !!row && typeof row.threadId === "string" && typeof row.messageId === "string");
  } catch {
    return [];
  }
}

/** #3296: the wait of a turn that ended, was stopped, or was cut by a
 * shutdown ends with it ("interrupted"), so the row never keeps counting a
 * wait nobody waits on. With no threadId: every open row (the shutdown). */
export function createEndSandboxWakeRows(getHost: () => Host): (match?: { threadId?: string; generation?: string }) => number {
  return function endSandboxWakeRows(match = {}) {
    const host = getHost();
    const noted: Map<string, SandboxWakeRow> = host.sandboxWakeNoted;
    if (!noted?.size) return 0;
    const now = typeof host.now === "function" ? host.now() : Date.now();
    let ended = 0;
    for (const [threadId, row] of noted) {
      if (match.threadId !== undefined && threadId !== match.threadId) continue;
      if (match.generation !== undefined && row.generation !== match.generation) continue;
      noted.delete(threadId);
      if (!row.messageId || row.line.endedAt !== undefined) continue;
      const line = { ...row.line, endedAt: now, outcome: "interrupted" as const };
      try {
        host.store.patchMessage(threadId, row.messageId, { tool: { name: host.SANDBOX_WAKE_NOTICE, ok: true, sandboxWake: line } });
        ended += 1;
      } catch (error) {
        console.warn(`[sandbox] could not end a wait row: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    saveOpenRows(host);
    return ended;
  };
}

/** #3296: at start, the rows the last process left open (a crash or a kill
 * during the wait) are ended where they are found again. */
export function createEndSandboxWakeRowsLeftOpen(getHost: () => Host): () => number {
  return function endSandboxWakeRowsLeftOpen() {
    return settleLeftOpen(getHost());
  };
}

function settleLeftOpen(host: Host): number {
  const noted = host.sandboxWakeNoted;
  if (!noted || leftOpenSettled.has(noted)) return 0;
  leftOpenSettled.add(noted);
  const file: string | undefined = host.sandboxWakeRowsFile;
  const rows = readOpenRows(file).filter((row) => noted.get(row.threadId)?.messageId !== row.messageId);
  let ended = 0;
  for (const { threadId, messageId } of rows) {
    try {
      const message = host.store.messagesFor(threadId)?.find((m) => m.id === messageId);
      const line = message?.tool?.name === host.SANDBOX_WAKE_NOTICE ? message.tool.sandboxWake : undefined;
      if (!line || line.endedAt !== undefined) continue;
      const endedAt = Math.max(line.checkedAt ?? line.since, line.since);
      host.store.patchMessage(threadId, messageId, { tool: { name: host.SANDBOX_WAKE_NOTICE, ok: true, sandboxWake: { ...line, endedAt, outcome: "interrupted" } } });
      ended += 1;
    } catch (error) {
      console.warn(`[sandbox] could not end a wait row left open: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (file && rows.length) saveOpenRows(host);
  return ended;
}
