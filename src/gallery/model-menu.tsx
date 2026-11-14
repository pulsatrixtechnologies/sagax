/** Isolated gallery for Playwright screenshots of the composer's model menu
 * in its two steps (#4329: provider, then model) over a mock chat bar.
 * Not shipped in the app.
 * ?skin=<id>&lang=<code>&q=<search>&favorites=1&narrow=1
 * &path=<provider>: open at that provider's models (anthropic, openai, xai,
 *   server:home, computer)
 * &line=effort|runsWith: open that line of the footer
 * &mode=before: the menu as origin/main drew it before #3116 (340 px,
 *   provider submenus, fixed footer with no floor under the list)
 * &open=<provider key>: with mode=before, click that submenu
 * &broken=1: the bot's model does not respond (src/lib/model-health.ts) */
import { StrictMode, useEffect, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { ChevronDown, ChevronRight, Mic, Monitor, Plus } from "lucide-react";
import { ModelSearchList, type ModelMenuRow, type ModelMenuSection } from "../components/ModelMenu";
import { ModelMenuSettings } from "../components/ModelMenuSettings";
import { runsWithLabels } from "../components/ModelPicker.tsx-parts/ModelPickerMenu";
import { InstanceProviderMark, PresetProviderMark } from "../components/ProviderIcons";
import { loadLocale, t } from "../lib/i18n";
import { localModelSubtext } from "../lib/local-model-label";
import { favoriteKey, toggleModelFavorite, useModelFavorites, writeModelFavorites } from "../lib/model-favorites";
import { runsWithEntries } from "../lib/model-menu-steps";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { XAI_GROUP_LABEL } from "../../shared/model-provider";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "fr");
writeModelFavorites(params.get("favorites") === "1" ? [favoriteKey("claude", "claude-opus-5-5"), favoriteKey("grok", "grok-4.7")] : []);

const model = (instanceId: string, id: string, label: string, extra: Partial<ModelMenuRow> = {}): ModelMenuRow => ({
  key: favoriteKey(instanceId, id), kind: "model", instanceId, modelId: id, label, current: false, ...extra,
});
const defaultTag = t("model.defaultTag");
const before = params.get("mode") === "before";
const high = t("model.effortLevel.high");
const medium = t("model.effortLevel.medium");
// Claude: the sign-in, a key and pi, pooled: one model, one row; the
// others ride on it ("Runs with").
const viaClaude = (id: string, label: string, extra: Partial<ModelMenuRow> = {}) => model("claude", id, label, {
  harness: "claudeAgent", ...extra,
  alternatives: [model("claudeApi", id, label, { harness: "claudeAgent" }), model("pi", `anthropic/${id}`, label, { harness: "piAgent" })],
});
const sections: ModelMenuSection[] = [
  { key: "top", rows: [
    ...(params.get("keep") === "1" ? [{ key: "keep", kind: "keep" as const, label: t("teamSettings.keepModel"), current: true }] : []),
    { key: "auto", kind: "auto", label: t("model.auto.label"), detail: t("model.auto.rowHint"), current: false },
    { key: "follow", kind: "follow", label: t("model.useBotModel", { name: "Nimbus" }), detail: "Claude Sonnet 5", current: false,
      warning: params.get("broken") === "1" ? t("model.notResponding") : undefined },
  ] },
  { key: "anthropic", label: "Claude", rows: [
    viaClaude("claude-fable-5-2", "Claude Fable 5.2", { detail: high, current: true }),
    viaClaude("claude-fable-5-1", "Claude Fable 5.1", { detail: high }),
    viaClaude("claude-opus-5-5", "Claude Opus 5.5", { detail: high }),
    viaClaude("claude-sonnet-5-5", "Claude Sonnet 5.5", { detail: medium }),
    viaClaude("claude-sonnet-5", "Claude Sonnet 5", { detail: medium, tags: [defaultTag] }),
    viaClaude("claude-haiku-5-5", "Claude Haiku 5.5"),
  ] },
  { key: "openai", label: "OpenAI", rows: [
    model("codex", "gpt-5.6", "GPT-5.6", { detail: medium, harness: "codex" }), model("codex", "gpt-5.6-mini", "GPT-5.6 mini", { harness: "codex" }),
  ] },
  { key: "xai", label: XAI_GROUP_LABEL, rows: [
    model("grok", "grok-4.7", "Grok 4.7", { detail: high, harness: "grokAgent" }), model("grok", "grok-4.5", "Grok 4.5", { detail: high, harness: "grokAgent" }),
  ] },
  { key: "server:home", label: "Home server", rows: [
    model("compat-home", "qwen3-coder", "Qwen3 Coder", { harness: "openai-compat" }),
  ] },
  // The model name alone (2026-10-26); "(Shared by …)" for another person's
  // computer; the server only when two servers share a name.
  { key: "computer", label: t("model.computerProvider"), rows: [
    model("claude", "desk8000ab::Ornith-1.5-122B-oQ4e-mtp", "Ornith-1.5-122B-oQ4e-mtp", { harness: "claudeAgent" }),
    model("claude", "desk8000cd::Qwen3-Coder-Next", "Qwen3-Coder-Next", { harness: "claudeAgent", subtext: localModelSubtext({ sharedBy: "Camille Tremblay-Lachance" }) }),
    model("claude", "desk8000ab::Gemma-4", "Gemma-4", { harness: "claudeAgent", subtext: "oMLX" }),
  ] },
];

const MARKS: Record<string, ReactNode> = {
  anthropic: <PresetProviderMark preset="anthropic" size={14} />, openai: <PresetProviderMark preset="openai" size={14} />,
  xai: <PresetProviderMark preset="xai" size={14} />, "server:home": <InstanceProviderMark instance={{ driverKind: "openai-compat" }} size={14} />,
  computer: <Monitor size={14} aria-hidden="true" />,
};
let lineOpened = false;
const pathProvider = params.get("path") ?? undefined;
const initialPath = pathProvider ? { provider: pathProvider } : {};

/** The chat bar under the menu, for the side-by-side: the chip names the
 * model (its provider when the name does not say it). */
function ChatBar({ narrow }: { narrow: boolean }) {
  const chip = `Claude Fable 5.2 ${high}`;
  return (
    <div data-chat-bar
      style={narrow ? { left: 8, right: 8, bottom: 8 } : { left: 24, right: 24, bottom: 16 }}
      className="fixed z-40 rounded-[22px] border-[0.5px] border-border bg-composer px-2 py-1.5 shadow-[0_2px_8px_-1px_#0000000d,0_1px_2px_#00000008]">
      <div className="px-2 py-2 text-[15px] text-ink-secondary">{t("composer.placeholder.bot", { name: "Nimbus" })}</div>
      <div className="flex items-center gap-1">
        <span className="flex size-8 items-center justify-center rounded-full text-ink-secondary"><Plus size={18} aria-hidden="true" /></span>
        <span data-chat-bar-chip aria-expanded="true"
          className="flex max-w-full items-center gap-1 rounded-lg bg-raised px-1.5 py-1 text-[13px] text-ink">
          <span className="truncate">{chip}</span>
          <ChevronDown size={14} className="shrink-0 rotate-180" aria-hidden="true" />
        </span>
        <span className="flex-1" />
        <span className="flex size-8 items-center justify-center rounded-full text-ink-secondary"><Mic size={18} aria-hidden="true" /></span>
      </div>
    </div>
  );
}

function Gallery() {
  const keys = useModelFavorites();
  useEffect(() => {
    const open = params.get("open");
    const query = params.get("q");
    const input = document.querySelector<HTMLInputElement>("[data-model-search]");
    if (query && input) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, query);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (open) setTimeout(() => document.querySelector<HTMLElement>(`[data-model-provider="${open}"]`)?.click(), 50);
    // once: StrictMode runs this effect twice, and a second click would close the line
    const line = params.get("line");
    if (line && !lineOpened) {
      lineOpened = true;
      setTimeout(() => document.querySelector<HTMLElement>(`[data-model-line="${line === "runsWith" ? "runs-with" : line}"]`)?.click(), 50);
    }
  }, []);
  const narrow = params.get("narrow") === "1";
  const runsWith = runsWithLabels(runsWithEntries(sections), () => {});
  const footer = (
    <>
      <ModelMenuSettings
        effort={{ title: t("model.thinkingEffort"), levels: ["low", "medium", "high", "xhigh", "max"], value: "high", modelDefault: "high", onPick: () => {} }}
        runsWith={runsWith} />
      <div className="border-t border-popover-hairline px-1.5 pt-1">
        <div className="flex min-h-8 items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-[13px] text-popover-ink">
          <span>{t("model.manage")}</span>
          <ChevronRight size={14} aria-hidden="true" className="text-popover-ink-secondary" />
        </div>
      </div>
    </>
  );
  const bottom = narrow ? 92 : 100;
  const width = before ? 340 : 420;
  return (
    <div className="min-h-dvh bg-app p-4">
      <ChatBar narrow={narrow} />
      <div data-model-menu
        style={narrow ? { left: 8, right: 8, bottom } : { left: 24, bottom, width }}
        className={`fixed z-50 flex flex-col overflow-hidden rounded-xl border border-popover-hairline popover-surface bg-popover py-1 text-popover-ink shadow-2xl shadow-black/50 ${
          before ? "max-h-[min(392px,calc(100dvh-96px))]" : "max-h-[min(520px,calc(100dvh-120px))]"}`}>
        {before ? (
          <ModelSearchList variant="popover" autoFocus submenus sections={sections} onPick={() => {}}
            favorites={{ keys, onToggle: (row) => toggleModelFavorite(row.key) }}
            after={footer} />
        ) : (
          <ModelSearchList variant="popover" autoFocus showAll sections={sections} onPick={() => {}}
            custom={params.get("custom") === "1" ? { label: (text: string) => t("code.launch.useModel", { model: text }), onPick: () => {} } : undefined}
            favorites={{ keys, onToggle: (row) => toggleModelFavorite(row.key) }}
            steps={{ mark: (key) => MARKS[key] ?? null, initialPath }}
            listMinHeight={240}
            after={footer} />
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Gallery /></StrictMode>);
