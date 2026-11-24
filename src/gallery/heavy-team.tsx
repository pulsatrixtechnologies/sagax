/** Isolated gallery for headless screenshots of a Heavy run (#4901, #5089,
 * #5090): the real row (StatusActivityRow, so the same route as the chat)
 * with the real orbit (experts around the bot, the speaker pulsing, the
 * critique lines, the merge on agreement), after it, and the real Thoughts
 * panel in the right-hand detail panel. Synthetic data, demo accounts only.
 * Not shipped in the app.
 * ?skin=<id>&lang=<code>&case=propose|critique|merged|done|panel|refused|refused-panel&auto=risky */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { MausAvatar } from "../components/Avatar";
import { HeavyLeaderContext } from "../components/HeavyTeamRow";
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
const which = params.get("case") ?? "critique";
const auto = params.get("auto");

// a fixed clock: "14s" reads 14s however long the capture takes
const START = 1_700_000_000_000;
const running = which === "propose" || which === "critique" || which === "merged";
Date.now = () => START + (running ? 14_000 : 31_000);

const SEATS: Array<[string, string, string]> = [
  ["Skeptic", "ada@example.com", "Claude Opus 5.5"],
  ["Security", "ada.admin@acme.test", "Claude Opus 5.5"],
  ["Cost", "OpenAI", "GPT-6 Astra"],
  ["User's advocate", "ada@example.com", "Claude Fable 5.2"],
];
const PROPOSALS = [
  "Migrate in two waves, the office first, the data centre a week later, each with a tested rollback.",
  "Export the rule base and the NAT table before anything; keep the old unit powered for 30 days.",
  "Reuse the current licence term; a second unit for the lab is not worth it this quarter.",
  "Tell the staff the Sunday window a week ahead and keep the VPN profile names unchanged.",
];
const CRITIQUES = [
  "Wave two has no owner. Agree once someone holds the data centre cutover.",
  "The export is still not in the plan's first step.",
  "Agreed on the waves; the lab unit stays out.",
  "Fine, if the VPN names stay the same.",
];

const expert = (index: number, over: Partial<HeavyAgentLine>): HeavyAgentLine => ({
  n: index + 1, persona: SEATS[index]![0], engineLabel: SEATS[index]![1], modelLabel: SEATS[index]![2], status: "working", messages: [], ...over,
});

function lineFor(): HeavyTeamLine {
  const leader = { engineLabel: "OpenAI", modelLabel: "GPT-6 Astra" };
  const planned = [{ kind: "planned" as const, at: START + 2_000 }, { kind: "sent" as const, at: START + 2_000 }, { kind: "processing" as const, at: START + 2_000 }];
  if (which === "propose") {
    return {
      phase: "agents", startedAt: START, updatedAt: START + 14_000, maxRounds: 5,
      rounds: [{ n: 1, kind: "propose", startedAt: START + 2_000 }],
      agents: SEATS.map((_, index) => expert(index, index === 1
        ? { speaking: true, live: PROPOSALS[1]!.slice(0, 64) }
        : index === 0 ? { messages: [PROPOSALS[0]!] } : {})),
      leader: { ...leader, steps: planned },
      ...(auto === "risky" || auto === "big" ? { auto } : {}),
    };
  }
  if (which === "critique") {
    return {
      phase: "agents", startedAt: START, updatedAt: START + 14_000, maxRounds: 5,
      rounds: [{ n: 1, kind: "propose", startedAt: START + 2_000, endedAt: START + 7_000 }, { n: 2, kind: "critique", startedAt: START + 7_000, endedAt: START + 11_000 }, { n: 3, kind: "critique", startedAt: START + 11_000 }],
      agents: SEATS.map((_, index) => expert(index, {
        messages: [PROPOSALS[index]!, CRITIQUES[index]!],
        agrees: index !== 1,
        ...(index === 0 || index === 2 ? { speaking: true, live: "Round 3: with the export first, " } : {}),
      })),
      leader: { ...leader, steps: planned },
    };
  }
  if (which === "merged") {
    return {
      phase: "leader", startedAt: START, thoughtEndedAt: START + 14_000, updatedAt: START + 14_000, maxRounds: 5, outcome: "agreed",
      rounds: [{ n: 1, kind: "propose", startedAt: START + 2_000, endedAt: START + 7_000 }, { n: 2, kind: "critique", startedAt: START + 7_000, endedAt: START + 14_000, agreed: true }],
      agents: SEATS.map((_, index) => expert(index, { status: "done", agrees: true, messages: [PROPOSALS[index]!, CRITIQUES[index]!] })),
      leader: { ...leader, steps: [...planned, { kind: "agreed", at: START + 14_000, round: 2 }, { kind: "writing", at: START + 14_000 }] },
    };
  }
  if (which === "refused" || which === "refused-panel") {
    // M-20261123-040: an aggregator seat refused (HTTP 403), its expert went on on the next seat
    return {
      phase: "done", startedAt: START, thoughtEndedAt: START + 26_000, updatedAt: START + 31_000, maxRounds: 5, outcome: "agreed",
      rounds: [{ n: 1, kind: "propose", startedAt: START + 2_000, endedAt: START + 14_000 }, { n: 2, kind: "critique", startedAt: START + 14_000, endedAt: START + 26_000, agreed: true }],
      agents: SEATS.slice(0, 3).map((_, index) => expert(index, {
        status: "done", agrees: true, messages: [PROPOSALS[index]!, CRITIQUES[index]!], endedAt: START + 26_000,
        engineLabel: "OpenRouter", modelLabel: "Nemotron 3 Ultra",
      })),
      refusals: [{
        n: 2, persona: "Security", engineLabel: "OpenRouter", modelLabel: "Qwen3-Coder", cause: "access", status: 403,
        detail: "This model is not available on your plan", replacedBy: { engineLabel: "OpenRouter", modelLabel: "Nemotron 3 Ultra" },
      }],
      leader: { engineLabel: "OpenRouter", modelLabel: "Nemotron 3 Ultra", steps: [...planned, { kind: "agreed", at: START + 26_000, round: 2 }, { kind: "writing", at: START + 26_000 }] },
    };
  }
  // done (and the panel): no agreement after 5 rounds, the leader decided
  return {
    phase: "done", startedAt: START, thoughtEndedAt: START + 26_000, updatedAt: START + 31_000, maxRounds: 5, outcome: "decided",
    disagreements: ["who owns the data centre cutover", "export the rule base first"],
    rounds: [1, 2, 3, 4, 5].map((n) => ({ n, kind: n === 1 ? "propose" as const : "critique" as const, startedAt: START + n * 4_000, endedAt: START + n * 4_000 + 3_500 })),
    agents: SEATS.map((_, index) => expert(index, { status: "done", agrees: index !== 1, messages: [PROPOSALS[index]!, CRITIQUES[index]!], endedAt: START + 26_000 })),
    leader: { ...leader, steps: [...planned, { kind: "decided", at: START + 26_000, round: 5 }, { kind: "writing", at: START + 26_000 }] },
  };
}

const row: Message = { id: "run", at: START, role: "bot", kind: "activity", tool: { name: "Team of Experts", ok: true, team: lineFor() } } as Message;
const showPanel = which === "panel" || which === "refused-panel";
if (showPanel) openThoughts("run");

const userBubble = (text: string) => (
  <div className={cn("max-w-[560px] self-end rounded-[18px] bg-bubble-user px-3 py-[7px] text-ink", CHAT_BUBBLE_TEXT_CLASS)}>{text}</div>
);
const botBubble = (text: string) => (
  <div className={cn("max-w-[560px] self-start rounded-[18px] bg-card px-3 py-[7px] text-ink whitespace-pre-wrap", CHAT_BUBBLE_TEXT_CLASS)}>{text}</div>
);

function Gallery() {
  const done = !running;
  return (
    <HeavyLeaderContext value={<MausAvatar color="blue" size={34} state={running ? "thinking" : "idle"} animated={false} trackPointer={false} />}>
      <div className="flex h-screen bg-app text-ink">
        <div className="flex min-w-0 flex-1 flex-col justify-start gap-3 overflow-hidden px-8 pt-16" data-gallery-chat="">
          {userBubble("Plan the firewall migration for the two sites, and go ahead with the parts we agree on.")}
          <StatusActivityRow message={row} transcript={[row]} busy={running} />
          {done && botBubble("The plan: migrate in two waves, the office first and the data centre a week later, each with a tested rollback.\n\nStill in dispute, beside the plan:\n- who owns the data centre cutover\n- whether the rule export comes first (I put it first)\n\nI am starting with the export now.")}
        </div>
        {showPanel && <ThoughtsPanelHost messages={[row]} busy={false} />}
      </div>
    </HeavyLeaderContext>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Gallery /></StrictMode>);
