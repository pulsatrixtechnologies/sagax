/** Isolated gallery for screenshots of the model menu's provider preview
 * (#2181, #2709): at most 4 models per provider, "Show more (N)", and the
 * model in use kept visible when it is past the first 4. Synthetic catalog,
 * the real ModelSearchList. Not shipped in the app.
 * ?lang=en|fr&skin=<id>&active=<index in the Claude list> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ModelSearchList } from "../components/ModelMenu";
import { loadLocale } from "../lib/i18n";
import type { ModelMenuRow, ModelMenuSection } from "../lib/model-menu";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
const lang = params.get("lang") ?? "en";
await loadLocale(lang);
document.documentElement.lang = lang;
const active = Number(params.get("active") ?? "7");

const CLAUDE = ["Claude Fable 5.1", "Claude Fable 5", "Claude Opus 5.5", "Claude Opus 5", "Claude Sonnet 5.5", "Claude Sonnet 5", "Claude Haiku 5", "Claude Sonnet 4.6", "Claude Opus 4.6", "Claude Haiku 4.5"];
const OPENAI = ["GPT-6.1", "GPT-6.1 mini", "GPT-6", "GPT-6 mini", "GPT-5.5", "o5", "o5 mini", "GPT-5", "GPT-5 mini"];
const rows = (engine: string, names: string[], current: number): ModelMenuRow[] =>
  names.map((label, index) => ({
    key: `${engine}:${index}`,
    kind: "model",
    instanceId: engine,
    modelId: label.toLowerCase().replace(/\s+/g, "-"),
    label,
    detail: "High",
    tags: index === 0 ? ["Default"] : undefined,
    current: index === current,
  }));
const sections: ModelMenuSection[] = [
  { key: "top", rows: [{ key: "auto", kind: "auto", label: "Auto", detail: "best model per task", current: false }] },
  { key: "claude", label: "Claude", note: "Account", rows: rows("claude", CLAUDE, active) },
  { key: "openai", label: "OpenAI", note: "API", rows: rows("openai", OPENAI, -1) },
];

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <main className="min-h-screen bg-app p-10">
      <div data-gallery-menu="" className="flex max-h-[760px] w-[340px] flex-col overflow-hidden rounded-xl border border-popover-hairline popover-surface bg-popover py-1 text-popover-ink shadow-2xl shadow-black/50">
        <ModelSearchList sections={sections} onPick={() => {}} variant="popover" label="Model" />
      </div>
    </main>
  </StrictMode>,
);
