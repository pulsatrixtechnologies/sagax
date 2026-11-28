/** Gallery for whole-app customize mode (D-20261127-004, #5443).
 * PR1: composer + sidebar. PR2: conversation header + bot page.
 * ?skin=&lang=&zone=composerBar|sidebar|conversationHeader|botPage&customize=1
 * &hidden=usage|search|title|card:settings&jiggleFrame=1&chrome=1
 */
import { StrictMode, useEffect, useMemo, useRef, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUp,
  AudioLines,
  PanelLeft,
  PanelRight,
  Paperclip,
  Plus,
  Search,
  Ellipsis,
} from "lucide-react";
import { COMPOSER_PILL } from "../components/Composer.tsx-parts/ComposerEditor";
import { COMPOSER_WIDE_ONLY, ComposerMicButton, SECONDARY_CIRCLE } from "../components/ComposerControls";
import { ComposerMeterView } from "../components/ComposerMeter";
import { ModelPickerTrigger } from "../components/ModelPicker.tsx-parts/ModelPickerTrigger";
import { MODE_GLYPHS } from "../components/ModeMenu";
import { ComposerVoiceButton } from "../components/ComposerVoiceButton";
import type { LocaleKey } from "../locales";
import {
  ComposerBelowDropZone,
  ComposerCustomizeChrome,
  ComposerMovable,
  type ComposerCustomizeApi,
} from "../components/Composer.tsx-parts/ComposerCustomize";
import { UiCustomizeChrome } from "../components/ui-customize/UiCustomizeChrome";
import { UiCustomizeProvider, useUiCustomize } from "../components/ui-customize/UiCustomizeMode";
import { UiMovable } from "../components/ui-customize/UiMovable";
import { ConfirmProvider } from "../components/ConfirmProvider";
import { ChatHeaderBar } from "../components/ChatHeaderBar";
import { PillTabs } from "../components/PillTabs";
import { CIRCLE_BUTTON, CIRCLE_ICON } from "../lib/circle-button";
import {
  composerBarSlots,
  DEFAULT_COMPOSER_BAR_LAYOUT,
  type ComposerBarItem,
} from "../lib/composer-bar-layout";
import { chatBarChipLabel } from "../lib/model-mode";
import { parseUsagePillPlacement } from "../lib/usage-pill-preferences";
import { hideInZone } from "../lib/ui-layout/draft";
import { defaultUiLayout, setUiLayout, resetUiLayoutStoreForTests } from "../lib/ui-layout/preference";
import {
  conversationHeaderControlOrder,
  conversationHeaderTitleVisible,
} from "../lib/ui-layout/conversation-header-order";
import {
  botGeneralCardOrder,
  botPanelTabOrder,
  botProfileTabOrder,
  panelTabComponentId,
  profileTabComponentId,
  profileTabFromComponentId,
  panelTabFromComponentId,
} from "../lib/ui-layout/bot-page-order";
import { loadLocale, t } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import type { UsageAccount } from "../lib/usage-pill";
import type { ZoneId } from "../lib/ui-layout/types";
import { ZONE_IDS } from "../lib/ui-layout/types";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");
const zoneParam = params.get("zone") ?? "composerBar";
const zone: ZoneId = (ZONE_IDS as readonly string[]).includes(zoneParam) ? zoneParam as ZoneId : "composerBar";
const customize = params.get("customize") === "1";
const showChrome = params.get("chrome") !== "0";
const jiggleFrame = params.get("jiggleFrame") === "1" || customize;
const hiddenParam = (params.get("hidden") ?? "").split(",").filter(Boolean);
const place = parseUsagePillPlacement(params.get("place"));

resetUiLayoutStoreForTests();
let seed = defaultUiLayout();
seed.zones.composerBar.usagePlacement = place;
for (const id of hiddenParam) {
  if (["plus", "model", "usage", "voice"].includes(id)) seed = hideInZone(seed, "composerBar", id);
  else if (["collapse", "search", "new", "pinnedTiles", "accountUsage", "builtin:general"].includes(id) || id.startsWith("section:")) {
    seed = hideInZone(seed, "sidebar", id);
  } else if (["title", "botPanel", "exportMenu", "liveCall", "tasks"].includes(id)) {
    seed = hideInZone(seed, "conversationHeader", id);
  } else {
    seed = hideInZone(seed, "botPage", id);
  }
}
setUiLayout(seed);

const NOW = Date.UTC(2026, 10, 27, 18, 0, 0);
const accounts: UsageAccount[] = [{
  id: "claude", name: "Claude", plan: null, fiveHour: 20, weekly: 44,
  hours: 5, serving: true, blocked: false, backAt: null, driver: "claudeAgent",
}];

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

function RealVoiceButton() {
  return (
    <ComposerVoiceButton
      engine="xai"
      dictation={<ComposerMicButton onClick={() => undefined} engine="xai" shortcut="Cmd+D" />}
      conversation={
        <button type="button" data-composer-voice="" aria-label="Voice" className={SECONDARY_CIRCLE}>
          <AudioLines size={16} aria-hidden="true" />
        </button>
      }
    />
  );
}

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
    }),
    hideItem: () => undefined,
  };
}

function ComposerZone({ customizing }: { customizing: boolean }) {
  const ui = useUiCustomize();
  const zoneLayout = ui.draft.zones.composerBar;
  const placement = zoneLayout.usagePlacement ?? "inBar";
  const layout = {
    order: zoneLayout.order.filter((id): id is ComposerBarItem =>
      (DEFAULT_COMPOSER_BAR_LAYOUT.order as readonly string[]).includes(id)),
    left: zoneLayout.left ?? 1,
  };
  const slots = composerBarSlots(layout, placement);
  const api = useMemo(() => buildApi(null), []);
  const meter = <Meter />;
  const render = (id: ComposerBarItem): ReactNode => {
    const node =
      id === "plus" ? (
        <button type="button" data-composer-plus="" className={SECONDARY_CIRCLE} aria-label="+">
          <Paperclip size={16} aria-hidden="true" />
        </button>
      ) : id === "model" ? (
        <span data-composer-model-chip="" className={COMPOSER_WIDE_ONLY}><RealModelChip /></span>
      ) : id === "usage" ? (placement === "inBar" ? meter : null)
      : <RealVoiceButton />;
    if (!node) return null;
    return (
      <ComposerMovable key={id} id={id} customizing={customizing} api={api}>{node}</ComposerMovable>
    );
  };
  return (
    <div data-gallery-zone="composerBar" className="w-[720px]">
      <ComposerCustomizeChrome
        customizing={customizing}
        jiggleFrame={jiggleFrame}
        globalChrome
        onReset={() => undefined}
        onDone={() => undefined}
      >
        {customizing ? (
          <div className="mb-1 flex min-h-7 items-center justify-end rounded-xl border border-dashed border-hairline px-2" {...api.dropZoneProps("above")}>
            <span className="text-[11px] text-ink-tertiary">{t("composer.customize.dropAbove")}</span>
          </div>
        ) : null}
        <div className={COMPOSER_PILL}>
          <div data-composer-row className="flex items-end gap-1">
            <div className="composer-band flex items-center gap-2">{slots.left.map(render)}</div>
            <div className="min-h-6 flex-1 px-1 py-1.5 text-[14px] text-ink-tertiary" data-composer-field="">Message</div>
            <div data-composer-actions className="composer-band flex items-center gap-2">
              {slots.right.map(render)}
              <button type="button" data-composer-send="" className="flex size-7 items-center justify-center rounded-full bg-accent text-accent-ink" aria-label="Send">
                <ArrowUp size={17} />
              </button>
            </div>
          </div>
        </div>
        {customizing ? <ComposerBelowDropZone customizing api={api} /> : null}
      </ComposerCustomizeChrome>
    </div>
  );
}

function SidebarZone({ customizing }: { customizing: boolean }) {
  const ui = useUiCustomize();
  const hidden = new Set(ui.draft.zones.sidebar.hidden);
  const head = [
    { id: "collapse", node: <button type="button" className="flex size-9 items-center justify-center rounded-full border border-hairline" aria-label={t("ui.customize.item.collapse")}><PanelLeft {...CIRCLE_ICON} /></button> },
    { id: "search", node: <button type="button" className="flex size-9 items-center justify-center rounded-full border border-hairline" aria-label={t("ui.customize.item.search")}><Search {...CIRCLE_ICON} /></button> },
    { id: "new", node: <button type="button" className="flex size-9 items-center justify-center rounded-full border border-hairline" aria-label={t("ui.customize.item.new")}><Plus {...CIRCLE_ICON} /></button> },
  ];
  return (
    <div data-gallery-zone="sidebar" className="w-[280px] rounded-2xl border border-hairline bg-sidebar p-3 text-sidebar-ink">
      <div className="mb-3 flex items-center justify-end gap-2" data-sidebar-head="">
        {head.map(({ id, node }) => {
          if (hidden.has(id)) return null;
          return customizing
            ? <UiMovable key={id} zoneId="sidebar" id={id} label={t(`ui.customize.item.${id}` as LocaleKey)}>{node}</UiMovable>
            : <span key={id}>{node}</span>;
        })}
      </div>
      {!hidden.has("pinnedTiles") && (
        customizing
          ? (
            <UiMovable zoneId="sidebar" id="pinnedTiles" label={t("ui.customize.item.pinnedTiles")} className="mb-3 block w-full">
              <div data-sidebar-pinned="" className="grid grid-cols-3 gap-2 rounded-xl border border-dashed border-hairline p-2 text-[11px] text-sidebar-ink-secondary">
                <span>Ada</span><span>Nimbus</span><span>Cryptic</span>
              </div>
            </UiMovable>
          )
          : (
            <div data-sidebar-pinned="" className="mb-3 grid grid-cols-3 gap-2 rounded-xl border border-dashed border-hairline p-2 text-[11px] text-sidebar-ink-secondary">
              <span>Ada</span><span>Nimbus</span><span>Cryptic</span>
            </div>
          )
      )}
      {!hidden.has("builtin:general") && (
        customizing
          ? (
            <UiMovable zoneId="sidebar" id="builtin:general" label={t("ui.customize.item.section")} className="block w-full">
              <div data-sidebar-section-id="builtin:general" className="rounded-xl border border-hairline px-2 py-2 text-[13px]">General</div>
            </UiMovable>
          )
          : <div data-sidebar-section-id="builtin:general" className="rounded-xl border border-hairline px-2 py-2 text-[13px]">General</div>
      )}
    </div>
  );
}

function HeaderZone({ customizing }: { customizing: boolean }) {
  const ui = useUiCustomize();
  const headerZone = ui.draft.zones.conversationHeader;
  const titleVisible = conversationHeaderTitleVisible(headerZone);
  const controls = conversationHeaderControlOrder(headerZone);
  const byId: Record<string, ReactNode> = {
    botPanel: (
      <button type="button" data-chat-bot-panel="" className={CIRCLE_BUTTON} aria-label={t("ui.customize.item.botPanel")}>
        <PanelRight size={18} strokeWidth={1.75} aria-hidden="true" />
      </button>
    ),
    exportMenu: (
      <button type="button" data-chat-export="" className={CIRCLE_BUTTON} aria-label={t("ui.customize.item.exportMenu")}>
        <Ellipsis size={18} strokeWidth={1.75} aria-hidden="true" />
      </button>
    ),
    liveCall: (
      <span data-chat-live-call="" className="rounded-full border border-hairline px-2 py-1 text-[11px] text-ink-secondary">
        {t("ui.customize.item.liveCall")}
      </span>
    ),
    tasks: (
      <button type="button" data-chat-tasks="" className="rounded-full border border-hairline px-2.5 py-1 text-[12px]">
        {t("ui.customize.item.tasks")}
      </button>
    ),
  };
  const wrap = (id: string, node: ReactNode) => customizing
    ? <UiMovable key={id} zoneId="conversationHeader" id={id} label={t(`ui.customize.item.${id}` as LocaleKey)}>{node}</UiMovable>
    : <span key={id}>{node}</span>;
  const title = (
    <div data-chat-header-pill="" className="rounded-full border border-hairline bg-panel px-3 py-1.5 text-[13px] font-medium">
      Ada
    </div>
  );
  return (
    <div data-gallery-zone="conversationHeader" className="relative h-[120px] w-[720px] overflow-hidden rounded-2xl border border-hairline bg-app">
      <ChatHeaderBar
        align="center"
        center={titleVisible
          ? (customizing
            ? <UiMovable zoneId="conversationHeader" id="title" label={t("ui.customize.item.title")}>{title}</UiMovable>
            : title)
          : null}
      >
        <div data-chathead-controls="" className="flex items-center gap-2">
          {controls.map((id) => wrap(id, byId[id] ?? null))}
        </div>
      </ChatHeaderBar>
    </div>
  );
}

function BotPageZone({ customizing }: { customizing: boolean }) {
  const ui = useUiCustomize();
  const botZone = ui.draft.zones.botPage;
  const tabs = botProfileTabOrder(botZone)
    .map((id) => profileTabFromComponentId(id))
    .filter((id): id is "general" | "outcomes" | "knowledge" | "stats" => id !== null);
  const cards = botGeneralCardOrder(botZone);
  const panelTabs = botPanelTabOrder(botZone)
    .map((id) => panelTabFromComponentId(id))
    .filter((id): id is "activity" | "library" | "coding" => id !== null);
  const activeTab = (tabs[0] ?? "general") as "general" | "outcomes" | "knowledge" | "stats";
  const wrapTab = customizing
    ? (id: typeof activeTab, node: ReactNode) => (
        <UiMovable zoneId="botPage" id={profileTabComponentId(id)} label={t(`ui.customize.item.tab.${id}` as LocaleKey)}>
          {node}
        </UiMovable>
      )
    : undefined;
  const cardLabel: Record<string, LocaleKey> = {
    "card:settings": "ui.customize.item.card.settings",
    "card:channels": "ui.customize.item.card.channels",
    "card:accounts": "ui.customize.item.card.accounts",
    "card:more": "ui.customize.item.card.more",
  };
  return (
    <div data-gallery-zone="botPage" className="flex w-[720px] flex-col gap-4">
      <div data-bot-profile-page="" className="rounded-2xl border border-hairline bg-app p-4">
        <div className="mb-3 text-[15px] font-medium">Ada</div>
        {tabs.length > 0 ? (
          <PillTabs
            tabs={tabs}
            tab={activeTab}
            onTab={() => undefined}
            idPrefix="bot-profile"
            ariaLabel={t("botProfile.tabsAria")}
            data-bot-profile-tabs=""
            label={(id) => t(`botProfile.tab.${id}` as LocaleKey)}
            wrapTab={wrapTab}
            tabAttributes={(id) => ({ "data-bot-profile-tab": id })}
          />
        ) : null}
        <div className="mt-4 flex flex-col gap-3" data-bot-profile-panel="general">
          {cards.map((id) => {
            const node = (
              <div data-settings-group={`bot-profile-group-${id.replace("card:", "")}`} className="rounded-xl border border-hairline px-3 py-2 text-[13px]">
                {t(cardLabel[id] ?? "ui.customize.item.section")}
              </div>
            );
            return customizing
              ? (
                  <UiMovable key={id} zoneId="botPage" id={id} label={t(cardLabel[id] ?? "ui.customize.item.section")} className="block w-full">
                    {node}
                  </UiMovable>
                )
              : <div key={id}>{node}</div>;
          })}
        </div>
      </div>
      <div data-bot-panel-tabs="" className="rounded-2xl border border-hairline bg-panel p-3">
        <div className="mb-2 text-[12px] text-ink-secondary">{t("ui.customize.zone.botPage")}</div>
        <div role="tablist" className="flex flex-wrap items-center gap-1">
          {panelTabs.map((id) => {
            const button = (
              <button type="button" data-panel-tab={id} className="rounded-full bg-raised px-3 py-1 text-[13px]">
                {t(`botPanel.tab.${id}` as LocaleKey)}
              </button>
            );
            return customizing
              ? (
                  <UiMovable key={id} zoneId="botPage" id={panelTabComponentId(id)} label={t(`ui.customize.item.panel.${id}` as LocaleKey)}>
                    {button}
                  </UiMovable>
                )
              : <span key={id}>{button}</span>;
          })}
        </div>
      </div>
    </div>
  );
}

function Gallery() {
  const ui = useUiCustomize();
  useEffect(() => {
    if (customize && !ui.active) ui.begin();
  }, [customize, ui]);
  const customizing = ui.active || customize;
  return (
    <div className="flex flex-col gap-6" data-gallery-ui-customize="" data-gallery-zone={zone}>
      {zone === "composerBar" ? <ComposerZone customizing={customizing} />
        : zone === "sidebar" ? <SidebarZone customizing={customizing} />
          : zone === "conversationHeader" ? <HeaderZone customizing={customizing} />
            : <BotPageZone customizing={customizing} />}
      {showChrome && customizing ? <UiCustomizeChrome jiggleFrame={jiggleFrame} /> : null}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConfirmProvider>
      <UiCustomizeProvider>
        <div className="min-h-screen bg-app p-8 text-ink">
          <p className="mb-4 text-[13px] text-ink-secondary">{t("ui.customize.action")}</p>
          <Gallery />
        </div>
      </UiCustomizeProvider>
    </ConfirmProvider>
  </StrictMode>,
);
