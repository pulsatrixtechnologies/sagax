// What the Claude permission prompt does before a card: AskUserQuestion,
// record-link stripping, searched call_tool, pre-allowed names, artifact
// reads. The MCP proxy (server/permission-proxy.ts) and the stdio
// can_use_tool handler (can-use-tool.ts, #4525) both use this.
import { parseAskQuestions, QUESTION_UNANSWERED_NOTE, questionAnswersByQuestion, type AskQuestion } from "../../../shared/ask-question.ts";
import { permissionRoute } from "../../../shared/searched-tool-call.ts";
import { withoutRecordLinksIn } from "../../../shared/record-cards.ts";
import { harnessToolWordsLeave } from "../../../shared/record-link-tools.ts";

export const ASK_USER_QUESTION = "AskUserQuestion";

export const ASK_USER_QUESTION_UNANSWERABLE =
  "Sagax: this AskUserQuestion call had no answerable question (each one needs question text), so nobody was shown it. Ask again with a well-formed call, or continue without it.";

export interface PermissionFacts {
  searched: ReadonlySet<string>;
  preallowed: readonly string[];
  artifactReads: boolean;
}

export type ClassifiedPrompt =
  | { kind: "deny"; message: string }
  | { kind: "allow"; updatedInput: unknown }
  | { kind: "native-question"; input: unknown; questions: AskQuestion[] | null }
  | { kind: "ask"; tool: string; askInput: unknown; updatedInput: unknown; searched: boolean; suggestions: object[] | null };

export function permissionSuggestions(value: unknown): object[] | null {
  return Array.isArray(value) ? value as object[] : null;
}

/** #4507: a record link keeps only its label when the tool's words leave the app. */
export function recordSafeInput(tool: unknown, input: unknown): unknown {
  return typeof tool === "string" && harnessToolWordsLeave(tool, input) ? withoutRecordLinksIn(input) : input;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** One approve call, before anyone is asked. */
export function classifyPermissionPrompt(
  facts: PermissionFacts,
  toolName: unknown,
  rawInput: unknown,
  suggestions: unknown,
): ClassifiedPrompt {
  const listed = permissionSuggestions(suggestions);
  if (toolName === ASK_USER_QUESTION) {
    const questions = parseAskQuestions(rawInput);
    return { kind: "native-question", input: rawInput, questions: questions?.length ? questions : null };
  }
  const safe = recordSafeInput(toolName, rawInput ?? {});
  if (typeof toolName !== "string") {
    return { kind: "ask", tool: "tool", askInput: safe, updatedInput: safe, searched: false, suggestions: listed };
  }
  const route = permissionRoute(toolName, safe, facts.searched, facts.preallowed, facts.artifactReads);
  if (route.kind === "deny") return { kind: "deny", message: route.message };
  if (route.kind === "allow") return { kind: "allow", updatedInput: safe };
  return {
    kind: "ask",
    tool: route.tool,
    askInput: route.input,
    updatedInput: safe,
    searched: route.searched,
    suggestions: listed,
  };
}

export function allowPermissionResult(
  updatedInput: unknown,
  suggestions: object[] | null,
  always: boolean,
  searched: boolean,
  suppressAlways: boolean,
): { behavior: "allow"; updatedInput: object; updatedPermissions?: object[] } {
  const result: { behavior: "allow"; updatedInput: object; updatedPermissions?: object[] } = {
    behavior: "allow",
    updatedInput: updatedInput as object,
  };
  if (always && suggestions && !searched && !suppressAlways) result.updatedPermissions = suggestions;
  return result;
}

/**
 * Ask the person every question at once, then answer the tool the way it
 * documents. The answer is not a bare allow: that tells the CLI to run
 * AskUserQuestion, and a headless run has no dialog, so the click is lost.
 */
export async function answerNativeQuestions(
  input: unknown,
  ask: (questions: AskQuestion[]) => Promise<{ behavior?: string; message?: string; source?: string }>,
): Promise<string> {
  const questions = parseAskQuestions(input);
  if (!questions?.length) return JSON.stringify({ behavior: "deny", message: ASK_USER_QUESTION_UNANSWERABLE });
  const answer = await ask(questions);
  return JSON.stringify(nativeQuestionDecision(input, questions, answer));
}

/** AskUserQuestion's documented `answers` field. A bare allow drops the click.
 * #5032: a question that ran out of time is refused with the shared note,
 * never allowed with empty answers: the CLI then read "the user did not
 * answer" and the model went on to pick for the person. */
export function nativeQuestionDecision(
  input: unknown,
  questions: AskQuestion[],
  answer: { behavior?: string; message?: string; source?: string },
): { behavior: "allow"; updatedInput: Record<string, unknown> } | { behavior: "deny"; message: string } {
  if (answer.source === "timeout") return { behavior: "deny", message: QUESTION_UNANSWERED_NOTE };
  if (answer.behavior === "deny") return { behavior: "deny", message: answer.message || "Denied from Sagax" };
  const answers = answer.source === "user" && typeof answer.message === "string"
    ? questionAnswersByQuestion(answer.message, questions)
    : {};
  return { behavior: "allow", updatedInput: { ...asRecord(input), answers } };
}

export function asPermissionInput(value: unknown): Record<string, unknown> {
  return asRecord(value);
}
