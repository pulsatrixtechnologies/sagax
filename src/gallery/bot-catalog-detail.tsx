/** Isolated gallery for screenshots of Browse Bots' bot profile (the read
 * only detail: header, tab rail, content pane). Not shipped in the app.
 * ?skin=<id>&lang=<code>&tab=soul|memories|skills|routines|integrations
 * &w=<viewport px, for the frame>&empty=1 (every tab empty) */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BotCatalogDetailView, type CatalogDetailContent, type CatalogTab, CATALOG_TABS } from "../components/bot-catalog/BotCatalogDetailView";
import { CATEGORY_MODAL } from "../components/category-modal";
import { setLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider } from "../state/store";
import type { CatalogItem } from "../lib/bot-catalog";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
const lang = params.get("lang") ?? "fr";
setLocale(lang);
const tabParam = params.get("tab") as CatalogTab | null;
const tab: CatalogTab = tabParam && CATALOG_TABS.includes(tabParam) ? tabParam : "soul";

const SOUL = lang === "fr"
  ? `# Responsabilités

- Répondre aux questions des clients du **service de dépannage** en moins de 5 minutes.
- Résumer chaque billet ouvert dans la journée et signaler ce qui est en retard.
- Garder un ton *clair et poli*, sans jargon inutile.

## Exemple de réponse

1. Accuser réception.
2. Donner l'état du billet.
3. Proposer la prochaine étape avec \`une date\`.

# Règles

- Ne jamais promettre une date sans l'avoir validée.
- Toujours demander la permission avant d'écrire à un client.

> Dans le doute, demander à la personne responsable.

| Priorité | Délai |
| --- | --- |
| Critique | 15 min |
| Normale | 4 h |
`
  : `# Responsibilities

- Answer **help desk** customer questions within 5 minutes.
- Summarize every ticket opened today and flag what is late.
- Keep a *clear, polite* tone without needless jargon.

## Sample reply

1. Acknowledge.
2. Give the ticket status.
3. Propose the next step with \`a date\`.

# Rules

- Never promise a date without checking it.
- Always ask before writing to a customer.

> When in doubt, ask the person in charge.

| Priority | Delay |
| --- | --- |
| Critical | 15 min |
| Normal | 4 h |
`;

const item: CatalogItem = {
  kind: "bot",
  key: "bot:dumpling",
  entry: {
    id: "dumpling", name: "Dumpling", title: "", description: lang === "fr" ? "Assistante du service de dépannage." : "Help desk assistant.",
    look: { color: "orange" }, owner: { principalId: "pr_1", name: "Zachary Sellam" }, source: "shared", archived: false, primary: false,
  },
};

const full: CatalogDetailContent = {
  soul: SOUL,
  memories: ["Le client Alpha préfère les courriels le matin.", "Les billets critiques passent par le 2e niveau."],
  skills: [{ name: "resume-billets", description: "Résume les billets ouverts" }, { name: "relance", description: "" }],
  routines: [{ name: "Ronde du matin", schedule: "Tous les jours à 8 h", enabled: true }, { name: "Rapport hebdo", schedule: "Le vendredi à 16 h", enabled: false }],
  integrations: [{ name: "connectwise", kind: "mcp" }, { name: "Outlook", kind: "app" }, { name: "browser", kind: "browser" }],
};
const empty: CatalogDetailContent = { soul: "", memories: [], skills: [], routines: [], integrations: [] };
const content = params.get("empty") ? empty : params.get("private") ? { ...full, memories: null } : full;
const width = Number(params.get("w") ?? 900);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <div className="flex min-h-screen items-center justify-center bg-black/50 p-3 sm:p-6">
        <div className={CATEGORY_MODAL.frame} style={{ width: `min(${width}px, calc(100vw - 24px))` }} data-gallery-frame="">
          <div className={CATEGORY_MODAL.content}>
            <BotCatalogDetailView
              item={item}
              content={content}
              tab={tab}
              onTab={() => {}}
              onBack={() => {}}
              actions={<>
                <button type="button" className="rounded-full bg-ink px-4 py-2 text-[13px] font-medium text-app">Ouvrir</button>
                <button type="button" className="rounded-full border border-border px-4 py-2 text-[13px] font-medium text-ink">Publier au catalogue de l'organisation</button>
              </>}
            />
          </div>
        </div>
      </div>
    </StoreProvider>
  </StrictMode>,
);
