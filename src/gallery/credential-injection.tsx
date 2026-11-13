/** Isolated gallery for headless screenshots of an API key's two uses in
 * Settings > Credentials (2026-10-26): how Sagax sends it on a bot's request,
 * and the command variable the person may turn on. No server: the buttons do
 * nothing here. Not shipped in the app. ?skin=<id>&lang=<code>&only=<sample>
 * (#4094: a form is the Vault's centered window; shoot one at a time with only=) */
import { StrictMode, type ReactElement } from "react";
import { createRoot } from "react-dom/client";

import type { VaultItemListing } from "../../shared/credential-vault";
import { ItemForm, ItemRow } from "../components/settings/CredentialsSettings";
import { SettingsGroup } from "../components/SettingsPrimitives";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "fr");
const only = params.get("only");

const bots = [{ id: "bot-helper", name: "Assistant" }, { id: "bot-research", name: "Recherche" }];
const base: VaultItemListing = {
  id: "a1b2c3d4e5f6a7b8c9d0e1f2", kind: "apiKey", name: "Example API", domains: ["api.example.com"],
  hasPassword: false, hasTotp: false, hasApiKey: true, hasNotes: false, source: "local",
  injection: { mode: "bearer", basePath: "/v1" },
  grants: [{ botId: "bot-helper", mode: "always", grantedAt: 1 }],
  createdAt: 1, updatedAt: 1, lastUsedAt: Date.UTC(2026, 9, 26, 14, 5), lastUsedBy: "bot-helper",
};
const withVariable: VaultItemListing = { ...base, id: "b1b2c3d4e5f6a7b8c9d0e1f2", name: "Weather API", domains: ["weather.example.com"], injection: { mode: "header", header: "X-Api-Key" }, commandVariable: "WEATHER_API_KEY" };
const botName = (id: string) => bots.find((bot) => bot.id === id)?.name ?? "Bot";
const noop = async () => {};

const samples: Array<{ id: string; width: number; render: () => ReactElement }> = [
  {
    id: "rows", width: 720, render: () => (
      <SettingsGroup title="Identifiants" groupId="gallery.rows">
        <ItemRow item={base} botName={botName} bots={bots} onChanged={noop} />
        <ItemRow item={withVariable} botName={botName} bots={bots} onChanged={noop} />
      </SettingsGroup>
    ),
  },
  {
    id: "form", width: 720, render: () => (
      <SettingsGroup title="Identifiants" groupId="gallery.form">
        <ItemForm onDone={noop} start={{ kind: "apiKey", name: "Weather API", domains: "weather.example.com", injectionMode: "header", injectionHeader: "X-Api-Key", basePath: "/v1", exposeCommand: true, commandVariable: "WEATHER_API_KEY" }} />
      </SettingsGroup>
    ),
  },
  {
    id: "form-off", width: 720, render: () => (
      <SettingsGroup title="Identifiants" groupId="gallery.form-off">
        <ItemForm onDone={noop} start={{ kind: "apiKey", name: "Example API", domains: "api.example.com", injectionMode: "bearer" }} />
      </SettingsGroup>
    ),
  },
  {
    id: "narrow", width: 360, render: () => (
      <SettingsGroup title="Identifiants" groupId="gallery.narrow">
        <ItemRow item={withVariable} botName={botName} bots={bots} onChanged={noop} />
      </SettingsGroup>
    ),
  },
];

function Gallery() {
  return (
    <div className="flex flex-col items-start gap-8 bg-app p-6 text-ink">
      {samples.filter((sample) => !only || sample.id === only).map((sample) => (
        <div key={sample.id} data-gallery-sample={sample.id} style={{ width: sample.width }}>
          {sample.render()}
        </div>
      ))}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
