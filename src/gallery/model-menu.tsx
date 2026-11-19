/** The real ModelPanel in its menu box on synthetic rows, for captures of the
 * composer's model menu (scripts/capture/model-menu.mjs). No server. Every name
 * is synthetic. Not shipped.
 * ?view=short|all &theme=light|dark &lang=en|fr &stars=<n favorites> &auto=1
 * &accounts=1: two Claude accounts with their own lists, through the real
 * menu sections (M-20261119-015), &on=team to run on the second one */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

import { ModelPanel } from "../components/ModelPanel";
import { ClaudeMark, ProviderMonogram } from "../components/ProviderIcons";
import { MENU_BOX } from "../components/menu-look";
import { loadLocale } from "../lib/i18n";
import { applySkin } from "../lib/skins";
import type { ModelMenuRow, ModelMenuSection } from "../lib/model-menu";
import { buildModelPickerSections } from "../components/ModelPicker.tsx-parts/buildSections";
import type { InstanceInfo } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const lang = params.get("lang") ?? "en";
await loadLocale(lang);
applySkin(params.get("theme") === "dark" ? "pulsatrix" : "pulsatrix-light");
const view = params.get("view") === "all" ? "all" : "short";
const autoOn = params.get("auto") === "1";

const row = (instanceId: string, modelId: string, label: string, extra: Partial<ModelMenuRow> = {}): ModelMenuRow => ({
  key: `${instanceId}\u0000${modelId}`, kind: "model", instanceId, modelId, label, current: false, ...extra,
});
const claude = [row("claude", "opus", "Opus", { description: "1M context", current: !autoOn }), row("claude", "sonnet", "Sonnet", { description: "200k context" }), row("claude", "haiku", "Haiku", { description: "200k context" })];
const grok = [row("grok", "grok-4", "Grok 4", { description: "256k context" }), row("grok", "grok-code", "Grok Code", { description: "256k context" })];
const gpt = [row("codex", "gpt-5", "GPT-5", { description: "400k context" })];

// M-20261119-015: a person's two Claude accounts, each with its own live list
const accountsShown = params.get("accounts") === "1";
const claudeAccount = (instanceId: string, email: string, options: Array<[string, string]>): InstanceInfo => ({
  instanceId, displayName: email, driverKind: "claudeAgent", access: "subscription",
  snapshot: { state: "available", authenticated: true, account: { email } },
  models: { default: options[0]![0], options: options.map(([id, label]) => ({ id, label, contextWindow: 1_000_000 })) },
  capabilities: { effortLevels: ["low", "medium", "high"] },
} as unknown as InstanceInfo);
const shared: Array<[string, string]> = [["claude-fable-5-2", "Claude Fable 5.2"], ["claude-opus-5-5", "Claude Opus 5.5"], ["claude-sonnet-5-5", "Claude Sonnet 5.5"]];
const accountInstances = [
  claudeAccount("claude-personal", "ada@example.com", shared),
  claudeAccount("claude-team", "ada.admin@acme.test", [["claude-mythos-5-2", "Claude Mythos 5.2"], ["claude-mythos-5-1", "Claude Mythos 5.1"], ...shared]),
];
function accountSections(stars: readonly string[]): ModelMenuSection[] {
  const on = params.get("on") === "team" ? "claude-team" : "claude-personal";
  const selection = { instanceId: on, model: on === "claude-team" ? "claude-mythos-5-2" : "claude-opus-5-5", auto: autoOn };
  const bot = { id: "bot-1", name: "Scout", threadId: "t1", modelSelection: selection, tasks: [] };
  return buildModelPickerSections({
    orgMode: false, accountModels: new Map(), selection, switches: {}, autoOn, follows: undefined, selectedVariantLabel: undefined,
    fallback: undefined, instances: accountInstances, selectable: accountInstances, viewerLocal: false, autoPreview: null, autoRecord: null,
    profile: bot as never, botModelInstance: accountInstances[0], botModelName: "", health: { orgMode: false, myEngines: null },
    myEngines: null, ranOnName: () => "", favoriteKeys: stars,
  }).menuSections;
}

function Menu() {
  const [stars, setStars] = useState<string[]>(accountsShown
    ? ["claude-team\u0000claude-mythos-5-2", "claude-personal\u0000claude-fable-5-2"].slice(0, Number(params.get("stars") ?? "2"))
    : ["claude\u0000sonnet", "grok\u0000grok-4"].slice(0, Number(params.get("stars") ?? "2")));
  const all = [...claude, ...grok, ...gpt];
  const sections: ModelMenuSection[] = accountsShown ? accountSections(stars) : [
    { key: "top", rows: [{ key: "auto", kind: "auto", label: "Auto", current: autoOn }] },
    { key: "favorites", label: "Favorites", rows: all.filter((candidate) => stars.includes(candidate.key)) },
    { key: "claude", label: "Claude", rows: claude },
    { key: "xai", label: "Grok", rows: grok },
    { key: "openai", label: "OpenAI", rows: gpt },
  ];
  return (
    <div className="flex min-h-screen items-center justify-center bg-app p-6">
      <div className={`${MENU_BOX} w-[320px] py-1 text-popover-ink`} data-model-menu>
        <ModelPanel
          sections={sections}
          onPick={() => undefined}
          favorites={{ keys: stars, onToggle: (candidate) => setStars((list) => (list.includes(candidate.key) ? list.filter((key) => key !== candidate.key) : [...list, candidate.key])) }}
          mark={(key) => (key === "claude" || key === "anthropic" ? <ClaudeMark size={14} /> : <ProviderMonogram label={key === "xai" ? "Grok" : "OpenAI"} />)}
          autoOn={autoOn}
          optimize={{ value: "balance", onPick: () => undefined }}
          effort={{ title: "Reasoning effort", levels: ["low", "medium", "high"], modelDefault: "medium", onPick: () => undefined }}
          manage={{ onManage: () => undefined, turnedOff: 0, openProviders: () => undefined }}
          showSettings
          view={view}
        />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Menu /></StrictMode>);
