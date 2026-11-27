// Floating mode bar + Hidden panel while customizing (D-20261127-004, #5443).
import { createPortal } from "react-dom";
import { useMemo } from "react";

import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { cn } from "@/lib/cn";
import { ZONE_REGISTRY, zoneComponent } from "@/lib/ui-layout/registry";
import type { ZoneId } from "@/lib/ui-layout/types";
import { ZONE_IDS } from "@/lib/ui-layout/types";
import { useUiCustomize } from "./UiCustomizeMode";

function labelFor(zoneId: ZoneId, id: string): string {
  const spec = zoneComponent(zoneId, id);
  if (spec) {
    if (spec.labelKey === "ui.customize.item.section") {
      return id.startsWith("section:") ? id.slice("section:".length) : t(spec.labelKey as LocaleKey);
    }
    return t(spec.labelKey as LocaleKey);
  }
  if (id.startsWith("section:")) return id.slice("section:".length);
  return id;
}

export function UiCustomizeChrome({ jiggleFrame = false }: { jiggleFrame?: boolean } = {}) {
  const api = useUiCustomize();
  const hiddenEntries = useMemo(() => {
    const rows: { zoneId: ZoneId; id: string; label: string; zoneLabel: string }[] = [];
    for (const zoneId of ZONE_IDS) {
      const zone = api.draft.zones[zoneId];
      for (const id of zone.hidden) {
        rows.push({
          zoneId,
          id,
          label: labelFor(zoneId, id),
          zoneLabel: t(ZONE_REGISTRY[zoneId].labelKey as LocaleKey),
        });
      }
    }
    return rows;
  }, [api.draft]);

  if (!api.active) return null;
  if (typeof document === "undefined" || !document.body) return null;

  return createPortal(
    <div
      data-ui-customize-chrome=""
      data-ui-customize="1"
      data-ui-jiggle-frame={jiggleFrame ? "1" : undefined}
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 px-3 pb-3"
    >
      {hiddenEntries.length > 0 && (
        <div
          data-ui-customize-hidden=""
          className="pointer-events-auto w-full max-w-lg rounded-2xl border border-hairline bg-panel/95 p-3 shadow-lg backdrop-blur"
        >
          <div className="mb-2 text-[12px] font-medium text-ink-secondary">{t("ui.customize.hidden")}</div>
          <ul className="flex flex-col gap-1">
            {hiddenEntries.map((row) => (
              <li key={`${row.zoneId}:${row.id}`} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                  {row.label}
                  <span className="ml-1 text-[11px] text-ink-tertiary">{row.zoneLabel}</span>
                </span>
                <button
                  type="button"
                  data-ui-customize-restore={row.id}
                  onClick={() => api.restore(row.zoneId, row.id)}
                  className="rounded-full px-2.5 py-1 text-[12px] text-ink-secondary hover:bg-menu-hover hover:text-ink"
                >
                  {t("ui.customize.restore")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div
        data-ui-customize-toolbar=""
        className={cn(
          "pointer-events-auto flex items-center gap-2 rounded-full border border-hairline bg-panel/95 px-2 py-1.5 shadow-lg backdrop-blur",
        )}
      >
        <button
          type="button"
          data-ui-customize-reset=""
          onClick={() => api.requestReset()}
          className="rounded-full px-2.5 py-1 text-[12px] text-ink-secondary hover:bg-menu-hover hover:text-ink"
        >
          {t("ui.customize.reset")}
        </button>
        <button
          type="button"
          data-ui-customize-cancel=""
          onClick={() => api.cancel()}
          className="rounded-full px-2.5 py-1 text-[12px] text-ink-secondary hover:bg-menu-hover hover:text-ink"
        >
          {t("ui.customize.cancel")}
        </button>
        <button
          type="button"
          data-ui-customize-save=""
          onClick={() => api.save()}
          className="rounded-full bg-accent px-2.5 py-1 text-[12px] text-accent-ink hover:brightness-110"
        >
          {t("ui.customize.save")}
        </button>
      </div>
    </div>,
    document.body,
  );
}
