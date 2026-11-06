// A collapsed-by-default preview of the settings-derived prompt, built from
// GET /api/bots/:id/system-prompt (server/system-prompt.ts's
// previewSystemPrompt, the same builder a real turn uses). Pure
// presentational: the dialog owns the fetch and the open/closed state.
import { ChevronDown, ScrollText } from "lucide-react";
import { useId, useState } from "react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { ProfileRow } from "./ProfileRow";
import { CountPill, InlineFold, useSettingsSurface } from "../SettingsPrimitives";

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
  const plain = useSettingsSurface() === "plain";
  const bodyId = useId();
  if (plain) {
    // The bot profile (2026-11-06): a row of the "What it does" card, its
    // size under the name, a count pill that unfolds one row per part.
    return (
      <ProfileRow
        data-prompt-preview={open ? "open" : "closed"}
        icon={<ScrollText />}
        label={t("botPanel.prompt.title")}
        state={data ? t("botPanel.prompt.size", { bytes: data.totalBytes.toLocaleString(), tokens: data.approxTokens.toLocaleString() }) : undefined}
        action={<CountPill open={open} onToggle={onToggle} label={t("botPanel.prompt.title")} controls={bodyId} />}
      >
        {open && (
          <div id={bodyId} className="flex flex-col gap-1">
            {!data && <p className="text-[13px] leading-[18px] text-ink-secondary">{error ? t("botPanel.prompt.error") : t("botPanel.loading")}</p>}
            {data?.sections.map((section) => <PromptPart key={section.id} label={section.label} bytes={section.bytes} text={section.text} />)}
            {data?.note && <p className="pt-1 text-[12px] leading-4 text-ink-secondary">{data.note}</p>}
          </div>
        )}
      </ProfileRow>
    );
  }
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

/** One part of the prompt on the bot profile: its name and size, a count
 * pill that unfolds its text in a filled box (no outline). */
function PromptPart({ label, bytes, text }: { label: string; bytes: number; text: string }) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  return (
    <div data-prompt-part={open ? "open" : "closed"} className="flex flex-col">
      <div className="flex min-h-[44px] items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13px] leading-[18px] text-ink">{label}</span>
          <span className="text-[12px] leading-4 text-ink-secondary tabular-nums">{t("botPanel.prompt.bytes", { count: bytes.toLocaleString() })}</span>
        </div>
        <CountPill open={open} onToggle={() => setOpen(!open)} label={label} controls={bodyId} />
      </div>
      <div id={bodyId} hidden={!open}>
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-inset p-3 font-mono text-[12px] leading-relaxed text-ink">{text}</pre>
      </div>
    </div>
  );
}
