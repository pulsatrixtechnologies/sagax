/** Isolated gallery for headless screenshots of propose_rule Confirm cards.
 * Not shipped in the app.
 * ?lang=<code>&skin=<id>&card=add|change|remove&behavior=allow|ask|deny&answered=allow
 * Decisions land in window.__decisions for a headless click check. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ApprovalCard } from "../components/ApprovalCard";
import { PendingApprovalBox, type Pending } from "../components/PendingApproval";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { BotEditorStore, type Bot, type Message, type useStore } from "../state/store";
import type { RuleRequestCardData } from "../../shared/rule-request";
import type { CustomRuleBehavior } from "../../shared/custom-rules";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "fr");
const which = params.get("card") ?? "add";
const behavior = (params.get("behavior") ?? "allow") as CustomRuleBehavior;
const answered = params.get("answered") === "allow" ? "allow" : params.get("answered") === "deny" ? "deny" : undefined;

declare global {
  interface Window { __decisions: unknown[] }
}
window.__decisions = [];

const store = {
  state: {},
  dispatch: (action: unknown) => { window.__decisions.push(action); },
  flushBotPatches: async () => null,
} as unknown as ReturnType<typeof useStore>;

const bot = { id: "bot-ottoline", name: "Ottoline", color: "violet" } as unknown as Bot;

function rulePayload(action: "add" | "change" | "remove"): RuleRequestCardData {
  const base = {
    version: 1 as const,
    requestId: `req-rule-${action}`,
    botId: bot.id,
    threadId: "thread-1",
    ownerId: "person-synthetic",
    scopeBotId: bot.id,
    scopeBotName: bot.name,
    createdAt: 1,
    reason: "You confirmed reading files in Documents; a standing rule would help next time.",
    sentence: "read files in Documents",
  };
  if (action === "add") {
    return {
      ...base,
      operation: { action: "add", when: "read files in Documents", behavior, botId: bot.id },
    };
  }
  if (action === "change") {
    return {
      ...base,
      sentence: "read files in Documents and Desktop",
      operation: {
        action: "change",
        ruleId: "rule-synth-1",
        before: { when: "read files in Documents", behavior: "ask" as const, botId: bot.id, enabled: true },
        changes: { when: "read files in Documents and Desktop", behavior },
      },
    };
  }
  return {
    ...base,
    operation: {
      action: "remove",
      ruleId: "rule-synth-1",
      before: { when: "read files in Documents", behavior: "allow" as const, botId: bot.id },
    },
  };
}

const titles: Record<string, string> = {
  add: "Add this approval rule?",
  change: "Change this approval rule?",
  remove: "Remove this approval rule?",
};
const action = (which === "change" || which === "remove" ? which : "add") as "add" | "change" | "remove";
const request = rulePayload(action);
const behaviorLabel = behavior === "allow" ? "Allow automatically" : behavior === "ask" ? "Ask first" : "Refuse";
const scope = "Ottoline";
const detail = [
  `Why: ${request.reason}`,
  action === "change"
    ? `Was: When ${scope} wants to: read files in Documents\nNow: When ${scope} wants to: ${request.sentence}`
    : `When ${scope} wants to: ${request.sentence}`,
  `It should: ${behaviorLabel}`,
  action === "remove"
    ? "Confirm removes this rule. Org Ask first and Refuse rules still apply."
    : "Confirm saves this rule for you. Org Ask first and Refuse rules still win over it.",
].join("\n");

const card = {
  title: titles[action]!,
  subtitle: detail,
  options: ["Confirm", "Cancel"],
  requestId: request.requestId,
  tool: "propose_rule",
  answered,
  ...(answered === "allow" ? { ruleRequest: { ...request, appliedAt: 2 } } : { ruleRequest: request }),
} as NonNullable<Message["card"]>;

const message = {
  id: "m-rule",
  role: "bot",
  kind: "options",
  at: 0,
  text: "",
  from: { botId: bot.id, name: bot.name, color: bot.color },
  card,
} as unknown as Message;

const pending: Pending = {
  message,
  requestId: request.requestId,
  tool: "propose_rule",
  threadId: "thread-1",
  detail,
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BotEditorStore value={store}>
      <div
        data-shot="rule-request"
        className="min-h-screen bg-canvas p-6 text-ink"
        style={{ maxWidth: 720, margin: "0 auto" }}
      >
        <div className="mb-4 rounded-2xl border border-hairline/40 bg-card p-4">
          <ApprovalCard bot={bot} message={message} threadId="thread-1" />
        </div>
        {!answered && (
          <div data-shot="rule-dock">
            <PendingApprovalBox
              approvals={[pending]}
              threadId="thread-1"
              botFor={() => bot}
              onCancelTurn={() => {}}
            />
          </div>
        )}
      </div>
    </BotEditorStore>
  </StrictMode>,
);
