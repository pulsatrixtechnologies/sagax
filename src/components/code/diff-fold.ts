// Pure fold helpers shared by the Code page DiffView and the coding chat
// diff (CodingDiff). Kept out of DiffView.tsx so the launch path that
// reaches CodingChat does not also parse the full DiffView + ChatMarkdown
// preview surface.
import type { DiffHunk, DiffLine } from "../../../shared/code-runs.ts";

export type DiffFoldPiece =
  | { kind: "line"; line: DiffLine }
  | { kind: "fold"; id: string; lines: DiffLine[] };

/** A hunk's lines with long unchanged stretches folded. Pure, for tests. */
export function foldContext(hunk: DiffHunk, keep: number, hunkId: string): DiffFoldPiece[] {
  const out: DiffFoldPiece[] = [];
  const lines = hunk.lines;
  let i = 0;
  while (i < lines.length) {
    if (lines[i]!.kind !== "ctx") { out.push({ kind: "line", line: lines[i]! }); i++; continue; }
    let j = i;
    while (j < lines.length && lines[j]!.kind === "ctx") j++;
    const run = lines.slice(i, j);
    const head = i === 0 ? 0 : keep;
    const tail = j === lines.length ? 0 : keep;
    if (run.length > head + tail + 1) {
      for (const line of run.slice(0, head)) out.push({ kind: "line", line });
      out.push({ kind: "fold", id: `${hunkId}:${i}`, lines: run.slice(head, run.length - tail) });
      for (const line of run.slice(run.length - tail)) out.push({ kind: "line", line });
    } else {
      for (const line of run) out.push({ kind: "line", line });
    }
    i = j;
  }
  return out;
}

/** Side by side rows: a change block pairs its removals with its additions. */
export function splitRows(lines: DiffLine[]): { left?: DiffLine; right?: DiffLine }[] {
  const rows: { left?: DiffLine; right?: DiffLine }[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.kind === "ctx") { rows.push({ left: line, right: line }); i++; continue; }
    const dels: DiffLine[] = [];
    const adds: DiffLine[] = [];
    while (i < lines.length && lines[i]!.kind === "del") dels.push(lines[i++]!);
    while (i < lines.length && lines[i]!.kind === "add") adds.push(lines[i++]!);
    for (let k = 0; k < Math.max(dels.length, adds.length); k++) rows.push({ left: dels[k], right: adds[k] });
    if (dels.length === 0 && adds.length === 0) i++;
  }
  return rows;
}
