// #4877: a routine step that failed says, in one shape, what failed, why and
// what to do. A failure that trying again cannot change (a tool the bot does
// not have, a permission the account was refused, a saved result that
// expired) is lasting: it is surfaced and stops there, never retried as if it
// might pass, and never left silent because it happened only once.
//
// Read from the step's own words (a tool's output, an engine's error); a
// failure of any other kind keeps its own words and gets no next step here.
import { isEngineReconnectCondition } from "../engines/engine-reconnect-ahead.ts";
import { isPermissionRefusal } from "../drivers/retry.ts";

export type RoutineStepFailureKind = "missing_tool" | "permission" | "expired_result";

export interface RoutineStepFailure {
  kind: RoutineStepFailureKind;
  /** Why it failed, in words a person reads (no raw code). */
  why: string;
  /** What to do, as one sentence. */
  next: string;
}

/** A tool the engine or the connector does not have: the WHOLE message
 * says so and names the tool ("tool not found: Flow", "Unknown tool: x",
 * "MCP error: no tool named x"). A longer text is the tool's own refusal
 * ("Unknown tool: create_invoice is not an operation of this API", #4432
 * review), never a missing tool. */
const MISSING_TOOL = /^(?:mcp error(?:\s+-?\d+)?:\s*|error:\s*)?(?:(?:tool|function)\s+not\s+found|unknown\s+tool|no\s+such\s+tool|no\s+tool\s+named)\s*[:\s]\s*["'`]?([A-Za-z0-9][\w.-]{0,120}?)["'`]?[.!]?$|^(?:mcp error(?:\s+-?\d+)?:\s*|error:\s*)?tool\s+["'`]?([A-Za-z0-9][\w.-]{0,120}?)["'`]?\s+(?:not\s+found|does\s+not\s+exist|is\s+not\s+served)[.!]?$/i;

/** A connector's saved result (a result handle) that is gone: it never comes back. */
const EXPIRED_RESULT = /\bhandle\s+\S+\s+is\s+(?:unknown|expired)\b|\bhandle_(?:unknown|expired)\b/i;

/** A vendor that knows who asks and refuses this call for lack of a
 * permission or a scope (a security role without Inquire, a token without a
 * scope). Not an engine sign-in (isEngineReconnectCondition). */
const PERMISSION_WORDS = /\bdo(?:es)?\s+not\s+have\s+(?:the\s+)?(?:required\s+)?(?:permissions?|access|rights?)\b|\bpermissions?\s*(?:\([^)]{1,40}\)|["'`][^"'`]{1,40}["'`]|[A-Z][\w.:-]{1,40})?\s*(?:is\s+|are\s+)?(?:required|denied|missing|needed)\b|\binsufficient\s+(?:permissions?|privileges?|rights|scopes?)\b|\b(?:lacks?|missing)\s+(?:the\s+)?(?:[\w.:-]+\s+)?(?:permissions?|scopes?)\b|\bnot\s+(?:permitted|authori[sz]ed)\s+to\b|\bsecurity\s+role\b/i;
const PERMISSION_NAME = [
  /\bpermissions?\s*\(([^)]{1,40})\)/i,
  /\bpermissions?\s+["'`]?([A-Z][\w.:-]{1,40})["'`]?/,
  /\b(?:lacks?|missing|requires?|needs?)\s+(?:the\s+)?["'`]?([\w.:-]{2,60})["'`]?\s+(?:permission|scope)\b/i,
  /\(([A-Z][a-z]+)\)/,
];

function permissionName(text: string): string | undefined {
  for (const pattern of PERMISSION_NAME) {
    const name = pattern.exec(text)?.[1]?.trim();
    if (name && !/^(?:is|are|the|to|for|denied|required|missing|forbidden|unauthorized)$/i.test(name)) return name;
  }
  return undefined;
}

/** Whether a failure's words name a permission or a scope the account
 * lacks, and are not the engine's sign-in. */
export function namesMissingPermission(text: string): boolean {
  return Boolean(text) && PERMISSION_WORDS.test(text) && !isEngineReconnectCondition(text);
}

/** Whether a failure is a vendor's refusal for a missing permission or
 * scope, not the engine's sign-in. */
export function isVendorPermissionRefusal(text: string): boolean {
  if (!text || isEngineReconnectCondition(text)) return false;
  return isPermissionRefusal(text) || PERMISSION_WORDS.test(text);
}

/** The lasting failure a step's words say, or null for any other failure
 * (a timeout, a 5xx, a miss the bot moves past). `tool`: the step's tool
 * in words, when known. */
export function routineStepFailure(output: string | undefined, tool?: string): RoutineStepFailure | null {
  const text = String(output ?? "");
  if (!text.trim()) return null;
  const missing = MISSING_TOOL.exec(text.trim());
  if (missing) {
    const name = missing[1] ?? missing[2] ?? tool;
    return {
      kind: "missing_tool",
      why: `the tool${name ? ` "${name}"` : ""} is not available to this bot`,
      next: "Reconnect the connector or plugin that provides it, or change the routine to a tool the bot has.",
    };
  }
  if (EXPIRED_RESULT.test(text)) {
    return {
      kind: "expired_result",
      why: "the saved result it read had expired (a connector keeps a result handle 15 minutes idle) and never comes back",
      next: "Nothing to fix by hand: the step must run its query again for a fresh result, which the next run does.",
    };
  }
  if (isVendorPermissionRefusal(text)) {
    const name = permissionName(text);
    return {
      kind: "permission",
      why: name ? `the account was refused the "${name}" permission this step needs` : "the account lacks a permission this step needs",
      next: `Give ${name ? `the "${name}" permission` : "that permission"} to the account the routine runs as (its role or token in that service), or run the routine as someone who has it.`,
    };
  }
  return null;
}

/** One problem line: what failed and its own words (why), then what to do
 * when trying again cannot fix it. `times`: how many times the step failed
 * in the run. */
export function routineStepProblem(tool: string, output: string | undefined, times = 1): string {
  const failed = times < 2 ? `${tool} failed` : `${tool} failed ${times} times and never succeeded after`;
  const line = `${failed}${output ? `: ${output}` : ""}`;
  const known = routineStepFailure(output, tool);
  return known ? `${line.replace(/[.\s]+$/, "")}. Next: ${known.next}` : line;
}

/** A run's failure in the same shape, when its words are a lasting step
 * failure; else the words as they are. */
export function routineFailureText(failure: string): string {
  const known = routineStepFailure(failure);
  if (!known) return failure;
  return `${failure.trim().replace(/[.\s]+$/, "")}. Why: ${known.why}. Next: ${known.next}`;
}
