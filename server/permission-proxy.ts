// permission-proxy — the MCP stdio server the claude CLI spawns for
// --permission-prompt-tool (ported from agentcal's runPermissionProxy;
// dedicated entry file, so there is no argv-dispatch fork-bomb hazard).
// Forwards each ask over a unix socket to the broker living in the
// Sagax server and waits for the human's answer.
//
//   approve   — the CLI calls this for any tool use its permission mode
//               would deny; the answer is the --permission-prompt-tool
//               JSON contract ({behavior:"allow"|"deny", …}).
//   ask_user  — the agent can pose a question mid-run and wait; the
//               human's words come back verbatim. With multiSelect it is
//               asked as a question card the person can pick several from.
//
// One tool arrives through `approve` that is not a permission at all: the
// CLI's own AskUserQuestion. It is the tool the model actually reaches for
// when it wants a person to choose, and acceptEdits will not run it unasked,
// so it lands here looking like "may I run a tool?" — which is how a question
// ended up on screen as an Allow/Deny dialog over a JSON blob. It is intercepted
// below and asked as what it is: one card carrying every question it posed,
// answered through the tool's own `answers` field.
//
// stdout is the MCP channel — never console.log here.
import { connect } from "node:net";
import { randomUUID } from "node:crypto";
import { parseAskQuestions, questionAnswersByQuestion, type AskQuestion } from "../shared/ask-question.ts";
import { allowsTool, parseToolScope } from "../shared/tool-scope.ts";
import { permissionRoute, preallowedFromEnv, searchedServersFromEnv } from "../shared/searched-tool-call.ts";

// #1276: the servers whose catalog is searched; a call_tool there is asked
// about as the tool it runs (shared/searched-tool-call.ts).
const SEARCHED = searchedServersFromEnv(process.env.SAGAX_PERMISSION_SEARCHED);
// #1374: what the turn pre-allows by name (claude.ts), so a call_tool or the
// agents bridge's use_tool runs unasked exactly when its target would have.
const PREALLOWED = preallowedFromEnv(process.env.SAGAX_PERMISSION_PREALLOWED);
// #2018: Auto turns let Artifact reads run unasked.
const ARTIFACT_READS = process.env.SAGAX_PERMISSION_ARTIFACT_READS === "1";

const selection = parseToolScope(process.env.SAGAX_PERMISSION_TOOL_SCOPE === undefined
  ? undefined : (() => { try { return JSON.parse(process.env.SAGAX_PERMISSION_TOOL_SCOPE); } catch { return null; } })());
if (!selection.ok) throw new Error(selection.error);
const allowQuestion = allowsTool(selection.scope, { kind: "mcp", server: "ogb", name: "ask_user" });

const socketPath = process.argv[2] ?? "";

const waiting = new Map<string, (msg: any) => void>();
const conn = connect(socketPath);
// Both streams below carry JSON lines that can be larger than one read.
// Decoding as a stream keeps a character split across two reads whole.
conn.setEncoding("utf8");

interface AllowPermissionResult {
  behavior: "allow";
  updatedInput: object;
  updatedPermissions?: object[];
}
const dead = () => {
  for (const resolve of waiting.values()) {
    resolve({ behavior: "deny", message: "Sagax: permission broker unavailable — skip this action" });
  }
  waiting.clear();
};
conn.on("error", dead);
conn.on("close", dead);

let connBuf = "";
conn.on("data", (chunk) => {
  connBuf += chunk;
  let nl;
  while ((nl = connBuf.indexOf("\n")) !== -1) {
    const line = connBuf.slice(0, nl);
    connBuf = connBuf.slice(nl + 1);
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.t === "answer") {
      waiting.get(msg.id)?.(msg);
      waiting.delete(msg.id);
    }
  }
});

const send = (obj: unknown) => process.stdout.write(JSON.stringify(obj) + "\n");

/** Hand one ask to the broker and wait for the human's answer. */
function askBroker(ask: Record<string, unknown>): Promise<any> {
  return new Promise((resolve) => {
    waiting.set(String(ask.id), resolve);
    if (conn.destroyed) return dead();
    try {
      conn.write(JSON.stringify(ask) + "\n");
    } catch {
      dead();
    }
  });
}

/** A multiSelect ask_user as the one-question card AskUserQuestion already
 * draws with checkboxes; flat choices can only ever be one tap. Null when
 * the call asks for a single pick. */
function multiSelectQuestion(args: Record<string, unknown>): AskQuestion[] | null {
  if (args.multiSelect !== true) return null;
  const options = Array.isArray(args.choices) ? args.choices : [];
  return parseAskQuestions({ questions: [{ question: args.question, multiSelect: true, options }] });
}

// ── the CLI's own AskUserQuestion ──────────────────────────────────────
const ASK_USER_QUESTION = "AskUserQuestion";

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

/** One question, in the shape the broker and the option card understand. */
/**
 * Ask the person every question at once, then answer the tool the way it
 * documents.
 *
 * The answer is NOT a bare allow. A bare allow tells the CLI to go and run
 * AskUserQuestion, and a headless run has no dialog to collect anything —
 * the model gets "The user did not answer the questions." back and the
 * click is thrown away. The `answers` object is the field the tool's own
 * schema calls "User answers collected by the permission component":
 * keyed by the question's text, one comma-joined string per question.
 *
 * One ask, not one per question: the card draws the whole set with a tab
 * each, so a person sees what they are committing to before answering any
 * of it. `questionAnswersByQuestion` maps the answer text back per question.
 *
 * There is deliberately no "fall through to the permission path" here. That
 * path cannot answer this tool — allowing it throws the click away, as
 * above — so the fallback offered a person an Allow/Deny dialog over raw JSON.
 * That dialog is the bug this file exists to remove.
 */
async function answerNativeQuestions(input: unknown): Promise<string> {
  // Unanswerable entries are SKIPPED by the parser, not fatal: one bad entry
  // must not cost the user the good questions beside it. Nothing left means
  // the whole call was unanswerable, which becomes a denial.
  const questions = parseAskQuestions(input);
  if (!questions?.length) {
    return JSON.stringify({
      behavior: "deny",
      message:
        "Sagax: this AskUserQuestion call had no answerable question (each one needs question text), so nobody was shown it. Ask again with a well-formed call, or continue without it.",
    });
  }
  const answer = await askBroker({
    t: "ask",
    id: randomUUID(),
    kind: "question",
    tool: ASK_USER_QUESTION,
    input: { questions },
  });
  // A question is only ever denied when the broker is gone.
  if (answer.behavior === "deny") {
    return JSON.stringify({ behavior: "deny", message: answer.message || "Denied from Sagax" });
  }
  // What lands in `answers` turns on WHO answered, not on whether there are
  // words. The broker's own notes are words — the timeout's "nobody answered
  // in time, use your best judgment" is a whole sentence — so filing anything
  // non-blank hands the model system text in the slot reserved for what the
  // person chose. Left out, the CLI reports the question as unanswered, which
  // is the truth.
  const answers =
    answer.source === "user" && typeof answer.message === "string"
      ? questionAnswersByQuestion(answer.message, questions)
      : {};
  return JSON.stringify({ behavior: "allow", updatedInput: { ...asRecord(input), answers } });
}

const TOOLS = [
  {
    name: "approve",
    description: "Ask the Sagax user whether a tool use is allowed",
    inputSchema: {
      type: "object",
      properties: {
        tool_name: { type: "string" },
        input: { type: "object" },
        tool_use_id: { type: "string" },
      },
      required: ["tool_name", "input"],
    },
  },
  {
    name: "ask_user",
    description:
      "Ask the human who owns this bot a question and wait for their answer. Use whenever you need a decision, a preference, missing information, or sign-off before doing something consequential — do not guess on things the owner would want to decide. Returns their answer as text.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", description: "The question, with enough context to answer at a glance" },
        choices: {
          type: "array",
          items: { type: "string" },
          description: "Optional 2-5 suggested answers, shown as one-tap buttons",
        },
        multiSelect: {
          type: "boolean",
          description: "Set true when the person may pick more than one of the choices. Their picks come back joined with commas.",
        },
      },
      required: ["question"],
    },
  },
];

async function handle(msg: any) {
  if (msg.method === "initialize") {
    return send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: msg.params?.protocolVersion ?? "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "openmausbot-permissions", version: "1" },
      },
    });
  }
  // approve is the CLI's private permission callback, not an execution grant.
  if (msg.method === "tools/list") return send({ jsonrpc: "2.0", id: msg.id, result: { tools: TOOLS.filter((tool) => tool.name === "approve" || allowQuestion) } });
  if (msg.method === "tools/call") {
    const name = msg.params?.name;
    const args = msg.params?.arguments ?? {};
    const reply = (text: string) => send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text }] } });
    if (name === "ask_user" && !allowQuestion) return reply("Sagax: this question tool is excluded by the bot's tool selection.");
    // AskUserQuestion is a question wearing a permission's clothes. It never
    // continues into the permission path below — see nativeQuestions.
    if (name === "approve" && args.tool_name === ASK_USER_QUESTION) {
      return reply(await answerNativeQuestions(args.input));
    }
    const askId = randomUUID();
    const isQuestion = name === "ask_user";
    const picksSeveral = isQuestion ? multiSelectQuestion(args) : null;
    // the CLI may include its own suggested permission rules; on allow we
    // hand them straight back as updatedPermissions so claude stops asking
    // at its own layer — no invented rule syntax (agentcal)
    const suggestions = Array.isArray(args.permission_suggestions)
      ? args.permission_suggestions
      : Array.isArray(args.suggestions)
        ? args.suggestions
        : null;
    // A call_tool on a searched server is asked about as the tool it runs,
    // so its card, its rules and Always allow are that tool's. Claude's own
    // suggested rule would allow every call_tool of the server: never handed back.
    // #1374: the agents bridge's use_tool likewise; one naming no tool, or
    // another meta tool, runs nothing and is refused without a card.
    const route = isQuestion || typeof args.tool_name !== "string" ? null : permissionRoute(args.tool_name, args.input, SEARCHED, PREALLOWED, ARTIFACT_READS);
    if (route?.kind === "deny") return reply(JSON.stringify({ behavior: "deny", message: route.message }));
    if (route?.kind === "allow") return reply(JSON.stringify({ behavior: "allow", updatedInput: args.input ?? {} } satisfies AllowPermissionResult));
    const runs = route?.kind === "ask" ? route : null;
    const answer: any = await askBroker(
      isQuestion
        ? { t: "ask", id: askId, kind: "question", tool: "ask_user", input: { question: args.question, choices: args.choices, ...(picksSeveral ? { questions: picksSeveral } : {}) } }
        : { t: "ask", id: askId, tool: runs?.searched ? runs.tool : args.tool_name, input: runs?.searched ? runs.input : args.input },
    );
    let text = answer.message || "No answer was given — use your best judgment.";
    // The card answers in its Q:/A: form; hand back just the picks, the way
    // a one-tap answer arrives. Only the person's own words are unpacked.
    if (picksSeveral && answer.source === "user" && typeof answer.message === "string") {
      text = questionAnswersByQuestion(answer.message, picksSeveral)[picksSeveral[0]!.question] ?? text;
    }
    if (!isQuestion) {
      if (answer.behavior === "allow") {
        const result: AllowPermissionResult = { behavior: "allow", updatedInput: args.input ?? {} };
        if (answer.always && suggestions && !runs?.searched) result.updatedPermissions = suggestions;
        text = JSON.stringify(result);
      } else {
        text = JSON.stringify({ behavior: "deny", message: answer.message || "Denied from Sagax" });
      }
    }
    return reply(text);
  }
  if (String(msg.method ?? "").startsWith("notifications/")) return;
  if (msg.id != null) {
    send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `method not found: ${msg.method}` } });
  }
}

let inBuf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  inBuf += chunk;
  let nl;
  while ((nl = inBuf.indexOf("\n")) !== -1) {
    const line = inBuf.slice(0, nl);
    inBuf = inBuf.slice(nl + 1);
    if (!line.trim()) continue;
    try {
      void handle(JSON.parse(line));
    } catch {
      /* ignore malformed lines */
    }
  }
});
process.stdin.on("end", () => process.exit(0));
