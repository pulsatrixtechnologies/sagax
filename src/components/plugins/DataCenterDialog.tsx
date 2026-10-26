// "Choose your {connector} data center" (2026-10-21, parity with Grok Bot):
// a provider that serves each region at its own address (shared/plugin-
// catalog.ts regions, or a registry remote with a {region} choice) asks
// where the account lives before Add connects it. The choice goes to
// POST /api/plugins/install as `region`; nothing is added before it.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Globe2 } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { DIALOG, PILL, PRIMARY_PILL } from "../SettingsPrimitives";

export interface DataCenter { id: string; label: string; url: string }

/** The region ticked first: the one whose address is the default. Pure. */
export function defaultDataCenter(regions: readonly DataCenter[], defaultUrl: string): string {
  return (regions.find((region) => region.url === defaultUrl) ?? regions[0])?.id ?? "";
}

export function DataCenterDialog({ name, regions, defaultUrl, onCancel, onChoose }: {
  name: string;
  regions: readonly DataCenter[];
  defaultUrl: string;
  onCancel: () => void;
  onChoose: (regionId: string) => void;
}) {
  const [chosen, setChosen] = useState(() => defaultDataCenter(regions, defaultUrl));
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLInputElement>("input:checked")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);
  return createPortal(
    <div className={cn(DIALOG.backdrop, "z-[80]")} onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="data-center-title" data-data-center-dialog=""
        className={cn(DIALOG.frame, DIALOG.width.sm, "gap-3 p-5")}>
        <h2 id="data-center-title" className="flex items-center gap-2 text-[15px] font-semibold"><Globe2 size={16} aria-hidden="true" />{t("plugins.dataCenter.title", { name })}</h2>
        <p className="text-[12.5px] leading-relaxed text-ink-secondary">{t("plugins.dataCenter.intro", { name })}</p>
        <fieldset className="space-y-1.5">
          <legend className="sr-only">{t("plugins.dataCenter.title", { name })}</legend>
          {regions.map((region) => (
            <label key={region.id} data-data-center={region.id}
              className={cn("flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-[13px]", chosen === region.id ? "border-accent bg-accent/10" : "border-hairline/60 hover:bg-hover")}>
              <input type="radio" name="data-center" value={region.id} checked={chosen === region.id} onChange={() => setChosen(region.id)} className="accent-accent" />
              <span className="min-w-0 flex-1">
                <span className="block text-ink">{region.label}</span>
                <span className="block truncate font-mono text-[11px] text-ink-tertiary" title={region.url}>{new URL(region.url).hostname}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className={PILL}>{t("common.cancel")}</button>
          <button type="button" data-data-center-continue disabled={!chosen} onClick={() => onChoose(chosen)} className={PRIMARY_PILL}>{t("plugins.dataCenter.continue")}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
