/** Isolated gallery for headless screenshots of "When something changes in
 * a product" in the routine editor (#4250, S4), next to its neighbour, the
 * GitHub trigger of the same editor. Mocked API (the watchable resources
 * answer a canned list); no server. Not shipped in the app.
 * ?lang=<code>&skin=<id>&sample=github|product&linked=yes|no (a server
 * linked to Perspicax, the default, or a solo server) */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RoutineEditor } from "../components/RoutineCalendarPage";
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
const sample = params.get("sample") ?? "product";
const linked = params.get("linked") !== "no";

/** About as many as a person with a few products sees: 40 resources and 15
 * templates, some with long names, so the list's scroll and search show. */
function watchableSample(code: string) {
  const fr = code === "fr";
  const boards = fr
    ? ["Support", "Projets", "Facturation", "Réseau", "Postes de travail", "Serveurs", "Sécurité", "Approvisionnement", "Intégration des nouveaux employés", "Demandes urgentes après les heures d'ouverture"]
    : ["Support", "Projects", "Billing", "Network", "Workstations", "Servers", "Security", "Procurement", "New employee onboarding", "Urgent after hours requests"];
  const resources: Array<{ uri: string; name: string; template?: true }> = [];
  boards.forEach((board, index) => {
    resources.push({ uri: `perspicax://tickets/boards/${index + 10}/open`, name: fr ? `Billets ouverts, tableau ${board}` : `Open tickets, ${board} board` });
    resources.push({ uri: `perspicax://tickets/boards/${index + 10}/unassigned`, name: fr ? `Billets sans technicien, tableau ${board}` : `Unassigned tickets, ${board} board` });
  });
  const singles = fr
    ? ["Menaces ouvertes", "Menaces en quarantaine", "Agents hors ligne depuis plus de sept jours", "Sauvegardes en échec", "Sauvegardes en retard", "Coffres presque pleins", "Alertes critiques", "Correctifs manquants sur les serveurs", "Appareils sans antivirus", "Comptes verrouillés", "Licences qui expirent ce mois-ci", "Ententes à renouveler", "Factures en brouillon", "Soumissions en attente de signature", "Projets en retard sur leur échéancier", "Rendez-vous de demain", "Temps non soumis de la semaine", "Textos reçus sur la ligne principale", "Appels manqués", "Pages de documentation modifiées"]
    : ["Open threats", "Quarantined threats", "Agents offline for more than seven days", "Failed backups", "Late backups", "Vaults almost full", "Critical alerts", "Missing patches on servers", "Devices without antivirus", "Locked accounts", "Licenses expiring this month", "Agreements up for renewal", "Draft invoices", "Quotes waiting for a signature", "Projects behind schedule", "Tomorrow's appointments", "Unsubmitted time this week", "Texts on the main line", "Missed calls", "Changed documentation pages"];
  singles.forEach((name, index) => resources.push({ uri: `perspicax://watch/${index + 1}`, name }));
  const templates = fr
    ? ["Billets ouverts d'un tableau", "Billets d'un client", "Billets d'un technicien", "Un billet précis", "Menaces d'un site", "Agents d'un groupe", "Sauvegardes d'un appareil", "Alertes d'un client", "Correctifs d'un appareil", "Ententes d'un client", "Factures d'un client", "Projet précis", "Tâches d'un projet", "Rendez-vous d'un technicien", "Page de documentation d'un livre"]
    : ["Open tickets of a board", "Tickets of a client", "Tickets of a technician", "One ticket", "Threats of a site", "Agents of a group", "Backups of a device", "Alerts of a client", "Patches of a device", "Agreements of a client", "Invoices of a client", "One project", "Tasks of a project", "Appointments of a technician", "Documentation page of a book"];
  templates.forEach((name, index) => resources.push({ uri: `perspicax://template/${index + 1}/{id}`, name, template: true }));
  return resources;
}

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/watchable-resources")) {
    return new Response(JSON.stringify({
      available: true,
      resources: watchableSample(lang),
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.includes("/api/org")) {
    return new Response(JSON.stringify({ org: linked ? { name: "Org", identity: { kind: "perspicax" } } : null }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.includes("/api/")) return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
  return realFetch(input, init);
};

const bot = { id: "bot-ember", name: "Ember", color: "violet", tasks: [], threadId: "thread-ember", modelSelection: { instanceId: "", model: "" } } as unknown as Bot;
const schedules: Record<string, unknown> = {
  github: { type: "event", source: "github", events: ["issues.opened"], filters: { repo: ["org/app"] } },
  product: { type: "event", source: "perspicax", resources: ["perspicax://tickets/boards/12/open"] },
};
const routine = {
  id: "routine-1",
  name: lang === "fr" ? "Trier les nouveaux billets" : "Triage new tickets",
  prompt: lang === "fr" ? "Lis les nouveaux billets et propose qui les prend." : "Read the new tickets and suggest who takes them.",
  target: "bot", botId: bot.id, runOn: "maus", enabled: true,
  schedule: schedules[sample] ?? schedules.product,
  durationMinutes: 30, createdAt: Date.now(), updatedAt: Date.now(),
} as unknown as Routine;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <RoutineEditor routine={routine} bots={[bot]} lockedBotId={bot.id} onClose={() => {}} />
    </StoreProvider>
  </StrictMode>,
);
