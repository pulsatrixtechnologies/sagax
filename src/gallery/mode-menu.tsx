/** Isolated gallery for headless captures of the chat bar and its mode menu
 * (#4900, #5088, #5372): the real composer field (COMPOSER_PILL) holding the
 * +, the field and the voice button; under it the quiet row with the real
 * chip (ModelPickerTrigger) reading the mode and its reasoning level, and the
 * real context and usage meter (ComposerMeterView); the real ModelPanel with
 * its modes (Auto, Fast, Expert, Heavy, Favorites, Reasoning, All models) in the
 * model menu's box, its sections built by the real buildModelPickerSections
 * from demo accounts (two Claude accounts, one more signed out, Grok, OpenAI).
 * Synthetic data only. Not shipped in the app.
 * ?skin=<id>&lang=<code>&mode=auto|fast|expert|heavy|pinned&view=short|all
 * &open=0 (the bar at rest, no menu) &meter=context|usage (a detail open)
 * &place=left|right (the bar at a side of the window)
 * &settings=modes (Settings > Models > Modes alone; &set=1 with choices made)
 * (the capture hovers a row with a real pointer, as a person would) */
import { StrictMode, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AudioLines } from "lucide-react";
import { COMPOSER_PILL } from "../components/Composer.tsx-parts/ComposerEditor";
import { ATTACH_ICON, ComposerMicButton, ComposerPlusMenu, RecordMark, SECONDARY_CIRCLE } from "../components/ComposerControls";
import { ModelPanel } from "../components/ModelPanel";
import { ClaudeMark, ProviderMonogram } from "../components/ProviderIcons";
import { ModelPickerTrigger } from "../components/ModelPicker.tsx-parts/ModelPickerTrigger";
import { MENU_WIDTH } from "../components/ModelPicker.tsx-parts/helpers";
import { buildModelPickerSections } from "../components/ModelPicker.tsx-parts/buildSections";
import { MENU_BOX } from "../components/menu-look";
import { cn } from "../lib/cn";
import { loadLocale, t } from "../lib/i18n";
import { chatBarChipLabel, type ModelMode } from "../lib/model-mode";
import { ComposerMeterView } from "../components/ComposerMeter";
import { MENU_ROW } from "../components/menu-look";
import type { PlanRow } from "../lib/plan-usage";
import { ComposerVoiceButton } from "../components/ComposerVoiceButton";
import { ModesSettingsView, type ModeEngine } from "../components/settings/ModesSettings";
import type { ModeModels } from "../../shared/mode-models";
import { trackInputModality } from "../lib/input-modality";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import type { ModeModel, ModeResolution } from "../../shared/model-mode";
import type { InstanceInfo } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");
// the menu opens from a click on the chip, as in the app: its first focus is the pointer's
trackInputModality();
document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
const current = (params.get("mode") ?? "auto") as ModelMode | "pinned";
const view = params.get("view") === "all" ? "all" : "short";
// place=left: a composer at the window's left, so the cascade has the room to open to the right (#5338)
const atLeft = params.get("place") === "left";
// place=right: a bar at the window's right, where the cascade has to open to the left
const atRight = params.get("place") === "right";
const menuOpen = params.get("open") !== "0";
const meterOpen = params.get("meter") === "context" ? "context" as const : params.get("meter") === "usage" ? "usage" as const : null;

const engine = (instanceId: string, driverKind: string, displayName: string, email: string | undefined, options: Array<[string, string]>, authenticated = true): InstanceInfo => ({
  instanceId, displayName, driverKind, access: "subscription",
  snapshot: { state: "available", authenticated, ...(email ? { account: { email } } : {}) },
  models: { default: options[0]?.[0] ?? "", options: options.map(([id, label]) => ({ id, label, contextWindow: 1_000_000 })) },
  capabilities: { effortLevels: ["low", "medium", "high", "xhigh", "max"] },
} as unknown as InstanceInfo);
const claudeModels: Array<[string, string]> = [["claude-fable-5-2", "Claude Fable 5.2"], ["claude-opus-5-5", "Claude Opus 5.5"], ["claude-sonnet-5-5", "Claude Sonnet 5.5"]];
const instances = [
  engine("claude-personal", "claudeAgent", "ada@example.com", "ada@example.com", claudeModels),
  engine("claude-team", "claudeAgent", "ada.admin@acme.test", "ada.admin@acme.test", [["claude-mythos-5-2", "Claude Mythos 5.2"], ...claudeModels]),
  engine("claude-old", "claudeAgent", "old@example.com", "old@example.com", claudeModels, false),
  engine("grok", "grokAgent", "Grok", undefined, [["grok-4.7", "Grok 4.7"], ["grok-4-fast", "Grok 4 Fast"], ["grok-code-2", "Grok Code 2"]]),
  engine("codex", "codex", "Codex", undefined, [["gpt-6-astra", "GPT-6 Astra"], ["gpt-5.5-codex", "GPT-5.5 Codex"]]),
  // signed out: its provider has nothing usable, so All models does not list it
  engine("gemini", "geminiAgent", "Gemini", undefined, [["gemini-3-pro", "Gemini 3 Pro"]], false),
];
// two local servers: "Local" is a provider, its servers where the accounts are
(instances[3]!.models.options as unknown as Array<Record<string, unknown>>).push(
  { id: "studio::qwen-flash-next", label: "Qwen Flash-Next", local: true, server: "Studio", loaded: true },
  { id: "mini::qwen-coder-30b", label: "Qwen Coder 30B", local: true, server: "Mini" },
);

const m = (instanceId: string, engineLabel: string, modelLabel: string): ModeModel => ({ instanceId, model: modelLabel.toLowerCase().replace(/\W+/g, "-"), engineLabel, modelLabel });
const resolutions: Record<ModelMode, ModeResolution> = {
  auto: { mode: "auto", pick: m("claude-personal", "Claude", "Claude Opus 5.5") },
  fast: { mode: "fast", pick: m("grok", "Grok", "Grok 4 Fast"), effort: "low" },
  expert: { mode: "expert", pick: m("codex", "OpenAI", "GPT-6 Astra"), effort: "high" },
  heavy: { mode: "heavy", pick: m("codex", "OpenAI", "GPT-6 Astra"), effort: "high",
    team: [m("codex", "OpenAI", "GPT-6 Astra"), m("claude-personal", "Claude", "Claude Fable 5.2"), m("claude-team", "Claude", "Claude Opus 5.5"), m("grok", "Grok", "Grok 4.7")] },
  build: { mode: "build", pick: m("grok", "Grok", "Grok Code 2") },
};

function Chip({ label }: { label: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  return ModelPickerTrigger({
    windowOnly: false, inComposer: true, headless: false, contained: false, bot: { id: "demo", busy: false } as never, triggerRef: ref, menu: true,
    toggleMenu: () => {}, composerLabel: label, followLine: "", summary: label, selection: { instanceId: "demo", model: "demo" }, autoOn: current !== "pinned",
    autoRecord: null, autoInstance: undefined, active: undefined, showActiveAccount: false, selectedVariantLabel: undefined, advanced: false,
  });
}

const meterWindow = (used: number, hours: number) => ({ available: true, remainingPercent: 100 - used, usedPercent: used, resetsAt: new Date(Date.parse("2026-11-25T17:00:00Z") + hours * 3_600_000).toISOString() });
const meterRow: PlanRow = {
  id: "claude", name: "ada@example.com", driver: "claude", plan: "Max", state: "windows", access: "subscription", instanceId: "claude", instanceIds: ["claude"],
  message: null, fiveHour: meterWindow(31, 2.5), weekly: meterWindow(89, 52), extra: [], models: [],
};

/** Settings > Providers > Models > Modes, alone (?settings=modes). */
function ModesGallery() {
  const [value, setValue] = useState<ModeModels>(params.get("set") === "1"
    ? { fast: { instanceId: "grok", model: "grok-4-fast", effort: "low" }, heavy: [{ instanceId: "claude-team", model: "claude-opus-5-5" }, { instanceId: "grok", model: "grok-4.7" }] }
    : {});
  const engines: ModeEngine[] = instances.filter((instance) => instance.snapshot.authenticated !== false).map((instance) => ({
    instanceId: instance.instanceId,
    name: [instance.displayName, instance.snapshot.account?.email].filter((part, index, parts) => part && parts.indexOf(part) === index).join(" · "),
    models: instance.models.options.map((option) => ({ id: option.id, label: option.label, effortLevels: ["low", "medium", "high"] as const })),
  }));
  return (
    <div className="min-h-screen bg-app p-8 text-ink">
      <span data-gallery-chip="" aria-hidden="true" className="block size-px" />
      <div data-gallery-modes-settings="" className="mx-auto max-w-[720px]">
        <ModesSettingsView value={value} engines={engines} favorites={["grok\u0000grok-4.7", "claude-team\u0000claude-mythos-5-2"]} onChange={setValue} onReset={() => setValue({})} busy={false} error={null} />
      </div>
    </div>
  );
}

function Gallery() {
  const autoOn = current !== "pinned";
  const selection = { instanceId: "claude-team", model: "claude-opus-5-5", ...(autoOn ? { auto: true as const } : {}), ...(autoOn && current !== "auto" ? { mode: current } : {}) };
  const [stars, setStars] = useState<string[]>(["grok\u0000grok-4.7", "claude-team\u0000claude-mythos-5-2"]);
  const bot = { id: "bot-1", name: "Wren", threadId: "t1", modelSelection: selection, tasks: [] };
  const sections = buildModelPickerSections({
    orgMode: false, accountModels: new Map(), selection, switches: {}, autoOn, follows: undefined, selectedVariantLabel: undefined,
    fallback: undefined, instances, selectable: instances, viewerLocal: false, autoPreview: null, autoRecord: null,
    profile: bot as never, botModelInstance: instances[1], botModelName: "", health: { orgMode: false, myEngines: null },
    myEngines: null, ranOnName: () => "", favoriteKeys: stars,
  }).menuSections;
  const pinnedLabel = "Claude Opus 5.5 · ada.admin@acme.test";
  const chip = current === "pinned" ? "Claude Opus 5.5" : chatBarChipLabel(current, current === "auto" ? undefined : resolutions[current].effort);
  return (
    <div className="flex min-h-screen flex-col bg-app p-4 text-ink sm:p-8">
      <div className={cn("relative mt-auto flex w-full min-w-0 flex-col justify-end pt-[560px]", atLeft ? "mr-auto max-w-[600px]" : atRight ? "ml-auto max-w-[600px]" : "mx-auto max-w-[760px]")}>
        {menuOpen && <div data-model-menu="" data-gallery-menu="" style={{ width: MENU_WIDTH }} className={cn("absolute bottom-[34px] left-0 z-10 py-1 text-popover-ink", MENU_BOX)}>
          <ModelPanel
            sections={sections}
            onPick={() => undefined}
            favorites={{ keys: stars, onToggle: (candidate) => setStars((list) => (list.includes(candidate.key) ? list.filter((key) => key !== candidate.key) : [...list, candidate.key])) }}
            mark={(key) => (key === "anthropic" || key === "claude" ? <ClaudeMark size={14} /> : <ProviderMonogram label={key === "xai" ? "Grok" : key === "computer" ? "Local" : "OpenAI"} />)}
            autoOn={autoOn}
            effort={{ title: t("model.reasoning"), levels: ["low", "medium", "high", "xhigh", "max"], modelDefault: "high", onPick: () => undefined }}
            manage={{ onManage: () => undefined, turnedOff: 3, openProviders: () => undefined }}
            showSettings
            view={view}
            modes={{ current: current === "pinned" ? null : current, resolutions, onPick: () => undefined, ...(current === "pinned" ? { pinnedLabel } : {}) }}
          />
        </div>}
        <div data-tour="composer" className={COMPOSER_PILL}>
          <div className="flex items-end gap-1">
            <ComposerPlusMenu items={[
              { id: "attach", label: t("composer.plus.attach"), icon: ATTACH_ICON, onSelect: () => {} },
              { id: "teach", label: t("composer.plus.teach"), icon: <RecordMark />, onSelect: () => {} },
            ]} />
            <textarea rows={1} placeholder="Message Wren · Assistant" className="block min-h-6 w-full flex-1 resize-none bg-transparent chat-input-text px-1 py-1.5 placeholder:text-ink-secondary focus:outline-none" />
            {/* the one voice button (ComposerVoiceButton.tsx): its face, its arrow, its menu */}
            <ComposerVoiceButton engine="xai"
              dictation={<ComposerMicButton onClick={() => undefined} engine="xai" shortcut="⌘D" />}
              conversation={<button type="button" data-composer-voice="" aria-label="Voice" className={SECONDARY_CIRCLE}><AudioLines size={16} aria-hidden="true" /></button>} />
          </div>
        </div>
        {/* the quiet row under the box (ComposerUnderRow.tsx): the chip, then the meter at its end */}
        <div data-composer-under-row="" className="@container/composer relative z-[1] w-full">
          <div className="flex min-h-7 items-center gap-2 px-2 pt-1">
            <span data-gallery-chip="" className="flex items-center"><Chip label={chip} /></span>
            <span className="ml-auto flex min-w-0 items-center">
              <ComposerMeterView
                initialOpen={meterOpen}
                context={{ percent: 42, detail: t("chat.usage.contextOfWindow", { tokens: "84k", percent: "42", window: "200k" }) }}
                usage={{
                  percent: 89, tone: "warning", row: meterRow, favorite: { id: "claude", onToggle: () => undefined },
                }}
                contextActions={<button type="button" className={MENU_ROW}>{t("contextWarning.compactNow")}</button>}
                usageActions={() => (
                  <>
                    <button type="button" role="menuitem" className={MENU_ROW}>{t("sendBlock.switchEngine")}</button>
                    <button type="button" role="menuitem" className={MENU_ROW}>{t("chat.notice.weekly.more")}</button>
                  </>
                )}
              />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

const Shown = params.get("settings") === "modes" ? ModesGallery : Gallery;
createRoot(document.getElementById("root")!).render(<StrictMode><Shown /></StrictMode>);
