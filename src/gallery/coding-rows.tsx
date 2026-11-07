/** Isolated gallery for the bot panel's Coding rows (JC, 2026-11-07): the
 * first card is JC's reference (Merged, Ready for review), the second one
 * every state. Not shipped in the app. ?skin=<id>&lang=<code> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CodingSessionRow } from "../components/bot-settings/CodingSessionRow";
import type { CodingRowPull } from "../lib/coding-row-state";
import { PANEL_CARD, PANEL_LABEL } from "../lib/grouped-card";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import type { BotActivityStatus } from "../lib/bot-activity";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");

const pull = (number: number, extra: Partial<CodingRowPull> = {}): CodingRowPull => ({ number, url: `https://github.com/acme/web/pull/${number}`, state: "open", ...extra });
const reference: Array<[string, BotActivityStatus, CodingRowPull?]> = [
  ["RVSQ S3: rebase PR #3 onto main", "finished", pull(3, { state: "merged" })],
  ["Recording tags, favorites API and stream merging", "finished", pull(40)],
];
const all: Array<[string, BotActivityStatus, CodingRowPull?]> = [
  ["Fix the column order", "running"],
  ["Write the release notes", "waiting"],
  ["Tidy the widgets grid", "failed"],
  ["Spike the old parser (no pull request)", "finished"],
  ["Dark mode, first draft", "finished", pull(41, { draft: true })],
  ["Ready for review", "finished", pull(40)],
  ["Lexer split", "finished", pull(44, { review: "changes_requested" })],
  ["Search index", "finished", pull(45, { checks: "failing" })],
  ["Old parser spike", "finished", pull(12, { state: "closed" })],
  ["Merged", "finished", pull(3, { state: "merged" })],
];

function Card({ rows }: { rows: Array<[string, BotActivityStatus, CodingRowPull?]> }) {
  return (
    <ul className={PANEL_CARD}>
      {rows.map(([title, status, p]) => <CodingSessionRow key={title} title={title} status={status} pull={p} onOpen={() => {}} />)}
    </ul>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <aside data-gallery-panel="" className="min-h-screen w-[420px] bg-panel p-4 text-ink">
      <div className="flex flex-col gap-6">
        <section data-card="reference" className="flex flex-col gap-2"><h2 className={PANEL_LABEL}>Coding</h2><Card rows={reference} /></section>
        <section data-card="all" className="flex flex-col gap-2"><h2 className={PANEL_LABEL}>All states</h2><Card rows={all} /></section>
      </div>
    </aside>
  </StrictMode>,
);
