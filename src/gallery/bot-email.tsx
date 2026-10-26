/** Isolated gallery for headless screenshots of the bot's own email
 * address (B21, 2026-10-21): the bot panel's Overview with the "Email
 * address" group above its neighbours, the Triggers builder with source
 * "Bot email" (no secret, no URL, the bot's address), and a Bot email
 * trigger's row opened. The capture script
 * (scripts/capture-bot-email.mjs) answers /api itself. Not shipped.
 * ?skin=<id>&lang=<code>&mail=on|off */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { BotEmailAddress } from "../components/bot-settings/BotEmailAddress";
import { OverviewSection } from "../components/bot-settings/OverviewSection";
import { EMPTY_TYPED_DRAFT, TypedSourceFields, TypedTriggerRow, type TypedDraft } from "../components/TypedTriggers";
import type { BotOverview } from "../lib/bot-overview-types";
import { setLocale, t } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import type { WebhookTrigger } from "../lib/webhooks";
import { StoreProvider } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
setLocale(params.get("lang") ?? "fr");

const overview: BotOverview = {
  who: { name: "Cryptic", title: "Comptabilité", blurb: "Classe les factures et prépare les paiements.", soulLead: "" },
  does: ["Résumé du matin, chaque jour à 8 h", "Factures reçues : les classe et prépare le paiement"],
  reaches: ["Microsoft 365 (courriel, calendrier)", "Dossier Factures"],
  wont: ["N'envoie rien sans votre approbation"],
  recent: [],
};

const trigger: WebhookTrigger = {
  id: "w-mail", endpointId: "wh_mail", name: "Factures reçues", prompt: "Classe la facture et prépare le paiement.", botId: "cryptic", runOn: "maus",
  enabled: true, createdAt: 1, updatedAt: 1, deliveryCount: 3, lastReceivedAt: Date.now() - 40 * 60_000,
  source: { type: "botmail", events: [], filters: { subject: ["facture"], sender: ["*@fournisseur.example"] } },
} as WebhookTrigger;

function Gallery() {
  const [draft, setDraft] = useState<TypedDraft>({ ...EMPTY_TYPED_DRAFT, filters: { subject: "facture", sender: "*@fournisseur.example" } });
  return (
    <div className="flex min-h-screen items-start gap-6 bg-canvas p-6 text-ink">
      <aside data-gallery-panel="overview" className="w-[380px] rounded-2xl border border-hairline/40 bg-panel px-4 pb-6 pt-4">
        <div className="flex flex-col gap-5">
          <BotEmailAddress botId="cryptic" />
          <OverviewSection overview={overview} prompt={null} onOpen={() => {}} />
        </div>
      </aside>
      <section data-gallery-panel="builder" className="w-[560px] rounded-2xl border border-hairline/40 bg-panel p-4">
        <h2 className="mb-2 text-[13px] text-ink-secondary">{t("triggers.source.botmail")}</h2>
        <TypedSourceFields type="botmail" draft={draft} onChange={setDraft} creating botId="cryptic" />
      </section>
      <section data-gallery-panel="row" className="w-[560px] rounded-2xl border border-hairline/40 bg-panel">
        <ul>
          <TypedTriggerRow webhook={trigger} bot={undefined} setup={undefined} baseUrl="https://hooks.example" busy={false}
            onToggle={() => {}} onDelete={() => {}} onEdit={() => {}} onSetup={() => {}} onOpenChat={() => {}} />
        </ul>
      </section>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <Gallery />
    </StoreProvider>
  </StrictMode>,
);
