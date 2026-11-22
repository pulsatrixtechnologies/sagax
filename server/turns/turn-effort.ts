// Reasoning effort for one turn, in one place (docs/code/engines.md).
// A call and a background one-shot run at the lowest effort the engine
// offers ("low" where it exists). A chat, a warm of that chat, and a
// routine run use the saved effort. Grok's HTTP API is included: when a
// chat, warm or routine names no effort, it runs at high, which is that
// API's own default, sent explicitly so two turns of one conversation
// name the same level.
import type { EffortLevel } from "../../shared/model-selection.ts";
import { resolveEngineTurnEffort } from "../../shared/ultracode-effort.ts";
import { callTurnEffort } from "../voice/voice-call-effort.ts";

export type TurnEffortKind = "chat" | "call" | "routine" | "background" | "warm";

export function effortForTurn(input: {
  kind: TurnEffortKind;
  driverKind: string;
  /** what the engine accepts; absent means the caller keeps the saved effort */
  levels?: readonly EffortLevel[];
  /** the bot's own effort, when it set one */
  effort?: EffortLevel;
  /** a routine's own effort; wins over the bot's on a routine turn */
  routineEffort?: EffortLevel;
}): EffortLevel | undefined {
  switch (input.kind) {
    case "call":
    case "background":
      return callTurnEffort({ driverKind: input.driverKind, levels: input.levels, effort: input.effort });
    case "chat":
    case "warm":
    case "routine": {
      const saved = input.kind === "routine" ? (input.routineEffort ?? input.effort) : input.effort;
      const chosen = resolveEngineTurnEffort(saved, input.driverKind, input.levels);
      if (chosen) return chosen;
      if (input.driverKind === "grok" && input.levels?.includes("high")) return "high";
      return undefined;
    }
    default: {
      const neverKind: never = input.kind;
      return neverKind;
    }
  }
}
