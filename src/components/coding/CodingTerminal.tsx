// A shell call in the coding chat: a terminal block. The header is the
// command (one line, monospace), a test run's counts, its time and how it
// ended (a spinner while it runs, a check, or the exit code in red); the
// output folds under it, open while it runs or when it failed. Text only.
import { CheckCircle2, ChevronDown, ChevronRight, Loader2, SquareTerminal, XCircle } from "lucide-react";
import { useEffect, useState } from "react";

import type { CodingStep, TestSummary } from "@/lib/coding-chat";
import { stepDuration } from "@/lib/step-label";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { CodingDiff } from "./CodingDiff";

type CommandStep = Extract<CodingStep, { kind: "command" }>;

/** "12 passed · 1 failed · 2 skipped": the counts that are not zero, passed always. */
export function TestCounts({ tests, className }: { tests: TestSummary; className?: string }) {
  return (
    <span data-coding-tests={tests.failed > 0 ? "failed" : "passed"} className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] tabular-nums", tests.failed > 0 ? "bg-danger/10 text-danger" : "bg-success/10 text-success", className)}>
      {t(tests.passed === 1 ? "codingChat.tests.passed.one" : "codingChat.tests.passed", { count: tests.passed })}
      {tests.failed > 0 && <span>· {t(tests.failed === 1 ? "codingChat.tests.failed.one" : "codingChat.tests.failed", { count: tests.failed })}</span>}
      {tests.skipped > 0 && <span className="text-ink-secondary">· {t(tests.skipped === 1 ? "codingChat.tests.skipped.one" : "codingChat.tests.skipped", { count: tests.skipped })}</span>}
    </span>
  );
}

export function CodingTerminal({ step }: { step: CommandStep }) {
  const running = step.ok === undefined;
  const failed = step.ok === false;
  const [open, setOpen] = useState(running || failed);
  // It failed after it was drawn: show why.
  useEffect(() => { if (failed) setOpen(true); }, [failed]);
  const output = step.output?.replace(/\s+$/, "");
  const duration = stepDuration(step.durationMs);
  return (
    <div data-coding-terminal={running ? "running" : failed ? "failed" : "ok"} className="overflow-hidden rounded-xl border border-hairline-weak bg-inset">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={t(open ? "codingChat.terminal.hide" : "codingChat.terminal.show")}
        className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60"
      >
        {open ? <ChevronDown size={14} aria-hidden="true" className="shrink-0 text-ink-secondary" /> : <ChevronRight size={14} aria-hidden="true" className="shrink-0 text-ink-secondary" />}
        <SquareTerminal size={14} aria-hidden="true" className="shrink-0 text-ink-secondary" />
        <code data-coding-command className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink" title={step.command}>
          <span className="select-none text-ink-tertiary">$ </span>{step.command}
        </code>
        {step.tests && <TestCounts tests={step.tests} />}
        {duration && <span className="shrink-0 text-[11.5px] tabular-nums text-ink-tertiary">{duration}</span>}
        {running ? (
          <Loader2 size={14} aria-label={t("codingChat.terminal.running")} className="shrink-0 animate-spin text-accent-text motion-reduce:animate-none" />
        ) : failed ? (
          <span className="inline-flex shrink-0 items-center gap-1 text-[11.5px] text-danger">
            <XCircle size={14} aria-hidden="true" />
            {step.exitCode !== undefined ? t("codingChat.terminal.exit", { code: step.exitCode }) : t("codingChat.terminal.failed")}
          </span>
        ) : (
          <CheckCircle2 size={14} aria-label={t("codingChat.terminal.done")} className="shrink-0 text-success" />
        )}
      </button>
      {open && (
        <div className="border-t border-hairline-weak">
          {output ? (
            <pre data-coding-output className="max-h-80 overflow-auto px-3 py-2 font-mono text-[12px] leading-5 text-ink-secondary whitespace-pre">{output}</pre>
          ) : (
            <p className="px-3 py-2 text-[12px] text-ink-tertiary">{running ? t("codingChat.terminal.waiting") : t("codingChat.terminal.noOutput")}</p>
          )}
          {step.diff && step.diff.length > 0 && <div className="border-t border-hairline-weak p-2"><CodingDiff files={step.diff} /></div>}
        </div>
      )}
    </div>
  );
}
