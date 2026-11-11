// Reading one turn's dump record from the fake Claude CLI's turn log
// (FAKE_CLAUDE_DUMP_LOG in fake-claude-cli.ts). The single dump file keeps
// only the latest turn, so a test that asserts on the prompt of one turn
// while other turns can still run (an automatic follow-up, another person's
// conversation) reads the wrong turn whenever one of them lands after it.
// The log keeps every turn; this finds the one the test means.
import { existsSync, readFileSync } from "node:fs";

/** What the fake CLI records for a turn (the same shape as its dump). */
export type TurnDump = {
  pid: number;
  argv: string[];
  env: Record<string, string>;
  cwd: string;
  prompt: unknown;
  systemPrompt?: string | null;
  systemPromptFile?: string | null;
  mcpConfig?: any;
  settings?: unknown;
  settingsMode?: number | null;
};

/** The turns logged so far, in the order they ran. A line still being
 * written is skipped; it is read on the next call. */
function loggedTurns(log: string): TurnDump[] {
  if (!existsSync(log)) return [];
  const turns: TurnDump[] = [];
  for (const line of readFileSync(log, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      turns.push(JSON.parse(line) as TurnDump);
    } catch {
      /* a partial last line */
    }
  }
  return turns;
}

/** Every line of text a prompt carries, whatever its shape (a string, a
 * stream frame, content blocks). */
function promptLines(prompt: unknown): string[] {
  if (typeof prompt === "string") return prompt.split("\n").map((line) => line.trim());
  if (Array.isArray(prompt)) return prompt.flatMap(promptLines);
  if (prompt && typeof prompt === "object") return Object.values(prompt).flatMap(promptLines);
  return [];
}

/** The first turn whose prompt holds `text` as a line of its own (the words
 * the turn was given), waiting (bounded) until it is in the log. A mention of
 * the same words inside another turn's context (a recalled passage, a list of
 * earlier topics: `Asked: "..."`) is not that turn. */
export async function turnWithPrompt(log: string, text: string, timeoutMs = 30_000): Promise<TurnDump> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const turns = loggedTurns(log);
    const found = turns.find((turn) => promptLines(turn.prompt).includes(text));
    if (found) return found;
    if (Date.now() >= deadline) {
      throw new Error(`no turn whose prompt holds ${JSON.stringify(text)} within ${timeoutMs} ms (${turns.length} turns logged in ${log})`);
    }
    await new Promise((wake) => setTimeout(wake, 50));
  }
}
