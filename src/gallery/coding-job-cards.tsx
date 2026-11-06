/** Isolated gallery for headless screenshots of a coding job in the bot's
 * chat (#2148, JC 2026-11-06): the card while it runs (status, elapsed time,
 * Stop) and once finished (branch, short result, PR link), under the person's
 * request. It never opens a thread. Neutral fictional bot and repo.
 * Not shipped in the app.
 * ?skin=<id>&lang=<code> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { CodingJobCard } from "../components/CodingJobCard";
import { codingJobView } from "../lib/coding-job-card";
import type { BotActivityItem } from "../lib/bot-activity";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "fr");

const NOW = Date.now();
const M = 60_000;
const running = {
  id: "thread:job-1", kind: "session", botId: "pepper", botName: "Pepper", title: "Corriger l'ordre des colonnes du tableau de dispatch",
  status: "running", startedAt: NOW - 6 * M - 12_000, updatedAt: NOW, threadId: "job-1", coding: true, currentStep: "Exécute les tests du tableau",
  code: { folder: "/srv/repos/dispatch-board", branch: "fix/column-order", repo: "acme/dispatch-board", pullRequests: [], branches: [{ name: "fix/column-order", repo: "acme/dispatch-board", pushed: false, at: NOW - 2 * M }], commits: [] },
} as BotActivityItem;
const finished = {
  id: "thread:job-0", kind: "session", botId: "pepper", botName: "Pepper", title: "Ajouter le widget des outils TI",
  status: "finished", startedAt: NOW - 52 * M, endedAt: NOW - 31 * M, updatedAt: NOW - 31 * M, threadId: "job-0", coding: true,
  code: {
    folder: "/srv/repos/marketplace", branch: "feat/it-tools-widget", repo: "acme/marketplace",
    pullRequests: [{ repo: "acme/marketplace", number: 42, title: "Widget des outils TI", url: "https://github.com/acme/marketplace/pull/42", action: "opened", branch: "feat/it-tools-widget", at: NOW - 32 * M }],
    branches: [{ name: "feat/it-tools-widget", repo: "acme/marketplace", pushed: true, url: "https://github.com/acme/marketplace/tree/feat/it-tools-widget", at: NOW - 33 * M }],
    commits: [],
  },
} as BotActivityItem;
const result = "J'ai ajouté le widget en grille de trois colonnes, avec ses tests. Les 48 tests passent et la PR est ouverte.";

function Bubble({ text }: { text: string }) {
  return <div className="ml-auto w-fit max-w-[70%] rounded-[18px] bg-bubble-user px-3 py-[7px] text-[13px] leading-5 text-ink">{text}</div>;
}

function Chat() {
  return (
    <main data-gallery-chat="" className="min-h-screen bg-app px-6 py-6 text-ink">
      <div className="mx-auto flex max-w-[720px] flex-col gap-5">
        <Bubble text="Ajoute le widget des outils TI au marketplace." />
        <CodingJobCard job={codingJobView(finished, result)} threadId="job-0" now={NOW} />
        <Bubble text="Corrige aussi l'ordre des colonnes du tableau de dispatch." />
        <CodingJobCard job={codingJobView(running)} threadId="job-1" now={NOW} onStop={() => {}} />
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <Chat />
    </StoreProvider>
  </StrictMode>,
);
