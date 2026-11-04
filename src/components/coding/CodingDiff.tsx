// A file edit in the coding chat: one collapsible card per file (its path,
// a status chip when it is new, deleted or renamed, `+N -M`), the lines in
// unified form with the chat's syntax colours (ChatMarkdown's grammars and
// themes, as tokens: text nodes, never HTML), long unchanged stretches
// folded like the Code page's DiffView (foldContext).
import { ChevronDown, ChevronRight, ChevronsUpDown, FileCode2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { DiffFile, DiffLine } from "../../../shared/code-runs.ts";
import { highlightCodeLines, type CodeToken } from "../ChatMarkdown";
import { foldContext } from "../code/DiffView";
import { languageOf } from "@/lib/coding-chat";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

const TONE = { add: "bg-success/10", del: "bg-danger/10", ctx: "" } as const;
const SIGN = { add: "+", del: "-", ctx: " " } as const;
/** Past this many lines a file opens folded: its header stays, one click shows it. */
export const DIFF_OPEN_MAX_LINES = 400;

/** The file's lines, highlighted once its grammar loaded. Lines read in
 * display order (old and new mixed): close enough for colour, exact for text. */
function useTokens(file: DiffFile): Map<DiffLine, CodeToken[]> | null {
  const lines = useMemo(() => file.hunks.flatMap((hunk) => hunk.lines), [file]);
  const [tokens, setTokens] = useState<Map<DiffLine, CodeToken[]> | null>(null);
  useEffect(() => {
    let live = true;
    const lang = languageOf(file.path);
    if (!lang || lines.length === 0) return;
    highlightCodeLines(lines.map((line) => line.text).join("\n"), lang)
      .then((rows) => {
        if (!live || !rows) return;
        const map = new Map<DiffLine, CodeToken[]>();
        lines.forEach((line, index) => { if (rows[index]) map.set(line, rows[index]!); });
        setTokens(map);
      })
      .catch(() => {});
    return () => { live = false; };
  }, [file.path, lines]);
  return tokens;
}

function Row({ line, tokens, numbers }: { line: DiffLine; tokens?: CodeToken[]; numbers: boolean }) {
  return (
    <div data-diff-line={line.kind} className={cn("flex min-w-max", TONE[line.kind])}>
      {/* An edit's own text has no file line numbers: none are made up. */}
      {numbers ? <span className="w-9 shrink-0 select-none pr-2 text-right tabular-nums text-ink-tertiary">{line.kind === "del" ? line.old ?? "" : line.new ?? line.old ?? ""}</span> : <span className="w-2 shrink-0" />}
      <span className={cn("w-4 shrink-0 select-none text-center", line.kind === "add" ? "text-success" : line.kind === "del" ? "text-danger" : "text-ink-tertiary")}>{SIGN[line.kind]}</span>
      <span className="whitespace-pre pr-4 text-ink">
        {tokens ? tokens.map((token, index) => <span key={index} style={token.style}>{token.content}</span>) : line.text}
      </span>
    </div>
  );
}

export function CodingDiffFile({ file, open: forced }: { file: DiffFile; open?: number }) {
  const total = file.hunks.reduce((sum, hunk) => sum + hunk.lines.length, 0);
  const [open, setOpen] = useState(total <= DIFF_OPEN_MAX_LINES);
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(() => new Set());
  // A jump from the Changes band opens it (each jump a new nonce).
  useEffect(() => { if (forced !== undefined) setOpen(true); }, [forced]);
  const tokens = useTokens(file);
  const name = file.path.split("/").at(-1) ?? file.path;
  const dir = file.path.slice(0, file.path.length - name.length);
  return (
    <section data-coding-diff={file.path} className="overflow-hidden rounded-xl border border-hairline-weak bg-card">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={t(open ? "code.diff.collapse" : "code.diff.expand", { path: file.path })}
        className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60"
      >
        {open ? <ChevronDown size={14} aria-hidden="true" className="shrink-0 text-ink-secondary" /> : <ChevronRight size={14} aria-hidden="true" className="shrink-0 text-ink-secondary" />}
        <FileCode2 size={14} aria-hidden="true" className="shrink-0 text-ink-secondary" />
        <span className="min-w-0 flex-1 truncate font-mono text-[12px]" title={file.path}>
          {dir && <span className="text-ink-tertiary">{dir}</span>}
          <span className="text-ink">{name}</span>
        </span>
        {file.status !== "modified" && <span data-coding-diff-status={file.status} className="shrink-0 rounded-md bg-control px-1.5 text-[11px] text-ink-secondary">{t(`code.diff.status.${file.status}` as "code.diff.status.added")}</span>}
        <span className="shrink-0 font-mono text-[11.5px] tabular-nums">
          <span className="text-success">+{file.added}</span> <span className="text-danger">-{file.removed}</span>
        </span>
      </button>
      {open && total > 0 && (
        <div data-coding-diff-body className="overflow-x-auto border-t border-hairline-weak py-1 font-mono text-[12px] leading-5">
          {file.hunks.map((hunk, h) => foldContext(hunk, 3, `${h}`).map((piece, p) => {
            if (piece.kind === "line") return <Row key={`${h}:${p}`} line={piece.line} tokens={tokens?.get(piece.line)} numbers={hunk.header !== ""} />;
            if (unfolded.has(piece.id)) return piece.lines.map((line, l) => <Row key={`${h}:${p}:${l}`} line={line} tokens={tokens?.get(line)} numbers={hunk.header !== ""} />);
            return (
              <button
                key={piece.id}
                type="button"
                data-diff-fold
                onClick={() => setUnfolded((set) => new Set([...set, piece.id]))}
                className="flex w-full items-center gap-2 bg-inset/60 px-3 py-0.5 text-left font-sans text-[11.5px] text-ink-secondary hover:bg-hover"
              >
                <ChevronsUpDown size={12} aria-hidden="true" />
                {t("code.diff.unchanged", { n: piece.lines.length })}
              </button>
            );
          }))}
        </div>
      )}
      {open && total === 0 && <p className="border-t border-hairline-weak px-3 py-2 text-[12px] text-ink-secondary">{t("codingChat.diff.noLines")}</p>}
    </section>
  );
}

/** The files of one edit, stacked. */
export function CodingDiff({ files, reveal }: { files: readonly DiffFile[]; reveal?: { path: string; nonce: number } }) {
  return (
    <div data-coding-edit className="flex flex-col gap-2">
      {files.map((file, index) => <CodingDiffFile key={`${file.path}:${index}`} file={file} open={reveal?.path === file.path ? reveal.nonce : undefined} />)}
    </div>
  );
}
