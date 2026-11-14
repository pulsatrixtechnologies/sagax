/** #4250 (S2): the shared cases of the one attention policy
 * (./attention-policy.vectors.json), read the same way by the server's and
 * the desktop's tests; the phone reads the same file. Test support only. */
import vectorsJson from "./attention-policy.vectors.json";
import type { AttentionInput, LevelChannels } from "./attention-policy.ts";
import type { NotifyKind } from "./notification.ts";
import type { ReachChannelId } from "./reach-me.ts";
import type { QuietHours, SignalLevel } from "./signal-levels.ts";

export interface AttentionVectorCase {
  name: string;
  input: {
    kind: NotifyKind;
    botId: string;
    level?: SignalLevel;
    notify?: boolean;
    personTurn?: boolean;
    when: "night" | "day";
    quiet?: boolean;
    budget?: number;
    sentToday?: number;
    looking?: boolean;
    seen?: boolean;
    botChannels?: ReachChannelId[];
    levelChannels?: LevelChannels;
  };
  expected: { verdict: "ring" | "quiet" | "hold" | "seen"; level: SignalLevel; reason: string; channels: string[]; counts?: boolean };
}

export interface AttentionVectors {
  quiet: QuietHours;
  night: string;
  day: string;
  cases: AttentionVectorCase[];
}

export const attentionVectors = vectorsJson as unknown as AttentionVectors;

/** A vector's input as the policy takes it. `presence: false` leaves the
 * presence step out (the server's verdict before a client is asked). */
export function vectorInput(input: AttentionVectorCase["input"], options: { presence?: boolean } = {}): AttentionInput {
  return {
    kind: input.kind,
    botId: input.botId,
    ...(input.level ? { level: input.level } : {}),
    ...(input.notify !== undefined ? { notify: input.notify } : {}),
    ...(input.personTurn ? { personTurn: true } : {}),
    at: Date.parse(input.when === "night" ? attentionVectors.night : attentionVectors.day),
    quiet: input.quiet ? attentionVectors.quiet : null,
    ...(input.budget !== undefined ? { budget: input.budget, sentToday: input.sentToday ?? 0 } : {}),
    ...(options.presence === false ? {} : { presence: { looking: input.looking === true, seen: input.seen === true } }),
    ...(input.levelChannels ? { levelChannels: input.levelChannels } : {}),
    ...(input.botChannels ? { botChannels: input.botChannels } : {}),
  };
}
