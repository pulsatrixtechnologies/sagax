export interface RoutineFlowInput { routine?: string; plan: Record<string, unknown> }
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));

/** Read explicit server commands from the same prompt the routine receives.
 * Missing inputs stay missing: fabricating empty units would hide missing reads. */
export function routineFlowInput(prompt: string): RoutineFlowInput {
  const records: Record<string, unknown>[] = [];
  const starts: number[] = [];
  let quoted = false;
  let escaped = false;
  for (let i = 0; i < prompt.length; i++) {
    const char = prompt[i];
    if (starts.length && char === '"' && !escaped) quoted = !quoted;
    if (!quoted) {
      if (char === "{") starts.push(i);
      else if (char === "}" && starts.length) {
        const start = starts.pop()!;
        try { const value: unknown = JSON.parse(prompt.slice(start, i + 1)); if (object(value)) records.push(value); } catch { /* Prose braces are not commands. */ }
      }
    }
    escaped = quoted && char === "\\" && !escaped;
  }
  const init = records.find(record => record.command === "run.init");
  const plan = records.find(record => record.command === "plan");
  const explicit = object(init?.args) ? init.args.routine : records.find(record => typeof record.routine === "string")?.routine;
  const named = prompt.match(/--routine(?:=|\s+)[`"']?([a-zA-Z0-9][a-zA-Z0-9_.-]*)/)
    ?? prompt.match(/\b(?:routine\s+Flow|Flow\s+routine)\s*[:=]?\s*[`"']?([a-zA-Z0-9][a-zA-Z0-9_.-]*)/i)
    ?? prompt.match(/\broutine\s+[`"']([a-zA-Z0-9][a-zA-Z0-9_.-]*)[`"']/i)
    ?? prompt.match(/\b(?:run|execute|launch|ex[eé]cute|lance)\s+(?:(?:the|la)\s+)?routine\s+([a-zA-Z0-9][a-zA-Z0-9_.-]*)/i);
  const routine = typeof explicit === "string" ? explicit : named?.[1]?.replace(/\.+$/, "");
  // The server supplies a bound routine when the prompt does not name one.
  return { ...(routine ? { routine } : {}), plan: object(plan?.args) ? { ...plan.args } : {} };
}
