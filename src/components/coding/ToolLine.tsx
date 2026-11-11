// One tool call of the coding chat (#2099; #3581 lot 5, the owner
// 2026-11-10: "the way it works, with the look of the reference product").
// Every call is the chat's own step row (StepRow), the same row as a tool
// step of the main chat with Tool calls on, so "a step" has one look:
//
//   Ran src/board tests   11 passed · 1 failed   4s  v
//   Edited a file  column.ts   +14 -0  v
//   Read 3 files  a.ts, b.ts, c.ts
//
// The step in words, a file or a program as the quiet target (never the
// arguments), the test counts or the exit code, the duration. State is the
// row's: the words shimmer while it runs, turn the danger ink when it
// failed, and nothing marks a success. Opened: the command and its output in
// a code block (the first lines, then "… +N lines" and "Show less"), an
// edit's diff. A command that only waits (sleep, pgrep) is a quiet row with
// nothing to open. Any other tool is the main chat's ToolActivity itself.
// Monospace stays inside the code block and the diff.
import { useState } from "react";

import type { CodingRow, CodingStep, TestSummary } from "@/lib/coding-chat";
import { isWaitCommand, previewLines, stepWords } from "@/lib/coding-chat";
import { stepDuration, type StepPhase } from "@/lib/step-label";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { StepRow } from "../StepRow";
import { ToolActivity } from "../ToolActivity";
import { CodingDiff } from "./CodingDiff";

type CommandStep = Extract<CodingStep, { kind: "command" }>;
type EditStep = Extract<CodingStep, { kind: "edit" }>;
type Reveal = { path: string; nonce: number };

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

/** "+14 -0" in the interface font, green and red. */
export function DiffCounts({ added, removed }: { added: number; removed: number }) {
  return (
    <span data-coding-diff-counts className="shrink-0 text-[12px] tabular-nums">
      <span className="text-success">+{added}</span> <span className="text-danger">-{removed}</span>
    </span>
  );
}

// The code block of an opened step: the look of the main chat's step
// detail (ToolStepDetail), with the coding chat's longer reach.
const CODE_BLOCK = "overflow-auto rounded-md bg-inset px-2 py-1.5 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap break-words text-ink";

function commandPhase(step: CommandStep): StepPhase {
  if (step.ok === false || (step.exitCode !== undefined && step.exitCode !== 0)) return "failed";
  if (step.ok === undefined && step.output === undefined && step.exitCode === undefined) return "running";
  return "done";
}

function editPhase(step: EditStep): StepPhase {
  return step.ok === false ? "failed" : "done";
}

function CommandDetail({ step }: { step: CommandStep }) {
  const [open, setOpen] = useState(false);
  const output = step.output?.replace(/\s+$/, "") ?? "";
  const preview = previewLines(output, 3);
  return (
    <div className="flex flex-col gap-1.5 py-1">
      <pre dir="ltr" data-tool-command className={cn(CODE_BLOCK, "max-h-32")}>{step.command}</pre>
      {preview.lines.length > 0 && (
        <pre dir="ltr" data-tool-output className={cn(CODE_BLOCK, open ? "max-h-[60vh]" : "max-h-52")}>{open ? output : preview.lines.join("\n")}</pre>
      )}
      {preview.more > 0 && (
        <button
          type="button"
          data-tool-more
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="self-start rounded text-[11px] text-ink-tertiary hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
        >
          {open ? t("codingChat.less") : t("codingChat.more", { count: preview.more })}
        </button>
      )}
      {step.diff && step.diff.length > 0 && <CodingDiff files={step.diff} />}
    </div>
  );
}

function CommandRow({ step }: { step: CommandStep }) {
  const phase = commandPhase(step);
  const words = stepWords(step, phase);
  const waits = isWaitCommand(step.command);
  const exit = phase === "failed" && step.exitCode !== undefined && step.exitCode !== 0 && !step.tests
    ? <span data-tool-exit className="shrink-0 text-[12px] text-danger">{t("codingChat.exit", { code: step.exitCode })}</span>
    : undefined;
  const row = (
    <StepRow
      label={words.label}
      target={words.target}
      title={words.title}
      phase={phase}
      duration={phase === "running" ? undefined : stepDuration(step.durationMs)}
      extra={step.tests ? <TestCounts tests={step.tests} /> : exit}
    >
      {waits ? undefined : () => <CommandDetail step={step} />}
    </StepRow>
  );
  // A command that only waits is a quiet row: the tertiary ink, nothing to open.
  return waits ? <div data-coding-wait className="[&_[data-step-row]>*]:text-ink-tertiary">{row}</div> : row;
}

function EditRow({ step, reveal }: { step: EditStep; reveal?: Reveal }) {
  const phase = editPhase(step);
  const words = stepWords(step, phase);
  const added = step.files.reduce((sum, file) => sum + file.added, 0);
  const removed = step.files.reduce((sum, file) => sum + file.removed, 0);
  return (
    // A jump from the Changes band (each jump a new nonce) opens the diff,
    // even when the row was closed by hand since the last jump.
    <StepRow
      key={reveal?.nonce ?? "folded"}
      label={words.label}
      target={words.target}
      title={words.title}
      phase={phase}
      forceOpen={reveal !== undefined}
      wide
      extra={<DiffCounts added={added} removed={removed} />}
    >
      {() => (
        <div className="flex flex-col gap-1.5 py-1">
          {phase === "failed" && (
            <p data-coding-edit-failed className="text-[12px] text-danger">{step.error ? t("codingChat.edit.failedWhy", { why: step.error.split("\n")[0]!.slice(0, 200) }) : t("codingChat.edit.failed")}</p>
          )}
          <CodingDiff files={step.files} reveal={reveal} />
        </div>
      )}
    </StepRow>
  );
}

function ReadsRow({ paths, running }: { paths: readonly string[]; running: boolean }) {
  const phase: StepPhase = running ? "running" : "done";
  const words = stepWords({ kind: "reads", paths }, phase);
  return <StepRow label={words.label} target={words.target} title={words.title} phase={phase} />;
}

/** One coding row that is a tool call (a step or a burst of reads). `live`:
 * the task still runs, so a call without a result is running, not unverified. */
export function ToolLine({ row, reveal, live = true }: { row: Exclude<CodingRow, { kind: "line" }>; reveal?: Reveal; live?: boolean }) {
  const step = row.kind === "step" ? row.step : undefined;
  return (
    <div data-coding-row={row.id} data-coding-step={row.kind === "reads" ? "read" : step!.kind} className="flex min-w-0 flex-col">
      {row.kind === "reads" && <ReadsRow paths={row.paths} running={row.running} />}
      {step?.kind === "command" && <CommandRow step={step} />}
      {step?.kind === "edit" && <EditRow step={step} reveal={reveal} />}
      {step?.kind === "read" && <ReadsRow paths={step.paths} running={false} />}
      {step?.kind === "tool" && <ToolActivity tool={step.tool} live={live} />}
    </div>
  );
}
