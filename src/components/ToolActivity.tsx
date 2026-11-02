import { useState } from "react";
import { Check, ChevronDown, Copy } from "lucide-react";
import type { Message } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { placeLabelKey, type Place } from "@/lib/place";
import { copyText } from "@/lib/copy-text";
import { readStep, stepArgs, stepDuration, stepJson, stepPhase, stepResult, type StepNameOf } from "@/lib/step-label";
import { parseArgs } from "@/lib/approval-describe";
import { computerSelectTarget, toolExecutionTarget } from "../../shared/execution-target";
import { PlaceIcon } from "./PlaceIcon";
import { StepRow } from "./StepRow";
import { CustomRuleNoticeLine } from "./CustomRuleNotice";
import { autoApprovalReason, type AutoApprovalReason } from "../../shared/auto-approval-reason";
import type { LocaleKey } from "@/locales";

type Tool = NonNullable<Message["tool"]>;

/** Turn a list of bots into the id-to-name reader a step label wants. */
export function botNames(bots: ReadonlyArray<{ id: string; name: string }> | undefined): StepNameOf | undefined {
  if (!bots?.length) return undefined;
  return (id: string) => bots.find((bot) => bot.id === id)?.name;
}

/** One tool call as a quiet step row: what it did in plain words, how long
 * it took, and a detail a person can read (the tool id, its arguments, the
 * start of its result) with the full JSON one click further. Old messages
 * and providers without output keep their status and never invent a
 * successful result.
 *
 * `place` names where a screen or page tool ran, so a transcript shows the
 * place of every step, not just the current one. Absent for tools that touch
 * no screen. */
export function ToolActivity({ tool, place = null, nameOf, defaultOpen = false }: { tool: Tool; place?: Place | null; nameOf?: StepNameOf; defaultOpen?: boolean }) {
  // Auto Works on: the bot chose where it works from this step on.
  const switched = tool.ok === true ? computerSelectTarget(tool.name, tool.input) : null;
  if (switched) {
    const label = t(switched === "cloud" ? "toolTarget.cloud" : switched === "local_vm" ? "toolTarget.localVm" : switched === "browser" ? "place.browser" : "toolTarget.myComputer");
    const icon: Place = switched === "cloud" ? "cloud" : switched === "local_vm" ? "vm" : switched === "browser" ? "browser" : "local";
    return (
      <span className="inline-flex w-fit max-w-full items-center gap-1.5 py-0.5 text-[13px] leading-5 text-ink-secondary" data-testid="tool-computer-switch" data-target={switched}>
        <PlaceIcon place={icon} size={12} className="shrink-0 opacity-70" aria-hidden="true" />
        {t("toolTarget.workingOn", { place: label })}
      </span>
    );
  }
  const phase = stepPhase(tool);
  const reading = readStep(tool, nameOf);
  // Where the tool ran: the person's server environment or their own computer.
  const target = toolExecutionTarget(tool.name, place);
  const status = phase === "running" ? t("toolDetail.running") : phase === "failed" ? t("toolDetail.failed") : t("toolDetail.completed");
  const row = (
    <StepRow
      testId="tool-activity"
      label={reading.label}
      target={reading.target}
      phase={phase}
      defaultOpen={defaultOpen}
      duration={phase === "running" ? undefined : stepDuration(tool.durationMs)}
      title={reading.title}
      ariaLabel={t("toolDetail.label", { name: reading.label, status })}
      icon={place ? <PlaceIcon place={place} size={13} className="shrink-0" role="img" aria-label={t(placeLabelKey(place))} data-testid="tool-place" /> : undefined}
      extra={target ? (
        <span className="shrink-0 text-[11px] text-ink-tertiary" data-testid="tool-target" data-target={target}>
          · {t(target === "user-sandbox" ? "toolTarget.userSandbox" : "toolTarget.userDesktop")}
        </span>
      ) : undefined}
    >
      {() => <ToolStepDetail tool={tool} status={status} />}
    </StepRow>
  );
  // 2026-10-16: the person's custom rule that answered this with no card.
  // 2026-10-28: an approval stays in the details, never on the line; a rule
  // that refused or held the call keeps its line.
  if (!tool.ruleNotice || tool.ruleNotice.outcome === "approved") return row;
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      {row}
      <CustomRuleNoticeLine notice={tool.ruleNotice} compact />
    </div>
  );
}

const AUTO_APPROVAL_TEXT: Record<AutoApprovalReason, LocaleKey> = {
  full: "approval.auto.full",
  level: "approval.auto.level",
  rule: "approval.auto.rule",
  command: "approval.auto.command",
  recipients: "approval.auto.recipients",
  trusted: "approval.auto.trusted",
  answered: "approval.auto.answered",
  other: "approval.auto.other",
};

/** What answered a call's ask with no card, in words (its details only). */
export function autoApprovalText(approval: { source: string } | undefined): string | undefined {
  return approval ? t(AUTO_APPROVAL_TEXT[autoApprovalReason(approval.source)]) : undefined;
}

const KEY = "text-[11px] text-ink-tertiary";
const MONO_BLOCK = "max-h-52 overflow-auto rounded-md bg-inset px-2 py-1.5 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap break-words text-ink";

/** What the open row shows, top to bottom: the technical name with its
 * status and duration, the arguments in a few readable lines, the start of
 * the result, then the whole record as JSON, folded and copyable. */
export function ToolStepDetail({ tool, status }: { tool: Tool; status: string }) {
  const phase = stepPhase(tool);
  const args = stepArgs(tool.input);
  const parsed = parseArgs(tool.input);
  const command = typeof parsed?.command === "string" ? parsed.command : undefined;
  const plainInput = !parsed && (tool.input ?? tool.summary);
  const result = stepResult(tool.output);
  const duration = stepDuration(tool.durationMs);
  return (
    <div className="space-y-2 py-1 text-[12px] text-ink-secondary" data-testid="tool-step-detail">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className={KEY}>{t("step.detail.tool")}</span>
        <code dir="ltr" className="min-w-0 break-all font-mono text-[11.5px] text-ink">{tool.name}</code>
        <span className={cn("text-[11px]", phase === "failed" ? "text-danger" : "text-ink-tertiary")}>
          {status}{duration && phase !== "running" ? ` · ${duration}` : ""}
        </span>
      </div>
      {(tool.autoApproval || tool.ruleNotice?.outcome === "approved") && (
        <div data-testid="tool-auto-approval" data-source={tool.autoApproval?.source}>
          <div className={cn(KEY, "mb-0.5")}>{t("step.detail.approval")}</div>
          {tool.ruleNotice?.outcome === "approved"
            ? <CustomRuleNoticeLine notice={tool.ruleNotice} compact />
            : <p className="text-[12px] text-ink">{autoApprovalText(tool.autoApproval)}</p>}
        </div>
      )}
      {(args.length > 0 || plainInput) && (
        <div>
          <div className={cn(KEY, "mb-0.5")}>{t("step.detail.arguments")}</div>
          {command ? (
            <pre dir="ltr" className={MONO_BLOCK}>{command}</pre>
          ) : args.length > 0 ? (
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5">
              {args.map((pair) => (
                <div key={pair.key} className="contents">
                  <dt className="font-mono text-[11.5px] text-ink-tertiary">{pair.key}</dt>
                  <dd className="min-w-0 break-words text-ink">{pair.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <pre dir="ltr" className={MONO_BLOCK}>{plainInput}</pre>
          )}
        </div>
      )}
      <div>
        <div className={cn(KEY, "mb-0.5")}>{t("step.detail.result")}</div>
        {result ? (
          <>
            <pre dir="ltr" className={MONO_BLOCK}>{result.text}</pre>
            {result.cut && <p className="mt-0.5 text-[11px] text-ink-tertiary">{t("step.detail.truncated")}</p>}
          </>
        ) : (
          <p className="text-[12px]">{phase === "running" ? t("toolDetail.waiting") : phase === "failed" ? t("toolDetail.failedNoOutput") : t("toolDetail.noOutput")}</p>
        )}
      </div>
      <JsonFold json={stepJson(tool)} />
      <p className="text-[11px] text-ink-tertiary">{t("toolDetail.previewHint")}</p>
    </div>
  );
}

function JsonFold({ json }: { json: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const copy = async () => {
    const outcome = await copyText(json);
    if (outcome === "empty") return;
    setCopied(outcome);
    setTimeout(() => setCopied("idle"), 1_200);
  };
  return (
    <div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="inline-flex items-center gap-1 rounded text-[11px] text-ink-tertiary hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
          data-testid="tool-step-json-toggle"
        >
          {t("step.detail.json")}
          <ChevronDown size={12} aria-hidden="true" className={cn("transition-transform duration-150", open && "rotate-180")} />
        </button>
        <button
          type="button"
          onClick={() => void copy()}
          className="inline-flex items-center gap-1 rounded text-[11px] text-ink-tertiary hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
          data-testid="tool-step-json-copy"
        >
          {copied === "copied" ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
          {copied === "copied" ? t("step.detail.copied") : copied === "failed" ? t("step.detail.copyFailed") : t("step.detail.copy")}
        </button>
      </div>
      {open && <pre dir="ltr" data-testid="tool-step-json" className={cn(MONO_BLOCK, "mt-1 max-h-72")}>{json}</pre>}
    </div>
  );
}
