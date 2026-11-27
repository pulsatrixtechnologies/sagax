/** Isolated gallery for headless screenshots of a Heavy run (#4901, #5089,
 * M-20261126-122): the real row (StatusActivityRow, so the same route as the
 * chat) with the real division (the bot's mascot divides into its experts),
 * after it, and the real Thoughts panel in the right-hand detail panel.
 * Synthetic data, demo accounts only. Not shipped in the app.
 * ?skin=<id>&lang=<code>&case=division|propose|critique|merged|done|panel|refused|refused-panel&auto=risky
 * &shape=<shape id, or owl for a character>&color=<bot colour>&n=<experts, 2 to 8>
 * &def=own (the bot's shape is its own drawing: a copy of the cup under an id of its own, read at run time)
 * &material=fluffy|glass&mascotSkin=<a shape skin>&fail=<the expert that fails mid-run>
 * &character=<shiba, grump, trombi... in place of a shape>&photo=1 (the bot's own picture, /api/attachments/demo-photo.png: the capture serves it)
 * &zoom=<magnify the row>&rows=<that many rows, for the cost measure>&motion=reduced
 * case=division is a live run: the leader picks its team, then `n` experts appear (and `fail` fails 3 s later). */
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import type { BotAvatarProps } from "../components/Avatar";
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
import { OBJECT_SHAPE_BY_ID } from "../../shared/shape-avatar-presets";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");
const which = params.get("case") ?? "critique";
const auto = params.get("auto");
const shape = params.get("shape") ?? "cat";
const experts = Math.max(1, Number(params.get("n")) || 4);
const zoom = Number(params.get("zoom")) || 1;
const rowCount = Math.max(1, Number(params.get("rows")) || 1);
if (params.get("motion") === "reduced") document.documentElement.dataset.reducedMotion = "true";
const failing = Number(params.get("fail")) || 0;
/** The conversation's bot: a shape in its colour (its own drawing, a material, a skin), the owl, another character or a picture (a round in its colour divides, then its characters). */
const BOT = {
  name: "Nimbus",
  color: params.get("color") ?? "grey",
  ...(params.get("photo") ? { avatarUrl: "/api/attachments/demo-photo.png", avatarCrop: "circle" } : {}),
  ...(params.get("character") ? { mascotLook: { character: params.get("character") } } : shape === "owl" ? {} : {
    mascotLook: {
      character: "shape",
      shape,
      ...(params.get("def") === "own" ? { avatarDef: { ...OBJECT_SHAPE_BY_ID.cup, id: "my-own-mascot", name: "My own mascot" } } : {}),
      ...(params.get("material") ? { material: params.get("material") } : {}),
      ...(params.get("mascotSkin") ? { skins: { shape: params.get("mascotSkin") } } : {}),
    },
  }),
} as BotAvatarProps["bot"];

// a fixed clock: "14s" reads 14s however long the capture takes
const START = 1_700_000_000_000;
const running = which === "propose" || which === "critique" || which === "merged" || which === "division";
Date.now = () => START + (running ? 14_000 : 31_000);

const ALL_SEATS: Array<[string, string, string]> = [
  ["Skeptic", "ada@example.com", "Claude Opus 5.5"],
  ["Security", "ada.admin@acme.test", "Claude Opus 5.5"],
  ["Cost", "OpenAI", "GPT-6 Astra"],
  ["User's advocate", "ada@example.com", "Claude Fable 5.2"],
  ["Operations", "Grok", "Grok 4.7"],
  ["Compliance", "OpenAI", "GPT-6 Astra"],
  ["Network", "Grok", "Grok 4.7"],
  ["Support", "ada@example.com", "Claude Fable 5.2"],
];
const SEATS = ALL_SEATS.slice(0, params.has("n") ? experts : 4);
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

const expert = (index: number, over: Partial<HeavyAgentLine>, failed = true): HeavyAgentLine => ({
  n: index + 1, persona: SEATS[index]![0], engineLabel: SEATS[index]![1], modelLabel: SEATS[index]![2], status: "working", messages: [], ...over,
  // the expert asked to fail did, mid-run, after one message
  ...(failed && index + 1 === failing && (over.status ?? "working") === "working" ? { status: "failed" as const, speaking: false, live: undefined, messages: [PROPOSALS[index % 4]!] } : {}),
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
        messages: [PROPOSALS[index % 4]!, CRITIQUES[index % 4]!],
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
      agents: SEATS.map((_, index) => expert(index, { status: "done", agrees: true, messages: [PROPOSALS[index % 4]!, CRITIQUES[index % 4]!] })),
      leader: { ...leader, steps: [...planned, { kind: "agreed", at: START + 14_000, round: 2 }, { kind: "writing", at: START + 14_000 }] },
    };
  }
  if (which === "refused" || which === "refused-panel") {
    // M-20261123-040: an aggregator seat refused (HTTP 403), its expert went on on the next seat
    return {
      phase: "done", startedAt: START, thoughtEndedAt: START + 26_000, updatedAt: START + 31_000, maxRounds: 5, outcome: "agreed",
      rounds: [{ n: 1, kind: "propose", startedAt: START + 2_000, endedAt: START + 14_000 }, { n: 2, kind: "critique", startedAt: START + 14_000, endedAt: START + 26_000, agreed: true }],
      agents: SEATS.slice(0, 3).map((_, index) => expert(index, {
        status: "done", agrees: true, messages: [PROPOSALS[index % 4]!, CRITIQUES[index % 4]!], endedAt: START + 26_000,
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
    agents: SEATS.map((_, index) => expert(index, { status: "done", agrees: index !== 1, messages: [PROPOSALS[index % 4]!, CRITIQUES[index % 4]!], endedAt: START + 26_000 })),
    leader: { ...leader, steps: [...planned, { kind: "decided", at: START + 26_000, round: 5 }, { kind: "writing", at: START + 26_000 }] },
  };
}

/** A live run for case=division: the leader picks its team, then the experts appear and propose (and one fails, when asked). */
function liveLine(planned: boolean, failed = false): HeavyTeamLine {
  const leader = { engineLabel: "OpenAI", modelLabel: "GPT-6 Astra" };
  if (!planned) return { phase: "planning", startedAt: START, updatedAt: START, maxRounds: 5, rounds: [], agents: [], leader: { ...leader, steps: [] } };
  return {
    phase: "agents", startedAt: START, updatedAt: START + 14_000, maxRounds: 5,
    rounds: [{ n: 1, kind: "propose", startedAt: START + 2_000 }],
    agents: SEATS.map((_, index) => expert(index, {}, failed)),
    leader: { ...leader, steps: [{ kind: "planned", at: START + 2_000 }, { kind: "sent", at: START + 2_000 }, { kind: "processing", at: START + 2_000 }] },
  };
}
const messageOf = (team: HeavyTeamLine, id = "run"): Message => ({ id, at: START, role: "bot", kind: "activity", tool: { name: "Team of Experts", ok: true, team } } as Message);
const row: Message = messageOf(which === "division" ? liveLine(false) : lineFor());
const showPanel = which === "panel" || which === "refused-panel";
if (showPanel) openThoughts("run");

const userBubble = (text: string) => (
  <div className={cn("max-w-[560px] self-end rounded-[18px] bg-bubble-user px-3 py-[7px] text-ink", CHAT_BUBBLE_TEXT_CLASS)}>{text}</div>
);
const botBubble = (text: string) => (
  <div className={cn("max-w-[560px] self-start rounded-[18px] bg-card px-3 py-[7px] text-ink whitespace-pre-wrap", CHAT_BUBBLE_TEXT_CLASS)}>{text}</div>
);

/** A live run: the team arrives a moment after the row (a capture reads data-gallery-planned to time its frames). */
function LiveRow({ id }: { id: string }) {
  const [planned, setPlanned] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setPlanned(true), 900);
    const failure = failing ? setTimeout(() => setFailed(true), 900 + 3_000) : 0;
    return () => {
      clearTimeout(timer);
      clearTimeout(failure);
    };
  }, []);
  const message = messageOf(liveLine(planned, failed), id);
  return <div data-gallery-planned={planned ? "" : undefined}><StatusActivityRow message={message} transcript={[message]} busy /></div>;
}

function Gallery() {
  const done = !running;
  const rows = Array.from({ length: rowCount }, (_, index) => (which === "division"
    ? <LiveRow key={index} id={`run-${index}`} />
    : <StatusActivityRow key={index} message={index ? messageOf(lineFor(), `run-${index}`) : row} transcript={[row]} busy={running} />));
  return (
    <HeavyLeaderContext value={BOT}>
      <div className="flex h-screen bg-app text-ink">
        <div className="flex min-w-0 flex-1 flex-col justify-start gap-3 overflow-hidden px-8 pt-16" data-gallery-chat="">
          {userBubble("Plan the firewall migration for the two sites, and go ahead with the parts we agree on.")}
          <div data-gallery-rows="" className="flex flex-col gap-3" style={zoom === 1 ? undefined : { zoom }}>{rows}</div>
          {done && botBubble("The plan: migrate in two waves, the office first and the data centre a week later, each with a tested rollback.\n\nStill in dispute, beside the plan:\n- who owns the data centre cutover\n- whether the rule export comes first (I put it first)\n\nI am starting with the export now.")}
        </div>
        {showPanel && <ThoughtsPanelHost messages={[row]} busy={false} />}
      </div>
    </HeavyLeaderContext>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Gallery /></StrictMode>);
