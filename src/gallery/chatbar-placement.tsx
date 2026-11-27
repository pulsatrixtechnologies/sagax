/** Gallery for headless captures of usage pill placement and customize mode
 * (D-20261127-001, D-20261126-014). Uses the real model chip (ModelPickerTrigger
 * with mode glyph + "Heavy · High") and the real ComposerVoiceButton, same as
 * the mode-menu gallery. Synthetic data only.
 * ?skin=&lang=&place=inBar|above|below&customize=1&dragging=usage&jiggleFrame=1
 */
import { StrictMode, useMemo, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { ArrowUp, AudioLines, Paperclip } from "lucide-react";
import { COMPOSER_PILL } from "../components/Composer.tsx-parts/ComposerEditor";
import { COMPOSER_WIDE_ONLY, ComposerMicButton, SECONDARY_CIRCLE } from "../components/ComposerControls";
import { ComposerMeterView } from "../components/ComposerMeter";
import { ModelPickerTrigger } from "../components/ModelPicker.tsx-parts/ModelPickerTrigger";
import { MODE_GLYPHS } from "../components/ModeMenu";
import { ComposerVoiceButton } from "../components/ComposerVoiceButton";
import {
  ComposerBelowDropZone,
  ComposerCustomizeChrome,
  ComposerMovable,
  type ComposerCustomizeApi,
} from "../components/Composer.tsx-parts/ComposerCustomize";
import {
  composerBarSlots,
  DEFAULT_COMPOSER_BAR_LAYOUT,
  type ComposerBarItem,
  type ComposerBarLayout,
} from "../lib/composer-bar-layout";
import { chatBarChipLabel } from "../lib/model-mode";
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
const draggingParam = params.get("dragging") === "usage" ? "usage" as const : null;
const jiggleFrame = params.get("jiggleFrame") === "1" || customize;

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

function buildApi(dragging: ComposerBarItem | null): ComposerCustomizeApi {
  return {
    customizing: true,
    dragging,
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
      ...(dragging === "usage" ? { "data-composer-drop-active": "1" as const } : {}),
    }),
  };
}

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

/** Real chat-bar chip: Heavy mode glyph + "Heavy · High" (ModelPickerTrigger). */
function RealModelChip() {
  const ref = useRef<HTMLButtonElement>(null);
  const label = chatBarChipLabel("heavy", "high");
  return ModelPickerTrigger({
    windowOnly: false,
    inComposer: true,
    headless: false,
    contained: false,
    bot: { id: "demo", busy: false } as never,
    triggerRef: ref,
    menu: false,
    toggleMenu: () => undefined,
    composerLabel: label,
    chipGlyph: MODE_GLYPHS.heavy,
    followLine: "",
    summary: label,
    selection: { instanceId: "demo", model: "demo", auto: true, mode: "heavy", effort: "high" },
    autoOn: true,
    autoRecord: null,
    autoInstance: undefined,
    active: undefined,
    showActiveAccount: false,
    selectedVariantLabel: undefined,
    advanced: false,
  });
}

/** Real voice button (ComposerVoiceButton) with mic face + conversation waves. */
function RealVoiceButton() {
  return (
    <ComposerVoiceButton
      engine="xai"
      dictation={<ComposerMicButton onClick={() => undefined} engine="xai" shortcut="⌘D" />}
      conversation={
        <button type="button" data-composer-voice="" aria-label="Voice" className={SECONDARY_CIRCLE}>
          <AudioLines size={16} aria-hidden="true" />
        </button>
      }
    />
  );
}

function Bar({
  placement,
  customizing,
  dragging,
}: {
  placement: UsagePillPlacement;
  customizing: boolean;
  dragging: ComposerBarItem | null;
}) {
  const [layout] = useState<ComposerBarLayout>(DEFAULT_COMPOSER_BAR_LAYOUT);
  const slots = useMemo(() => composerBarSlots(layout, placement), [layout, placement]);
  const meter = <Meter />;
  const api = customizing
    ? buildApi(dragging)
    : { ...buildApi(null), customizing: false, dragging: null };
  const render = (id: ComposerBarItem): ReactNode => {
    const node =
      id === "plus" ? (
        <button type="button" data-composer-plus="" className={SECONDARY_CIRCLE} aria-label="+">
          <Paperclip size={16} aria-hidden="true" />
        </button>
      ) : id === "model" ? (
        <span data-composer-model-chip="" className={COMPOSER_WIDE_ONLY}>
          <RealModelChip />
        </span>
      ) : id === "usage" ? (placement === "inBar" ? meter : null)
      : (
        <RealVoiceButton />
      );
    if (!node) return null;
    return (
      <ComposerMovable key={id} id={id} customizing={customizing} api={api}>
        {node}
      </ComposerMovable>
    );
  };
  const aboveMeter = placement === "above" ? (
    <div data-composer-above-row="" className="mb-1 flex min-h-7 items-center justify-end px-2">
      <ComposerMovable id="usage" customizing={customizing} api={api}>{meter}</ComposerMovable>
    </div>
  ) : null;
  const belowMeter = placement === "below" ? (
    <div data-composer-under-row="" className="flex min-h-7 items-center justify-end px-2 pt-1">
      <ComposerMovable id="usage" customizing={customizing} api={api}>{meter}</ComposerMovable>
    </div>
  ) : null;
  return (
    <div data-gallery-sample="bar" className="w-[720px]">
      <ComposerCustomizeChrome
        customizing={customizing}
        jiggleFrame={jiggleFrame}
        globalChrome={false}
        onReset={() => undefined}
        onDone={() => undefined}
      >
        {customizing && !aboveMeter ? (
          <div
            className="mb-1 flex min-h-7 items-center justify-end rounded-xl border border-dashed border-hairline px-2"
            {...api.dropZoneProps("above")}
          >
            <span className="text-[11px] text-ink-tertiary">{t("composer.customize.dropAbove")}</span>
          </div>
        ) : aboveMeter}
        <div className={COMPOSER_PILL}>
          <div data-composer-row className="flex items-end gap-1">
            <div className="composer-band flex items-center gap-2">{slots.left.map(render)}</div>
            <div className="min-h-6 flex-1 px-1 py-1.5 text-[14px] text-ink-tertiary" data-composer-field="">
              Message Cryptic
            </div>
            <div data-composer-actions className="composer-band flex items-center gap-2">
              {slots.right.map(render)}
              <button
                type="button"
                data-composer-send=""
                className="flex size-7 items-center justify-center rounded-full bg-accent text-accent-ink"
                aria-label="Send"
              >
                <ArrowUp size={17} />
              </button>
            </div>
          </div>
        </div>
        {customizing ? (
          <ComposerBelowDropZone customizing api={api}>
            {belowMeter}
          </ComposerBelowDropZone>
        ) : belowMeter}
      </ComposerCustomizeChrome>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div
      className="min-h-screen bg-app p-8 text-ink"
      data-gallery-placement={place}
      data-gallery-customize={customize ? "1" : "0"}
      data-gallery-dragging={draggingParam ?? ""}
    >
      <p className="mb-4 text-[13px] text-ink-secondary">
        {t("settings.usagePill.placement.title")}: {t(`settings.usagePill.placement.${place}`)}
      </p>
      <Bar placement={place} customizing={customize} dragging={draggingParam} />
    </div>
  </StrictMode>,
);
