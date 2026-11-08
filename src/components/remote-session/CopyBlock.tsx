// One value with its Copy button inside the block (#2956). The same shape
// as CommandLine in SettingsPrimitives, with the three looks the enrolment
// flow needs: a command on one line that scrolls sideways (never cut in the
// middle of a word), an install code shown big, and a link. Copy feedback
// comes from useCopyFeedback like every other Copy in Sagax.
import type { ReactNode } from "react";
import { Check, Copy, X } from "lucide-react";

import { cn } from "@/lib/cn";
import { useCopyFeedback } from "@/lib/copy-text";
import { t } from "@/lib/i18n";

export function CopyBlock({ name, label, value, variant = "command", hint, children }: {
  /** The test hook (`data-unattended-value`, `data-unattended-copy`). */
  name: string;
  label: string;
  value: string;
  variant?: "command" | "code" | "link";
  /** One line under the block (how to run it, where it leads). */
  hint?: string;
  /** An extra action beside Copy (open the link). */
  children?: ReactNode;
}) {
  const { state, copy } = useCopyFeedback(value);
  const code = variant === "code";
  return (
    <div data-copy-block={variant} className="flex min-w-0 flex-col gap-1">
      <p className="text-[12px] font-medium text-ink-secondary">{label}</p>
      <div className={cn("flex min-w-0 items-center gap-2 rounded-xl border-[0.5px] border-border bg-inset", code ? "px-4 py-3" : "px-3 py-2")}>
        <code data-unattended-value={name} aria-label={label}
          className={cn("min-w-0 flex-1 select-all font-mono text-ink",
            code ? "overflow-x-auto whitespace-nowrap text-center text-[26px] font-semibold leading-none tracking-[0.18em]" : "overflow-x-auto whitespace-nowrap text-[12.5px] leading-5")}>
          {value}
        </code>
        {children}
        <button type="button" data-unattended-copy={name} onClick={copy}
          aria-label={state === "failed" ? t("common.copyFailed") : `${t("canvasComputers.unattended.copy")} · ${label}`}
          title={state === "copied" ? t("addComputer.copied") : t("canvasComputers.unattended.copy")}
          className={cn("ui-icon-button shrink-0", code && "size-9")}>
          {state === "copied" ? <Check size={14} className="text-success" aria-hidden="true" /> : state === "failed" ? <X size={14} className="text-danger" aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
        </button>
      </div>
      {hint && <p className="text-[12px] leading-[18px] text-ink-secondary">{hint}</p>}
    </div>
  );
}
