// A run's changes, file by file. Same contract as the Perspicax console's
// `DiffView` (its spec, section 8.0): unified or side by side, one
// collapsible section per file (path, `+N -M`, a Preview switch when the
// file is Markdown), long unchanged stretches folded into "N unchanged
// lines" that open on click, line numbers, add/remove colours.
//
// Text only: a line is a React text node, never injected HTML. Past 2,000
// lines the rows are drawn in blocks the browser skips while off screen
// (`content-visibility: auto`), so a large diff stays cheap to scroll.
import { ChevronDown, ChevronRight, ChevronsUpDown, Columns2, Rows3 } from "lucide-react";
import { Fragment, useMemo, useState } from "react";

import type { DiffFile, DiffHunk, DiffLine } from "../../../shared/code-runs.ts";
import { ChatMarkdown } from "../ChatMarkdown";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

export interface DiffViewProps {
  files: DiffFile[];
  mode: "unified" | "split";
  onModeChange: (mode: "unified" | "split") => void;
  /** Unchanged lines kept around a change before the rest folds; 3 by default. */
  collapsedContext?: number;
  testId?: string;
}

export const DIFF_VIRTUAL_THRESHOLD = 2_000;
const BLOCK = 200;

type Piece =
  | { kind: "line"; line: DiffLine }
  | { kind: "fold"; id: string; lines: DiffLine[] };

/** A hunk's lines with long unchanged stretches folded. Pure, for tests. */
export function foldContext(hunk: DiffHunk, keep: number, hunkId: string): Piece[] {
  const out: Piece[] = [];
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

const TONE = { add: "bg-success/10", del: "bg-danger/10", ctx: "" } as const;
const SIGN = { add: "+", del: "-", ctx: " " } as const;
const NUM = "w-10 shrink-0 select-none pr-2 text-right tabular-nums text-ink-tertiary";

function UnifiedRow({ line }: { line: DiffLine }) {
  return (
    <div data-diff-line={line.kind} className={cn("flex min-w-max", TONE[line.kind])}>
      <span className={NUM}>{line.old ?? ""}</span>
      <span className={NUM}>{line.new ?? ""}</span>
      <span className={cn("w-4 shrink-0 select-none text-center", line.kind === "add" ? "text-success" : line.kind === "del" ? "text-danger" : "text-ink-tertiary")}>{SIGN[line.kind]}</span>
      <span className="whitespace-pre pr-4 text-ink">{line.text}</span>
    </div>
  );
}

function SplitCell({ line, side }: { line?: DiffLine; side: "left" | "right" }) {
  if (!line) return <div className="flex min-w-0 flex-1 bg-inset/40" />;
  return (
    <div data-diff-line={line.kind} className={cn("flex min-w-0 flex-1 overflow-hidden", line.kind !== "ctx" && TONE[line.kind])}>
      <span className={NUM}>{side === "left" ? line.old ?? "" : line.new ?? ""}</span>
      <span className="truncate whitespace-pre pr-2 text-ink">{line.text}</span>
    </div>
  );
}

function FoldRow({ count, onOpen }: { count: number; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} data-diff-fold className="flex w-full items-center gap-2 bg-inset/60 px-3 py-1 text-left text-[11.5px] text-ink-secondary hover:bg-hover">
      <ChevronsUpDown size={12} aria-hidden />
      {t("code.diff.unchanged", { n: count })}
    </button>
  );
}

/** Rows drawn in blocks the browser may skip while off screen. */
function Blocks({ rows, virtual }: { rows: React.ReactNode[]; virtual: boolean }) {
  if (!virtual) return <>{rows}</>;
  const blocks: React.ReactNode[][] = [];
  for (let i = 0; i < rows.length; i += BLOCK) blocks.push(rows.slice(i, i + BLOCK));
  return (
    <>
      {blocks.map((block, index) => (
        <div key={index} style={{ contentVisibility: "auto", containIntrinsicSize: `auto ${block.length * 20}px` }}>{block}</div>
      ))}
    </>
  );
}

function FileSection({ file, index, mode, keep, virtual }: { file: DiffFile; index: number; mode: DiffViewProps["mode"]; keep: number; virtual: boolean }) {
  const [open, setOpen] = useState(true);
  const [preview, setPreview] = useState(false);
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(new Set());
  const previewText = useMemo(
    () => file.hunks.flatMap((hunk) => hunk.lines.filter((line) => line.kind !== "del").map((line) => line.text)).join("\n"),
    [file],
  );
  const rows: React.ReactNode[] = [];
  file.hunks.forEach((hunk, h) => {
    const id = `${index}:${h}`;
    rows.push(<div key={`${id}:head`} className="bg-inset/60 px-3 py-0.5 text-[11px] text-ink-tertiary">{hunk.header}</div>);
    const pieces = foldContext(hunk, keep, id);
    const lines: DiffLine[] = [];
    const flush = (key: string) => {
      if (!lines.length) return;
      if (mode === "split") {
        splitRows(lines.splice(0)).forEach((row, r) => rows.push(
          <div key={`${key}:${r}`} className="flex divide-x divide-hairline"><SplitCell line={row.left} side="left" /><SplitCell line={row.right} side="right" /></div>,
        ));
      } else {
        lines.splice(0).forEach((line, r) => rows.push(<UnifiedRow key={`${key}:${r}`} line={line} />));
      }
    };
    pieces.forEach((piece, p) => {
      if (piece.kind === "line") { lines.push(piece.line); return; }
      if (unfolded.has(piece.id)) { lines.push(...piece.lines); return; }
      flush(`${id}:${p}`);
      rows.push(<FoldRow key={piece.id} count={piece.lines.length} onOpen={() => setUnfolded((set) => new Set([...set, piece.id]))} />);
    });
    flush(`${id}:end`);
  });
  return (
    <section data-diff-file={file.path} className="overflow-hidden rounded-lg border border-hairline bg-card">
      <header className="flex items-center gap-2 border-b border-hairline px-2 py-1.5">
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label={t(open ? "code.diff.collapse" : "code.diff.expand", { path: file.path })} className="rounded p-0.5 text-ink-secondary hover:bg-hover">
          {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
        </button>
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink" title={file.path}>{file.path}</span>
        {file.status !== "modified" && <span className="rounded bg-control px-1.5 text-[10.5px] text-ink-secondary">{t(`code.diff.status.${file.status}` as "code.diff.status.added")}</span>}
        {file.previewable && (
          <label className="flex cursor-pointer items-center gap-1.5 text-[11.5px] text-ink-secondary">
            <input type="checkbox" role="switch" checked={preview} onChange={(e) => setPreview(e.target.checked)} className="accent-[var(--color-accent)]" />
            {t("code.diff.preview")}
          </label>
        )}
        <span className="shrink-0 text-[11.5px] tabular-nums"><span className="text-success">+{file.added}</span> <span className="text-danger">-{file.removed}</span></span>
      </header>
      {open && (
        file.binary ? (
          <p className="px-3 py-2 text-[12px] text-ink-secondary">{t("code.diff.binary")}</p>
        ) : preview ? (
          <div data-diff-preview className="max-w-none px-4 py-3 text-[13px]"><ChatMarkdown text={previewText} inert /></div>
        ) : (
          <div className="overflow-x-auto font-mono text-[12px] leading-5">
            <Blocks rows={rows} virtual={virtual} />
          </div>
        )
      )}
    </section>
  );
}

export function DiffView({ files, mode, onModeChange, collapsedContext = 3, testId }: DiffViewProps) {
  const total = files.reduce((n, file) => n + file.hunks.reduce((m, hunk) => m + hunk.lines.length, 0), 0);
  const virtual = total > DIFF_VIRTUAL_THRESHOLD;
  return (
    <div data-testid={testId ?? "diff-view"} className="flex flex-col gap-3">
      <div className="flex items-center justify-end gap-1" role="group" aria-label={t("code.diff.modeAria")}>
        {(["unified", "split"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            title={t(`code.diff.mode.${value}`)}
            aria-label={t(`code.diff.mode.${value}`)}
            onClick={() => onModeChange(value)}
            className={cn("rounded-md p-1.5", mode === value ? "bg-selected text-ink" : "text-ink-secondary hover:bg-hover")}
          >
            {value === "unified" ? <Rows3 size={14} aria-hidden /> : <Columns2 size={14} aria-hidden />}
          </button>
        ))}
      </div>
      {files.length === 0 && <p className="py-6 text-center text-[13px] text-ink-secondary">{t("code.diff.empty")}</p>}
      {files.map((file, index) => (
        <Fragment key={`${file.path}:${index}`}>
          <FileSection file={file} index={index} mode={mode} keep={collapsedContext} virtual={virtual} />
        </Fragment>
      ))}
    </div>
  );
}
