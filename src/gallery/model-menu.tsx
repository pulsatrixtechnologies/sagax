/** The real ModelPanel in its menu box on synthetic rows, for captures of the
 * composer's model menu (scripts/capture/model-menu.mjs). No server. Every name
 * is synthetic. Not shipped.
 * ?view=short|all &theme=light|dark &lang=en|fr &stars=<n favorites> &auto=1
 * &accounts=1: two Claude accounts with their own lists, through the real
 * menu sections (M-20261119-015), &on=team to run on the second one
 * &scene=owner (M-20261119-051): the owner's menu, the bot's model followed,
 * a favorite with the Default pill, one with its account, seven reasoning
 * levels and 11 models off; &scene=plain: a chosen model, no account, no
 * pill, three levels; &scene=long: a long name, chosen and starred */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

import { ModelPanel } from "../components/ModelPanel";
import { ClaudeMark, ProviderMonogram } from "../components/ProviderIcons";
import { MENU_BOX } from "../components/menu-look";
import { MENU_WIDTH } from "../components/ModelPicker.tsx-parts/helpers";
import { loadLocale, t } from "../lib/i18n";
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
  const selection = { instanceId: on, model: on === "claude-team" ? "claude-mythos-5-2" : "claude-opus-5-5", ...(autoOn ? { auto: true as const } : {}) };
  const bot = { id: "bot-1", name: "Scout", threadId: "t1", modelSelection: selection, tasks: [] };
  return buildModelPickerSections({
    orgMode: false, accountModels: new Map(), selection, switches: {}, autoOn, follows: undefined, selectedVariantLabel: undefined,
    fallback: undefined, instances: accountInstances, selectable: accountInstances, viewerLocal: false, autoPreview: null, autoRecord: null,
    profile: bot as never, botModelInstance: accountInstances[0], botModelName: "", health: { orgMode: false, myEngines: null },
    myEngines: null, ranOnName: () => "", favoriteKeys: stars,
  }).menuSections;
}

// M-20261119-051: the owner's menu and its variants
const scene = params.get("scene");
function sceneSections(stars: readonly string[]): ModelMenuSection[] {
  const grok = row("grok", "grok-4-7", "Grok 4.7", { description: `${t("model.settings.context")} 256k`, ...(scene === "plain" ? {} : { tags: [t("model.defaultTag")] }) });
  const mythos = row("claude-team", "claude-mythos-5-2", "Claude Mythos 5.2", { description: `${t("model.settings.context")} 1M`, account: "ada.admin@acme.test" });
  const opus = row("claude", "claude-opus-5-5", "Claude Opus 5.5", { description: `${t("model.settings.context")} 1M`, current: scene === "plain" && !autoOn });
  const long = row("claude-team", "claude-long", "Claude Sonnet 5.5 Extended Research Preview", { description: `${t("model.settings.context")} 1M`, account: "ada.longer-address.admin@acme.test", current: !autoOn });
  const models = scene === "long" ? [long, opus, grok] : scene === "plain" ? [opus, grok] : [grok, mythos, opus];
  const top: ModelMenuRow[] = [{ key: "auto", kind: "auto", label: "Auto", current: autoOn }];
  if (scene === "owner") top.push({ key: "follow", kind: "follow", label: t("model.useBotModel", { name: "Scout" }), detail: "Claude Opus 5.5", current: !autoOn });
  return [
    { key: "top", rows: top },
    { key: "favorites", label: "Favorites", rows: models.filter((candidate) => stars.includes(candidate.key)) },
    { key: "claude", label: "Claude", rows: models.filter((candidate) => candidate.instanceId !== "grok") },
    { key: "xai", label: "Grok", rows: models.filter((candidate) => candidate.instanceId === "grok") },
  ];
}
const sceneStars = scene === "long" ? ["claude-team\u0000claude-long", "grok\u0000grok-4-7"]
  : scene === "plain" ? ["grok\u0000grok-4-7"] : ["grok\u0000grok-4-7", "claude-team\u0000claude-mythos-5-2"];
const sceneLevels = scene === "owner" || scene === "long"
  ? { levels: ["low", "medium", "high", "xhigh", "max", "ultracode"] as const, modelDefault: undefined }
  : { levels: ["low", "medium", "high"] as const, modelDefault: "medium" as const };

function Menu() {
  const [stars, setStars] = useState<string[]>(scene ? sceneStars : accountsShown
    ? ["claude-team\u0000claude-mythos-5-2", "claude-personal\u0000claude-fable-5-2"].slice(0, Number(params.get("stars") ?? "2"))
    : ["claude\u0000sonnet", "grok\u0000grok-4"].slice(0, Number(params.get("stars") ?? "2")));
  const all = [...claude, ...grok, ...gpt];
  const sections: ModelMenuSection[] = scene ? sceneSections(stars) : accountsShown ? accountSections(stars) : [
    { key: "top", rows: [{ key: "auto", kind: "auto", label: "Auto", current: autoOn }] },
    { key: "favorites", label: "Favorites", rows: all.filter((candidate) => stars.includes(candidate.key)) },
    { key: "claude", label: "Claude", rows: claude },
    { key: "xai", label: "Grok", rows: grok },
    { key: "openai", label: "OpenAI", rows: gpt },
  ];
  return (
    <div className="flex min-h-screen items-center justify-center bg-app p-6">
      <div className={`${MENU_BOX} py-1 text-popover-ink`} style={{ width: scene ? MENU_WIDTH : 320 }} data-model-menu>
        <ModelPanel
          sections={sections}
          onPick={() => undefined}
          favorites={{ keys: stars, onToggle: (candidate) => setStars((list) => (list.includes(candidate.key) ? list.filter((key) => key !== candidate.key) : [...list, candidate.key])) }}
          mark={(key) => (key === "claude" || key === "anthropic" ? <ClaudeMark size={14} /> : <ProviderMonogram label={key === "xai" ? "Grok" : "OpenAI"} />)}
          autoOn={autoOn}
          optimize={{ value: "balance", onPick: () => undefined }}
          effort={{ title: "Reasoning effort", ...(scene ? sceneLevels : { levels: ["low", "medium", "high"], modelDefault: "medium" }), value: scene === "owner" ? "high" : undefined, onPick: () => undefined }}
          manage={{ onManage: () => undefined, turnedOff: scene === "owner" ? 11 : 0, openProviders: () => undefined }}
          showSettings
          view={view}
        />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Menu /></StrictMode>);
