// the operator's rules, held as guard tests on every PR
// (scripts/verify/release/verify-merge.mjs, GUARD_TESTS). Each section names
// the issue and quotes the rule. They fail for the PR that merged last, so
// the line holds on main.
//
// Chat / routines (#2081, #2096, #2098): a run opens in the chat, Stop sits
// on the running card, and with threads off there are zero thread links.
// Every gate follows the app's own setting (useShowThreads), never a
// hard-coded value.
//
// Model picker / composer (#2106): owned surfaces stay unified-chat clean
// (no side-thread or run-continue copy), the chat-bar model chip stays
// visible, and picking writes the bot default for every thread.
//
// Approvals (#2091, #2086):
// 1. Every approval or permission card offers "Always allow", which keeps a
//    rule; the only card without it is an organization Refuse / Ask first
//    rule decided in Perspicax, and that card says so in plain words.
// 2. Every approval passes through the one settings-linked decision (Full
//    access, the person's Always / Ask / Deny rules, the organization's
//    Perspicax settings): the card's emitter carries the full-access marker,
//    like server/approvals/full-access-gate.guard.test.ts asks.
// 3. No "never always" list anywhere: no tool, write, payment, remote MCP,
//    shell, send, connector or delete is kept from Always by caution.
// 4. No admin gate on the person's own space: `{admin &&` and
//    `memberHidesSection` only where the thing is the whole organization's.
//
// Unified chat static scans (#2086): Open thread / Go to conversation locale
// keys and hard-coded strings stay gated or allowlisted; SideThreadPanel sits
// behind showThreads; no new "· Results" thread titles outside the Cloud-guest
// fallback. French catalog values carry no em-dash or en-dash; UI locale
// strings embed no raw UUID.
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
import { FULL_ACCESS_MARKER, FULL_ACCESS_SURFACES } from "../../server/approvals/full-access-gate.ts";
import { recipientKeysForSendCard } from "../../shared/send-card-recipients.ts";
import { parseGoMessage } from "../../server/perspicax/go-message.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = join(ROOT, "src");
const SKIP = /\.(?:test|e2e|dom\.test)\.tsx?$|\.d\.ts$|\/testing\/|\/self-knowledge\/|\/locales\//;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "testing" || entry.name === "self-knowledge" || entry.name === "locales") return [];
      return sourceFiles(path);
    }
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}
const files = sourceFiles(SRC).map((path) => ({ name: relative(SRC, path).split("\\").join("/"), text: readFileSync(path, "utf8") }));
const readSrc = (name: string) => readFileSync(join(SRC, name), "utf8");

function* walkSources(dir: string, ext: RegExp): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (entry === "node_modules" || entry === "testing" || entry === "self-knowledge" || entry === "locales") continue;
    if (statSync(path).isDirectory()) { yield* walkSources(path, ext); continue; }
    if (!ext.test(path) || SKIP.test(path)) continue;
    yield path;
  }
}

const rel = (file: string) => relative(ROOT, file).split("\\").join("/");
const readRoot = (file: string) => readFileSync(join(ROOT, file), "utf8");

function runMessage(status: "running" | "completed", patch: Record<string, unknown> = {}): Message {
  return {
    id: "report", role: "bot", kind: "routine.run", at: 1, text: "Dispatch pass",
    routineRun: { runId: "run-1", routineId: "routine-1", routineName: "dispatch-acme-pass", status, executionThreadId: "exec", ...patch },
  } as Message;
}

const attention: PersonAttentionCard = {
  id: "attention-1", kind: "question", botId: "ember", botName: "Ember", threadId: "ember-job",
  items: [{ text: "Which agreement do I bill #4812 to?", ticketId: 4812 }],
  createdAt: 1,
} as PersonAttentionCard;

// #2098 (the operator, 2026-11-05: "C'EST INNACEPTABLE"), then #2272 (the owner,
// 2026-11-06: "It not doing anything when I click it"): a run opens from
// every entry point as its own window over the bot's chat column, shaped
// like a bot-to-bot exchange (ExchangeSheet, X to close). Never a thread,
// a side panel or a Continue/Open thread button (one conversation, #2081).
describe("#2272 a routine run opens as its window over the chat, from every entry point", () => {
  const ENTRY_POINTS = [
    "state/store/model.ts", // View run, notifications, Inbox links, unified thread links
    "components/ChatView.tsx-parts/chips.tsx", // the run card in the chat (#1383 leaf)
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
    for (const name of ENTRY_POINTS) expect(readSrc(name), name).toContain("openRoutineRun(");
  });

  it("openRoutineRun opens the run's window on the bot's chat, even when its report is not loaded", () => {
    const actions: Action[] = [];
    openRoutineRun((action) => actions.push(action), { runId: "run-1", routineId: "routine-1", botId: "scout" });
    expect(actions).toEqual([{ type: "openRoutineRunWindow", runId: "run-1", routineId: "routine-1", botId: "scout" }]);
    const state = {
      ...initialState,
      activeView: "routines",
      selectedId: "other",
      bots: [{ ...initialState.bots[0], id: "scout", threadId: "scout-chat", messages: [] } as never],
      routineRuns: [{ id: "run-1", botId: "scout", routineId: "routine-1" } as never],
    } as typeof initialState;
    const next = reducer(state, actions[0]!);
    expect(next.activeView).toBe("chat");
    expect(next.selectedId).toBe("scout");
    expect(next.routineRunWindow).toEqual({ runId: "run-1", routineId: "routine-1", botId: "scout" });
  });

  it("the window is the bot-to-bot exchange shell, rendered over the main chat, with no thread button", () => {
    const window = readSrc("components/routines/RoutineRunWindow.tsx");
    expect(window).toContain("<ExchangeSheet");
    expect(window).not.toMatch(/continueRoutineRunInConversation|openGroupThread|openThread|routineRun\.continue/);
    expect(readSrc("components/ChatView.tsx-parts/ChatViewSheets.tsx")).toContain("<RoutineRunWindow");
    // The old shapes stay gone.
    const offenders = files.filter((file) => /RoutineRunExchange|routineRunSheet|openRoutineRunSheet|openRoutineRunInChat/.test(file.text)).map((file) => file.name);
    expect(offenders).toEqual([]);
  });

  it("the calendar's details draw nothing for a run: its window opens over the chat", () => {
    const page = readSrc("components/RoutineCalendarPage.tsx");
    expect(page).toContain("if (showingRun && run) return null;");
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
    // #2432 (iPad parity round 6): the report reads as the bot's bubble.
    expect(row).toContain("MarkdownText(source: report, inert: true)");
    const chat = readSwift("App/Features/Chat/MessageRow.swift");
    expect(chat).toContain("openThread: threadsShown ? openThread : nil");
    // #2432: the row always hands Stop; the card shows it while live
    // (queued, running, waiting), as the desktop card does.
    expect(chat).toContain("stop: { Task { await session.cancelRoutineRun(id: card.runId) } },");
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
    expect(live).toContain('aria-label="Stop the run of dispatch-acme-pass"');
    expect(live).toContain("data-routine-run-open");
  });

  it("a finished card has no Stop", () => {
    const done = renderToStaticMarkup(createElement(RoutineRunCard, { message: runMessage("completed", { summary: "All green." }), onOpen: () => {}, onStop: () => {} }));
    expect(done).not.toContain("data-run-stop");
  });

  it("the chat wires Stop to cancelRoutineRun on the card", () => {
    // #1383: RoutineRunRow lives in ChatView.tsx-parts/chips.tsx
    const chips = readSrc("components/ChatView.tsx-parts/chips.tsx");
    expect(chips).toContain('onStop={run?.runId ? () => dispatch({ type: "cancelRoutineRun", runId: run.runId }) : undefined}');
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
    // #2417: one conversation draws the shared question sheet (the bot's
    // question, one-tap choices, a field in words), never the old bubble.
    expect(unified).toContain("data-attention-sheet");
    expect(unified).toContain("data-attention-question");
    expect(unified).toContain("<textarea");
    expect(unified).not.toContain("data-attention-bubble");
    expect(unified).not.toContain("data-attention-open-thread");
    expect(unified).not.toContain("Open thread");
    const threaded = renderToStaticMarkup(createElement(AttentionCard, { card: attention, onOpenThread: () => {} }));
    expect(threaded).toContain("data-attention-open-thread");
  });

  it("a hand-off on a run card names the teammate without a thread link", () => {
    const handed = runMessage("completed", { handedTo: [{ botId: "wren", threadId: "k-work", name: "Wren", status: "completed" }] });
    const unified = renderToStaticMarkup(createElement(RoutineRunCard, { message: handed, onOpen: () => {} }));
    expect(unified).toContain("Wren");
    expect(unified).not.toContain("data-run-teammate-thread");
    expect(unified).not.toContain("thread");
  });

  it("the chat gates every thread link and the side panel on the threads setting", () => {
    // #1383: AttentionRow / RoutineRunRow gates live in chips.tsx
    const chips = readSrc("components/ChatView.tsx-parts/chips.tsx");
    expect(chips.match(/onOpenThread=\{showThreads \? /g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(chips).toContain("onReply={showThreads ? undefined : async (text) =>");
    expect(readSrc("App.tsx-parts/ShellLayout.tsx")).toContain("{showThreads && <SideThreadPanel />}");
  });

  it("the gate reads the setting, never a hard-coded value", () => {
    const hardCoded = files.filter((file) => /const showThreads = (true|false)\b|showThreads=\{(true|false)\}/.test(file.text)).map((file) => file.name);
    expect(hardCoded).toEqual([]);
    for (const name of ["components/ChatView.tsx-parts/useChatViewSession.ts", "components/ChatView.tsx-parts/chips.tsx", "App.tsx-parts/ShellLayout.tsx"]) {
      expect(readSrc(name), name).toContain("useShowThreads()");
    }
  });
});

// ── 1. every card type offers Always allow ──────────────────────────────────

/** A card the person answers: its `options:` line as the server writes it. */
const CARD_OPTIONS = /\boptions: \[(?:"Allow", "Deny"(?:, "Always allow")?|"Confirm", "Cancel"|"Remember", "Skip"|"Ouvrir un terminal", "Refuser"|approve, decline|"allow", "always_allow", "deny"|"deny")\]/;

/** What on the card (its object literal, around the options line) carries
 * the rule Always allow keeps:
 *  - `ownerRule`: the rule itself (server/approvals/owner-approval.ts), saved
 *    by saveOwnerRuleFromCard and matched by keptCardRule on the next card;
 *  - `always_allow` / "Always allow": a Primary Bot or peer card option that
 *    maps to a rule (primary-approvals.ts `always: "rule"`);
 *  - a proposal payload (`routineRequest`, `ruleRequest`, `profileRequest`,
 *    `teamMemoryRequest`, `modelRequest`): proposalRuleCandidate puts the
 *    rule on the card (settleProposalByRule), checked below;
 *  - a send (`emailSendRequest`, `tool: "send_message"`): Always allow adds
 *    the recipients to the bot's list (shared/send-card-recipients.ts),
 *    checked below with the helper itself. */
const RULE_ON_CARD = /\bownerRule\b|"always_allow"|"Always allow"|\browtineRequest\b|\broutineRequest\b|\bruleRequest\b|\bprofileRequest\b|\bteamMemoryRequest\b|\bmodelRequest\b|\bemailSendRequest\b|tool: "send_message"/;

/** The cards that offer no Always allow, each by the operator's own decision, never
 * by an agent's caution. The key is `file` + a text the options line's
 * window carries. */
const NO_ALWAYS_BY_DECISION: ReadonlyArray<{ file: string; marker: RegExp; why: string }> = [
  {
    file: "server/outbound/outbound-wiring.ts", marker: /phoneCallConsent/,
    why: "a one-time consent that turns phone calls on: a setting, never an approval of one call (full-access: exempt)",
  },
  {
    file: "server/rules/rule-requests.ts", marker: /autoApplied: true/,
    why: "a rule proposal already applied at Full: the card is shown answered, nothing to allow",
  },
];

interface CardHit { file: string; line: number; text: string; window: string }

function cardEmitters(): CardHit[] {
  const hits: CardHit[] = [];
  for (const file of walkSources(join(ROOT, "server"), /\.ts$/)) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((text, index) => {
      if (/^\s*(?:\/\/|\*)/.test(text) || !CARD_OPTIONS.test(text)) return;
      // the card's object literal: the lines around the options line
      const window = lines.slice(Math.max(0, index - 14), index + 22).join("\n");
      hits.push({ file: rel(file), line: index + 1, text: text.trim(), window });
    });
  }
  return hits;
}

const cards = cardEmitters();
const describeCard = (hit: CardHit) => `${hit.file}:${hit.line}: ${hit.text.slice(0, 90)}`;

describe("every approval card offers Always allow, which keeps a rule (#2091)", () => {
  it("finds the card emitters at all", () => {
    expect(cards.length).toBeGreaterThan(15);
    // #1388: approval card emitters left server/index.ts for index-leaves/
    expect(cards.some((hit) => hit.file.startsWith("server/index-leaves/"))).toBe(true);
    expect(cards.some((hit) => hit.file === "server/outbound/outbound-wiring.ts")).toBe(true);
  });

  it("each card carries its rule, or is on the operator's own list of cards without one", () => {
    const decided = (hit: CardHit) => NO_ALWAYS_BY_DECISION.find((row) => row.file === hit.file && row.marker.test(hit.window));
    const without = cards.filter((hit) => !RULE_ON_CARD.test(hit.window) && !decided(hit)).map(describeCard);
    expect(without, "an approval card with nothing for Always allow to keep: give it an ownerRule (owner-approval.ts) or a proposal payload; never a card without Always (decided 2026-11-05)").toEqual([]);
    // the list names only cards that exist, and none that already offers a rule
    for (const row of NO_ALWAYS_BY_DECISION) {
      const hit = cards.find((card) => card.file === row.file && row.marker.test(card.window));
      expect(hit, `${row.file} ${row.marker}: no such card any more; drop it from NO_ALWAYS_BY_DECISION`).toBeDefined();
    }
  });

  it("a proposal card gets its rule from proposalRuleCandidate, for every proposal kind", () => {
    // #1388: proposalRuleCandidate and settleProposalByRule live in index-leaves/
    const candidateSrc = readRoot("server/index-leaves/proposalRuleCandidate.ts");
    const start = candidateSrc.indexOf("function proposalRuleCandidate(");
    expect(start).toBeGreaterThan(0);
    const body = candidateSrc.slice(start);
    for (const key of ["routineRequest", "profileRequest", "ruleRequest", "teamMemoryRequest", "modelRequest"]) {
      expect(body, `proposalRuleCandidate reads no ${key}`).toContain(key);
    }
    // the candidate is put on the card before a kept rule settles it
    const settleSrc = readRoot("server/index-leaves/settleProposalByRule.ts");
    expect(settleSrc).toMatch(/store\.patchMessage\(threadId, message\.id, \{ card: \{ \.\.\.card, ownerRule: \{ tool: candidate\.tool/);
  });

  it("a send card's Always allow keeps the recipients: an email draft and an iMessage", () => {
    expect(recipientKeysForSendCard({ emailSendRequest: { draft: { to: ["someone@example.test"], cc: ["Other@example.test"] } } }))
      .toEqual(["email:someone@example.test", "email:other@example.test"]);
    expect(recipientKeysForSendCard({ tool: "send_message", toolInput: JSON.stringify({ to: "+1 514 555 0142", text: "Allo", service: "iMessage" }) }))
      .toEqual(["phone:+15145550142"]);
  });

  it("a Flow GO card keeps a rule per tool and action, whatever server asked it", () => {
    const go = parseGoMessage("Pulsatrix Flow needs your GO before this write is sent.\nTool: cw_psa_write\nAction: create\nArguments: {\"action\":\"create\",\"resource\":\"service.tickets\"}");
    expect(go.fingerprint).toBe("go:cw_psa_write:create");
    // never "wants to <server-name>": the human line names the write
    expect(go.summary).toMatch(/^Create service\.tickets with cw_psa_write\./);
    const index = readRoot("server/index.ts");
    const askGo = index.slice(index.indexOf("askGo: ({ threadId, botId, message }) =>"), index.indexOf("onRemoteSupport:"));
    expect(askGo).toContain("parseGoMessage(message)");
    expect(askGo).toMatch(/fingerprint: go\.fingerprint/);
    expect(askGo).toMatch(/toolInput: go\.args/);
    // the held card always carries a rule: a fingerprint, or the digest of its summary
    // #1388: confirmHeldCard lives in index-leaves/
    const heldSrc = readRoot("server/index-leaves/confirmHeldCard.ts");
    const heldStart = heldSrc.indexOf("async function confirmHeldCard(");
    const held = heldSrc.slice(heldStart, heldSrc.indexOf("\n}\n", heldStart));
    expect(held).toMatch(/const fingerprint = request\.fingerprint \?\? wholeCallDigest\(/);
    expect(held).toMatch(/ownerRule: \{ \.\.\.candidate, from: "hold"/);
  });

  it("a purchase card and a phone call card offer Always, on the card and at the server", () => {
    const outbound = readRoot("src/components/OutboundCard.tsx");
    expect(outbound).toContain("data-outbound-always");
    expect(outbound).toMatch(/decision: choice === "always" \? "always" : "call"/);
    expect(outbound).toMatch(/answerPurchase\(card\.id, choice === "always" \? "always"/);
    const vault = readRoot("server/vault/credential-vault.ts");
    expect(vault).toMatch(/decision !== "deny" && decision !== "once" && decision !== "always"/);
    expect(vault).toContain("standingPurchaseGrant(");
    const calls = readRoot("server/outbound/outbound-calls.ts");
    expect(calls).toMatch(/decision !== "call" && decision !== "always" && decision !== "deny"/);
    expect(calls).toContain("STANDING_CALL_VIA");
    const wiring = readRoot("server/outbound/outbound-wiring.ts");
    // #2471: the Primary Bot answers a call card like a purchase card, once or always
    expect(wiring).toMatch(/const always = body\.always === true \|\| body\.rule === "allow";/);
    expect(wiring).toMatch(/if \(kind === "purchase"\) return \{ decision: always \? "always" : "once" \}/);
    expect(wiring).toMatch(/return \{ decision: always \? "always" : "call", confirmedTo: number, confirmed: true \}/);
  });

  it("the client offers Always allow on every card but the organization's Refuse / Ask first, which says so", () => {
    const pending = readRoot("src/components/PendingApproval.tsx");
    // the one branch without Always allow is the organization policy, and it reads in plain words
    expect(pending).toContain('data-org-always-allow-off=""');
    expect(pending).toMatch(/orgPolicy\.alwaysAllow/);
    const en = JSON.parse(readRoot("src/locales/en.json")) as Record<string, string>;
    expect(en["approval.orgOnce"]).toMatch(/^Your organization always asks/);
    expect(en["approval.orgOnce"]).not.toMatch(/policy|enforce|RBAC|tenant/i);
    // every other card: a rule on the card is an Always allow button
    expect(pending).toMatch(/const alwaysAllow[^\n]*= ownerRule\n\s*\? \{ run: \(\) => decide\("allow", false, false, "allow"\)/);
    // the bulk answer saves the rule for whoever answers (no admin clause)
    // #1388: answerInboxCard lives in index-leaves/
    const inbox = readRoot("server/index-leaves/answerInboxCard.ts");
    expect(inbox).toMatch(/if \(rule && \(decision !== "allow" \|\| !card\.ownerRule\)\)/);
  });
});

// ── 2. every approval passes through the one settings-linked decision ──────

const EMITTERS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: "options card", pattern: /\bkind: "options",/ },
  { name: "permission request", pattern: /\brequestType: "permission"(?!\s*\|)/ },
  { name: "peer card", pattern: /\brequestPeerApproval\(/ },
  { name: "safety review", pattern: /\bsafety(?:PermissionEffect|ToolHold)\(/ },
  { name: "ask_choice card", pattern: /\bcreateChoiceCard\(/ },
];

describe("every approval reads the one settings-linked decision (Full access, rules, organization)", () => {
  it("each card emitter carries the full-access marker of a registered surface", () => {
    const unmarked: string[] = [];
    let count = 0;
    for (const file of walkSources(join(ROOT, "server"), /\.ts$/)) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((text, index) => {
        if (/^\s*(?:export\s+)?(?:async\s+)?function\b/.test(text)) return;
        if (/^\s*(?:readonly\s+)?\w+\??: .*;\s*$/.test(text) && !/\(/.test(text)) return;
        if (/^\s*(?:readonly\s+)?\w+\??\(\w+\??:\s/.test(text)) return;
        if (/^\s*(?:\/\/|\*)/.test(text)) return;
        // #2436: the leaf host's accessors (`get requestPeerApproval() { return requestPeerApproval; }`) emit no card
        if (/^\s*get \w+\(\) \{ return \w+; \},?\s*$/.test(text)) return;
        for (const emitter of EMITTERS) {
          if (!emitter.pattern.test(text)) continue;
          count += 1;
          const marker = FULL_ACCESS_MARKER.exec(lines.slice(Math.max(0, index - 3), index + 1).join("\n"))?.[1];
          if (!marker || !(marker in FULL_ACCESS_SURFACES)) unmarked.push(`${rel(file)}:${index + 1} (${emitter.name})`);
        }
      });
    }
    expect(count).toBeGreaterThan(20);
    expect(unmarked, "a card that bypasses the settings-linked decision (server/approvals/full-access-gate.ts)").toEqual([]);
  });

  it("the Full access decision itself is read from the app settings, not hard-coded", () => {
    const gate = readRoot("server/approvals/full-access-gate.ts");
    expect(gate).toMatch(/export function fullAccessDecision\(/);
    // #1388: request.opened (and its Full access read) lives in runtime-events/
    const opened = readRoot("server/runtime-events/request-opened.ts");
    expect(opened).toMatch(/const fullTurn = host\.fullAccessDecision\(effectiveApprovalMode\)/);
  });
});

// ── 3. no "never always" list ───────────────────────────────────────────────

/** Words of a list that kept a tool, a write, a payment or a send from
 * Always allow by caution. Each was removed under #2091; none comes back. */
const NEVER_ALWAYS_TOKENS: ReadonlyArray<{ token: RegExp; was: string }> = [
  { token: /\bscopeRemembers\b/, was: "owner-approval.ts: scopes refused a rule (guest, botmail, cross-person)" },
  { token: /\bNO_ARGUMENT_DIGESTS\b/, was: "owner-approval.ts: tools whose calls kept no rule" },
  { token: /never always/i, was: "a card or a decision that refused Always" },
  { token: /"no_always"/, was: "index.ts: the Primary Bot's refusal code" },
  { token: /deny or once/, was: "credential-vault.ts: a purchase answered once at most" },
  { token: /call or deny\b/, was: "outbound-calls.ts: a phone call answered once at most" },
  { token: /too dangerous for always/i, was: "a tool kept from Always by caution" },
  { token: /scopeKeepable\(candidate\.scope\) \? \{ ownerRule/, was: "index.ts: a ConnectWise widget card without a rule when its scope was long" },
];

describe("no list keeps a card from Always allow", () => {
  it("none of the removed exclusions is back in server, src or shared", () => {
    const back: string[] = [];
    for (const dir of ["server", "src", "shared"]) {
      for (const file of walkSources(join(ROOT, dir), /\.tsx?$/)) {
        const text = readFileSync(file, "utf8");
        for (const row of NEVER_ALWAYS_TOKENS) {
          if (row.token.test(text)) back.push(`${rel(file)}: ${row.token} (${row.was})`);
        }
      }
    }
    expect(back).toEqual([]);
  });

  it("the owner rule candidate is never undefined for a tool call", () => {
    const owner = readRoot("server/approvals/owner-approval.ts");
    const start = owner.indexOf("export function cardRuleCandidate(");
    expect(start).toBeGreaterThan(0);
    const body = owner.slice(start, owner.indexOf("\n}\n", start));
    expect(body).not.toMatch(/return undefined/);
    expect(body).toMatch(/WHOLE_CALL_KEY\]: wholeCallDigest\(input\)/);
  });
});

// ── 4. no admin gate on the person's own space ──────────────────────────────

/** Where `{admin &&` or `memberHidesSection` is right: the thing shown is
 * the whole organization's (every member, the shared server, the org's
 * billing), never the person's own bots, groups, setups or settings. */
const ADMIN_GATES_BY_DECISION: ReadonlyArray<{ file: string; why: string }> = [
  { file: "src/components/PublishedPages.tsx", why: "OrganizationPages: pages published for the whole organization" },
  { file: "src/components/settings/OrgSharing.tsx", why: "OrgBotMenu: stop or delete a bot shared with the whole organization" },
  { file: "src/components/SettingsModal.tsx", why: "memberHidesSection: hides the organization-only sections (edit config, computers, backups) of the Settings nav" },
  { file: "src/components/settings/settings-nav.ts", why: "memberHidesSection: its definition" },
  { file: "src/components/settings/useSettingsModal.ts", why: "memberHidesSection: its one call" },
  { file: "src/components/settings/DeveloperSettings.tsx", why: "memberHidesSection: the Experimental section keeps the server.experimental right the Experimental page had (AB 2026-11-08)" },
];

describe("no admin gate on what stays in the person's own space (decided 2026-10-26)", () => {
  it("`{admin &&` and `memberHidesSection` only where the thing is the whole organization's", () => {
    const gated: string[] = [];
    for (const file of walkSources(join(ROOT, "src"), /\.tsx?$/)) {
      const text = readFileSync(file, "utf8");
      if (!/\{admin &&|\bmemberHidesSection\b/.test(text)) continue;
      const path = rel(file);
      if (!ADMIN_GATES_BY_DECISION.some((row) => row.file === path)) gated.push(path);
    }
    expect(gated, "an admin gate on the person's own space: a member manages their own bots, groups, setups and settings without an admin").toEqual([]);
    for (const row of ADMIN_GATES_BY_DECISION) {
      expect(/\{admin &&|\bmemberHidesSection\b/.test(readRoot(row.file)), `${row.file}: no admin gate any more; drop it from ADMIN_GATES_BY_DECISION`).toBe(true);
    }
  });

  it("memberHidesSection hides organization sections only", () => {
    const nav = readRoot("src/components/settings/settings-nav.ts");
    const start = nav.indexOf("export function memberHidesSection(");
    const body = nav.slice(start, nav.indexOf("\n}\n", start));
    // the person's own sections never appear in the hidden set
    for (const own of ['"bots"', '"security"', '"notifications"', '"appearance"', '"account"', '"memory"']) {
      expect(body, `memberHidesSection hides ${own}, the person's own section`).not.toContain(own);
    }
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

describe("the owner unified chat guards (#2106)", () => {
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
    const bar = readRoot("src/components/Composer.tsx-parts/ComposerActionBar.tsx");
    expect(bar).toMatch(/#2106/);
    expect(bar).toMatch(/<ModelPicker inComposer/);
    expect(bar).not.toMatch(/headless/);
  });

  it("picking writes the bot default for every thread (updateBotDefault)", () => {
    const picker = readRoot("src/components/ModelPicker.tsx");
    expect(picker).toMatch(/updateBotDefault:\s*true/);
    expect(picker).not.toMatch(/confirm.*model|toast.*model|warn.*model/i);
  });
});

// ── #2086 static scans ──────────────────────────────────────────────────────

/** Locale keys whose English value is an "Open thread" / side-thread entry.
 * A component that calls t(key) must gate on showThreads / onOpenThread, or
 * sit on UNIFIED_THREAD_KEY_ALLOWLIST with a comment. */
const UNIFIED_THREAD_KEYS = [
  "needsYou.openThread",
  "botPanel.activity.openThread",
  "floatingBots.menu.openThread",
  "chat.openThread",
  "chat.openThreadOn",
  "chat.goToConversation",
  "chat.goToConversationWith",
] as const;

/** Code that still names a thread key, with why it is safe or which follow-up
 * owns the product fix. Prefer a showThreads / onOpenThread gate over a new row. */
const UNIFIED_THREAD_KEY_ALLOWLIST: ReadonlyArray<{ file: string; why: string }> = [
  // gated: optional onOpenThread; ChatView only passes it when showThreads
  { file: "src/components/ThreadChip.tsx", why: "returns null when !useShowThreads()" },
  { file: "src/components/ThreadRefs.tsx", why: "openThread(..., showThreads) and chat.openThread titles on a threads-shown ref chip" },
  { file: "src/components/bot-settings/RolePermissionsSection.tsx", why: "passes onOpenThread only when showThreads" },
  // in-place exchange sheet / goto chip primitives (not SideThreadPanel)
  { file: "src/components/ConversationLink.tsx", why: "follow-up #2081: Go to conversation line opens an in-place exchange sheet; ChatView still shows bot-to-bot lines in unified mode" },
  { file: "src/components/BotExchangeChip.tsx", why: "follow-up #2081: uses ConversationLink for an in-place sheet" },
  { file: "src/components/BotConversations.tsx", why: "follow-up #2081: uses ConversationLink for an in-place sheet" },
  { file: "src/components/GotoGroupChip.tsx", why: "follow-up #2081: folds Go to conversation lines; opens sheet or selects target" },
];

/** Hard-coded English strings that must not appear in shipped UI source unless
 * the file is gated or allowlisted. */
const UNIFIED_FORBIDDEN_STRINGS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  { pattern: /["'`]Open thread["'`]/, label: "Open thread" },
  { pattern: /["'`]Open \{name\}'s thread["'`]/, label: "Open <bot>'s thread" },
  { pattern: /["'`]Go to conversation["'`]/, label: "Go to conversation" },
  { pattern: /["'`]Go to conversation with/, label: "Go to conversation with" },
];

/** Side-thread panel entry: must sit behind showThreads. */
const SIDE_PANEL_FILES = ["src/App.tsx-parts/ShellLayout.tsx"];

describe("#2086 unified chat: no thread entry points when threads are off", () => {
  it("SideThreadPanel is only mounted behind showThreads", () => {
    for (const file of SIDE_PANEL_FILES) {
      const text = readRoot(file);
      expect(text, file).toContain("{showThreads && <SideThreadPanel />}");
      expect(text, file).toContain("useShowThreads()");
    }
    const offenders: string[] = [];
    for (const dir of ["src", "server", "shared"]) {
      for (const file of walkSources(join(ROOT, dir), /\.tsx?$/)) {
        const text = readFileSync(file, "utf8");
        if (!/<SideThreadPanel\b/.test(text)) continue;
        const path = rel(file);
        if (SIDE_PANEL_FILES.includes(path)) continue;
        // gallery previews mount the panel on purpose
        if (path.startsWith("src/gallery/")) continue;
        offenders.push(path);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("Open thread / Go to conversation locale keys are only used in gated or allowlisted files", () => {
    const keyPattern = new RegExp(`t\\(\\s*["'](${UNIFIED_THREAD_KEYS.join("|")})["']`);
    const offenders: string[] = [];
    for (const file of walkSources(join(ROOT, "src"), /\.tsx?$/)) {
      const text = readFileSync(file, "utf8");
      if (!keyPattern.test(text)) continue;
      const path = rel(file);
      if (UNIFIED_THREAD_KEY_ALLOWLIST.some((row) => row.file === path)) continue;
      offenders.push(path);
    }
    expect(offenders, "gate with showThreads / onOpenThread, or add an allowlist row with a comment").toEqual([]);
    for (const row of UNIFIED_THREAD_KEY_ALLOWLIST) {
      expect(keyPattern.test(readRoot(row.file)) || /openThread|goToConversation/.test(readRoot(row.file)), `${row.file}: no longer uses a thread key; drop it from UNIFIED_THREAD_KEY_ALLOWLIST`).toBe(true);
    }
  });

  it("no hard-coded Open thread / Go to conversation strings in shipped source outside allowlisted files", () => {
    const allow = new Set(UNIFIED_THREAD_KEY_ALLOWLIST.map((row) => row.file));
    const offenders: string[] = [];
    for (const dir of ["src", "server", "shared"]) {
      for (const file of walkSources(join(ROOT, dir), /\.tsx?$/)) {
        const path = rel(file);
        if (allow.has(path) || path.startsWith("src/gallery/")) continue;
        // comments may name the rule; only code and string literals count
        const text = readFileSync(file, "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .split("\n")
          .filter((line) => !/^\s*\/\//.test(line))
          .join("\n");
        for (const row of UNIFIED_FORBIDDEN_STRINGS) {
          if (row.pattern.test(text)) offenders.push(`${path}: ${row.label}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no new automatic \"· Results\" thread titles outside the Cloud-guest fallback", () => {
    // resolveResultsThread still opens a results task when the person has no
    // main conversation (Cloud guest). Everywhere else reports into the one
    // conversation. A second createTask with " · Results" fails here.
    const offenders: string[] = [];
    for (const file of walkSources(join(ROOT, "server"), /\.ts$/)) {
      const text = readFileSync(file, "utf8");
      const matches = text.matchAll(/createTask\([^)]*· Results/g);
      for (const match of matches) {
        const path = rel(file);
        // the one guest fallback in index.ts
        if (path === "server/index.ts" && /\$\{routine\.name\} · Results/.test(match[0]!)) continue;
        offenders.push(`${path}: ${match[0]}`);
      }
    }
    // title helpers that only recognize legacy threads stay
    expect(offenders).toEqual([]);
    const index = readRoot("server/index.ts");
    expect(index).toMatch(/\$\{routine\.name\} · Results/);
    expect(index).toMatch(/routineResults: true/);
  });
});

const DASH = /[\u2013\u2014]/;
const UUID = /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/;

describe("#2086 no em/en dash in fr.json and no raw UUID in UI locale strings", () => {
  it("French catalog values have no em-dash or en-dash", () => {
    const fr = JSON.parse(readRoot("src/locales/fr.json")) as Record<string, string>;
    const offending = Object.entries(fr).filter(([, value]) => typeof value === "string" && DASH.test(value)).map(([key]) => key);
    expect(offending).toEqual([]);
  });

  it("English and French catalog values embed no raw UUID", () => {
    const offending: string[] = [];
    for (const name of ["src/locales/en.json", "src/locales/fr.json"]) {
      const catalog = JSON.parse(readRoot(name)) as Record<string, string>;
      for (const [key, value] of Object.entries(catalog)) {
        if (typeof value === "string" && UUID.test(value)) offending.push(`${name}: ${key}`);
      }
    }
    expect(offending).toEqual([]);
  });
});
