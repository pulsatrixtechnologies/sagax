/** Isolated gallery for Playwright screenshots of the composer's edge beside
 * the account menu's: the composer field (its real class, COMPOSER_PILL), the
 * real + menu open above it, the model menu's real box (MENU_BOX) around the
 * real model list, the pinned card's edge (`menu-edge`) and the account
 * menu's surface (MENU_SURFACE and its rows). Not shipped in the app.
 * ?skin=<id>&lang=<code>&case=idle|focus|plus|model|pinned */
import { StrictMode, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { ChevronRight, HelpCircle, Settings, UserRound, BarChart3, Wrench, Mic } from "lucide-react";
import { COMPOSER_PILL } from "../components/Composer.tsx-parts/ComposerEditor";
import { ATTACH_ICON, ComposerPlusMenu, RecordMark } from "../components/ComposerControls";
import { ModelSearchList, type ModelMenuRow, type ModelMenuSection } from "../components/ModelMenu";
import { MENU_BOX, MENU_FIT_ROW, MENU_SURFACE, MenuDivider, MenuGlyph, menuRow } from "../components/menu-look";
import { cn } from "../lib/cn";
import { loadLocale, t } from "../lib/i18n";
import { favoriteKey } from "../lib/model-favorites";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");
const which = params.get("case") ?? "idle";

const model = (id: string, label: string, extra: Partial<ModelMenuRow> = {}): ModelMenuRow => ({
  key: favoriteKey("claude", id), kind: "model", instanceId: "claude", modelId: id, label, current: false, harness: "claudeAgent", ...extra,
});
const sections: ModelMenuSection[] = [
  { key: "top", rows: [
    { key: "auto", kind: "auto", label: t("model.auto.label"), detail: t("model.auto.rowHint"), current: false },
  ] },
  { key: "anthropic", label: "Claude", rows: [
    model("claude-fable-5-2", "Claude Fable 5.2", { current: true }),
    model("claude-opus-5-5", "Claude Opus 5.5"),
    model("claude-sonnet-5-5", "Claude Sonnet 5.5"),
  ] },
];

function Account() {
  const row = (icon: React.ReactNode, label: string, chevron = false) => (
    <div role="menuitem" className={menuRow()}>
      <MenuGlyph>{icon}</MenuGlyph>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {chevron && <ChevronRight size={14} aria-hidden="true" className="shrink-0 text-ink-tertiary" />}
    </div>
  );
  return (
    <div role="menu" data-account-menu className={cn(MENU_SURFACE, MENU_FIT_ROW)}>
      {row(<BarChart3 size={16} />, "Usage", true)}
      {row(<HelpCircle size={16} />, "Help", true)}
      {row(<Settings size={16} />, "Settings")}
      {row(<Wrench size={16} />, "Tools", true)}
      <MenuDivider />
      {row(<UserRound size={16} />, "Switch account", true)}
    </div>
  );
}

function Pill({ focused }: { focused: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (focused) ref.current?.focus(); }, [focused]);
  return (
    <div data-tour="composer" className={COMPOSER_PILL}>
      <div className="flex items-end gap-1">
        <ComposerPlusMenu
          initialOpen={which === "plus"}
          items={[
            { id: "attach", label: t("composer.plus.attach"), icon: ATTACH_ICON, onSelect: () => {} },
            { id: "teach", label: t("composer.plus.teach"), icon: <RecordMark />, onSelect: () => {} },
          ]}
        />
        <textarea ref={ref} rows={1} placeholder="Type your answer…" className="block min-h-6 w-full flex-1 resize-none bg-transparent chat-input-text px-1 py-1.5 placeholder:text-ink-secondary focus:outline-none" />
        <span className="flex size-7 items-center justify-center rounded-full bg-ink/[0.06] text-ink-secondary"><Mic size={16} aria-hidden="true" /></span>
      </div>
    </div>
  );
}

function Gallery() {
  return (
    <div className="flex min-h-screen flex-col gap-6 bg-app p-4 text-ink sm:flex-row sm:p-8">
      <div className="sm:w-[260px]"><Account /></div>
      <div className="relative mt-auto flex min-w-0 flex-1 flex-col justify-end sm:pt-[280px]">
        {which === "model" && (
          <div data-model-box className={cn("absolute bottom-[56px] left-0 w-[min(360px,100%)] overflow-hidden py-1", MENU_BOX)}>
            <ModelSearchList sections={sections} onPick={() => {}} variant="popover" label="Model" />
          </div>
        )}
        {which === "pinned" && (
          <div data-pinned-edge className="mb-2 rounded-3xl menu-edge bg-composer px-4 py-3 text-[14px]">Which environment should I use?</div>
        )}
        <Pill focused={which === "focus"} />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Gallery /></StrictMode>);
