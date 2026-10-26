// Settings > Import (port of OpenMausBot #3073): bring a shared Grok Bot in.
// The preview and Add are the bot templates' own (TeamImportPreview), so the
// same rules hold: skills off, routines paused, no model, no keys.
import { useState } from "react";
import { t } from "@/lib/i18n";
import type { PendingTeamImport } from "@/lib/team-import";
import type { GrokLeftOut } from "../../../shared/grok-import";
import { TeamImportPreview } from "../bot-catalog/TemplateTools";
import { GrokImportBox, GrokLeftOutList } from "../GrokImportBox";
import { SettingsGroup } from "../SettingsPrimitives";

export function ImportSettings() {
  const [pending, setPending] = useState<{ preview: PendingTeamImport; leftOut: GrokLeftOut[] } | null>(null);
  const [done, setDone] = useState("");
  return (
    <div data-settings-card="import" className="flex flex-col gap-2">
      <SettingsGroup title={t("grokImport.title")} groupId="import">
        <div className="px-3.5 py-3">
          {done ? <p role="status" className="mb-3 text-[12.5px] text-ink">{done}</p> : null}
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
      </SettingsGroup>
    </div>
  );
}
