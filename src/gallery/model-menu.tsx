/** Isolated gallery for Playwright screenshots of the composer's model menu
 * in its three steps (#3116: harness, provider, model) over a mock chat bar.
 * Not shipped in the app.
 * ?skin=<id>&lang=<code>&q=<search>&favorites=1&narrow=1
 * &path=<harness>[/<provider>]: open at that step (claudeAgent/claudeApi)
 * &mode=before: the menu as origin/main drew it (340 px, provider
 *   submenus, fixed footer with no floor under the list: the squashed list)
 * &open=<provider key>: with mode=before, click that submenu
 * &broken=1: the bot's model does not respond (src/lib/model-health.ts) */
import { StrictMode, useEffect, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { ChevronDown, ChevronRight, Mic, Monitor, Plus } from "lucide-react";
import { ModelSearchList, type ModelMenuRow, type ModelMenuSection } from "../components/ModelMenu";
import { ClaudeMark, CodexMark, GrokMark } from "../components/ProviderIcons";
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
const before = params.get("mode") === "before";
const claude = { harness: "claudeAgent", harnessLabel: "Claude Code" };
const sections: ModelMenuSection[] = [
  { key: "top", rows: [
    ...(params.get("keep") === "1" ? [{ key: "keep", kind: "keep" as const, label: t("teamSettings.keepModel"), current: true }] : []),
    { key: "auto", kind: "auto", label: t("model.auto.label"), detail: t("model.auto.rowHint"), current: false },
    { key: "follow", kind: "follow", label: t("model.useBotModel", { name: "Dispatch" }), detail: "Claude Sonnet 5", current: true,
      warning: params.get("broken") === "1" ? t("model.notResponding") : undefined },
  ] },
  // Claude Code has two accounts: the subscription and an API key (step 2)
  { key: "claude", label: "Anthropic (Max)", ...claude, rows: [
    model("claude", "claude-fable-5-1", "Claude Fable 5.1", { detail: "Élevé", current: true }),
    model("claude", "claude-fable-5", "Claude Fable 5", { detail: "Élevé" }),
    model("claude", "claude-opus-5-5", "Claude Opus 5.5", { detail: "Élevé" }),
    model("claude", "claude-opus-5", "Claude Opus 5", { detail: "Élevé" }),
    model("claude", "claude-sonnet-5-5", "Claude Sonnet 5.5", { detail: "Moyen" }),
    model("claude", "claude-sonnet-5", "Claude Sonnet 5", { detail: "Moyen", tags: [defaultTag] }),
    model("claude", "claude-haiku-5-5", "Claude Haiku 5.5"),
    model("claude", "claude-haiku-4-5", "Claude Haiku 4.5"),
  ] },
  { key: "claudeApi", label: "Anthropic (API key)", ...claude, rows: [
    model("claudeApi", "claude-opus-5-5", "Claude Opus 5.5", { detail: "Élevé" }),
    model("claudeApi", "claude-sonnet-5-5", "Claude Sonnet 5.5", { detail: "Moyen" }),
    model("claudeApi", "claude-haiku-5-5", "Claude Haiku 5.5"),
  ] },
  { key: "grok", label: "xAI", harness: "grokAgent", harnessLabel: "Grok", rows: [
    model("grok", "grok-4.7", "Grok 4.7", { detail: "Élevé" }), model("grok", "grok-4.5", "Grok 4.5", { detail: "Élevé" }),
  ] },
  { key: "codex", label: "OpenAI", harness: "codex", harnessLabel: "Codex", rows: [
    model("codex", "gpt-5.6", "GPT-5.6", { detail: "Moyen" }), model("codex", "gpt-5.6-mini", "GPT-5.6 mini"),
  ] },
  // The model name alone (2026-10-26); "(Shared by …)" for another person's
  // computer; the server only when two servers share a name.
  { key: "local:this-computer", label: t("model.localGroup"), harness: "local", harnessLabel: t("model.localGroup"), rows: [
    model("claude", "desk8000ab::Ornith-1.5-122B-oQ4e-mtp", "Ornith-1.5-122B-oQ4e-mtp"),
    model("claude", "desk8000ab::Ornith-1.5-35B-A3B-oQ4e-mtp", "Ornith-1.5-35B-A3B-oQ4e-mtp"),
    model("claude", "desk8000cd::Qwen3-Coder-Next", "Qwen3-Coder-Next", { subtext: localModelSubtext({ sharedBy: "Camille Tremblay-Lachance" }) }),
    model("claude", "desk8000ab::Gemma-4", "Gemma-4", { subtext: "oMLX" }),
    model("claude", "desk8002ab::Gemma-4", "Gemma-4", { subtext: ":8002" }),
  ] },
];
// mode=before: the sections as origin/main drew them (no harness grouping)
const beforeSections = sections.map((section) => {
  const { harness: _harness, harnessLabel: _label, ...rest } = section;
  return rest;
});

const MARKS: Record<string, ReactNode> = {
  claudeAgent: <ClaudeMark size={14} />, grokAgent: <GrokMark size={14} />, codex: <CodexMark size={14} />,
  local: <Monitor size={14} aria-hidden="true" />,
};
const [pathHarness, pathProvider] = (params.get("path") ?? "").split("/").filter(Boolean);
const initialPath = pathHarness ? { harness: pathHarness, provider: pathProvider } : {};

/** The chat bar under the menu, for the side-by-side: the chip reads the
 * three steps (#3116) or, before, the model alone. */
function ChatBar({ narrow }: { narrow: boolean }) {
  const chip = before ? "Claude Fable 5.1 Élevé" : "Claude Code · Anthropic (Max) · Fable 5.1 Élevé";
  return (
    <div data-chat-bar
      style={narrow ? { left: 8, right: 8, bottom: 8 } : { left: 24, right: 24, bottom: 16 }}
      className="fixed z-40 rounded-[22px] border-[0.5px] border-border bg-composer px-2 py-1.5 shadow-[0_2px_8px_-1px_#0000000d,0_1px_2px_#00000008]">
      <div className="px-2 py-2 text-[15px] text-ink-secondary">{t("composer.placeholder.bot", { name: "Dispatch" })}</div>
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
  }, []);
  const narrow = params.get("narrow") === "1";
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
          <ModelSearchList variant="popover" autoFocus submenus sections={beforeSections} onPick={() => {}}
            favorites={{ keys, onToggle: (row) => toggleModelFavorite(row.key) }}
            after={footer} />
        ) : (
          <ModelSearchList variant="popover" autoFocus showAll sections={sections} onPick={() => {}}
            custom={params.get("custom") === "1" ? { label: (text: string) => t("code.launch.useModel", { model: text }), onPick: () => {} } : undefined}
            favorites={{ keys, onToggle: (row) => toggleModelFavorite(row.key) }}
            steps={{ mark: (harness) => MARKS[harness] ?? null, initialPath }}
            listMinHeight={240}
            after={footer} />
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Gallery /></StrictMode>);
