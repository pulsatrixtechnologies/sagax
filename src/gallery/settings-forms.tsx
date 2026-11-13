/** Isolated gallery for headless screenshots of the Settings forms drawn
 * with the standard rows (2026-10-26): Organization's bots (team secrets,
 * phone calls), Credentials (an item, the add form, the export panel), the
 * computer's disk saver, the Anthropic key's every-bot switch, published
 * pages, this computer's environments, pairing and computer sharing. Not
 * shipped. A mocked fetch and a mocked desktop bridge answer; nothing
 * connects. Fictitious names and numbers only. ?skin=<id>&lang=<code>
 * (scripts/capture/settings-forms.mjs). */
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { OrgPhoneCalls } from "../components/settings/OrgPhoneCalls";
import { OrgTeamSecrets } from "../components/settings/OrgTeamSecrets";
import { OrgVaultExportPolicy } from "../components/settings/OrgVaultExportPolicy";
import { OrgGrokBridgePolicy } from "../components/settings/OrgGrokBridgePolicy";
import { LinkedGrokBotSettings } from "../components/settings/LinkedGrokBotSettings";
import { CredentialsSettings } from "../components/settings/CredentialsSettings";
import { ComputerCareSettings } from "../components/settings/ComputerCareSettings";
import { PublishedPagesSettings } from "../components/PublishedPages";
import { ConnectedWorkspacesSettings } from "../components/ConnectedWorkspacesSettings";
import { RemoteComputerSection } from "../components/RemoteComputerSection";
import { ComputerSharingSettings } from "../components/ComputerSharingSettings";
import { SettingsGroup } from "../components/SettingsPrimitives";
import { LoopGuardRow } from "../components/settings/AdvancedSettings";
import { TelemetrySettings } from "../components/settings/TelemetrySettings";
import { WebSearchSettings } from "../components/settings/WebSearchSettings";
import { loadLocale, t } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { BotEditorStore, initialState } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "fr");

const now = Date.now();
const bots = [
  { id: "bot-atlas", name: "Atlas" },
  { id: "bot-boreas", name: "Boreas" },
  { id: "bot-cirrus", name: "Cirrus" },
];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const path = new URL(url, location.origin).pathname;
  if (path === "/api/org/bot-secrets") {
    return json({ secrets: [
      { id: "bs_0000000000000001", kind: "secret", label: "Boutique en ligne", injection: { via: "env", name: "SHOP_TOKEN" }, botIds: ["bot-atlas"] },
      { id: "bs_0000000000000002", kind: "serviceAccount", label: "Portail fournisseur", injection: { via: "env", name: "SUPPLIER_PASSWORD" }, login: "compte.service", botIds: ["bot-boreas"] },
    ] });
  }
  if (path === "/api/org/phone-calls") {
    return json({ settings: { enabled: false, doNotCall: ["+15145550142", "+14385550199"] } });
  }
  if (path === "/api/telemetry") {
    return json({ endpoint: "https://otel.example.org:4318", headerNames: ["Authorization"], serviceName: "sagax-bureau", enabled: true, stats: { queued: 0, dropped: 0, exported: 1284, failed: 0 } });
  }
  if (path === "/api/me/web-search") return json({ provider: "brave", keyConfigured: true, last4: "7f2c", baseUrl: null, ready: true });
  if (path === "/api/org/settings") return json({ settings: { allowVaultExport: true, allowGrokBridge: true } });
  if (path === "/api/me/grok-bridge") {
    return json({
      linked: true,
      enabled: true,
      webhookUrl: "https://grok.example/hook",
      keySet: true,
      linkId: "link_gallery",
      bots: ["cryptic"],
      mayCallOwner: false,
      mayTextOwner: false,
      orgAllowed: true,
      stats: { sentToday: 0, receivedToday: 0, deadLetters: 0, circuitOpen: false },
    });
  }
  if (path === "/api/me/credentials/list") {
    return json({
      items: [
        {
          id: "c1", kind: "login", name: "Portail fournisseur", username: "julie.exemple", domains: ["fournisseur.example"], hasPassword: true, hasTotp: true, hasApiKey: false, hasNotes: false,
          source: "local", grants: [{ botId: "bot-atlas", mode: "always", grantedAt: now - 86_400_000 }], createdAt: now - 9 * 86_400_000, updatedAt: now - 86_400_000, lastUsedAt: now - 3_600_000, lastUsedBy: "bot-atlas",
        },
      ],
      onePassword: { available: false, reason: "absent" },
    });
  }
  if (path === "/api/computer/maintenance") {
    return json({ schedule: { enabled: true, days: [6], hour: 3, windowHours: 2, timeZone: "America/Toronto" }, nextWindowAt: now + 2 * 86_400_000, running: false });
  }
  if (path === "/api/computer/disk-saver") {
    return json({ computerRunning: true, totalBytes: 3_400_000_000, items: [
      { id: "packageCaches", bytes: 1_800_000_000, userFiles: false },
      { id: "browserCache", bytes: 900_000_000, userFiles: false },
      { id: "tempFiles", bytes: 400_000_000, userFiles: false },
      { id: "trash", bytes: 300_000_000, userFiles: true },
    ] });
  }
  if (path === "/api/pages") {
    return json({ pages: [{
      id: "p1", title: "Rapport mensuel", status: "published", access: "org", expiresAt: null, currentVersion: 2, botId: "bot-atlas", threadId: "t1",
      createdAt: now - 5 * 86_400_000, updatedAt: now - 86_400_000, url: "https://pages.example/rapport", path: "/p/rapport", reachable: true, expired: false,
      versions: [{ version: 1, createdAt: now - 5 * 86_400_000 }, { version: 2, createdAt: now - 86_400_000 }],
    }] });
  }
  return realFetch(input, init);
};

const sharing = { enabled: true, connected: true, folders: [{ id: "f1", name: "Documents", path: "/Users/exemple/Documents", write: false }], terminal: false, computer: true };
(window as unknown as { ogb: unknown }).ogb = {
  confirm: async () => true,
  environments: {
    state: async () => ({
      localOrigin: "http://127.0.0.1:18790", remote: false, packaged: true, activeId: "e1",
      environments: [
        { id: "e1", kind: "local", name: "Bureau", dataDir: "/Users/exemple/Sagax" },
        { id: "e2", kind: "local", name: "Essais", dataDir: "/Users/exemple/Sagax-essais" },
      ],
    }),
    switch: async () => ({ ok: true }), addFromLink: async () => true, create: async () => ({ ok: true, state: {} }), pickDir: async () => ({ ok: false }), forget: async () => ({ ok: true }),
  },
  remoteClient: { active: false, state: async () => ({ active: false }), pair: async () => ({ active: false }), disconnect: async () => ({ active: false }) },
  computerSharing: { state: async () => sharing, chooseFolder: async () => null, save: async () => sharing, revoke: async () => sharing, activity: async () => [] },
  serverMode: { state: async () => ({ active: false }) },
};

function Sample({ id, width = 680, children }: { id: string; width?: number; children: ReactNode }) {
  return (
    <section data-gallery-sample={id} className="bg-app p-6" style={{ width }}>
      <div className="flex flex-col gap-6">{children}</div>
    </section>
  );
}

/** A still store: the gallery's bots and the config the samples read, no
 * server behind it. */
const store = {
  state: {
    ...initialState,
    bots: bots as unknown as typeof initialState.bots,
    config: {
      anthropic: { configured: true, everyClaudeBot: true },
      features: { sharedComputers: true },
    } as unknown as typeof initialState.config,
  },
  dispatch: () => {},
  flushBotPatches: async () => null,
  refreshInstances: async () => {},
  refreshModels: async () => {},
};

function Gallery() {
  return (
    <main className="flex min-h-screen flex-col bg-app text-ink" data-gallery-settings="">
      <Sample id="org-bots">
        <SettingsGroup title={t("organization.group.bots")} groupId="organizationBots">
          <OrgVaultExportPolicy initial />
          <OrgGrokBridgePolicy initial />
          <OrgTeamSecrets />
        </SettingsGroup>
      </Sample>
      <Sample id="linked-grok-bot">
        <LinkedGrokBotSettings initial={{
            linked: true,
            enabled: true,
            webhookUrl: "https://grok.example/hook",
            keySet: true,
            linkId: "link_gallery",
            bots: ["cryptic"],
            mayCallOwner: false,
            mayTextOwner: true,
            orgAllowed: true,
            stats: { sentToday: 1, receivedToday: 0, deadLetters: 0, circuitOpen: false },
          }} />
      </Sample>
      <Sample id="experimental-phone-calls-off">
        <SettingsGroup title={t("settings.experimental.title")} groupId="experimental">
          <OrgPhoneCalls initial={{ enabled: false, callbackNumber: "+15145550100", doNotCall: ["+15145550142"] }} />
        </SettingsGroup>
      </Sample>
      <Sample id="experimental-phone-calls-on">
        <SettingsGroup title={t("settings.experimental.title")} groupId="experimental">
          <OrgPhoneCalls initial={{ enabled: true, callbackNumber: "+15145550100", doNotCall: ["+15145550142", "+14385550199"] }} />
        </SettingsGroup>
      </Sample>
      <Sample id="telemetry">
        <SettingsGroup title={t("settings.loopGuard.title")} groupId="loopGuard"><LoopGuardRow /></SettingsGroup>
        <SettingsGroup title={t("telemetry.title")} groupId="telemetry"><TelemetrySettings /></SettingsGroup>
        <WebSearchSettings />
      </Sample>
      <Sample id="credentials"><CredentialsSettings /></Sample>
      <Sample id="computer-care"><ComputerCareSettings /></Sample>
      <Sample id="pages"><PublishedPagesSettings /></Sample>
      <Sample id="environments"><ConnectedWorkspacesSettings /></Sample>
      <Sample id="pairing"><RemoteComputerSection /></Sample>
      <Sample id="sharing">
        <ComputerSharingSettings workspace={{ id: "e9", name: "Serveur de l'équipe", origin: "https://equipe.example" }} onClose={() => {}} />
      </Sample>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BotEditorStore value={store}>
      <Gallery />
    </BotEditorStore>
  </StrictMode>,
);
