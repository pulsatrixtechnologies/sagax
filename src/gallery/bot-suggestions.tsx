/** Isolated gallery for screenshots of the bot panel's Suggestions card
 * (#4250 S6): the server's open fix card, what a routine needs, a
 * conversation waiting on the person, a saving the server proposed and a
 * setup step, in the bot panel's width.
 * Not shipped. The capture script answers /api. ?skin=<id>&lang=<code> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SuggestionsSection } from "../components/bot-settings/SuggestionsSection";
import { loadLocale } from "../lib/i18n";
import type { Routine } from "../lib/routines";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider, type Bot } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
const lang = params.get("lang") ?? "fr";
await loadLocale(lang);
const fr = lang === "fr";

const bot = {
  id: "gallery-bot", threadId: "t1", name: "Atlas", title: "Research", description: "", notifications: true, color: "blue", unread: false,
  modelSelection: { instanceId: "x", model: "x" }, messages: [],
  tasks: [{ threadId: "t9", title: fr ? "Factures du mois" : "Monthly invoices", activity: "waiting-on-you" }],
} as unknown as Bot;

const routines = [
  { id: "r2", name: fr ? "Tri de la boîte" : "Inbox triage", needsPerson: { kind: "question", text: fr ? "Quel dossier garder pour les reçus?" : "Which folder keeps the receipts?", since: 1 } },
] as unknown as Routine[];

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <div className="flex min-h-screen items-start gap-6 bg-app p-4 text-ink">
        <aside data-gallery-panel="" className="w-[380px] border-r border-hairline/40 bg-panel">
          <div className="flex flex-col gap-6 px-4 pb-6 pt-4">
            <SuggestionsSection bot={bot} routineCount={2} routines={routines} />
          </div>
        </aside>
      </div>
    </StoreProvider>
  </StrictMode>,
);
