/** Isolated gallery for Playwright screenshots of the bot panel's Details:
 * Coding (pull requests, branches, commits) above Routines, so the two
 * cards compare side by side (JC 2026-10-19: "le même encadré"). Branches:
 * not pushed, pushed, pull request open, merged, and one archived. The
 * capture script (scripts/capture-bot-panel-coding.mjs) answers /api itself
 * with each branch read now. Not shipped in the app.
 * ?skin=<id>&lang=<code> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CalendarClock, Plus, SquareTerminal } from "lucide-react";
import { CodeWorkList, SectionHeader } from "../components/bot-settings/ActivitySection";
import { RoutineList } from "../components/routines/RoutineList";
import { setLocale, t } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider } from "../state/store";
import type { Routine } from "../lib/routines";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
setLocale(params.get("lang") ?? "fr");

const NOW = Date.now();
const H = 3_600_000;
const pr = { repo: "acme/web", number: 42, title: "IT tools widgets", url: "https://github.com/acme/web/pull/42", action: "opened" as const, branch: "feat/dark-mode", at: NOW - 2 * H };
const merged = { repo: "acme/web", number: 37, title: "Lexer split", url: "https://github.com/acme/web/pull/37", action: "merged" as const, branch: "fix/lexer", at: NOW - 30 * H };
const work = {
  pullRequests: [pr, merged],
  branches: [
    { name: "feat/it-tools-widgets", repo: "acme/web", pushed: false, at: NOW - 15 * H, threadId: "t1", folder: "/srv/web" },
    // On the bot's own computer: actionable (place "remote"), and offline.
    { name: "feat/on-bot-computer", repo: "acme/web", pushed: false, at: NOW - 3 * H, threadId: "t1", folder: "/srv/web" },
    { name: "feat/bot-offline", repo: "acme/web", pushed: false, at: NOW - 40 * H, threadId: "t1", folder: "/srv/web" },
    { name: "feat/search-index", repo: "acme/web", pushed: true, url: "https://github.com/acme/web/tree/feat/search-index", at: NOW - 5 * H, threadId: "t1", folder: "/srv/web" },
    { name: "feat/dark-mode", repo: "acme/web", pushed: true, url: "https://github.com/acme/web/tree/feat/dark-mode", at: NOW - 2 * H, threadId: "t1", folder: "/srv/web", pull: pr },
    { name: "fix/lexer", repo: "acme/web", pushed: true, url: "https://github.com/acme/web/tree/fix/lexer", at: NOW - 30 * H, threadId: "t1", folder: "/srv/web", pull: merged },
  ],
  commits: [{ sha: "1a2b3c4d5e", message: "Add the widgets grid", branch: "feat/it-tools-widgets", repo: "acme/web", pushed: false, at: NOW - 15 * H }],
  archivedBranches: [{ name: "spike/old-parser", repo: "acme/web", pushed: false, at: NOW - 80 * H, threadId: "t1", folder: "/srv/web" }],
};
const routine = (id: string, name: string, everyMinutes: number): Routine => ({
  id, name, prompt: "", target: "bot", botId: "pepper", runOn: "maus", enabled: true,
  schedule: { type: "interval", everyMinutes, anchorAt: 1 }, durationMinutes: 30, nextRunAt: NOW + H, createdAt: 1, updatedAt: 1,
} as Routine);

function Panel() {
  return (
    <aside data-gallery-panel="" className="min-h-screen w-[380px] border-r border-hairline/40 bg-panel text-ink">
      <div className="flex flex-col gap-6 px-4 pb-6 pt-4">
        <section data-bot-settings-section="coding" className="flex flex-col gap-2">
          <SectionHeader icon={<SquareTerminal size={16} aria-hidden="true" className="text-ink-secondary" />} title={t("botPanel.coding.title")} name="coding" onOpenHistory={() => {}} />
          <CodeWorkList work={work} now={NOW} branchActions={{ botId: "pepper", onArchive: async () => {} }} />
        </section>
        <section data-bot-settings-section="routines" className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <CalendarClock size={16} className="text-ink-secondary" />
            <h2 className="min-w-0 flex-1 text-[13px] font-normal leading-[18px] text-ink-secondary">{t("computer.tab.routines")}</h2>
            <span className="ui-icon-button"><Plus size={15} /></span>
          </div>
          <RoutineList routines={[routine("r1", "Résumé du matin", 1440), routine("r2", "Revue des billets ouverts", 60)]} runs={[]} onOpen={() => {}} grouped toggle={false} />
        </section>
      </div>
    </aside>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <Panel />
    </StoreProvider>
  </StrictMode>,
);
