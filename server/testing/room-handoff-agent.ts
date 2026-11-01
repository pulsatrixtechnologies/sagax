// Scripted provider fixture that exercises the REAL injected agents MCP proxy.
// The plan and evidence are confined to the isolated launcher's temporary home.
import { spawn } from "node:child_process";
import { appendFileSync, readFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { claudeLaunchLevel } from "./claude-level.ts";
import { waitForExit } from "./cleanup.ts";

type AgentsIntegration = { command: string; args: string[]; env: Record<string, string> };

/** One entry of a `script` plan: the turn whose own text holds every `match`
 * string runs it, once (or every time, with `repeat`). The other fields are a
 * plan's. */
type ScriptEntry = { key: string; match: string[]; repeat?: boolean; [field: string]: unknown };

// Claude reads its MCP config and system prompt files once, at launch. The
// harness removes both when the first turn settles, so a process kept warm
// for later turns must not read them again.
const launchFiles = new Map<string, string>();
const readAtLaunch = (path: string) => {
  if (!launchFiles.has(path)) launchFiles.set(path, readFileSync(path, "utf8"));
  return launchFiles.get(path)!;
};

const REPLAYED_HISTORY_END = "[Now reply to the user's latest message:]";

/** What a turn itself was asked: the text after any history the harness
 * replayed, with recalled passages cut, since both can quote another
 * conversation's words. */
export function ownTurnText(prompt: unknown): string {
  const content = (prompt as any)?.message?.content;
  const text = typeof content === "string" ? content
    : Array.isArray(content) ? content.map((block: any) => typeof block === "string" ? block : block?.text ?? "").join("\n") : "";
  const replayed = text.lastIndexOf(REPLAYED_HISTORY_END);
  return (replayed < 0 ? text : text.slice(replayed + REPLAYED_HISTORY_END.length))
    .replace(/Recalled for this message[\s\S]*?\[end of recalled passages[^\]]*\]/g, "");
}

/** A permission request made the way Claude Code makes one for a tool its
 * permission mode will not run unasked: through the permission-prompt tool
 * the harness mounts for it (server/permission-proxy.ts). Resolves with the
 * answer — the person's, the engine's timer's, or a shutdown's. */
async function askPermission(server: AgentsIntegration, ask: { tool_name: string; input: Record<string, unknown> }): Promise<{ behavior: string; message?: string }> {
  const child = spawn(server.command, server.args, { env: { ...process.env, ...server.env }, stdio: ["pipe", "pipe", "pipe"] });
  child.stderr.resume();
  try {
    return await new Promise((resolve, reject) => {
      createInterface({ input: child.stdout }).on("line", line => {
        try {
          const data = JSON.parse(line);
          if (data.id !== 2) return;
          const text = String(data.result?.content?.[0]?.text ?? "");
          try { resolve(JSON.parse(text)); } catch { resolve({ behavior: "unparsed", message: text }); }
        } catch { reject(new Error("Fixture permission MCP returned malformed JSON")); }
      });
      child.on("error", reject);
      child.on("exit", (code, signal) => reject(new Error(`Fixture permission MCP exited before answering: ${signal ?? code}`)));
      const send = (id: number, method: string, params: unknown) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      send(1, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "claude-code", version: "fixture" } });
      send(2, "tools/call", { name: "approve", arguments: { ...ask, tool_use_id: `toolu_fixture_${process.pid}_${Date.now()}` } });
    });
  } finally {
    child.stdin.destroy();
    await waitForExit(child, { signal: "SIGTERM", graceMs: 500 });
  }
}

/** Screen calls as the bridge of a mounted computer makes them: each one
 * first asks the harness whether this turn may act (control-client.ts), and
 * the harness may hold that check open while the computer is busy. Each
 * answer is kept with how long it took. */
async function screenCalls(server: AgentsIntegration, count: number): Promise<Array<{ ms: number; state: unknown }>> {
  const calls: Array<{ ms: number; state: unknown }> = [];
  for (let call = 0; call < count; call += 1) {
    const at = Date.now();
    const response = await fetch(server.env.SAGAX_CONTROL_URL!, { headers: { authorization: `Bearer ${server.env.SAGAX_CONTROL_TOKEN}` } });
    calls.push({ ms: Date.now() - at, state: response.ok ? await response.json() : { status: response.status } });
  }
  return calls;
}

/** `launch` replaces Claude's argv files for another fake engine: the agents
 * server it mounted, its instructions, and extra evidence fields. `progress`
 * streams a plan's `progress` text before the turn waits on its gate, and its
 * `progressAfterGate` text once the gate opens. Before that, a plan's
 * `approve` asks the person through Claude's permission-prompt tool (an
 * answer that is not an allow replies `replyIfDenied`), and its
 * `screenCalls` makes that many calls on the computer the turn mounted. */
export async function runRoomHandoffAgent(argv: string[], planPath: string, prompt?: unknown,
  launch?: { integration: AgentsIntegration; system: string; evidence?: Record<string, unknown> },
  progress?: (text: string) => void): Promise<string> {
  const arg = (flag: string) => argv[argv.indexOf(flag) + 1];
  const integration = launch?.integration ?? Object.values(JSON.parse(readAtLaunch(arg("--mcp-config"))).mcpServers as Record<string, AgentsIntegration>)
    .find(s => s.env?.SAGAX_BOT_ID);
  // A depth-capped delegated turn mounts no agents server: answer from the prompt alone.
  if (!integration) {
    // Nothing in such a launch's argv says which bot it is — only the task
    // text does. A test that needs a delegated reply to land at an exact
    // point (a wake it must follow) holds it here on a gate file, named by a
    // substring of the task text: `${planPath}.gates.json`, a JSON array of
    // { promptIncludes, gateFile }. The wait is unbounded like any plan
    // gate: the test that set it owns when it opens.
    const gatesPath = `${planPath}.gates.json`;
    const taskText = String((prompt as any)?.message?.content ?? "");
    for (const rule of existsSync(gatesPath) ? JSON.parse(readFileSync(gatesPath, "utf8")) as Array<{ promptIncludes: string; gateFile: string }> : []) {
      if (!taskText.includes(rule.promptIncludes) || existsSync(rule.gateFile)) continue;
      await new Promise<void>(resolve => {
        const timer = setInterval(() => {
          if (!existsSync(rule.gateFile)) return;
          clearInterval(timer);
          resolve();
        }, 10);
      });
    }
    return `Handled without teammate tools: ${taskText}`;
  }
  const botId = integration.env.SAGAX_BOT_ID;
  const system = launch?.system ?? readAtLaunch(arg("--append-system-prompt-file"));
  // Claude snapshots the launch-time system prompt for a session. A retained
  // process or --resume launch receives changed turn-scoped instructions in
  // the user message, so inspect both surfaces just as the model does.
  const turnContext = `${system}\n${JSON.stringify(prompt)}`;
  const resumed = turnContext.includes("Your downstream room requests have settled.");
  // `byPrompt` picks a bot's plan by what its turn was sent, for turns whose
  // order no index can pin (a thread the bot opened on itself runs beside
  // the turn that opened it): [{ promptIncludes, plan }], first match wins.
  const botPlan = JSON.parse(readFileSync(planPath, "utf8"))[botId] ?? {};
  const basePlan = (botPlan.byPrompt as Array<{ promptIncludes: string; plan: any }> | undefined)
    ?.find(rule => turnContext.includes(rule.promptIncludes))?.plan ?? botPlan;
  const previous = existsSync(`${planPath}.evidence.jsonl`) ? readFileSync(`${planPath}.evidence.jsonl`, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
  const turnIndex = previous.filter(p => p.botId === botId).length;
  // `script` picks a turn's entry by what that turn itself was asked, so a
  // turn nobody scripted (an unplanned resume, a duplicate dispatch) fails
  // loudly instead of quietly taking the next entry. One-shot entries win
  // over `repeat` ones, so a loop entry never swallows a later, more
  // specific turn.
  const script = botPlan.script as ScriptEntry[] | undefined;
  const own = script ? ownTurnText(prompt) : "";
  const used = new Set(previous.filter(p => p.botId === botId && p.planKey).map(p => p.planKey as string));
  const matches = (entry: ScriptEntry) => entry.match.every(text => own.includes(text));
  const entry = script && (script.find(e => !e.repeat && !used.has(e.key) && matches(e)) ?? script.find(e => e.repeat && matches(e)));
  if (script && !entry) {
    appendFileSync(`${planPath}.evidence.jsonl`, JSON.stringify({ botId, turnIndex, threadId: integration.env.SAGAX_THREAD_ID, unplanned: true, resumed, system, prompt }) + "\n");
    throw new Error(`Unplanned fixture turn for ${botId}: ${own.slice(0, 300)}`);
  }
  const plan: any = entry ?? (basePlan.turns ? basePlan.turns[turnIndex] : basePlan);
  if (!plan) throw new Error(`Unexpected extra fixture turn ${turnIndex} for ${botId}`);
  for (const expected of plan.expectSystemIncludes ?? []) if (!system.includes(expected)) throw new Error(`Missing discussion context: ${expected}`);
  for (const expected of plan.expectContextIncludes ?? []) if (!turnContext.includes(expected)) throw new Error(`Missing conversation context: ${expected}`);
  const indexed = Boolean(entry || basePlan.turns);
  const steps = indexed ? plan.steps ?? [] : resumed ? plan.resumeSteps ?? [] : plan.steps ?? [];
  const child = spawn(integration.command, integration.args, { env: { ...process.env, ...integration.env }, stdio: ["pipe", "pipe", "pipe"] });
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  let serial = 0;
  let closing = false;
  let failure: Error | undefined;
  let rejectRun!: (error: Error) => void;
  const failed = new Promise<never>((_resolve, reject) => { rejectRun = reject; });
  const fail = (error: Error) => {
    if (closing || failure) return;
    failure = error;
    for (const p of pending.values()) p.reject(error);
    pending.clear();
    rejectRun(error);
  };
  const lines = createInterface({ input: child.stdout });
  lines.on("line", line => {
    try {
      const data = JSON.parse(line);
      const waiter = pending.get(data.id);
      if (waiter) { pending.delete(data.id); waiter.resolve(data); }
    } catch { fail(new Error("Fixture MCP returned malformed JSON")); }
  });
  child.on("error", fail);
  child.on("exit", (code, signal) => fail(new Error(`Fixture MCP exited unexpectedly: ${signal ?? code}`)));
  child.stdin.on("error", fail);
  child.stderr.resume();
  const call = (method: string, params: unknown = {}) => new Promise<any>((resolve, reject) => {
    if (failure) { reject(failure); return; }
    const id = ++serial; pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  const timer = setTimeout(() => fail(new Error("Fixture MCP run timed out")), 20_000);
  let delayTimer: ReturnType<typeof setTimeout> | undefined;
  let gateTimer: ReturnType<typeof setInterval> | undefined;
  const evidence: unknown[] = [];
  let approval: { behavior: string; message?: string } | undefined;
  let screen: Array<{ ms: number; state: unknown }> | undefined;
  try {
    return await Promise.race([failed, (async () => {
      await call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "room-fixture", version: "1" } });
      evidence.push(await call("tools/list"));
      evidence.push(await call("tools/call", { name: "list_room_targets", arguments: {} }));
      for (const step of steps) {
        // `internal`: a raw call to a harness route with this turn's own
        // capability, as an older proxy or script makes it (an old entrypoint
        // beside the tool surface). `saveAs` keeps its taskId for a later turn's
        // path ("{{name}}"), in `${planPath}.vars.json`.
        if (step.internal) {
          const varsPath = `${planPath}.vars.json`;
          const vars: Record<string, string> = existsSync(varsPath) ? JSON.parse(readFileSync(varsPath, "utf8")) : {};
          const path = String(step.internal.path).replace(/\{\{(\w+)\}\}/g, (_m: string, key: string) => vars[key] ?? "");
          const response = await fetch(`${integration.env.SAGAX_HARNESS_URL}${path}`, {
            method: step.internal.method ?? "POST",
            headers: { authorization: `Bearer ${integration.env.SAGAX_COMMS_TOKEN}`, "content-type": "application/json" },
            ...(step.internal.body ? { body: JSON.stringify(step.internal.body) } : {}),
          });
          const body = await response.json().catch(() => ({})) as Record<string, any>;
          evidence.push({ step, internal: { status: response.status, body } });
          if (step.internal.saveAs && typeof body.taskId === "string") writeFileSync(varsPath, JSON.stringify({ ...vars, [step.internal.saveAs]: body.taskId }));
          continue;
        }
        const response = await call("tools/call", { name: step.tool ?? "coordinate_bots", arguments: step.arguments });
        evidence.push({ step, response });
        if (Boolean(response.error || response.result?.isError) !== Boolean(step.expectError)) throw new Error(`Unexpected tool outcome: ${JSON.stringify(response)}`);
      }
      // All MCP calls have completed. A person's answer, like an explicit
      // test gate, is owned by the parent test's timeout, not the transport
      // deadline: long conversation fixtures may deliberately keep a
      // teammate waiting across many turns.
      if (plan.gateFile || plan.approve || plan.screenCalls) clearTimeout(timer);
      const mounted = launch ? {} : JSON.parse(readAtLaunch(arg("--mcp-config"))).mcpServers as Record<string, AgentsIntegration>;
      if (plan.approve) {
        if (!mounted.ogb || !argv.includes("--permission-prompt-tool")) throw new Error("A scripted approval needs Claude's permission-prompt tool");
        approval = await askPermission(mounted.ogb, plan.approve);
      }
      if (plan.screenCalls) {
        if (!mounted.computer?.env?.SAGAX_CONTROL_URL) throw new Error("Scripted screen calls need a mounted computer");
        screen = await screenCalls(mounted.computer, plan.screenCalls);
      }
      if (typeof plan.progress === "string") progress?.(plan.progress);
      if (plan.readyFile) writeFileSync(plan.readyFile, "ready");
      if (plan.gateFile && !existsSync(plan.gateFile)) await new Promise<void>(resolve => {
        gateTimer = setInterval(() => {
          if (!existsSync(plan.gateFile)) return;
          clearInterval(gateTimer);
          resolve();
        }, 10);
      });
      if (typeof plan.progressAfterGate === "string") progress?.(plan.progressAfterGate);
      if (plan.delayMs) await new Promise(resolve => { delayTimer = setTimeout(resolve, plan.delayMs); });
      // `usageLimitFile`: while it exists, this turn ends on the account's
      // usage limit after its steps ran (the file is taken once), as Claude
      // Code reports one (fake-claude-cli.ts reads `usageLimit`). A JSON file
      // { text, resetsAt } (epoch seconds) also says when the window resets.
      if (plan.usageLimitFile && existsSync(plan.usageLimitFile)) {
        const raw = readFileSync(plan.usageLimitFile, "utf8").trim();
        rmSync(plan.usageLimitFile, { force: true });
        let limit: { text?: string; resetsAt?: number } = {};
        try { limit = raw.startsWith("{") ? JSON.parse(raw) : { text: raw }; } catch { limit = { text: raw }; }
        throw Object.assign(new Error(limit.text || "You've hit your weekly limit"), { usageLimit: true,
          ...(typeof limit.resetsAt === "number" ? { resetsAt: limit.resetsAt } : {}) });
      }
      if (plan.fail && !resumed) throw new Error("Scripted addressed agent failure");
      if (plan.failResumed && resumed) throw new Error("Scripted failure of a resumed turn");
      if (approval && approval.behavior !== "allow") return plan.replyIfDenied ?? `${plan.reply} (approval ${approval.behavior})`;
      if (entry) return plan.reply ?? `Result from ${botId}`;
      return basePlan.turns ? plan.reply : resumed ? plan.resumeReply ?? `Summary from ${botId}` : plan.reply ?? `Result from ${botId}`;
    })()]);
  } finally {
    closing = true;
    clearTimeout(timer); clearTimeout(delayTimer); clearInterval(gateTimer); lines.close(); child.stdin.destroy();
    await waitForExit(child, { signal: "SIGTERM", graceMs: 500 });
    appendFileSync(`${planPath}.evidence.jsonl`, JSON.stringify({ botId, turnIndex, threadId: integration.env.SAGAX_THREAD_ID,
      model: argv.includes("--model") ? arg("--model") : undefined,
      // the Sagax level: Approve for me is acceptEdits plus its allowlist (claude-level.ts)
      permissionMode: claudeLaunchLevel(argv),
      snapshotMode: argv.includes("--system-prompt-snapshot") ? arg("--system-prompt-snapshot") : undefined,
      resumed, system, prompt, evidence, ...(entry ? { planKey: entry.key } : {}), ...(approval ? { approval } : {}), ...(screen ? { screen } : {}), ...launch?.evidence }) + "\n");
  }
}
