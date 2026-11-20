// A Heavy run's orbit (#5090, owner 2026-11-19, M-20261119-077): the experts'
// avatars turn around the bot's. The one speaking pulses; while they critique
// each other, lines link them; on agreement they merge into the bot. The
// geometry and who is linked are src/lib/heavy-team.ts (orbitPlaces,
// critiqueLinks, orbitMerged); the motion is CSS (styles.css heavy-orbit-*),
// transform and opacity only, still under reduced motion.
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import { AGENT_COLORS, critiqueLinks, heavyIsRunning, orbitMerged, orbitPlaces } from "@/lib/heavy-team";
import type { HeavyTeamLine } from "../../shared/heavy-team";
import { MausAvatar } from "./Avatar";

const EXPERT = 22;
const LEADER = 34;

export function HeavyOrbit({ line, busy, leader, size = 92 }: { line: HeavyTeamLine; busy: boolean; leader: ReactNode; size?: number }) {
  const running = heavyIsRunning(line, busy);
  const merged = orbitMerged(line);
  const centre = size / 2;
  const places = orbitPlaces(line.agents.length, centre - EXPERT / 2 - 1);
  const links = running && !merged ? critiqueLinks(line) : [];
  const at = (n: number) => places[line.agents.findIndex((agent) => agent.n === n)];
  return (
    <div data-heavy-orbit={merged ? "merged" : running ? "running" : "rest"} aria-hidden="true"
      className="relative shrink-0" style={{ width: size, height: size }}>
      <div className="heavy-orbit-ring absolute inset-0" data-paused={running && !merged ? undefined : ""}>
        <svg className="absolute inset-0 overflow-visible" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {links.map(([from, to]) => {
            const a = at(from);
            const b = at(to);
            if (!a || !b) return null;
            const hot = line.agents.some((agent) => (agent.n === from || agent.n === to) && agent.speaking);
            return (
              <line key={`${from}-${to}`} data-heavy-orbit-link={`${from}-${to}`} x1={centre + a.x} y1={centre + a.y} x2={centre + b.x} y2={centre + b.y}
                className={cn("heavy-orbit-link", hot ? "text-accent" : "text-ink-tertiary")} stroke="currentColor" strokeWidth={hot ? 1.4 : 1} strokeLinecap="round" />
            );
          })}
        </svg>
        {line.agents.map((agent, index) => {
          const place = places[index]!;
          const speaking = running && agent.speaking === true;
          return (
            <span key={agent.n} data-heavy-orbit-expert={agent.n} data-heavy-orbit-speaking={speaking ? "" : undefined}
              className="heavy-orbit-seat absolute"
              style={{
                left: centre - EXPERT / 2, top: centre - EXPERT / 2,
                transform: merged ? "translate(0px, 0px) scale(0.3)" : `translate(${place.x}px, ${place.y}px)`,
                opacity: merged ? 0 : agent.status === "failed" ? 0.45 : 1,
              }}>
              <span className="heavy-orbit-upright block">
                <span className={cn("block rounded-full bg-app ring-2 ring-app", speaking && "heavy-orbit-speaking")}>
                  <MausAvatar color={AGENT_COLORS[index % AGENT_COLORS.length]!} size={EXPERT} state={speaking ? "thinking" : "idle"} animated={speaking} trackPointer={false} />
                </span>
              </span>
            </span>
          );
        })}
      </div>
      <span data-heavy-orbit-leader="" className={cn("absolute flex items-center justify-center rounded-full", merged && running && "heavy-orbit-speaking")}
        style={{ left: centre - LEADER / 2, top: centre - LEADER / 2, width: LEADER, height: LEADER }}>
        {leader}
      </span>
    </div>
  );
}
