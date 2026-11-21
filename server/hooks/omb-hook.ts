// omb-hook: the one command Sagax registers for Claude Code hooks
// (PostToolUse, PostToolUseFailure, PreCompact, SessionStart). Claude Code runs it with the
// hook's JSON on stdin and waits for it, so it obeys three rules learned
// the hard way by other harnesses:
//
//   1. It ALWAYS exits 0. A hook that fails or times out can block the
//      agent's next step; the harness observing is never worth that.
//   2. It has a hard budget (SAGAX_HOOK_TIMEOUT_MS, default 4000) below Claude
//      Code's own per-hook timeout, and speaks only to the loopback harness.
//   3. It is dependency-free and does no work itself: it forwards the event
//      to POST /api/internal/hook with the turn's capability token (read
//      from SAGAX_HOOK_TOKEN_FILE at run time: the token rotates per turn
//      while the CLI process, and its environment, live on) and prints the
//      harness's `hookSpecificOutput`, if any, for Claude Code to apply.
//
// `omb-hook connector-files` (#5140) is the one synchronous PostToolUse
// entry for the engine's own connectors: Sagax copies a file the engine
// saved into the person's place and hands back the result naming it there,
// so it waits up to SAGAX_CONNECTOR_FILES_BUDGET_MS (115 s, under that
// entry's 120 s timeout). It forwards only a result that names such a file,
// and of it only those strings (connector-files-slim.ts): a picture's
// base64 never travels, whatever its size, and the helper puts Sagax's
// strings back into the engine's own result.
//
// stdout is the hook channel: never console.log anything else here.
import { readFileSync } from "node:fs";
import { reportBackgroundError } from "../background-error.ts";
import { mergeToolResponse, namesEngineFile, slimToolResponse } from "./connector-files-slim.ts";

const CONTEXT_EVENTS = new Set(["SessionStart", "UserPromptSubmit"]);
/** #5140: the connector-files entry (claudeHookSettings). */
const CONNECTOR_FILES = process.argv[2] === "connector-files";
const ceiling = CONNECTOR_FILES ? 115_000 : 4_000;
const requestedBudget = Number(process.env[CONNECTOR_FILES ? "SAGAX_CONNECTOR_FILES_BUDGET_MS" : "SAGAX_HOOK_TIMEOUT_MS"]);
const budgetMs = Number.isFinite(requestedBudget) && requestedBudget > 0 ? Math.min(requestedBudget, ceiling) : ceiling;
// a connector-files result may carry a picture's base64 (it never leaves this process)
const MAX_INPUT_BYTES = CONNECTOR_FILES ? 128 * 1024 * 1024 : 1024 * 1024;
const url = process.env.SAGAX_HOOK_URL ?? "";
const tokenFile = process.env.SAGAX_HOOK_TOKEN_FILE ?? "";

const done = (out?: string) => {
  if (out === undefined) process.exit(0);
  process.stdout.write(out, () => process.exit(0));
};
process.stdout.on("error", () => process.exit(0));
// the outer fuse: whatever is still pending when this fires, we leave
const fuse = setTimeout(() => done(), budgetMs);
fuse.unref();

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    let bytes = 0;
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_INPUT_BYTES) return done();
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
  });
}

async function main(): Promise<void> {
  const raw = await readStdin();
  // a result without a file the engine saved has nothing to move
  if (CONNECTOR_FILES && !namesEngineFile(raw)) return done();
  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return done();
    payload = parsed as Record<string, unknown>;
  } catch {
    return done();
  }
  const event = typeof payload.hook_event_name === "string" ? payload.hook_event_name : "";
  if (!event || !/^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(url) || !tokenFile) return done();
  let token = "";
  try {
    token = readFileSync(tokenFile, "utf8").trim();
  } catch {
    return done();
  }
  if (!token) return done();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(200, budgetMs - 300));
  try {
    const response = await fetch(`${url}/api/internal/hook`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(CONNECTOR_FILES ? { event, payload: connectorFilesPayload(payload), mode: "connector-files" } : { event, payload }),
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) return done();
    const body = (await response.json().catch(() => null)) as { hookSpecificOutput?: unknown; context?: unknown } | null;
    if (body && typeof body === "object" && body.hookSpecificOutput && typeof body.hookSpecificOutput === "object") {
      const answer = CONNECTOR_FILES ? connectorFilesAnswer(body.hookSpecificOutput as Record<string, unknown>, payload.tool_response) : body.hookSpecificOutput;
      return done(JSON.stringify({ hookSpecificOutput: answer }));
    }
    // On SessionStart (and UserPromptSubmit) Claude Code reads plain-text
    // stdout as context the model sees; on every other event stdout is
    // only a debug line, so a context body is printed nowhere else.
    if (body && typeof body === "object" && typeof body.context === "string" && body.context && CONTEXT_EVENTS.has(event)) {
      return done(body.context);
    }
    return done();
  } catch {
    return done();
  } finally {
    clearTimeout(timer);
  }
}

/** #5140: what Sagax needs to move the files a result names: the hook's own
 * fields and the result's strings that name such a file. */
function connectorFilesPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const { hook_event_name, session_id, transcript_path, tool_name, tool_use_id } = payload;
  return { hook_event_name, session_id, transcript_path, tool_name, tool_use_id, tool_response: slimToolResponse(payload.tool_response) };
}

/** #5140: Sagax's rewritten strings put back into the engine's own result. */
function connectorFilesAnswer(output: Record<string, unknown>, original: unknown): Record<string, unknown> {
  const merged = { ...output };
  for (const field of ["updatedMCPToolOutput", "updatedToolOutput"]) {
    if (field in merged) merged[field] = mergeToolResponse(original, merged[field]);
  }
  return merged;
}

void main().catch(reportBackgroundError);
