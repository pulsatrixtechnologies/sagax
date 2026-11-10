/** Isolated gallery for headless screenshots of an orchestrator bot's work
 * (#3451 lot 2, #3462): the Coding section of its panel (team row, the work
 * in progress, the steps of one piece of work, Done today) beside today's
 * panel of a bot without a team, and a step's coding chat beside the panel
 * that opened it. Synthetic data only, built with the shared read model
 * (shared/team-work.ts) as the server would answer. Not shipped in the app.
 * ?skin=<id>&lang=<code>&view=panel|chat|today-chat */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { ExchangeColumnProvider, useExchangeColumn } from "../components/BotExchangeChip";
import { ChatWindowProvider } from "../components/BotHeaderPill";
import { SectionHeader } from "../components/bot-settings/ActivitySection";
import { AgentRows } from "../components/bot-settings/AgentRows";
import { TeamWorkSection } from "../components/bot-settings/TeamWorkSection";
import { CodingChatSheet } from "../components/coding/CodingChat";
import { RoutineList } from "../components/routines/RoutineList";
import { PANEL_LABEL } from "../lib/grouped-card";
import { loadLocale, t } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { teamStepMetaLine, teamStepOf } from "../lib/team-work";
import type { BotActivityDetail, BotActivityItem } from "../lib/bot-activity";
import type { Routine } from "../lib/routines";
import { StoreProvider, useStore, type Bot, type Message } from "../state/store";
import { buildTeamWork, type TeamStepFacts, type TeamWork } from "../../shared/team-work";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
const lang = params.get("lang") ?? "fr";
await loadLocale(lang);
const fr = lang === "fr";
const view = params.get("view") ?? "panel";

// No server here: the store's own calls fail quietly, the stream stays silent.
class SilentEventSource {
  onmessage = null;
  onerror = null;
  onopen = null;
  readyState = 0;
  constructor(readonly url: string) {}
  addEventListener() {}
  removeEventListener() {}
  close() {}
}
(window as unknown as { EventSource: unknown }).EventSource = SilentEventSource;

const NOW = Date.now();
const M = 60_000;
const ago = (minutes: number) => NOW - minutes * M;
const bot = (id: string, name: string, title: string, color: string): Bot => ({ id, name, title, color, threadId: `${id}-main`, tasks: [], messages: [], modelSelection: { instanceId: "t", model: "t" } } as unknown as Bot);
const lead = bot("lead", "Lead", fr ? "Développement et opérations" : "Development and operations", "amber");
const bots = [
  lead,
  bot("architect", "Architect", fr ? "Architecte" : "Architect", "purple"),
  bot("tester", "Tester", fr ? "Ingénieur de tests" : "Test engineer", "yellow"),
  bot("server", "Server", fr ? "Serveur" : "Server builder", "orange"),
  bot("reviewer", "Reviewer", fr ? "Relecteur" : "Reviewer", "red"),
  bot("interface", "Interface", fr ? "Interface" : "Interface builder", "blue"),
  bot("core", "Core", fr ? "Noyau" : "Core builder", "teal"),
];
const names = new Map(bots.slice(1).map((entry) => [entry.id, { name: entry.name, title: entry.title }]));

let seq = 0;
const step = (botId: string, title: string, work: string, status: TeamStepFacts["status"], start: number, end?: number, extra: Partial<TeamStepFacts> = {}): TeamStepFacts => ({
  id: `h${++seq}`, botId, requesterBotId: "lead", threadId: `t${seq}`, title, work, mode: "work", status,
  createdAt: ago(start), startedAt: ago(start), ...(end !== undefined ? { finishedAt: ago(end) } : {}), coding: true, ...extra,
});
const W1 = fr ? "Mode proactif : demande et carte" : "Proactive mode: ask and card";
const W2 = fr ? "Cartes d'approbation compactes" : "Compact approval cards";
const W3 = fr ? "Connecteurs entre moteurs" : "Connectors between engines";
const W4 = fr ? "Profil du bot : onglet Knowledge" : "Bot profile: Knowledge tab";
const W5 = fr ? "Coupe de version" : "Version cut";
const steps: TeamStepFacts[] = [
  step("architect", fr ? "Conception" : "Design", W1, "completed", 25, 21, { did: fr ? "plan en 6 fichiers" : "a plan of 6 files", tokens: 9_000 }),
  step("tester", fr ? "Tests" : "Tests", W1, "completed", 21, 12, { did: fr ? "14 tests, rouges avant" : "14 tests, red before", tokens: 13_000 }),
  step("server", fr ? "Correction" : "Fix", W1, "running", 12, undefined, { doing: fr ? "Modifie team.ts" : "Edit team.ts", turn: { startedAt: ago(12), lastActionAt: NOW - 20_000 }, tokens: 16_000 }),
  step("architect", fr ? "Conception" : "Design", W2, "completed", 38, 30, { tokens: 40_000 }),
  step("reviewer", fr ? "Relecture" : "Review", W2, "running", 30, undefined, { turn: { startedAt: ago(30), lastActionAt: NOW - 40_000 }, tokens: 64_000 }),
  step("tester", fr ? "Tests" : "Tests", W3, "running", 60, undefined, { turn: { startedAt: ago(60), lastActionAt: NOW - 60_000, toolSince: NOW - 6 * M }, doing: fr ? "Lance les tests" : "Running tests", tokens: 120_000 }),
  step("interface", fr ? "Onglet" : "Tab", W4, "running", 21, undefined, { turn: { startedAt: ago(21), lastActionAt: NOW - 6 * M }, tokens: 126_000 }),
  step("core", fr ? "Paquet" : "Package", W5, "running", 7, undefined, { turn: { startedAt: ago(7), lastActionAt: ago(2), waitingOnComputer: true }, tokens: 69_000 }),
  ...Array.from({ length: 6 }, (_, index) => step(index % 2 ? "server" : "interface", fr ? `Correctif ${index + 1}` : `Fix ${index + 1}`, fr ? `Correctif ${index + 1}` : `Fix ${index + 1}`, "completed", 300 - index * 30, 280 - index * 30, { merged: true, did: fr ? "fusionné" : "merged" })),
  step("architect", fr ? "Plan" : "Plan", fr ? "Nettoyage des branches" : "Branch cleanup", "completed", 600, 590),
];
const built = buildTeamWork({ orchestratorId: "lead", now: NOW, since: ago(12 * 60), steps, names });
// lot 3 (the declared plan): two steps of the first piece of work to come
const work: TeamWork = {
  ...built,
  live: built.live.map((item) => item.name === W1
    ? { ...item, toCome: [{ name: fr ? "Relecture" : "Review", botId: "reviewer" }, { name: fr ? "Fusion" : "Merge" }], total: item.total + 2 }
    : item),
};
const today: BotActivityItem[] = [
  { id: "thread:own1", kind: "session", botId: "lead", botName: "Lead", title: fr ? "Corrige l'ordre des colonnes" : "Fix the column order", status: "running", startedAt: ago(21), updatedAt: NOW, threadId: "own1", currentStep: "pnpm vitest run", canStop: true, coding: true } as BotActivityItem,
  { id: "thread:own2", kind: "session", botId: "lead", botName: "Lead", title: fr ? "Écris les notes de version" : "Write the release notes", status: "finished", startedAt: ago(95), endedAt: ago(50), updatedAt: NOW, threadId: "own2", coding: true } as BotActivityItem,
];
const routine = (id: string, name: string, everyMinutes: number): Routine => ({
  id, name, prompt: "", target: "bot", botId: "lead", runOn: "maus", enabled: true,
  schedule: { type: "interval", everyMinutes, anchorAt: 1 }, durationMinutes: 30, nextRunAt: NOW + 60 * M, createdAt: 1, updatedAt: 1,
} as Routine);

function Upcoming() {
  return (
    <section data-bot-settings-section="routines" className="flex flex-col gap-2">
      <h2 className={PANEL_LABEL}>{t("routines.upcoming.title")}</h2>
      <RoutineList routines={[routine("r1", fr ? "Résumé du matin" : "Morning summary", 1440)]} runs={[]} onOpen={() => {}} grouped toggle={false} leadingClock />
    </section>
  );
}

function Panel({ kind, openThreadId }: { kind: "today" | "team"; openThreadId?: string }) {
  return (
    <aside data-gallery-panel={kind} className="flex min-h-full w-[380px] max-w-full shrink-0 flex-col gap-6 overflow-y-auto border-l-[0.5px] border-hairline-weak bg-[var(--bot-panel-bg)] px-4 pb-6 pt-4 text-ink">
      {kind === "today" ? (
        <section data-bot-settings-section="coding" className="flex flex-col gap-2">
          <SectionHeader title={t("botPanel.coding.title")} name="coding" onOpenHistory={() => {}} />
          <AgentRows items={today} onOpen={() => {}} onStop={() => {}} onIgnore={() => {}} />
        </section>
      ) : (
        <TeamWorkSection work={work} now={NOW} streaming bots={bots} orchestrator={{ name: lead.name, title: lead.title }} openThreadId={openThreadId} onOpenStep={() => {}} onOpenHistory={() => {}}>
          <AgentRows items={today} onOpen={() => {}} onStop={() => {}} onIgnore={() => {}} />
        </TeamWorkSection>
      )}
      <Upcoming />
    </aside>
  );
}

const server = bots.find((entry) => entry.id === "server")!;
const fix = steps.find((entry) => entry.botId === "server" && entry.status === "running")!;
const said = (role: "user" | "bot", text: string, minutes: number): Message => ({ id: `m${++seq}`, role, kind: "text", text, at: ago(minutes), ...(role === "bot" ? { from: { botId: "server", name: "Server", color: "orange" } } : {}) } as Message);
const callOf = (name: string, input: unknown, minutes: number, extra: Partial<NonNullable<Message["tool"]>> = {}): Message => ({
  id: `m${++seq}`, role: "bot", kind: "activity", text: "", at: ago(minutes), from: { botId: "server", name: "Server", color: "orange" }, tool: { name, input: JSON.stringify(input, null, 2), ok: true, ...extra },
} as Message);
const messages: Message[] = [
  said("user", fr ? "Corrige le mode proactif : la carte de choix doit demander un domaine à la fois." : "Fix the proactive mode: the choice card asks for one domain at a time.", 12),
  said("bot", fr ? "Je lis le plan, puis je corrige et je relance les tests." : "I read the plan, then I fix it and run the tests again.", 11.5),
  callOf("Read", { file_path: "/workspace/bots/server/app/server/proactive/team.ts" }, 11),
  callOf("Edit", { file_path: "/workspace/bots/server/app/server/proactive/team.ts", old_string: "const domains = all;", new_string: "const domains = [first];" }, 2),
  callOf("Bash", { command: "pnpm vitest run server/proactive" }, 0.4, { ok: undefined }),
];
const detail: BotActivityDetail = {
  id: `thread:${fix.threadId}`, kind: "session", botId: "server", botName: "Server", title: fix.title, status: "running",
  startedAt: ago(12), updatedAt: NOW, threadId: fix.threadId, coding: true, canStop: true, currentStep: fr ? "Lance les tests" : "Running tests",
  code: { folder: "/workspace/bots/server/app", branch: "fix/proactive-card", repo: "acme/app", pullRequests: [], branches: [], commits: [] },
  steps: [], stepsTruncated: false, files: [], children: [],
};

function Chat({ step: asStep }: { step: boolean }) {
  const { dispatch } = useStore();
  const column = useExchangeColumn();
  useEffect(() => {
    dispatch({ type: "hydrate", bots, groups: [], sections: [], computerControl: {} } as never);
  }, [dispatch]);
  const place = teamStepOf(work, fix.threadId);
  return (
    <div className="flex h-screen bg-app text-ink" data-gallery="">
      <div ref={column.ref} className="relative h-full min-w-0 flex-1">
        <ExchangeColumnProvider node={column.node}>
          {column.node && (
            <ChatWindowProvider value={{ panelOpen: true, onTogglePanel: () => {}, composerInset: 0 }}>
              <CodingChatSheet
                item={detail}
                detail={detail}
                messages={messages}
                loaded
                failed={false}
                now={NOW}
                bot={server}
                bots={bots}
                onClose={() => {}}
                onStop={() => {}}
                onSend={async () => {}}
                {...(asStep && place ? { stepLine: teamStepMetaLine(place, NOW), quietSince: NOW - 20_000, panelBotId: "lead", title: fix.title } : {})}
              />
            </ChatWindowProvider>
          )}
        </ExchangeColumnProvider>
      </div>
      {/* a narrow window shows the chat alone, as the app does */}
      <div className="contents max-[699px]:hidden">
        <Panel kind={asStep ? "team" : "today"} openThreadId={asStep ? fix.threadId : undefined} />
      </div>
    </div>
  );
}

function Gallery() {
  if (view === "chat") return <Chat step />;
  if (view === "today-chat") return <Chat step={false} />;
  return (
    <div data-gallery-panels="" className="flex min-h-screen flex-wrap items-start gap-6 bg-app">
      <Panel kind="today" />
      <Panel kind="team" />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider><Gallery /></StoreProvider>
  </StrictMode>,
);
