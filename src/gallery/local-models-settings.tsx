/** Isolated gallery for headless screenshots of Settings > Local models
 * (D-20261123-023, M-20261123-040, M-20261123-047): the real card, with a
 * server declared on a port of the person's own, the people and teams the
 * models are shared with, and the control that removes a server. Synthetic
 * data, demo accounts only. Not shipped in the app.
 * ?skin=<id>&lang=<code>&case=chosen|org|none */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { LocalModelsSettings } from "../components/settings/LocalModelsSettings";
import { saveCardOpen } from "../components/SettingsPrimitives";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");
const which = params.get("case") ?? "chosen";

const settings = {
  expose: true,
  share: which === "org",
  shareWith: which === "none" ? { people: [], teams: [] } : { people: ["pr_ada", "pr_grace"], teams: ["team_support"] },
  endpoints: [
    { id: "deskua8e1b19b", label: "Splash", baseUrl: "http://127.0.0.1:8100/v1" },
    { id: "desk11434", label: "Ollama", baseUrl: "http://127.0.0.1:11434/v1" },
    { id: "desk1234", label: "LM Studio", baseUrl: "http://127.0.0.1:1234/v1" },
  ],
  published: [{ id: "deskua8e1b19b", label: "Splash", models: ["local/flash", "flash"] }],
  probes: [{ id: "deskua8e1b19b", status: "answered" }, { id: "desk11434", status: "offline" }, { id: "desk1234", status: "needs_key" }],
  connected: true,
};
const directory = {
  people: [
    { principalId: "pr_ada", name: "Ada Lovelace", login: "ada", email: "ada@example.com", role: "member", disabled: false },
    { principalId: "pr_grace", name: "Grace Hopper", login: "grace", email: "grace@example.com", role: "member", disabled: false },
    { principalId: "pr_alan", name: "Alan Turing", login: "alan", email: "alan@example.com", role: "member", disabled: false },
  ],
  teams: [{ id: "team_support", name: "Support", members: ["pr_ada", "pr_alan"], managers: ["pr_grace"] }],
};
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
window.fetch = async (input) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/api/me/local-models")) return json(settings);
  if (url.includes("/api/org/directory")) return json(directory);
  if (url.includes("/api/org")) return json({ org: { identity: { kind: "perspicax" } } });
  return json({});
};
// both folds open: the capture shows the recipients and the servers
saveCardOpen("computer.localModels.shareWith", true);
saveCardOpen("computer.localModels.endpoints", true);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div className="min-h-screen bg-app px-8 py-8 text-ink">
      <div className="mx-auto max-w-[680px]"><LocalModelsSettings /></div>
    </div>
  </StrictMode>,
);
