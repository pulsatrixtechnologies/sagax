// the operator's rules for the chat, held as guard tests (2026-11-05),
// plus #2106 model-picker / composer surface guards. Each section
// names the issue and quotes the rule. They run for every PR
// (scripts/verify/release/verify-merge.mjs, GUARD_TESTS) and fail for the PR
// that merged last, so the line holds on main.
//
// Every guardrail here follows the app's own settings (the threads setting,
// useShowThreads), never a hard-coded value: the tests check that the
// gate reads the setting, and that nothing bypasses it.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AttentionCard } from "@/components/AttentionCard";
import { RoutineRunCard } from "@/components/RoutineRunCard";
import { initialState, openRoutineRun, reducer, type Action, type Message } from "@/state/store";
import type { PersonAttentionCard } from "../../shared/person-attention";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = join(ROOT, "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}
const files = sourceFiles(SRC).map((path) => ({ name: relative(SRC, path).split("\\").join("/"), text: readFileSync(path, "utf8") }));
const read = (name: string) => readFileSync(join(SRC, name), "utf8");

function runMessage(status: "running" | "completed", patch: Record<string, unknown> = {}): Message {
  return {
    id: "report", role: "bot", kind: "routine.run", at: 1, text: "Dispatch pass",
    routineRun: { runId: "run-1", routineId: "routine-1", routineName: "dispatch-gox-pass", status, executionThreadId: "exec", ...patch },
  } as Message;
}

const attention: PersonAttentionCard = {
  id: "attention-1", kind: "question", botId: "ember", botName: "Ember", threadId: "ember-job",
  items: [{ text: "Which agreement do I bill #4812 to?", ticketId: 4812 }],
  createdAt: 1,
} as PersonAttentionCard;

// #2098 (the operator, 2026-11-05: "C'EST INNACEPTABLE"): a run opens ALWAYS in the
// main chat, at the run's message in the bot's unified conversation, from
// every entry point. The side run view (Continue in the conversation, Close
// Chat) is gone.
describe("#2098 a routine run opens in the chat, never beside it", () => {
  const ENTRY_POINTS = [
    "state/store/model.ts", // View run, notifications, Inbox links, unified thread links
    "components/ChatView.tsx", // the run card in the chat
    "components/GroupView.tsx",
    "components/RoutineCalendarPage.tsx", // the grid, the Runs list, Run now
    "components/bot-settings/RoutinesSection.tsx", // a routine's panel, its Runs list
    "components/bot-settings/ActivitySection.tsx",
    "components/group-panel/GroupRoutinesSection.tsx",
    "components/routines/RoutineRowMenu.tsx",
    "components/routines/RoutineFolders.tsx",
    "components/widget/widget-device.ts",
  ];

  it("every entry point goes through openRoutineRun", () => {
    for (const name of ENTRY_POINTS) expect(read(name), name).toContain("openRoutineRun(");
  });

  it("openRoutineRun lands on the bot's chat and focuses the run's message", () => {
    const actions: Action[] = [];
    openRoutineRun((action) => actions.push(action), { runId: "run-1", routineId: "routine-1", botId: "scout" });
    expect(actions).toEqual([{ type: "openRoutineRunInChat", runId: "run-1", routineId: "routine-1", botId: "scout" }]);
    const state = {
      ...initialState,
      activeView: "routines",
      selectedId: "other",
      bots: [{ ...initialState.bots[0], id: "scout", threadId: "scout-chat", messages: [runMessage("completed")] } as never],
      routineRuns: [{ id: "run-1", botId: "scout", routineId: "routine-1" } as never],
    } as typeof initialState;
    const next = reducer(state, actions[0]!);
    expect(next.activeView).toBe("chat");
    expect(next.selectedId).toBe("scout");
    expect(next.focusMessage).toMatchObject({ threadId: "scout-chat", messageId: "report", consumed: false });
  });

  it("no component renders a run view in the side panel", () => {
    const offenders = files.filter((file) => /RoutineRunExchange|routineRunSheet|openRoutineRunSheet/.test(file.text)).map((file) => file.name);
    expect(offenders).toEqual([]);
    expect(files.some((file) => file.name === "components/routines/RoutineRunExchange.tsx")).toBe(false);
    // The store has no run sheet to open: the only run action is the chat one.
    expect("routineRunSheet" in initialState).toBe(false);
  });

  it("the calendar's details draw nothing for a run: it is on its way to the chat", () => {
    const page = read("components/RoutineCalendarPage.tsx");
    expect(page).toContain("if (showingRun && run) return null;");
    expect(page).not.toContain("<RoutineRunExchange");
  });
});

// The same rule on the phone (ios/): no run detail screen, no presenter for
// one; every entry point opens the run in the bot's chat.
describe("#2098 on iOS: a run opens in the bot's chat", () => {
  const IOS = join(ROOT, "ios");
  const swiftFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === ".build" ? [] : swiftFiles(path);
      return entry.name.endsWith(".swift") ? [path] : [];
    });
  const swift = swiftFiles(IOS).map((path) => ({ name: relative(IOS, path), text: readFileSync(path, "utf8") }));
  const readSwift = (name: string) => readFileSync(join(IOS, name), "utf8");
  const ENTRY_POINTS = [
    "App/Features/Chat/MessageRow.swift", // the run card, the attention card
    "App/ChatListView.swift", // a push on the phone
    "App/Desktop/DesktopShell.swift", // a push on the iPad
    "App/TasksRoutinesView.swift", // Automations: Runs list, calendar, a routine's panel
    "App/Profile/RoutineDetailView.swift", // a routine's page: history, Run now
  ];

  it("every iOS entry point goes through Session.openRoutineRunInChat", () => {
    for (const name of ENTRY_POINTS) expect(readSwift(name), name).toContain("openRoutineRunInChat(");
    const session = readSwift("App/Session.swift");
    expect(session).toContain("func openRoutineRunInChat(_ run: RoutineRun) async");
    expect(session).toContain("func openRoutineRunInChat(id runId: String) async");
    expect(session).not.toContain("runDetail:");
  });

  it("no iOS view draws a run detail or presents one", () => {
    const offenders = swift.filter((file) => /RoutineRunDetailView|routineRunDetail\(|OpenedRoutineRun|notificationRoutineRun/.test(file.text)).map((file) => file.name);
    expect(offenders).toEqual([]);
  });

  it("the iOS run row carries Stop while live and no thread link with threads off", () => {
    const row = readSwift("App/Cards/RoutineRunCardView.swift");
    expect(row).toContain('"routine-run-stop"');
    expect(row).toContain("if live, let stop {");
    expect(row).toContain("MarkdownText(source: summary, inert: true)");
    const chat = readSwift("App/Features/Chat/MessageRow.swift");
    expect(chat).toContain("openThread: threadsShown ? openThread : nil");
    expect(chat).toContain("stop: card.knownStatus == .running ?");
    expect(chat).toContain("reply: threadsShown ? nil :");
    expect(chat).toContain("SidebarPrefsModel.shared.showThreads");
  });
});

// #2096 (the operator): Stop leaves the bottom bar and sits on the running card, beside
// View run, as long as the run is live.
describe("#2096 Stop on the running card, not in a bottom bar", () => {
  it("the live card has a Stop that cancels the run", () => {
    const live = renderToStaticMarkup(createElement(RoutineRunCard, { message: runMessage("running", { startedAt: 1 }), onOpen: () => {}, onStop: () => {} }));
    expect(live).toContain("data-run-stop");
    expect(live).toContain('aria-label="Stop the run of dispatch-gox-pass"');
    expect(live).toContain("data-routine-run-open");
  });

  it("a finished card has no Stop", () => {
    const done = renderToStaticMarkup(createElement(RoutineRunCard, { message: runMessage("completed", { summary: "All green." }), onOpen: () => {}, onStop: () => {} }));
    expect(done).not.toContain("data-run-stop");
  });

  it("the chat wires Stop to cancelRoutineRun on the card", () => {
    const chat = read("components/ChatView.tsx");
    expect(chat).toContain('onStop={run?.runId ? () => dispatch({ type: "cancelRoutineRun", runId: run.runId }) : undefined}');
  });

  it("no bottom bar (exchange sheet footer) carries a routine's Stop", () => {
    // The sheets left (a bot exchange, a coding task) stop their own thing;
    // none cancels a routine run. The coding sheet's Stop is the task's.
    const bars = files.filter((file) => /ExchangeSheet|BotExchangeChip|coding\/CodingChat/.test(file.name) || /<ExchangeSheet/.test(file.text));
    expect(bars.length).toBeGreaterThanOrEqual(2);
    for (const bar of bars) {
      expect(bar.text, bar.name).not.toContain("cancelRoutineRun");
      expect(bar.text, bar.name).not.toMatch(/routine-runs\/[^`"']*\/cancel/);
    }
    // A routine's Stop lives on its card in the chat and in the routine panel.
    const stopUsers = files.filter((file) => file.text.includes("data-run-stop")).map((file) => file.name).sort();
    expect(stopUsers).toEqual(["components/RoutineRunCard.tsx", "components/routines/RoutineRunDetail.tsx"]);
  });
});

// #2081 (the operator, 2026-11-05: "il existe une CALISE de mode chat unifié pis tu me
// calise encore des asti de thread partout"): with the threads setting off,
// zero threads anywhere. The gate is the app's setting (useShowThreads).
describe("unified chat mode: zero threads, following the threads setting", () => {
  it("a bot's question reads as its message with an inline answer and no Open thread", () => {
    const unified = renderToStaticMarkup(createElement(AttentionCard, { card: attention, onReply: async () => {}, onOpenRun: () => {} }));
    expect(unified).toContain("data-attention-bubble");
    expect(unified).toContain("data-attention-reply");
    expect(unified).not.toContain("data-attention-open-thread");
    expect(unified).not.toContain("Open thread");
    const threaded = renderToStaticMarkup(createElement(AttentionCard, { card: attention, onOpenThread: () => {} }));
    expect(threaded).toContain("data-attention-open-thread");
  });

  it("a hand-off on a run card names the teammate without a thread link", () => {
    const handed = runMessage("completed", { handedTo: [{ botId: "katarina", threadId: "k-work", name: "Katarina", status: "completed" }] });
    const unified = renderToStaticMarkup(createElement(RoutineRunCard, { message: handed, onOpen: () => {} }));
    expect(unified).toContain("Katarina");
    expect(unified).not.toContain("data-run-teammate-thread");
    expect(unified).not.toContain("thread");
  });

  it("the chat gates every thread link and the side panel on the threads setting", () => {
    const chat = read("components/ChatView.tsx");
    expect(chat.match(/onOpenThread=\{showThreads \? /g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(chat).toContain("onReply={showThreads ? undefined : async (text) =>");
    expect(read("App.tsx-parts/ShellLayout.tsx")).toContain("{showThreads && <SideThreadPanel />}");
  });

  it("the gate reads the setting, never a hard-coded value", () => {
    const hardCoded = files.filter((file) => /const showThreads = (true|false)\b|showThreads=\{(true|false)\}/.test(file.text)).map((file) => file.name);
    expect(hardCoded).toEqual([]);
    for (const name of ["components/ChatView.tsx", "App.tsx-parts/ShellLayout.tsx"]) expect(read(name), name).toContain("useShowThreads()");
  });
});

/** Surfaces #2106 owns or sits next to: must stay unified-chat clean. */
const MODEL_PICKER_OWNED = [
  "src/components/Composer.tsx-parts/ComposerActionBar.tsx",
  "src/components/ModelPicker.tsx",
  "src/components/ModelPicker.tsx-parts",
  "src/components/ModelMenu.tsx",
  "src/lib/model-menu.ts",
  "shared/model-account-pool.ts",
  "shared/model-provider-unify.ts",
  "shared/model-auto-optimize.ts",
  "server/models/resolve-model-account.ts",
];

const MODEL_PICKER_FORBIDDEN = [
  /Open thread/i,
  /Go to conversation/i,
  /Continue in the conversation/i,
  /["']Close Chat["']/,
  /data-run-continue/,
  /routineRun\.continue/,
];

function walkTs(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) walkTs(path, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

function modelPickerOwnedFiles(): string[] {
  const files: string[] = [];
  for (const entry of MODEL_PICKER_OWNED) {
    const path = join(ROOT, entry);
    const st = statSync(path);
    if (st.isDirectory()) files.push(...walkTs(path));
    else files.push(path);
  }
  return files;
}

describe("JC unified chat guards (#2106)", () => {
  const owned = modelPickerOwnedFiles();

  it("owned model-picker / composer surfaces keep no side-thread or run-continue copy", () => {
    const offenders: string[] = [];
    for (const file of owned) {
      const text = readFileSync(file, "utf8");
      for (const pattern of MODEL_PICKER_FORBIDDEN) {
        if (pattern.test(text)) offenders.push(`${relative(ROOT, file)} :: ${pattern}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("ComposerActionBar restores a visible model chip (no headless chat-bar picker)", () => {
    const bar = readFileSync(join(ROOT, "src/components/Composer.tsx-parts/ComposerActionBar.tsx"), "utf8");
    expect(bar).toMatch(/#2106/);
    expect(bar).toMatch(/<ModelPicker inComposer/);
    expect(bar).not.toMatch(/headless/);
  });

  it("picking writes the bot default for every thread (updateBotDefault)", () => {
    const picker = readFileSync(join(ROOT, "src/components/ModelPicker.tsx"), "utf8");
    expect(picker).toMatch(/updateBotDefault:\s*true/);
    expect(picker).not.toMatch(/confirm.*model|toast.*model|warn.*model/i);
  });
});
