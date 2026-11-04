/** One process-table read per budget sample, never one subprocess per resource. */
import { execFile } from "node:child_process";

export type ProcessMemory = { pid: number; parent: number; bytes: number };

export function processMemory(): Promise<ProcessMemory[]> {
  if (process.platform === "win32") return Promise.resolve([]);
  return new Promise(resolve => {
    execFile("ps", ["-axo", "pid=,ppid=,rss="], { timeout: 3_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
      if (error) return resolve([]);
      resolve(parseProcessMemory(stdout));
    });
  });
}

export function parseProcessMemory(text: string): ProcessMemory[] {
  return text.trim().split("\n").flatMap(line => {
    const fields = line.trim().split(/\s+/).map(Number);
    return fields.length === 3 && fields.every(Number.isFinite) && fields[0]! > 0
      ? [{ pid: fields[0]!, parent: fields[1]!, bytes: fields[2]! * 1024 }] : [];
  });
}

/** Attribute a tree to its nearest registered root. No double charging a
 * separately registered MCP child beneath a registered engine. */
export function resourceMemory(rows: ProcessMemory[], roots: ReadonlySet<number>): Map<number, number> {
  const byPid = new Map(rows.map(row => [row.pid, row]));
  const bytes = new Map<number, number>();
  for (const row of rows) {
    let pid = row.pid;
    const seen = new Set<number>();
    while (pid > 1 && !seen.has(pid)) {
      seen.add(pid);
      if (roots.has(pid)) { bytes.set(pid, (bytes.get(pid) ?? 0) + row.bytes); break; }
      pid = byPid.get(pid)?.parent ?? 0;
    }
  }
  return bytes;
}
