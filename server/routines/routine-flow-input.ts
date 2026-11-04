export interface RoutineFlowInput { routine?: string; plan?: Record<string, unknown> }
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
  const flag = prompt.match(/--routine(?:=|\s+)[`"']?([a-zA-Z0-9][a-zA-Z0-9_.-]*)/);
  const quotedName = prompt.match(/\b(?:Pulsatrix[ -]Flow|Flow\s+routine|routine(?:\s+Flow)?)\s*(?:[:=]\s*)?([`"'])([a-zA-Z0-9][a-zA-Z0-9_.-]*)\1/i);
  const markedName = prompt.match(/\b(?:Pulsatrix[ -]Flow|Flow\s+routine|routine(?:\s+Flow)?)\s*[:=]\s*([a-zA-Z0-9][a-zA-Z0-9_.-]*)/i);
  const routine = typeof explicit === "string" && explicit.trim() ? explicit.trim()
    : quotedName?.[2] ?? (flag?.[1] ?? markedName?.[1])?.replace(/\.+$/, "");
  // Prose such as "la routine Flow jusqu'à ..." names no recipe. A plan
  // is explicit only when the prompt supplies its command and arguments;
  // the model discovers missing units during the actual run.
  return { ...(routine ? { routine } : {}), ...(object(plan?.args) ? { plan: { ...plan.args } } : {}) };
}
