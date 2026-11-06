// A collapsed-by-default preview of the settings-derived prompt, built from
// GET /api/bots/:id/system-prompt (server/system-prompt.ts's
// previewSystemPrompt, the same builder a real turn uses). Pure
// presentational: the dialog owns the fetch and the open/closed state.
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { InlineFold } from "../SettingsPrimitives";

export interface PromptPreviewData {
  sections: Array<{ id: string; label: string; text: string; bytes: number }>;
  totalBytes: number;
  approxTokens: number;
  note: string;
}

export function PromptPreview({
  data,
  error,
  open,
  onToggle,
}: {
  data: PromptPreviewData | null;
  error?: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="rounded-xl border-[0.5px] border-border bg-elevated px-3.5 py-3">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="text-[13px] font-medium text-ink">
          {data
            ? t("botPanel.prompt.summary", { bytes: data.totalBytes.toLocaleString(), tokens: data.approxTokens.toLocaleString() })
            : t("botPanel.prompt.title")}
        </span>
        <ChevronDown size={16} className={cn("shrink-0 text-ink-secondary transition-transform", open && "rotate-180")} />
      </button>

      {open && !data && error && (
        <div className="mt-3 text-[13px] text-ink-secondary">{t("botPanel.prompt.error")}</div>
      )}

      {open && !data && !error && <div className="mt-3 text-[13px] text-ink-secondary">{t("botPanel.loading")}</div>}

      {open && data && (
        <div className="mt-3 flex flex-col gap-2">
          {data.sections.map((section) => (
            <InlineFold key={section.id} label={<>{section.label} · <span className="tabular-nums">{t("botPanel.prompt.bytes", { count: section.bytes.toLocaleString() })}</span></>}>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-ink">
                {section.text}
              </pre>
            </InlineFold>
          ))}
          {data.note && <div className="text-[11px] text-ink-secondary">{data.note}</div>}
        </div>
      )}
    </div>
  );
}
