// One tool call of the coding chat as a terminal line (JC, 2026-11-05, #2099),
// the way Claude Code prints it:
//
//   ● Bash(pnpm vitest run src/board …)        4s
//     ⎿ 11 passed · 1 failed
//       FAIL src/board/column.test.ts
//       … +14 lines
//
// The dot is the status (accent while it runs, green done, red failed), the
// tool's name is bold, its argument short and cut with "…". Below, `⎿` and the
// first lines of the result, then "… +N lines" to unfold the rest. An edit
// reads `⎿ +2 -0`, its diff folded behind that click (a jump from the Changes
// band opens it). A command that only waits (sleep, pgrep) is a muted line
// with no result. Text only: no card, no border.
import { useState } from "react";

import type { CodingRow, CodingStep, TestSummary } from "@/lib/coding-chat";
import { isWaitCommand, previewLines, toolLineOf } from "@/lib/coding-chat";
import { stepDuration, stepPhase, type StepPhase } from "@/lib/step-label";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { CodingDiff } from "./CodingDiff";

type CommandStep = Extract<CodingStep, { kind: "command" }>;
type EditStep = Extract<CodingStep, { kind: "edit" }>;
type ReadsRow = Extract<CodingRow, { kind: "reads" }>;

/** "12 passed · 1 failed · 2 skipped": the counts that are not zero, passed always. */
export function TestCounts({ tests, className }: { tests: TestSummary; className?: string }) {
  return (
    <span data-coding-tests={tests.failed > 0 ? "failed" : "passed"} className={cn("inline-flex shrink-0 items-center gap-1.5 text-[12px] tabular-nums", tests.failed > 0 ? "text-danger" : "text-success", className)}>
      {t(tests.passed === 1 ? "codingChat.tests.passed.one" : "codingChat.tests.passed", { count: tests.passed })}
      {tests.failed > 0 && <span>· {t(tests.failed === 1 ? "codingChat.tests.failed.one" : "codingChat.tests.failed", { count: tests.failed })}</span>}
      {tests.skipped > 0 && <span className="text-ink-secondary">· {t(tests.skipped === 1 ? "codingChat.tests.skipped.one" : "codingChat.tests.skipped", { count: tests.skipped })}</span>}
    </span>
  );
}

const DOT: Record<StepPhase, string> = {
  running: "text-accent-text animate-pulse motion-reduce:animate-none",
  done: "text-success",
  failed: "text-danger",
  unverified: "text-ink-tertiary",
};

function commandPhase(step: CommandStep): StepPhase {
  if (step.ok === false || (step.exitCode !== undefined && step.exitCode !== 0)) return "failed";
  if (step.ok === undefined && step.output === undefined && step.exitCode === undefined) return "running";
  return "done";
}

function editPhase(step: EditStep): StepPhase {
  return step.ok === false ? "failed" : "done";
}

/** The first line: the dot, `Name(arg)`, the duration at the right. */
function Head({ phase, name, arg, title, duration, muted }: { phase: StepPhase; name: string; arg: string; title?: string; duration?: string; muted?: boolean }) {
  return (
    <div className="flex items-baseline gap-2">
      <span data-tool-dot={phase} aria-hidden="true" className={cn("shrink-0 select-none text-[10px] leading-5", muted ? "text-ink-tertiary" : DOT[phase])}>●</span>
      <span className="min-w-0 flex-1 truncate" title={title ?? (arg || undefined)}>
        <span data-tool-name className={cn("font-semibold", muted ? "text-ink-secondary" : "text-ink")}>{name}</span>
        {arg && <span data-tool-arg className="text-ink-secondary">({arg})</span>}
      </span>
      {duration && <span className="shrink-0 text-[11px] tabular-nums text-ink-tertiary">{duration}</span>}
    </div>
  );
}

/** The indented result under the head: `⎿` then whatever is passed. */
function Tail({ children }: { children: React.ReactNode }) {
  return (
    <div data-tool-result className="flex gap-2">
      <span aria-hidden="true" className="w-[1ch] shrink-0 select-none text-ink-tertiary">⎿</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function MoreButton({ count, open, onClick }: { count: number; open: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      data-tool-more
      aria-expanded={open}
      onClick={onClick}
      className="rounded px-0.5 text-left text-[12px] text-ink-tertiary hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      {open ? t("codingChat.less") : t("codingChat.more", { count })}
    </button>
  );
}

function CommandLine({ step }: { step: CommandStep }) {
  const phase = commandPhase(step);
  const line = toolLineOf(step);
  const muted = isWaitCommand(step.command);
  const [open, setOpen] = useState(false);
  const output = step.output?.replace(/\s+$/, "") ?? "";
  const preview = previewLines(output, step.tests ? 2 : 3);
  const hasTail = !muted && (step.tests !== undefined || preview.lines.length > 0 || phase === "failed");
  return (
    <>
      <Head phase={phase} name={line.name} arg={line.arg} title={line.title} duration={stepDuration(step.durationMs)} muted={muted} />
      {hasTail && (
        <Tail>
          {step.tests && <div><TestCounts tests={step.tests} /></div>}
          {phase === "failed" && step.exitCode !== undefined && step.exitCode !== 0 && !step.tests && <div data-tool-exit className="text-[12px] text-danger">{t("codingChat.exit", { code: step.exitCode })}</div>}
          {open
            ? <pre data-tool-output className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words text-[12px] leading-5 text-ink-secondary">{output}</pre>
            : preview.lines.length > 0 && <pre data-tool-output className="whitespace-pre-wrap break-words text-[12px] leading-5 text-ink-secondary">{preview.lines.join("\n")}</pre>}
          {preview.more > 0 && <MoreButton count={preview.more} open={open} onClick={() => setOpen((value) => !value)} />}
          {step.diff && step.diff.length > 0 && open && <div className="mt-1"><CodingDiff files={step.diff} /></div>}
        </Tail>
      )}
    </>
  );
}

function EditLine({ step, reveal }: { step: EditStep; reveal?: { path: string; nonce: number } }) {
  const phase = editPhase(step);
  const line = toolLineOf(step);
  // A jump from the Changes band (each jump a new nonce) opens the diff at
  // once; the toggle then remembers its own choice for that nonce.
  const [folded, setFolded] = useState<{ nonce?: number; open: boolean }>({ open: false });
  const open = reveal !== undefined && reveal.nonce !== folded.nonce ? true : folded.open;
  const setOpen = (next: (value: boolean) => boolean) => setFolded({ nonce: reveal?.nonce, open: next(open) });
  const added = step.files.reduce((sum, file) => sum + file.added, 0);
  const removed = step.files.reduce((sum, file) => sum + file.removed, 0);
  return (
    <>
      <Head phase={phase} name={line.name} arg={line.arg} title={line.title} />
      <Tail>
        {phase === "failed" && (
          <p data-coding-edit-failed className="text-[12px] text-danger">{step.error ? t("codingChat.edit.failedWhy", { why: step.error.split("\n")[0]!.slice(0, 200) }) : t("codingChat.edit.failed")}</p>
        )}
        <button
          type="button"
          data-tool-more
          data-coding-diff-toggle
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="rounded px-0.5 text-left text-[12px] tabular-nums hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          <span className="text-success">+{added}</span> <span className="text-danger">-{removed}</span>
          <span className="ms-1.5 text-ink-tertiary">{open ? t("codingChat.diff.hide") : t("codingChat.diff.show")}</span>
        </button>
        {open && <div className="mt-1"><CodingDiff files={step.files} reveal={reveal} /></div>}
      </Tail>
    </>
  );
}

function ReadsLine({ row }: { row: ReadsRow }) {
  const line = toolLineOf({ kind: "reads", paths: row.paths });
  return <div data-coding-reads><Head phase={row.running ? "running" : "done"} name={line.name} arg={line.arg} title={line.title} /></div>;
}

function OtherLine({ step }: { step: Extract<CodingStep, { kind: "tool" }> }) {
  const phase = stepPhase(step.tool);
  const line = toolLineOf(step);
  const [open, setOpen] = useState(false);
  const output = step.tool.output?.replace(/\s+$/, "") ?? "";
  const preview = previewLines(output, 3);
  return (
    <>
      <Head phase={phase} name={line.name} arg={line.arg} title={line.title} duration={stepDuration(step.tool.durationMs)} />
      {(preview.lines.length > 0 || phase === "failed") && (
        <Tail>
          {open
            ? <pre data-tool-output className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words text-[12px] leading-5 text-ink-secondary">{output}</pre>
            : <pre data-tool-output className="whitespace-pre-wrap break-words text-[12px] leading-5 text-ink-secondary">{preview.lines.join("\n")}</pre>}
          {preview.more > 0 && <MoreButton count={preview.more} open={open} onClick={() => setOpen((value) => !value)} />}
        </Tail>
      )}
    </>
  );
}

/** One coding row that is a tool call (a step or a burst of reads). */
export function ToolLine({ row, reveal }: { row: Exclude<CodingRow, { kind: "line" }>; reveal?: { path: string; nonce: number } }) {
  const step = row.kind === "step" ? row.step : undefined;
  return (
    <div data-coding-row={row.id} data-coding-step={row.kind === "reads" ? "read" : step!.kind} className="font-mono text-[12.5px] leading-5">
      {row.kind === "reads" && <ReadsLine row={row} />}
      {step?.kind === "command" && <CommandLine step={step} />}
      {step?.kind === "edit" && <EditLine step={step} reveal={reveal} />}
      {step?.kind === "read" && <ReadsLine row={{ kind: "reads", id: row.id, at: row.at, paths: step.paths, running: false }} />}
      {step?.kind === "tool" && <OtherLine step={step} />}
    </div>
  );
}
