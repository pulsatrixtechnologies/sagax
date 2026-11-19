/** Isolated gallery for Playwright screenshots of the composer's mode menu
 * (#4900) beside the account menu (the neighbour that conforms to the
 * reference): the real composer field (COMPOSER_PILL), the real chip
 * (ModelPickerTrigger) reading the mode's name, and the real ModeMenu in the
 * model menu's box with its side tooltip. Synthetic data only, demo accounts.
 * Not shipped in the app.
 * ?skin=<id>&lang=<code>&case=chip|menu&mode=<current mode>&providers=1|3|local
 * (the capture hovers a row with a real pointer, as a person would) */
import { StrictMode, useRef } from "react";
import { createRoot } from "react-dom/client";
import { BarChart3, ChevronRight, HelpCircle, Mic, Settings, UserRound, Wrench } from "lucide-react";
import { COMPOSER_PILL } from "../components/Composer.tsx-parts/ComposerEditor";
import { ATTACH_ICON, ComposerPlusMenu, RecordMark } from "../components/ComposerControls";
import { MODE_MENU_WIDTH, ModeMenu } from "../components/ModeMenu";
import { ModelPickerTrigger } from "../components/ModelPicker.tsx-parts/ModelPickerTrigger";
import { MENU_BOX, MENU_FIT_ROW, MENU_SURFACE, MenuDivider, MenuGlyph, menuRow } from "../components/menu-look";
import { cn } from "../lib/cn";
import { loadLocale, t } from "../lib/i18n";
import { modeName, type ModelMode } from "../lib/model-mode";
import { trackInputModality } from "../lib/input-modality";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import type { ModeModel, ModeResolution } from "../../shared/model-mode";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");
const which = params.get("case") ?? "menu";
// the menu opens from a click on the chip, as in the app: its first focus is the pointer's
trackInputModality();
document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
const current = (params.get("mode") ?? "expert") as ModelMode | "pinned";
const providers = params.get("providers") ?? "1";

const m = (engineLabel: string, modelLabel: string): ModeModel => ({ instanceId: engineLabel.toLowerCase(), model: modelLabel.toLowerCase().replace(/\W+/g, "-"), engineLabel, modelLabel });
const grok = m("Grok", "Grok 4.7");
// what Sagax maps each mode to, per kind of person (demo providers, no accounts shown)
const resolutions: Record<ModelMode, ModeResolution> = providers === "3"
  ? {
      auto: { mode: "auto", pick: m("Claude", "Claude Opus 5.5") },
      fast: { mode: "fast", pick: m("Grok", "Grok 4 Fast"), effort: "low" },
      expert: { mode: "expert", pick: m("OpenAI", "GPT-6 Astra"), effort: "high" },
      heavy: { mode: "heavy", pick: m("OpenAI", "GPT-6 Astra"), effort: "high", team: [m("OpenAI", "GPT-6 Astra"), m("Claude", "Claude Opus 5.5"), grok] },
      build: { mode: "build", pick: m("OpenAI", "GPT-5.5 Codex") },
    }
  : providers === "local"
    ? {
        auto: { mode: "auto", pick: m("Local server", "Qwen3.5 122B A10B") },
        fast: { mode: "fast", pick: m("Local server", "Qwen3 Coder 30B A3B"), effort: "low" },
        expert: { mode: "expert", pick: m("Local server", "Qwen3.5 122B A10B"), effort: "high" },
        heavy: { mode: "heavy", pick: m("Local server", "Qwen3.5 122B A10B"), team: Array(3).fill(m("Local server", "Qwen3.5 122B A10B")) },
        build: { mode: "build", pick: m("Local server", "Qwen3 Coder 30B A3B") },
      }
    : {
        auto: { mode: "auto", pick: grok },
        fast: { mode: "fast", pick: grok, effort: "low" },
        expert: { mode: "expert", pick: grok, effort: "high" },
        heavy: { mode: "heavy", pick: grok, effort: "high", team: [grok, grok, grok] },
        build: { mode: "build", pick: grok },
      };

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

function Chip({ open }: { open: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  const label = current === "pinned" ? "Claude Opus 5.5" : modeName(current);
  return ModelPickerTrigger({
    windowOnly: false, inComposer: true, headless: false, contained: false, bot: { id: "demo", busy: false } as never, triggerRef: ref, menu: open,
    toggleMenu: () => {}, composerLabel: label, followLine: "", summary: label, selection: { instanceId: "demo", model: "demo" }, autoOn: true,
    autoRecord: null, autoInstance: undefined, active: undefined, showActiveAccount: false, selectedVariantLabel: undefined, advanced: false,
  });
}

function Gallery() {
  const open = which === "menu";
  return (
    <div className="flex min-h-screen flex-col gap-6 bg-app p-4 text-ink sm:flex-row sm:p-8">
      <div className="sm:w-[260px]"><Account /></div>
      <div className="relative mt-auto flex min-w-0 flex-1 flex-col justify-end sm:pt-[330px]">
        {open && (
          <div data-model-menu="" data-gallery-menu="" style={{ width: MODE_MENU_WIDTH }} className={cn("absolute bottom-[58px] right-0 z-10 overflow-visible py-0", MENU_BOX)}>
            <ModeMenu current={current === "pinned" ? null : current} pinnedLabel="Claude Opus 5.5" resolutions={resolutions} onPick={() => {}} manage={{ onManage: () => {}, turnedOff: 2 }} />
          </div>
        )}
        <div data-tour="composer" className={COMPOSER_PILL}>
          <div className="flex items-end gap-1">
            <ComposerPlusMenu items={[
              { id: "attach", label: t("composer.plus.attach"), icon: ATTACH_ICON, onSelect: () => {} },
              { id: "teach", label: t("composer.plus.teach"), icon: <RecordMark />, onSelect: () => {} },
            ]} />
            <textarea rows={1} placeholder="Message Wren · Assistant" className="block min-h-6 w-full flex-1 resize-none bg-transparent chat-input-text px-1 py-1.5 placeholder:text-ink-secondary focus:outline-none" />
            <span data-gallery-chip="" className="flex items-center"><Chip open={open} /></span>
            <span className="flex size-7 items-center justify-center rounded-full bg-ink/[0.06] text-ink-secondary"><Mic size={16} aria-hidden="true" /></span>
          </div>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Gallery /></StrictMode>);
