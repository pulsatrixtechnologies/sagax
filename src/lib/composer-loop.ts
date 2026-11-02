/** `/loop` in the chat: a repeating prompt on this bot, as a routine.
 * The clock minimum is 5 minutes and the maximum is one day
 * (server/routines/routines.ts). A shorter cadence is raised. A longer one is capped. */

export const LOOP_SUBCOMMANDS = ["status", "stop"] as const;
export type LoopSubcommand = (typeof LOOP_SUBCOMMANDS)[number];

export const LOOP_MIN_MINUTES = 5;
export const LOOP_MAX_MINUTES = 1_440;

export type LoopCommand =
  | { kind: "incomplete" }
  | { kind: "status" }
  | { kind: "stop"; name: string }
  | { kind: "start"; everyMinutes: number; prompt: string; raised: boolean; capped: boolean };

/** The typed `/loop …`, or null when this is not that command. */
export function parseLoopCommand(text: string): LoopCommand | null {
  const match = /^\/loop(?:\s+([\s\S]*))?$/i.exec(text.trim());
  if (!match) return null;
  const rest = (match[1] ?? "").trim();
  if (!rest) return { kind: "incomplete" };
  const [first, ...tail] = rest.split(/\s+/);
  const word = (first ?? "").toLowerCase();
  if (word === "status" && tail.length === 0) return { kind: "status" };
  if (word === "stop") return { kind: "stop", name: tail.join(" ").trim() };
  const everyMinutes = minutesFromCadence(word);
  if (everyMinutes === null) return { kind: "incomplete" };
  const prompt = tail.join(" ").trim();
  if (!prompt) return { kind: "incomplete" };
  const raw = rawMinutes(word);
  return {
    kind: "start",
    everyMinutes,
    prompt,
    raised: raw < LOOP_MIN_MINUTES,
    capped: raw > LOOP_MAX_MINUTES,
  };
}

function rawMinutes(token: string): number {
  const match = /^(\d+)([mhd])$/i.exec(token);
  if (!match) return 0;
  const count = Number(match[1]);
  const unit = match[2]!.toLowerCase();
  if (unit === "h") return count * 60;
  if (unit === "d") return count * 1_440;
  return count;
}

function minutesFromCadence(token: string): number | null {
  if (!/^(\d+)([mhd])$/i.test(token)) return null;
  const raw = rawMinutes(token);
  if (!Number.isInteger(raw) || raw < 1) return null;
  return Math.min(LOOP_MAX_MINUTES, Math.max(LOOP_MIN_MINUTES, raw));
}

/** A short name for the routine, from the cadence and the start of the prompt. */
export function loopRoutineName(everyMinutes: number, prompt: string): string {
  const cadence = everyMinutes % 60 === 0 && everyMinutes >= 60
    ? everyMinutes % 1_440 === 0
      ? `${everyMinutes / 1_440}d`
      : `${everyMinutes / 60}h`
    : `${everyMinutes}m`;
  const title = prompt.replace(/\s+/g, " ").slice(0, 42).trim();
  return `Loop ${cadence} ${title}`.slice(0, 80);
}
