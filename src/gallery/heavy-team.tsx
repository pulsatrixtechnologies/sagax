/** Isolated gallery for Playwright screenshots of a Heavy run (#4901): the
 * real row (StatusActivityRow, so the same route as the chat) while the agents
 * work and after, and the real Thoughts panel in the right-hand detail panel.
 * Synthetic data, demo providers only. Not shipped in the app.
 * ?skin=<id>&lang=<code>&case=running|done|panel&team=three|single&live=1 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { StatusActivityRow } from "../components/StatusActivityRow";
import { ThoughtsPanelHost } from "../components/ThoughtsPanel";
import { CHAT_BUBBLE_TEXT_CLASS } from "../lib/chat-bubble-width";
import { cn } from "../lib/cn";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { openThoughts } from "../lib/thoughts-panel";
import type { Message } from "../state/store";
import type { HeavyAgentLine, HeavyTeamLine } from "../../shared/heavy-team";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");
const which = params.get("case") ?? "running";
const team = params.get("team") ?? "three";
const live = params.get("live") === "1";

// a fixed clock: "6s" reads 6s however long the capture takes
const START = 1_700_000_000_000;
Date.now = () => START + (which === "running" || live ? 6_000 : 12_000);

const agent = (n: number, engineLabel: string, modelLabel: string, over: Partial<HeavyAgentLine>): HeavyAgentLine => ({
  n, engineLabel, modelLabel, status: "done", messages: [], ...over,
});
const FINDINGS = [
  ["The cutover window is the lowest-risk part: two hours on a Sunday night with the old firewall kept in standby.", "Recommended answer: migrate in two waves, the office first and the data centre a week later, each with a tested rollback."],
  ["The real exposure is the rollback, not the migration. The current rules were never exported, so a failed cutover has nothing to return to.", "Export the rule base and the NAT table first, and keep the old unit powered for 30 days."],
  ["Three details the plan depends on: the licence term of the new unit, the VPN peers that pin the old public address, and who holds the console password.", "I am confident about the first two, not the third."],
];
const names: Array<[string, string]> = team === "single"
  ? [["Grok", "Grok 4.7"], ["Grok", "Grok 4.7"], ["Grok", "Grok 4.7"]]
  : [["OpenAI", "GPT-6 Astra"], ["Claude", "Claude Opus 5.5"], ["Grok", "Grok 4.7"]];

function lineFor(): HeavyTeamLine {
  if (which === "running" || live) {
    return {
      phase: "agents", startedAt: START, updatedAt: START + 6_000,
      agents: [
        agent(1, ...names[0]!, { status: "working", messages: [FINDINGS[0]![0]!], live: "Recommended answer: migrate in two waves, the office first and the data centre a week later" }),
        agent(2, ...names[1]!, { status: "working", messages: [], live: "The real exposure is the rollback, not the migration. The current rules were never exported" }),
        agent(3, ...names[2]!, { status: "working", messages: [] }),
      ],
      leader: { engineLabel: names[0]![0], modelLabel: names[0]![1], steps: [{ kind: "sent", at: START }, { kind: "processing", at: START + 400 }] },
    };
  }
  return {
    phase: "done", startedAt: START, thoughtEndedAt: START + 8_000, updatedAt: START + 12_000,
    agents: names.map(([engine, model], index) => agent(index + 1, engine, model, { messages: FINDINGS[index]!, endedAt: START + 5_000 + index * 1_500 })),
    leader: { engineLabel: names[0]![0], modelLabel: names[0]![1], steps: [{ kind: "sent", at: START }, { kind: "processing", at: START + 400 }, { kind: "writing", at: START + 8_000 }] },
  };
}

const row: Message = { id: "run", at: START, role: "bot", kind: "activity", tool: { name: "Team of Experts", ok: true, team: lineFor() } } as Message;
const showPanel = which === "panel";
if (showPanel) openThoughts("run");

const userBubble = (text: string) => (
  <div className={cn("max-w-[560px] self-end rounded-[18px] bg-bubble-user px-3 py-[7px] text-ink", CHAT_BUBBLE_TEXT_CLASS)}>{text}</div>
);
const botBubble = (text: string) => (
  <div className={cn("max-w-[560px] self-start rounded-[18px] bg-card px-3 py-[7px] text-ink whitespace-pre-wrap", CHAT_BUBBLE_TEXT_CLASS)}>{text}</div>
);

function Gallery() {
  const done = !(which === "running" || live);
  return (
    <div className="flex h-screen bg-app text-ink">
      <div className="flex min-w-0 flex-1 flex-col justify-start gap-3 overflow-hidden px-8 pt-16" data-gallery-chat="">
        {userBubble("What should we weigh before the firewall migration?")}
        <StatusActivityRow message={row} transcript={[row]} busy={!done || live} />
        {done && botBubble("Migrate in two waves, the office first and the data centre a week later. Before either, export the rule base and the NAT table and keep the old unit powered for 30 days, so a failed cutover has something to return to. Two details to confirm: the new unit's licence term and the VPN peers that pin the old public address.")}
      </div>
      {showPanel && <ThoughtsPanelHost messages={[row]} busy={live} />}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Gallery /></StrictMode>);
