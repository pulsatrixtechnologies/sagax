/** Isolated gallery for Playwright screenshots of the bot panel's Details:
 * Coding (pull requests, branches, commits) above Routines, so the two
 * cards compare side by side (2026-10-19: "le même encadré"). Branches:
 * not pushed, pushed, pull request open, merged, and one archived. The
 * capture script (scripts/capture/bot-panel-coding.mjs) answers /api itself
 * with each branch read now. Above the branches, the agent rows (#2099):
 * Claude Code's agent list, one row each, "↓ N more" past five. Not shipped
 * in the app.
 * ?skin=<id>&lang=<code> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PANEL_LABEL } from "../lib/grouped-card";
import { CodeWorkList, SectionHeader } from "../components/bot-settings/ActivitySection";
import { AgentRows } from "../components/bot-settings/AgentRows";
import type { BotActivityItem, BotLaunchedAgentItem } from "../lib/bot-activity";
import type { TaskUsage } from "../state/store";
import { RoutineList } from "../components/routines/RoutineList";
import { loadLocale, t } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider } from "../state/store";
import type { Routine } from "../lib/routines";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "fr");

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
const M = 60_000;
const item = (id: string, title: string, status: BotActivityItem["status"], startedMinutesAgo: number, currentStep?: string, endedMinutesAgo?: number): BotActivityItem => ({
  id: `thread:${id}`, kind: "session", botId: "pepper", botName: "Pepper", title, status,
  startedAt: NOW - startedMinutesAgo * M, updatedAt: NOW, endedAt: endedMinutesAgo === undefined ? undefined : NOW - endedMinutesAgo * M,
  threadId: id, currentStep, canStop: true,
} as BotActivityItem);
const agents: BotActivityItem[] = [
  item("a1", "Fix the column order", "running", 21, "cd dispatch-board && pnpm vitest run src/board"),
  item("a2", "Write the release notes", "waiting", 8, "sleep 30; pgrep -f vite"),
  item("a3", "Review the lexer split", "finished", 95, undefined, 50),
  item("a4", "Tidy the widgets grid", "failed", 130, undefined, 120),
  item("a5", "Index the search", "finished", 300, undefined, 280),
  item("a6", "Spike the old parser", "stopped", 900, undefined, 890),
  // a finished conversation with no known end: no number (was "228h 06m")
  item("a7", "Peux tu me créer un fichier html", "finished", 228 * 60 + 6),
];
const launched: BotLaunchedAgentItem[] = [
  { id: "l1", targetBotId: "marc", targetBotName: "Marc", title: "work", status: "running", startedAt: NOW - 4 * M, updatedAt: NOW, threadId: "l1" },
];
const usage: Record<string, TaskUsage> = { a1: { input: 95_300, output: 6_500, costUsd: null, turns: 12 }, a3: { input: 11_200, output: 1_200, costUsd: null, turns: 3 } };
const routine = (id: string, name: string, everyMinutes: number): Routine => ({
  id, name, prompt: "", target: "bot", botId: "pepper", runOn: "maus", enabled: true,
  schedule: { type: "interval", everyMinutes, anchorAt: 1 }, durationMinutes: 30, nextRunAt: NOW + H, createdAt: 1, updatedAt: 1,
} as Routine);

function Panel() {
  return (
    <aside data-gallery-panel="" className="min-h-screen w-[380px] border-r border-hairline/40 bg-panel text-ink">
      <div className="flex flex-col gap-6 px-4 pb-6 pt-4">
        <section data-bot-settings-section="coding" className="flex flex-col gap-2">
          <SectionHeader title={t("botPanel.coding.title")} name="coding" onOpenHistory={() => {}} />
          <AgentRows items={agents} launched={launched} onOpen={() => {}} onOpenLaunched={() => {}} onStop={() => {}} now={NOW} usageOf={(threadId) => usage[threadId]} onIgnore={() => {}} />
          <CodeWorkList work={work} now={NOW} branchActions={{ botId: "pepper", botName: "Pepper", onArchive: async () => {}, onIgnore: () => {} }} />
        </section>
        {/* The real panel's Upcoming (PANEL_LABEL + PANEL_CARD), so the two compare side by side. */}
        <section data-bot-settings-section="routines" className="flex flex-col gap-2">
          <h2 className={PANEL_LABEL}>{t("routines.upcoming.title")}</h2>
          <RoutineList routines={[routine("r1", "Résumé du matin", 1440), routine("r2", "Revue des billets ouverts", 60)]} runs={[]} onOpen={() => {}} grouped toggle={false} leadingClock />
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
