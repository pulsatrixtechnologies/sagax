/** Gallery for headless captures of usage pill placement and customize mode
 * (D-20261127-001, D-20261126-014). Synthetic data only.
 * ?skin=&lang=&place=inBar|above|below&customize=1
 */
import { StrictMode, useMemo, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { ArrowUp, Paperclip } from "lucide-react";
import { COMPOSER_PILL } from "../components/Composer.tsx-parts/ComposerEditor";
import { COMPOSER_WIDE_ONLY, SECONDARY_CIRCLE } from "../components/ComposerControls";
import { ComposerMeterView } from "../components/ComposerMeter";
import { ComposerMovable, ComposerCustomizeChrome, type ComposerCustomizeApi } from "../components/Composer.tsx-parts/ComposerCustomize";
import {
  composerBarSlots,
  DEFAULT_COMPOSER_BAR_LAYOUT,
  type ComposerBarItem,
  type ComposerBarLayout,
} from "../lib/composer-bar-layout";
import { parseUsagePillPlacement, type UsagePillPlacement } from "../lib/usage-pill-preferences";
import { loadLocale, t } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import type { UsageAccount } from "../lib/usage-pill";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");
const place = parseUsagePillPlacement(params.get("place"));
const customize = params.get("customize") === "1";

const NOW = Date.UTC(2026, 10, 26, 18, 0, 0);
const accounts: UsageAccount[] = [
  {
    id: "claude",
    name: "Claude",
    plan: null,
    fiveHour: 20,
    weekly: 44,
    hours: 5,
    serving: true,
    blocked: false,
    backAt: null,
    driver: "claudeAgent",
  },
];

const noopApi: ComposerCustomizeApi = {
  customizing: true,
  begin: () => undefined,
  end: () => undefined,
  reset: () => undefined,
  onItemKeyDown: () => undefined,
  dragProps: () => ({
    draggable: true,
    onDragStart: () => undefined,
    onDragOver: () => undefined,
    onDrop: () => undefined,
    onDragEnd: () => undefined,
  }),
  dropZoneProps: (placement) => ({
    onDragOver: () => undefined,
    onDrop: () => undefined,
    "data-composer-drop": placement,
  }),
};

function Meter() {
  return (
    <ComposerMeterView
      now={NOW}
      shape="circles"
      context={{ percent: 42, detail: "42%" }}
      usage={{ accounts, favorite: { id: null, onToggle: () => undefined }, poolKnown: true }}
    />
  );
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <button type="button" className="flex h-8 items-center gap-1.5 rounded-full border border-hairline bg-panel px-2.5 text-[13px] text-ink">
      {children}
    </button>
  );
}

function Bar({ placement, customizing }: { placement: UsagePillPlacement; customizing: boolean }) {
  const [layout] = useState<ComposerBarLayout>(DEFAULT_COMPOSER_BAR_LAYOUT);
  const slots = useMemo(() => composerBarSlots(layout, placement), [layout, placement]);
  const meter = <Meter />;
  const api = customizing ? { ...noopApi, customizing: true } : { ...noopApi, customizing: false };
  const render = (id: ComposerBarItem) => {
    const node =
      id === "plus" ? (
        <button type="button" data-composer-plus="" className={SECONDARY_CIRCLE} aria-label="+">
          <Paperclip size={16} aria-hidden="true" />
        </button>
      ) : id === "model" ? (
        <span data-composer-model-chip="" className={COMPOSER_WIDE_ONLY}>
          <Chip>Auto</Chip>
        </span>
      ) : id === "usage" ? (placement === "inBar" ? meter : null)
      : (
        <button type="button" className={SECONDARY_CIRCLE} aria-label="Voice">
          <span className="text-[11px]">mic</span>
        </button>
      );
    if (!node) return null;
    return (
      <ComposerMovable key={id} id={id} customizing={customizing} api={api}>
        {node}
      </ComposerMovable>
    );
  };
  return (
    <div data-gallery-sample="bar" className="w-[720px]">
      <ComposerCustomizeChrome customizing={customizing} onReset={() => undefined} onDone={() => undefined}>
        {placement === "above" && (
          <div data-composer-above-row="" className="mb-1 flex min-h-7 items-center justify-end px-2">
            <ComposerMovable id="usage" customizing={customizing} api={api}>{meter}</ComposerMovable>
          </div>
        )}
        <div className={COMPOSER_PILL}>
          <div data-composer-row className="flex items-end gap-1">
            <div className="composer-band flex items-center gap-2">{slots.left.map(render)}</div>
            <div className="min-h-6 flex-1 px-1 py-1.5 text-[14px] text-ink-tertiary">Message Cryptic</div>
            <div data-composer-actions className="composer-band flex items-center gap-2">
              {slots.right.map(render)}
              <button type="button" className="flex size-7 items-center justify-center rounded-full bg-accent text-accent-ink" aria-label="Send">
                <ArrowUp size={17} />
              </button>
            </div>
          </div>
        </div>
        {placement === "below" && (
          <div data-composer-under-row="" className="flex min-h-7 items-center justify-end px-2 pt-1">
            <ComposerMovable id="usage" customizing={customizing} api={api}>{meter}</ComposerMovable>
          </div>
        )}
      </ComposerCustomizeChrome>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div className="min-h-screen bg-app p-8 text-ink" data-gallery-placement={place} data-gallery-customize={customize ? "1" : "0"}>
      <p className="mb-4 text-[13px] text-ink-secondary">{t("settings.usagePill.placement.title")}: {t(`settings.usagePill.placement.${place}`)}</p>
      <Bar placement={place} customizing={customize} />
    </div>
  </StrictMode>,
);
