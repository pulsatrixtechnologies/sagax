// Agents tool family: Agent-to-agent API and run_with_engine.
// Never import server/index.ts.
import { agentToolAnnotations } from "../../tools/agent-tool-policy.ts";
import type { ToolCallContext, ToolCallResult } from "../agents-call-types.ts";
import type { Json } from "../agents-client.ts";

/** The agent-to-agent tools (server/agent-api.ts, docs/agent-api.md): the
 * names, parameters and limits of the reference design's own agent tools. Every send
 * lands in that agent's single chat with its person (#1170), the sender named. */
const AGENT_ID = { type: "string", description: "The agent's id, exactly as list_agents or find_agents returned it." } as const;
const AGENT_CURSOR = { type: "string", description: "next_cursor of the previous page: entries before it." } as const;
export const AGENT_API_TOOLS = [
  {
    name: "list_agents",
    description: "List the Sagax agents (bots) you may reach: id, name, description, status (running or idle), temporary, and owner ({principal_id, name} or null). Its ids are the only valid agent_id values. Pass owner.principal_id to sagax_nudge to reach that agent's owner.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "find_agents",
    description: "Find reachable agents by name or description; answers the best matches only.",
    inputSchema: { type: "object", additionalProperties: false, properties: {
      query: { type: "string", minLength: 1, maxLength: 200, description: "Words of the agent's name or description." },
      status: { type: "string", enum: ["running", "idle"] },
      limit: { type: "integer", minimum: 1, maximum: 64, description: "Default 8." },
    }, required: ["query"] },
  },
  {
    name: "get_agent",
    description: "Read one agent's full profile for an audit: title, owner, instructions with their persona, rules, voice and anti-jobs sections, voice settings, whether it is temporary and when it expires, and a link to its sheet.",
    inputSchema: { type: "object", additionalProperties: false, properties: { agent_id: AGENT_ID }, required: ["agent_id"] },
  },
  {
    name: "create_agent",
    description: "Create one temporary agent (bot) in your section, for a one-off task kept apart from the lasting bots. Only when the user explicitly asks; one per call; check list_agents first. It is archived after idle_hours without a prompt (default 24) unless a person pins it; at most 10 per person; it cannot create agents itself. It greets the user itself: do not send it a first prompt and never quote its id.",
    inputSchema: { type: "object", additionalProperties: false, properties: {
      name: { type: "string", minLength: 1, maxLength: 80, description: "Display name." },
      description: { type: "string", maxLength: 1000, description: "What it does." },
      idle_hours: { type: "integer", minimum: 1, maximum: 720, description: "Hours without a prompt before it is archived; default 24." },
      workspace: { type: "string", enum: ["this_computer", "browser", "cloud", "local_vm"], description: "Optional: where it works while its Workspace is Auto. A place not allowed or offline falls back." },
    }, required: ["name"] },
  },
  {
    name: "delete_agent",
    description: "Delete a temporary agent you created once its task is done: it is archived (no longer listed, no longer answers) and its conversations are kept 30 days.",
    inputSchema: { type: "object", additionalProperties: false, properties: { agent_id: AGENT_ID }, required: ["agent_id"] },
  },
  {
    name: "send_prompt",
    description: "Send a prompt to an agent: it lands in the agent's one chat with its person, your name on it, and runs at the agent's own approval level. mode fire_and_forget (default) and async return a handle once accepted (async also tells you when the turn ends); blocking waits up to timeout_ms but returns still_working under the ~55 s ceiling with the handle so you resume via await_turn. The answer carries thread_id and the handle's lifetime: a handle lasts 7 days, given as ttl_ms, expires_at (unix ms) and expires_at_iso. Keep thread_id: it outlives the handle. After a timeout, resume with await_turn and the handle: never re-send. An empty reply with finished=true means the agent said nothing. on_busy: queue (default) waits its turn, reject refuses with retryable busy (turn_state and options in details), supersede stops the running turn you started (and any approval it waits on), never someone else's. Refusals use the unified envelope with retryable true|false. Optional priority now wakes an idle agent at once or moves the prompt to the front of its queue, and never interrupts a running turn; past 10 now sends an hour it is delivered as normal.",
    inputSchema: { type: "object", additionalProperties: false, properties: {
      agent_id: AGENT_ID,
      prompt: { type: "string", minLength: 1, maxLength: 32000 },
      mode: { type: "string", enum: ["fire_and_forget", "blocking", "async"] },
      timeout_ms: { type: "integer", minimum: 1000, maximum: 600000, description: "Blocking wait budget; the live wait is capped at 55000 so the handle returns. Default 120000." },
      on_busy: { type: "string", enum: ["supersede", "reject", "queue"], description: "queue (default) waits its turn; reject answers 409 busy (retryable) with turn_state; supersede stops a turn you started." },
      priority: { type: "string", enum: ["now", "normal"], description: "now wakes an idle recipient at once or moves this to the front of its queue. It never interrupts a running turn. Default normal. At most 10 now sends per sender per hour; past that it is delivered as normal." },
      files: { type: "array", maxItems: 8, items: { type: "string" }, description: "Workspace-relative paths, 25 MiB each; copied to the agent's workspace." },
      thread_id: { type: "string", description: "Optional: continue one of your conversations with this agent (the thread_id a turn answer gave)." },
    }, required: ["agent_id", "prompt"] },
  },
  {
    name: "await_turn",
    description: "Wait for an agent's turn under a caller-chosen timeout_ms (0 to 55000, default 15000): with the handle send_prompt or send_to_bot gave (copy it exactly), that turn; without one, the in-flight turn of your conversation, else its last message. When the wait ends and the turn is not done, the answer is still_working (not an error): thread_id, progress.summary, progress.steps, wait_cursor, recommended_wait_ms. Pass wait_cursor as cursor on the next call so steps are not repeated. Prefer short polls with cursor resume, or async send_prompt plus the completion notification, over a long held call. An expired handle (or one from another of your sessions) on a conversation you can read answers that turn anyway (handle null, recovered_from). A handle is bound to you (the person or the bot), not to your MCP session: reconnecting after an idle gap keeps it valid. Refusals: handle_expired, handle_session_mismatch, handle_agent_mismatch, bad_handle (altered), with thread_id when it is one of your conversations. Fallbacks that need no handle: read_latest_page with agent_id and the thread_id send_prompt returned, or sagax_thread with that thread_id from a Perspicax client. Never re-send the prompt.",
    inputSchema: { type: "object", additionalProperties: false, properties: {
      agent_id: AGENT_ID,
      handle: { type: "string", description: "Copy the handle send_prompt returned, exactly." },
      timeout_ms: { type: "integer", minimum: 0, maximum: 55000, description: "Caller-chosen wait, capped under engine ceilings. Default 15000; use wait_cursor to resume." },
      cursor: { type: "string", description: "Optional: the wait_cursor from a previous still_working answer so progress.steps continue without duplicates." },
    }, required: ["agent_id"] },
  },
  {
    name: "read_transcript",
    description: "Read your whole transcript with an agent (the conversations you may read), oldest first.",
    inputSchema: { type: "object", additionalProperties: false, properties: { agent_id: AGENT_ID }, required: ["agent_id"] },
  },
  {
    name: "read_transcript_page",
    description: "Read a time-bounded page of the transcript: the newest limit entries with before_ms >= at >= after_ms (unix ms, inclusive), before cursor when given.",
    inputSchema: { type: "object", additionalProperties: false, properties: {
      agent_id: AGENT_ID,
      limit: { type: "integer", minimum: 1, maximum: 200 },
      before_ms: { type: "integer", minimum: 0, description: "Inclusive upper bound, unix ms." },
      after_ms: { type: "integer", minimum: 0, description: "Optional inclusive lower bound, unix ms." },
      cursor: AGENT_CURSOR,
    }, required: ["agent_id", "limit", "before_ms"] },
  },
  {
    name: "read_latest_page",
    description: "Read the newest entries of the transcript; page back with next_cursor. With thread_id (a turn answer carries it) it reads that one conversation: the handle-free way to get a turn's result, even after its handle expired. Do not poll: use await_turn.",
    inputSchema: { type: "object", additionalProperties: false, properties: {
      agent_id: AGENT_ID, limit: { type: "integer", minimum: 1, maximum: 200, description: "Default 20." }, cursor: AGENT_CURSOR,
      thread_id: { type: "string", description: "Optional: one of your conversations with this agent, the thread_id a turn answer gave." },
    }, required: ["agent_id"] },
  },
  {
    name: "read_latest_page_with_threads",
    description: "read_latest_page plus each conversation's entry count, last time and status.",
    inputSchema: { type: "object", additionalProperties: false, properties: {
      agent_id: AGENT_ID, limit: { type: "integer", minimum: 1, maximum: 200, description: "Default 20." }, cursor: AGENT_CURSOR,
    }, required: ["agent_id"] },
  },
  {
    name: "read_transcript_cold",
    description: "Read the stored transcript, 50 entries per page from the newest, without touching the agent's live state.",
    inputSchema: { type: "object", additionalProperties: false, properties: { agent_id: AGENT_ID, cursor: AGENT_CURSOR }, required: ["agent_id"] },
  },
].map((tool) => {
  const annotations = agentToolAnnotations(tool.name);
  return annotations ? { ...tool, annotations } : tool;
});
export const AGENT_API_TOOL_NAMES: ReadonlySet<string> = new Set(AGENT_API_TOOLS.map((tool) => tool.name));


export const DEF_RUN_WITH_ENGINE = {
    name: "run_with_engine",
    description:
      "Run one part of your work on another engine or model you may use, and get its result in this turn. It runs as you, for the same person, on their own sign-in there (for example their Grok account's Outlook or Teams), at your approval level and rules. Never say you cannot switch engines. A refusal lists the engines you may use.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        engine: { type: "string", minLength: 1, maxLength: 120, description: "Engine id, name or family (grok, claude)." },
        model: { type: "string", maxLength: 200, description: "Optional model id on it." },
        message: { type: "string", minLength: 1, maxLength: 20000, description: "The complete request for that part." },
        title: { type: "string", maxLength: 80 },
      },
      required: ["engine", "message"],
    },
  };

export async function callAgentApiTool(name: string, args: Json, context: ToolCallContext): Promise<ToolCallResult | null> {
  const { depth: DEPTH } = context;
  const { api, apiResponse } = context.client;
  if (AGENT_API_TOOL_NAMES.has(name)) {
    const { ok, body } = await apiResponse(`/api/internal/agent-api/${name}`, { method: "POST", body: JSON.stringify(args ?? {}) });
    return { text: JSON.stringify(body), ...(ok ? {} : { isError: true }) };
  }
  if (name !== "run_with_engine") return null;
  if (name === "run_with_engine") {
    const engine = typeof args.engine === "string" ? args.engine.trim() : "";
    const message = typeof args.message === "string" ? args.message.trim() : "";
    if (!engine || !message) return { text: "run_with_engine needs engine (grok, claude, or an engine id) and message.", isError: true };
    const model = typeof args.model === "string" ? args.model.trim() : "";
    const title = typeof args.title === "string" ? args.title.trim() : "";
    const r = await api("/api/internal/run-with-engine", {
      method: "POST",
      body: JSON.stringify({ engine, message, depth: DEPTH, ...(model ? { model } : {}), ...(title ? { title } : {}) }),
    });
    // V4: the per-turn thread limit returns 200 { applied:false, limit:true }.
    if (r.limit === true || r.applied === false) {
      return { text: String(r.message ?? r.error ?? "Thread limit reached for this turn.") };
    }
    if (r.timeout) {
      const taskId = String(r.taskId ?? "").trim();
      return { text: `${String(r.engineLabel ?? "That engine")} is still working on it; the result will be delivered to this conversation automatically when it finishes (task id ${taskId}). Finish your turn now and tell the person in one short line.` };
    }
    if (r.error) return { text: String(r.error), isError: true };
    return { text: String(r.text ?? "(no result)"), ...(r.status === "reply" ? {} : { isError: true }) };
  }
  return null;
}
