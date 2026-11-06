// Settings > Backups and import (#2080 L3): Import is a card of this page.
// Two rows open the Grok Bot and primary-bot preference flows in place.
import { useState, type ReactNode } from "react";
import { t } from "@/lib/i18n";
import type { PendingTeamImport } from "@/lib/team-import";
import type { GrokLeftOut } from "../../../shared/grok-import";
import { TeamImportPreview } from "../bot-catalog/TemplateTools";
import { GrokImportBox, GrokLeftOutList } from "../GrokImportBox";
import { DescribedRow, PILL, SettingsGroup } from "../SettingsPrimitives";
import { PreferenceImportCard } from "./PreferenceImportCard";

/** The Grok Bot import body (also exercised by ImportSettings.dom.test). */
export function GrokImportPanel() {
  const [pending, setPending] = useState<{ preview: PendingTeamImport; leftOut: GrokLeftOut[] } | null>(null);
  const [done, setDone] = useState("");
  return (
    <div data-grok-import-panel="" className="flex flex-col gap-2 px-3.5 py-3">
      {done ? <p role="status" className="mb-1 text-[12.5px] text-ink">{done}</p> : null}
      {pending ? (
        <div data-grok-import-preview="">
          <h3 className="text-[14px] font-semibold text-ink">{pending.preview.name}</h3>
          <div className="mt-3">
            <TeamImportPreview
              pending={pending.preview}
              source="grok"
              onImported={(result) => { setPending(null); setDone(t("grokImport.added", { name: result.name })); }}
            />
          </div>
          <GrokLeftOutList leftOut={pending.leftOut} />
          <button type="button" className="mt-3 text-[12px] text-ink-secondary hover:text-ink" onClick={() => setPending(null)}>{t("botCatalog.back")}</button>
        </div>
      ) : (
        <GrokImportBox onPreview={(preview, leftOut) => { setDone(""); setPending({ preview, leftOut }); }} />
      )}
    </div>
  );
}

function ImportRow({ cardId, label, description, children }: {
  cardId: string;
  label: string;
  description: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div data-settings-card={cardId} data-open={open ? "true" : "false"}>
      <DescribedRow
        label={label}
        description={description}
        rowId={cardId}
        below={open ? <div className="mt-2">{children}</div> : null}
      >
        <button type="button" aria-expanded={open} className={PILL} onClick={() => setOpen((value) => !value)}>
          {t("import.action")}
        </button>
      </DescribedRow>
    </div>
  );
}

export function ImportSettings() {
  return (
    <div data-settings-card="import" className="flex flex-col gap-2">
      <SettingsGroup title={t("backups.group.import")} groupId="import">
        <ImportRow cardId="backups.import.grok" label={t("import.grok.row")} description={t("import.grok.summary")}>
          <GrokImportPanel />
        </ImportRow>
        <ImportRow cardId="backups.import.prefs" label={t("import.prefs.row")} description={t("import.prefs.summary")}>
          <PreferenceImportCard bare />
        </ImportRow>
      </SettingsGroup>
    </div>
  );
}
