/** Isolated gallery for the coding chat (2026-11-03): a coding task of the
 * bot panel's Coding list opened over the chat column. Synthetic data only.
 * ?skin=<id>&lang=<code>&status=running|finished&compose=1 */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { ExchangeColumnProvider, useExchangeColumn } from "../components/BotExchangeChip";
import { CodingChatSheet } from "../components/coding/CodingChat";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider, useStore, type Bot, type Message } from "../state/store";
import type { BotActivityDetail } from "../../shared/bot-activity";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");
const live = params.get("status") === "running";

const ROOT = "/workspace/bots/osprey/dispatch-board";
const NOW = Date.now();
const at = (minutesAgo: number) => NOW - minutesAgo * 60_000;
const pretty = (value: unknown) => JSON.stringify(value, null, 2);
const bot = { id: "osprey", threadId: "main", name: "Osprey", color: "green", tasks: [], modelSelection: { instanceId: "t", model: "t" } } as unknown as Bot;

let seq = 0;
const say = (role: "user" | "bot", text: string, minutesAgo: number): Message => ({
  id: `g${++seq}`, role, kind: "text", text, at: at(minutesAgo), ...(role === "bot" ? { from: { botId: "osprey", name: "Osprey", color: "green" } } : {}),
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

const messages: Message[] = [
  say("user", "Pour la colonne du board, garde l'ordre que les gens placent à la main au lieu de trier par date.", 9),
  say("bot", "Je regarde comment la colonne trie ses cartes, puis je corrige et je lance les tests.", 8.8),
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
    say("bot", "C'est fait. La colonne garde l'ordre posé à la main et place les nouvelles cartes à la fin.\n\n- `column.ts` trie par `order`, puis par date\n- `card.ts` ajoute le champ `order`\n- le test couvre une carte glissée au-dessus d'une plus récente\n\nLes 18 tests passent. La PR #41 est ouverte.", 3.5),
  ]),
];

const detail: BotActivityDetail = {
  id: "thread:gallery", kind: "session", botId: "osprey", botName: "Osprey",
  title: "Pour la colonne du board, garde l'ordre que les gens placent à la main au lieu de trier par date.",
  status: live ? "running" : "finished", startedAt: at(9), ...(live ? {} : { endedAt: at(3.5) }), updatedAt: NOW, threadId: "gallery", coding: true,
  canStop: live, currentStep: live ? "pnpm typecheck" : undefined,
  code: {
    folder: ROOT, branch: "feat/column-order", repo: "acme/dispatch-board",
    pullRequests: live ? [] : [{ repo: "acme/dispatch-board", number: 41, url: "https://github.com/acme/dispatch-board/pull/41", action: "opened", branch: "feat/column-order", at: at(3.8) }],
    branches: [], commits: live ? [] : [{ sha: "3f9c2a1d0e", message: "Keep the hand-set order in board columns", branch: "feat/column-order", pushed: true, at: at(4.2) }],
  },
  steps: [], stepsTruncated: false, files: [], children: [],
};

function Ready() {
  const { dispatch } = useStore();
  const column = useExchangeColumn();
  useEffect(() => {
    dispatch({ type: "hydrate", bots: [bot], groups: [], sections: [], computerControl: {} } as never);
  }, [dispatch]);
  return (
    <div className="h-screen bg-app text-ink" data-gallery="">
      <div ref={column.ref} className="relative mx-auto h-full max-w-[960px] border-x border-hairline/30">
        <ExchangeColumnProvider node={column.node}>
          {column.node && (
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
              composing={params.get("compose") === "1"}
            />
          )}
        </ExchangeColumnProvider>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider><Ready /></StoreProvider>
  </StrictMode>,
);
