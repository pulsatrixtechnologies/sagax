/** Isolated gallery for Playwright screenshots of the composer's model menu
 * with its provider submenus and favorites. Not shipped in the app.
 * ?skin=<id>&lang=<code>&open=<provider key>&q=<search>&favorites=1&narrow=1
 * &broken=1: the bot's model does not respond (src/lib/model-health.ts) */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { ChevronRight } from "lucide-react";
import { ModelSearchList, type ModelMenuRow, type ModelMenuSection } from "../components/ModelMenu";
import { loadLocale, t } from "../lib/i18n";
import { localModelSubtext } from "../lib/local-model-label";
import { favoriteKey, toggleModelFavorite, useModelFavorites, writeModelFavorites } from "../lib/model-favorites";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
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
const sections: ModelMenuSection[] = [
  { key: "top", rows: [
    ...(params.get("keep") === "1" ? [{ key: "keep", kind: "keep" as const, label: t("teamSettings.keepModel"), current: true }] : []),
    { key: "auto", kind: "auto", label: t("model.auto.label"), detail: t("model.auto.rowHint"), current: false },
    { key: "follow", kind: "follow", label: t("model.useBotModel", { name: "Dispatch" }), detail: "Claude Sonnet 5", current: true,
      warning: params.get("broken") === "1" ? t("model.notResponding") : undefined },
  ] },
  { key: "claude", label: "Claude (API key)", rows: [
    model("claude", "claude-fable-5-1", "Claude Fable 5.1", { detail: "Élevé" }),
    model("claude", "claude-fable-5", "Claude Fable 5", { detail: "Élevé" }),
    model("claude", "claude-opus-5-5", "Claude Opus 5.5", { detail: "Élevé" }),
    model("claude", "claude-opus-5", "Claude Opus 5", { detail: "Élevé" }),
    model("claude", "claude-sonnet-5-5", "Claude Sonnet 5.5", { detail: "Moyen" }),
    model("claude", "claude-sonnet-5", "Claude Sonnet 5", { detail: "Moyen", tags: [defaultTag] }),
    model("claude", "claude-haiku-5-5", "Claude Haiku 5.5"),
    model("claude", "claude-haiku-4-5", "Claude Haiku 4.5"),
  ] },
  { key: "grok", label: "Grok", rows: [model("grok", "grok-4.7", "Grok 4.7", { detail: "Élevé" }), model("grok", "grok-4.5", "Grok 4.5", { detail: "Élevé" })] },
  { key: "codex", label: "OpenAI", rows: [model("codex", "gpt-5.6", "GPT-5.6", { detail: "Moyen" }), model("codex", "gpt-5.6-mini", "GPT-5.6 mini")] },
  // The model name alone (2026-10-26); "(Shared by …)" for another person's
  // computer; the server only when two servers share a name.
  { key: "local:this-computer", label: t("model.localGroup"), rows: [
    model("claude", "desk8000ab::Ornith-1.5-122B-oQ4e-mtp", "Ornith-1.5-122B-oQ4e-mtp"),
    model("claude", "desk8000ab::Ornith-1.5-35B-A3B-oQ4e-mtp", "Ornith-1.5-35B-A3B-oQ4e-mtp"),
    model("claude", "desk8000cd::Qwen3-Coder-Next", "Qwen3-Coder-Next", { subtext: localModelSubtext({ sharedBy: "Camille Tremblay-Lachance" }) }),
    model("claude", "desk8000ab::Gemma-4", "Gemma-4", { subtext: "oMLX" }),
    model("claude", "desk8002ab::Gemma-4", "Gemma-4", { subtext: ":8002" }),
  ] },
];

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
  }, []);
  const narrow = params.get("narrow") === "1";
  const flat = params.get("flat") === "1";
  const footer = (
    <>
      <div className="border-t border-popover-hairline px-1.5 py-1">
        <div className="flex min-h-8 items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-[13px] text-popover-ink">
          <span>{t("model.effort")}</span>
          <span className="text-popover-ink-secondary">{t("model.effortLevel.high")}</span>
        </div>
      </div>
      <div className="border-t border-popover-hairline px-1.5 pt-1">
        <div className="flex min-h-8 items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-[13px] text-popover-ink">
          <span>{t("settings.section.providers")}</span>
          <ChevronRight size={14} aria-hidden="true" className="text-popover-ink-secondary" />
        </div>
      </div>
    </>
  );
  return (
    <div className="min-h-dvh bg-app p-4">
      <div data-model-menu
        style={narrow ? { left: 8, right: 8, bottom: 16 } : { right: 24, bottom: 24, width: 340 }}
        className="fixed z-50 flex max-h-[min(392px,calc(100dvh-96px))] flex-col overflow-hidden rounded-xl border border-popover-hairline popover-surface bg-popover py-1 text-popover-ink shadow-2xl shadow-black/50">
        <ModelSearchList variant="popover" autoFocus submenus={!flat} sections={sections} onPick={() => {}}
          custom={params.get("custom") === "1" ? { label: (text: string) => t("code.launch.useModel", { model: text }) } : undefined}
          favorites={{ keys, onToggle: (row) => toggleModelFavorite(row.key) }}
          after={footer} />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Gallery /></StrictMode>);
