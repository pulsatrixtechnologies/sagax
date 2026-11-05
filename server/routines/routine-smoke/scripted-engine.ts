// Scripted routine engine for the smoke suite (#2006). Calls the tools a
// real production routine calls against the fake Perspicax MCP: a Flow
// dispatch pass, an invoices pass, and a meetings-close pass that hits a
// 403 on one write. Deterministic; no model.
import {
  callFakePerspicax,
  type FakePerspicaxMcp,
} from "../../testing/fake-perspicax-mcp-server.ts";

export interface ScriptedPassResult {
  name: "dispatch" | "invoices" | "meetings-close";
  ok: boolean;
  steps: string[];
  error?: string;
  usage: { input: number; output: number };
}

export interface ScriptedRoutineResult {
  passes: ScriptedPassResult[];
  ok: boolean;
  usage: { input: number; output: number };
  /** One clear line when a deterministic block stopped the run early. */
  blockLine?: string;
}

async function session(mcp: FakePerspicaxMcp, profileId: string, botId: string) {
  const init = await callFakePerspicax(mcp.url, "initialize", {}, { profileId, botId });
  const sessionId = init.sessionId!;
  await callFakePerspicax(mcp.url, "notifications/initialized", {}, { id: sessionId, profileId, botId });
  return sessionId;
}

async function listTools(mcp: FakePerspicaxMcp, sessionId: string, profileId: string, botId: string): Promise<string[]> {
  const listed = await callFakePerspicax(mcp.url, "tools/list", {}, { id: sessionId, profileId, botId });
  const tools = (listed.result as { tools?: Array<{ name: string }> } | undefined)?.tools ?? [];
  return tools.map((tool) => tool.name);
}

async function callTool(
  mcp: FakePerspicaxMcp,
  sessionId: string,
  profileId: string,
  botId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<{ value: unknown; isError: boolean }> {
  const answered = await callFakePerspicax(
    mcp.url,
    "tools/call",
    { name, arguments: args },
    { id: sessionId, profileId, botId },
  );
  const result = answered.result as { isError?: boolean; structuredContent?: unknown; content?: Array<{ text?: string }> } | undefined;
  let value: unknown = result?.structuredContent;
  if (value === undefined && Array.isArray(result?.content)) {
    const text = result.content.find((block) => typeof block.text === "string")?.text;
    if (text) {
      try {
        value = JSON.parse(text);
      } catch {
        value = text;
      }
    }
  }
  return { value, isError: result?.isError === true };
}

function flowArgs(command: string, args: Record<string, unknown> = {}) {
  return { command, args };
}

/** Flow dispatch pass: run.init by name → plan with inline JSON → read → finish. */
export async function runDispatchPass(mcp: FakePerspicaxMcp, botId = "osprey"): Promise<ScriptedPassResult> {
  const profileId = "pf-dispatch";
  const steps: string[] = [];
  const sessionId = await session(mcp, profileId, botId);
  steps.push("initialize");
  const tools = await listTools(mcp, sessionId, profileId, botId);
  steps.push(`tools/list:${tools.join(",")}`);
  if (!tools.includes("flow_run")) {
    return { name: "dispatch", ok: false, steps, error: "flow_run missing on dispatch profile", usage: { input: 1200, output: 40 } };
  }
  const init = await callTool(mcp, sessionId, profileId, botId, "flow_run", flowArgs("run.init", { routine: "morning-dispatch" }));
  steps.push("run.init");
  const initValue = init.value as { status?: string; reason?: string; run_id?: string };
  if (init.isError || initValue.status === "blocked" || initValue.status === "failed") {
    return {
      name: "dispatch",
      ok: false,
      steps,
      error: initValue.reason === "already_running"
        ? "already_running"
        : `run.init refused: ${JSON.stringify(init.value)}`,
      usage: { input: 1800, output: 60 },
    };
  }
  const runId = initValue.run_id;
  const plan = await callTool(mcp, sessionId, profileId, botId, "flow_run", flowArgs("plan", {
    run_id: runId,
    units: [{ id: 42 }],
    since: "2026-11-04T10:00:00Z",
    reads: ["cw_psa_query"],
  }));
  steps.push("plan");
  if (plan.isError) {
    await callTool(mcp, sessionId, profileId, botId, "flow_run", flowArgs("run.finish", { run_id: runId }));
    steps.push("run.finish");
    const output = plan.value as { output?: { error?: string; message?: string }; error?: string; message?: string };
    const code = output.output?.error ?? output.error ?? "plan_failed";
    const message = output.output?.message ?? output.message ?? "";
    return { name: "dispatch", ok: false, steps, error: `${code} ${message}`.trim(), usage: { input: 2400, output: 80 } };
  }
  const read = await callTool(mcp, sessionId, profileId, botId, "cw_psa_query", { board: 24 });
  steps.push("cw_psa_query");
  if (read.isError) {
    await callTool(mcp, sessionId, profileId, botId, "flow_run", flowArgs("run.finish", { run_id: runId }));
    steps.push("run.finish");
    return { name: "dispatch", ok: false, steps, error: "cw_psa_query failed", usage: { input: 2600, output: 90 } };
  }
  await callTool(mcp, sessionId, profileId, botId, "flow_run", flowArgs("run.finish", { run_id: runId }));
  steps.push("run.finish");
  await fetch(mcp.url, { method: "DELETE", headers: { "mcp-session-id": sessionId, authorization: "Bearer fixture-mcp" } }).catch(() => {});
  return { name: "dispatch", ok: true, steps, usage: { input: 3200, output: 120 } };
}

/** Invoices pass: identity + query + one write. */
export async function runInvoicesPass(mcp: FakePerspicaxMcp, botId = "osprey"): Promise<ScriptedPassResult> {
  const profileId = "pf-invoices";
  const steps: string[] = [];
  const sessionId = await session(mcp, profileId, botId);
  steps.push("initialize");
  const tools = await listTools(mcp, sessionId, profileId, botId);
  steps.push(`tools/list:${tools.join(",")}`);
  const switched = await callTool(mcp, sessionId, profileId, botId, "identity_switch", { profile: "invoices-agent" });
  steps.push("identity_switch");
  if (switched.isError) {
    return { name: "invoices", ok: false, steps, error: "identity_switch refused", usage: { input: 900, output: 30 } };
  }
  const init = await callTool(mcp, sessionId, profileId, botId, "flow_run", flowArgs("run.init", { routine: "invoice-status-watch" }));
  steps.push("run.init");
  const runId = (init.value as { run_id?: string }).run_id;
  if (init.isError || !runId) {
    return { name: "invoices", ok: false, steps, error: `run.init refused: ${JSON.stringify(init.value)}`, usage: { input: 1100, output: 40 } };
  }
  await callTool(mcp, sessionId, profileId, botId, "flow_run", flowArgs("plan", {
    run_id: runId,
    units: [{ id: 7 }],
    reads: ["cw_psa_finance_invoices_query"],
  }));
  steps.push("plan");
  const query = await callTool(mcp, sessionId, profileId, botId, "cw_psa_finance_invoices_query", { status: "open" });
  steps.push("cw_psa_finance_invoices_query");
  if (query.isError) {
    await callTool(mcp, sessionId, profileId, botId, "flow_run", flowArgs("run.finish", { run_id: runId }));
    return { name: "invoices", ok: false, steps, error: "invoice query failed", usage: { input: 1500, output: 50 } };
  }
  const write = await callTool(mcp, sessionId, profileId, botId, "cw_psa_finance_invoices_write", { id: 7, set: { status: "reviewed" } });
  steps.push("cw_psa_finance_invoices_write");
  await callTool(mcp, sessionId, profileId, botId, "identity_switch", { clear: true });
  steps.push("identity_switch:clear");
  await callTool(mcp, sessionId, profileId, botId, "flow_run", flowArgs("run.finish", { run_id: runId }));
  steps.push("run.finish");
  await fetch(mcp.url, { method: "DELETE", headers: { "mcp-session-id": sessionId, authorization: "Bearer fixture-mcp" } }).catch(() => {});
  if (write.isError) {
    return { name: "invoices", ok: false, steps, error: `invoice write refused: ${JSON.stringify(write.value)}`, usage: { input: 2100, output: 70 } };
  }
  return { name: "invoices", ok: true, steps, usage: { input: 2800, output: 110 } };
}

/** Meetings-close pass: one of the writes answers 403. */
export async function runMeetingsClosePass(mcp: FakePerspicaxMcp, botId = "osprey"): Promise<ScriptedPassResult> {
  const profileId = "pf-meetings";
  const steps: string[] = [];
  const sessionId = await session(mcp, profileId, botId);
  steps.push("initialize");
  await listTools(mcp, sessionId, profileId, botId);
  steps.push("tools/list");
  const init = await callTool(mcp, sessionId, profileId, botId, "flow_run", flowArgs("run.init", { routine: "meetings-close" }));
  steps.push("run.init");
  const runId = (init.value as { run_id?: string }).run_id;
  if (init.isError || !runId) {
    return { name: "meetings-close", ok: false, steps, error: `run.init refused: ${JSON.stringify(init.value)}`, usage: { input: 1000, output: 40 } };
  }
  await callTool(mcp, sessionId, profileId, botId, "flow_run", flowArgs("plan", {
    run_id: runId,
    units: [{ id: 9 }],
    reads: ["calendar_events_query"],
  }));
  steps.push("plan");
  await callTool(mcp, sessionId, profileId, botId, "calendar_events_query", { day: "2026-11-04" });
  steps.push("calendar_events_query");
  const first = await callTool(mcp, sessionId, profileId, botId, "calendar_events_write", { id: 9, set: { closed: true } });
  steps.push("calendar_events_write:9");
  const second = await callTool(mcp, sessionId, profileId, botId, "calendar_events_write", { id: 10, set: { closed: true } });
  steps.push("calendar_events_write:10");
  await callTool(mcp, sessionId, profileId, botId, "flow_run", flowArgs("run.finish", { run_id: runId }));
  steps.push("run.finish");
  await fetch(mcp.url, { method: "DELETE", headers: { "mcp-session-id": sessionId, authorization: "Bearer fixture-mcp" } }).catch(() => {});
  if (first.isError) {
    return {
      name: "meetings-close",
      ok: false,
      steps,
      error: `calendar write 403: ${JSON.stringify(first.value)}`,
      usage: { input: 2200, output: 90 },
    };
  }
  if (second.isError) {
    const message = (second.value as { message?: string })?.message ?? JSON.stringify(second.value);
    return {
      name: "meetings-close",
      ok: false,
      steps,
      error: `calendar write 403: ${message}`,
      usage: { input: 2400, output: 95 },
    };
  }
  return { name: "meetings-close", ok: true, steps, usage: { input: 2600, output: 100 } };
}

/** Full scripted routine: dispatch, invoices, meetings-close (with one 403). */
export async function runScriptedRoutine(mcp: FakePerspicaxMcp, botId = "osprey"): Promise<ScriptedRoutineResult> {
  mcp.setWriteForbidden({ calendar_events_write: "meeting 10 is locked by another person (403)" });
  const passes: ScriptedPassResult[] = [];
  const dispatch = await runDispatchPass(mcp, botId);
  passes.push(dispatch);
  if (!dispatch.ok) {
    return {
      passes,
      ok: false,
      usage: dispatch.usage,
      blockLine: `Dispatch pass stopped: ${dispatch.error}`,
    };
  }
  const invoices = await runInvoicesPass(mcp, botId);
  passes.push(invoices);
  if (!invoices.ok) {
    return {
      passes,
      ok: false,
      usage: {
        input: dispatch.usage.input + invoices.usage.input,
        output: dispatch.usage.output + invoices.usage.output,
      },
      blockLine: `Invoices pass stopped: ${invoices.error}`,
    };
  }
  const meetings = await runMeetingsClosePass(mcp, botId);
  passes.push(meetings);
  const usage = {
    input: dispatch.usage.input + invoices.usage.input + meetings.usage.input,
    output: dispatch.usage.output + invoices.usage.output + meetings.usage.output,
  };
  // The meetings pass is expected to surface the 403 on one write and stop
  // with one clear line; that is a successful smoke of the error path.
  if (!meetings.ok && meetings.error?.includes("403")) {
    return { passes, ok: true, usage, blockLine: meetings.error };
  }
  return { passes, ok: meetings.ok, usage, ...(meetings.error ? { blockLine: meetings.error } : {}) };
}
