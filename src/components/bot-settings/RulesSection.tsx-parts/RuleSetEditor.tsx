import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { formatMemoryBytes } from "@/lib/memory";
import type { RuleSetWire } from "@/lib/rule-sets";
import { MarkdownEditor } from "../../markdown/MarkdownEditor";
import { buttonCls, ruleSetLabel } from "./shared";

export function RuleSetEditor({ current, plain, draft, count, conflict, busy, dirty, starter, saved, footer, onChange, onDrop, onReload, onSave }: {
  current: RuleSetWire;
  plain: boolean;
  draft: string;
  count: { over: boolean; maxLines: number; maxBytes: number };
  conflict: { id: string; current: string; currentHash: string } | null;
  busy: boolean;
  dirty: boolean;
  starter: boolean;
  saved: string | null;
  footer: React.ReactNode;
  onChange: (next: string) => void;
  onDrop: () => void;
  onReload: () => void;
  onSave: (expectedHash: string | undefined) => void;
}) {
  return (
    <div className={cn("flex flex-col gap-3", plain && "px-4 pb-3 pt-1")} data-rule-set-editor={current.id}>
      {!current.enabled && <p className="text-[12.5px] text-ink-secondary">{t("persona.rules.sets.offNote")}</p>}
      <MarkdownEditor
        ariaLabel={t("persona.rules.sets.editorLabel", { name: ruleSetLabel(current), file: current.file })}
        value={draft}
        onChange={onChange}
        minHeight={220}
        dataField="rules"
        placeholder={t("persona.rules.placeholder")}
        invalid={count.over}
        footer={footer}
      />
      {count.over && (
        <p role="alert" className="text-[12.5px] text-danger">
          {t("persona.rules.sets.setOver", { maxLines: count.maxLines, maxBytes: formatMemoryBytes(count.maxBytes) })}
        </p>
      )}
      {conflict && conflict.id === current.id && (
        <div role="alert" className={plain ? "rounded-lg bg-warning/10 p-3 text-[12.5px] leading-relaxed text-ink" : "rounded-lg border border-warning/25 bg-warning/10 p-3 text-[12.5px] leading-relaxed text-ink"}>
          <div className={plain ? undefined : "font-medium"}>{t("persona.rules.conflict")}</div>
          <div className="mt-2 flex gap-2">
            <button type="button" className={buttonCls} disabled={busy} onClick={onReload}>
              {t("persona.rules.reload")}
            </button>
            <button type="button" className={buttonCls} disabled={busy} onClick={() => onSave(conflict.currentHash)}>
              {t("persona.rules.overwrite")}
            </button>
          </div>
        </div>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          data-rules-save=""
          className={buttonCls}
          disabled={busy || (!dirty && !starter)}
          onClick={() => onSave(current.hash)}
        >
          {busy ? t("persona.rules.saving") : t("persona.rules.save")}
        </button>
        {dirty && (
          <button
            type="button"
            className={plain ? buttonCls : "rounded-md px-2 py-1 text-[12.5px] text-ink-secondary hover:bg-control hover:text-ink"}
            disabled={busy}
            onClick={onDrop}
          >
            {t("persona.rules.discard")}
          </button>
        )}
        {saved === current.id && !dirty && <span className="text-[12.5px] text-ink-secondary">{t("persona.rules.saved")}</span>}
      </div>
    </div>
  );
}
