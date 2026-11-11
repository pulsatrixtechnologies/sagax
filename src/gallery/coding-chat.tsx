/** Isolated gallery for the coding chat (2026-11-03): a coding task of the
 * bot panel's Coding list opened over the chat column. Synthetic data only.
 * A coding window (#2149): the X, the bot's own composer, the </> panel.
 * ?skin=<id>&lang=<code>&status=running|finished&pods=1 (Experimental on)
 * &panel=1 draws the bot panel on the right, where the session card and the
 * dev pods go (#2285). &heavy=1 (#3581): a long session, 15 rounds of reads,
 * edits and test runs (about 60 step rows), the way a heavy task reads. */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { ExchangeColumnProvider, useExchangeColumn } from "../components/BotExchangeChip";
import { ChatWindowProvider } from "../components/BotHeaderPill";
import { Composer } from "../components/Composer";
import { CodeWorkList } from "../components/bot-settings/ActivitySection";
import { CodingChatSheet } from "../components/coding/CodingChat";
import { DevPodsPanel } from "../components/dev-pods/DevPods";
import { setCodingPanelHost } from "../lib/coding-panel-host";
import { loadLocale, t } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider, useStore, type Bot, type Message } from "../state/store";
import type { BotActivityDetail } from "../../shared/bot-activity";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");
const live = params.get("status") === "running";
const withPanel = params.get("panel") === "1";
// The bot panel's tab while the coding chat is open: Coding (the session, the
// pods with Connectors, #2599) by default, ?tab=activity for Activity.
const panelTab = params.get("tab") === "activity" ? "activity" : "coding";
try {
  localStorage.setItem("sagax.devPods.v1", JSON.stringify({ enabled: params.get("pods") === "1" }));
} catch {
  // the window draws without the pods
}

// A gallery has no server: the routines and engines listings answer with
// empty lists and the live stream stays silent.
const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
  if (url.pathname === "/api/routines") return reply({ routines: [], runs: [] });
  if (url.pathname === "/api/instances") return reply({ instances: [] });
  return realFetch(input, init);
};
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

const ROOT = "/workspace/bots/osprey/dispatch-board";
const NOW = Date.now();
const at = (minutesAgo: number) => NOW - minutesAgo * 60_000;
const pretty = (value: unknown) => JSON.stringify(value, null, 2);
const bot = { id: "osprey", threadId: "main", name: "Osprey", title: "Chief of Staff", color: "green", tasks: [], messages: [], modelSelection: { instanceId: "t", model: "t" } } as unknown as Bot;

let seq = 0;
const say = (role: "user" | "bot", text: string, minutesAgo: number, extra: Partial<Message> = {}): Message => ({
  id: `g${++seq}`, role, kind: "text", text, at: at(minutesAgo), ...(role === "bot" ? { from: { botId: "osprey", name: "Osprey", color: "green" } } : {}), ...extra,
} as Message);
const call = (name: string, input: unknown, minutesAgo: number, extra: Partial<NonNullable<Message["tool"]>> = {}): Message => ({
  id: `g${++seq}`, role: "bot", kind: "activity", text: "", at: at(minutesAgo), from: { botId: "osprey", name: "Osprey", color: "green" },
  tool: { name, input: pretty(input), ok: true, ...extra },
} as Message);

const COLUMN_BEFORE = `export function sortColumn(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => a.createdAt - b.createdAt);
}`;
const COLUMN_AFTER = `export function sortColumn(cards: Card[]): Card[] {
  // Keep the order people set by hand; new cards go last.
  return [...cards].sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.createdAt - b.createdAt);
}`;

// A heavy session (#3581): 15 rounds of three reads, one edit and one test
// run, a note of the bot every third round, the fifth run failing.
const heavyRounds: Message[] = params.get("heavy") === "1"
  ? Array.from({ length: 15 }, (_, index) => {
    const minutes = 8.75 - index * 0.005;
    const lane = `lane-${index + 1}`;
    const failing = index === 4;
    return [
      call("Read", { file_path: `${ROOT}/src/board/${lane}.ts` }, minutes),
      call("Read", { file_path: `${ROOT}/src/board/${lane}.test.ts` }, minutes),
      call("Read", { file_path: `${ROOT}/src/board/column.ts` }, minutes),
      call("Edit", { file_path: `${ROOT}/src/board/${lane}.ts`, old_string: "  return cards;", new_string: "  // Keep the hand-set order.\n  return sortColumn(cards);" }, minutes),
      call("Bash", { command: `cd ${ROOT} && pnpm vitest run src/board/${lane}.test.ts` }, minutes, {
        durationMs: 2_000 + index * 150,
        ...(failing
          ? { ok: false, output: pretty({ output: ` ❯ src/board/${lane}.test.ts (4 tests | 1 failed)\n   × keeps the order\n\n      Tests  1 failed | 3 passed (4)`, exitCode: 1 }) }
          : { output: ` ✓ src/board/${lane}.test.ts (4 tests)\n\n      Tests  4 passed (4)` }),
      }),
      ...(index % 3 === 2 ? [say("bot", `Lane ${index + 1} garde maintenant l'ordre posé à la main.`, minutes)] : []),
    ];
  }).flat()
  : [];

const messages: Message[] = [
  say("user", "Pour la colonne du board, garde l'ordre que les gens placent à la main au lieu de trier par date.", 9),
  say("bot", "Je regarde comment la colonne trie ses cartes, puis je corrige et je lance les tests.", 8.8),
  ...heavyRounds,
  call("Read", { file_path: `${ROOT}/src/board/column.ts` }, 8.6),
  call("Read", { file_path: `${ROOT}/src/board/card.ts` }, 8.5),
  call("Read", { file_path: `${ROOT}/src/board/column.test.ts` }, 8.4),
  call("Edit", { file_path: `${ROOT}/src/board/column.ts`, old_string: COLUMN_BEFORE, new_string: COLUMN_AFTER }, 7.5),
  call("Edit", { file_path: `${ROOT}/src/board/card.ts`, old_string: "  createdAt: number;\n}", new_string: "  createdAt: number;\n  /** Set when someone drags the card. */\n  order?: number;\n}" }, 7.2),
  call("Bash", { command: `cd ${ROOT} && pnpm vitest run src/board` }, 6.8, {
    ok: false, durationMs: 4_300,
    output: pretty({ output: ` ❯ src/board/column.test.ts (6 tests | 1 failed)\n   × keeps a dragged card above a newer one\n     → expected [ 'b', 'a' ] to deeply equal [ 'a', 'b' ]\n\n Test Files  1 failed | 2 passed (3)\n      Tests  1 failed | 17 passed (18)`, exitCode: 1 }),
  }),
  say("bot", "Un test attend encore l'ancien ordre. Je mets le test à jour pour le nouveau comportement.", 6.5),
  call("Edit", { file_path: `${ROOT}/src/board/column.test.ts`, old_string: "  expect(sortColumn([b, a]).map((card) => card.id)).toEqual([\"b\", \"a\"]);", new_string: "  const dragged = { ...b, order: 0 };\n  expect(sortColumn([a, dragged]).map((card) => card.id)).toEqual([\"b\", \"a\"]);" }, 6),
  call("Bash", { command: `cd ${ROOT} && pnpm vitest run src/board` }, 5.4, { durationMs: 3_900, output: ` ✓ src/board/column.test.ts (6 tests)\n ✓ src/board/lane.test.ts (8 tests)\n ✓ src/board/card.test.ts (4 tests)\n\n Test Files  3 passed (3)\n      Tests  18 passed (18)` }),
  ...(live ? [
    call("Bash", { command: `cd ${ROOT} && pnpm typecheck` }, 0.4, { ok: undefined }),
  ] : [
    call("Bash", { command: `cd ${ROOT} && git add -A && git commit -m "Keep the hand-set order in board columns"` }, 4.2, { durationMs: 600, output: "[feat/column-order 3f9c2a1] Keep the hand-set order in board columns\n 3 files changed, 6 insertions(+), 2 deletions(-)" }),
    call("Bash", { command: "git push -u origin feat/column-order" }, 4, { durationMs: 1_800, output: "To github.com:acme/dispatch-board.git\n * [new branch]      feat/column-order -> feat/column-order" }),
    call("Bash", { command: "gh pr create --title \"Keep the hand-set order in board columns\" --body-file -" }, 3.8, { durationMs: 2_100, output: "https://github.com/acme/dispatch-board/pull/41" }),
    say("bot", "C'est fait. La colonne garde l'ordre posé à la main et place les nouvelles cartes à la fin.\n\n- `column.ts` trie par `order`, puis par date\n- `card.ts` ajoute le champ `order`\n- le test couvre une carte glissée au-dessus d'une plus récente\n\nLes 18 tests passent. La PR #41 est ouverte.", 3.5, {
      digest: {
        turnId: "gallery-turn", botId: "osprey", threadId: "gallery", at: at(3.5), durationMs: 330_000,
        tools: [], memory: [], reply: "C'est fait.", hookCoverage: "full",
        usage: { input: 10_200, output: 2_200 },
      },
    }),
  ]),
];

// Running gallery: one digest so the header can show tokens while the task works.
if (live) {
  const firstBot = messages.find((message) => message.role === "bot" && message.kind === "text");
  if (firstBot) {
    firstBot.digest = {
      turnId: "gallery-turn-live", botId: "osprey", threadId: "gallery", at: at(8.8), durationMs: 12_000,
      tools: [], memory: [], reply: firstBot.text ?? "", hookCoverage: "full",
      usage: { input: 10_200, output: 2_200 },
    };
  }
}

const detail: BotActivityDetail = {
  id: "thread:gallery", kind: "session", botId: "osprey", botName: "Osprey",
  title: "Pour la colonne du board, garde l'ordre que les gens placent à la main au lieu de trier par date.",
  status: live ? "running" : "finished", startedAt: at(9), ...(live ? {} : { endedAt: at(3.5) }), updatedAt: NOW, threadId: "gallery", coding: true,
  canStop: live, currentStep: live ? (params.get("lang") === "fr" ? "Vérifie les types" : "Checking types") : undefined,
  code: {
    folder: ROOT, branch: "feat/column-order", repo: "acme/dispatch-board",
    pullRequests: live ? [] : [{ repo: "acme/dispatch-board", number: 41, url: "https://github.com/acme/dispatch-board/pull/41", action: "opened", branch: "feat/column-order", at: at(3.8) }],
    branches: [], commits: live ? [] : [{ sha: "3f9c2a1d0e", message: "Keep the hand-set order in board columns", branch: "feat/column-order", pushed: true, at: at(4.2) }],
  },
  steps: [], stepsTruncated: false, files: [], children: [],
};

// The bot's pull requests and branches, below the session in the Coding tab (#2599).
const codePr = { repo: "acme/board", number: 12, title: "Sort the column by due date", url: "https://github.com/acme/board/pull/12", action: "opened" as const, branch: "fix/column-order", at: NOW - 600_000 };
const codeWork = {
  pullRequests: [codePr],
  branches: [
    { name: "fix/column-order", repo: "acme/board", pushed: true, url: "https://github.com/acme/board/tree/fix/column-order", at: NOW - 700_000, threadId: "t1", folder: "/srv/board", pull: codePr },
    { name: "feat/swimlanes", repo: "acme/board", pushed: false, at: NOW - 7_200_000, threadId: "t1", folder: "/srv/board" },
  ],
  commits: [],
};

function Ready() {
  const { dispatch } = useStore();
  const column = useExchangeColumn();
  useEffect(() => {
    dispatch({ type: "hydrate", bots: [bot], groups: [], sections: [], computerControl: {} } as never);
  }, [dispatch]);
  return (
    <div className="flex h-screen bg-app text-ink" data-gallery="">
      <div ref={column.ref} className="relative h-full min-w-0 flex-1">
        <ExchangeColumnProvider node={column.node}>
          {column.node && (
            <ChatWindowProvider value={{ panelOpen: withPanel, onTogglePanel: () => {}, composerInset: 0 }}>
            <CodingChatSheet
              item={detail}
              detail={detail}
              messages={messages}
              loaded
              failed={false}
              now={NOW}
              bot={bot}
              bots={[bot]}
              onClose={() => {}}
              onStop={live ? () => {} : undefined}
              onSend={async () => {}}
              side={<DevPodsPanel bot={bot} messages={messages} computerStart={undefined} dispatch={dispatch} />}
              composer={<Composer bot={{ ...bot, busy: live }} />}
            />
            </ChatWindowProvider>
          )}
        </ExchangeColumnProvider>
      </div>
      {withPanel && (
        <aside data-gallery-bot-panel="" className="flex h-full w-[380px] shrink-0 flex-col overflow-y-auto border-l-[0.5px] border-hairline-weak bg-[var(--bot-panel-bg)] px-4 pb-6 pt-6">
          <div role="tablist" className="flex items-center justify-center gap-1 pb-4">
            {(["activity", "library", "coding"] as const).map((id) => (
              <span key={id} role="tab" data-panel-tab={id} aria-selected={id === panelTab} className={id === panelTab ? "rounded-full bg-raised px-3 py-[3px] text-[14px] leading-5 text-ink" : "rounded-full px-3 py-[3px] text-[14px] leading-5 text-ink-secondary"}>{t(`botPanel.tab.${id}`)}</span>
            ))}
          </div>
          {panelTab === "coding"
            ? (
              <div key="coding" className="flex flex-col gap-5">
                <div ref={(element) => setCodingPanelHost(bot.id, element)} data-coding-panel-host="" className="flex flex-col gap-5 empty:hidden" />
                <section data-bot-settings-section="code-work" className="flex flex-col gap-2">
                  <CodeWorkList work={codeWork} now={NOW} branchActions={{ botId: bot.id, botName: bot.name, onArchive: async () => {}, onIgnore: () => {} }} />
                </section>
              </div>
            )
            : <div key="activity" data-gallery-activity="" className="flex flex-col gap-5" />}
        </aside>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider><Ready /></StoreProvider>
  </StrictMode>,
);
