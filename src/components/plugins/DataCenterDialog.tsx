// "Choose your {connector} data center" (2026-10-21, parity with the reference design;
// 2026-11-01 lot 5: popover anchored to Connect/Add, no modal window).
// A provider that serves each region at its own address (shared/plugin-
// catalog.ts regions, or a registry remote with a {region} choice) asks
// where the account lives before Add connects it. The choice goes to
// POST /api/plugins/install as `region`; nothing is added before it.
import { useEffect, useRef, useState, type RefObject } from "react";
import { Globe2 } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { AnchoredPopover, useAnchoredDismissRoot } from "../AnchoredPopover";
import { PILL, PRIMARY_PILL } from "../SettingsPrimitives";

export interface DataCenter { id: string; label: string; url: string }

/** The region ticked first: the one whose address is the default. Pure. */
export function defaultDataCenter(regions: readonly DataCenter[], defaultUrl: string): string {
  return (regions.find((region) => region.url === defaultUrl) ?? regions[0])?.id ?? "";
}

export function DataCenterDialog({ name, regions, defaultUrl, anchorRef, onCancel, onChoose }: {
  name: string;
  regions: readonly DataCenter[];
  defaultUrl: string;
  /** The Connect/Add control that opened this choice. */
  anchorRef: RefObject<HTMLElement | null>;
  onCancel: () => void;
  onChoose: (regionId: string) => void;
}) {
  const [chosen, setChosen] = useState(() => defaultDataCenter(regions, defaultUrl));
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRoot = useRef<HTMLElement | null>(null);
  triggerRoot.current = anchorRef.current;
  const dismissRoot = useAnchoredDismissRoot(triggerRoot, popoverRef);
  usePopoverDismiss(true, dismissRoot, onCancel);

  useEffect(() => {
    popoverRef.current?.querySelector<HTMLInputElement>("input:checked")?.focus();
  }, []);

  return (
    <AnchoredPopover
      anchorRef={anchorRef}
      popoverRef={popoverRef}
      align="end"
      side="bottom"
      role="dialog"
      aria-labelledby="data-center-title"
      data-data-center-dialog=""
      className="w-[min(360px,calc(100vw-24px))] rounded-xl border-[0.5px] border-border popover-surface bg-elevated p-4 text-[13px] text-ink shadow-xl"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }}
    >
      <h2 id="data-center-title" className="flex items-center gap-2 text-[15px] font-semibold">
        <Globe2 size={16} aria-hidden="true" />
        {t("plugins.dataCenter.title", { name })}
      </h2>
      <p className="mt-2 text-[12.5px] leading-relaxed text-ink-secondary">{t("plugins.dataCenter.intro", { name })}</p>
      <fieldset className="mt-3 space-y-1.5">
        <legend className="sr-only">{t("plugins.dataCenter.title", { name })}</legend>
        {regions.map((region) => (
          <label
            key={region.id}
            data-data-center={region.id}
            className={cn(
              "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-[13px]",
              chosen === region.id ? "border-accent bg-accent/10" : "border-hairline/60 hover:bg-hover",
            )}
          >
            <input
              type="radio"
              name="data-center"
              value={region.id}
              checked={chosen === region.id}
              onChange={() => setChosen(region.id)}
              className="accent-accent"
            />
            <span className="min-w-0 flex-1">
              <span className="block text-ink">{region.label}</span>
              <span className="block truncate font-mono text-[11px] text-ink-tertiary" title={region.url}>
                {new URL(region.url).hostname}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={PILL}>{t("common.cancel")}</button>
        <button
          type="button"
          data-data-center-continue
          disabled={!chosen}
          onClick={() => onChoose(chosen)}
          className={PRIMARY_PILL}
        >
          {t("plugins.dataCenter.continue")}
        </button>
      </div>
    </AnchoredPopover>
  );
}
