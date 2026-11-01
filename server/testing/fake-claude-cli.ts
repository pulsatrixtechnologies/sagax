#!/usr/bin/env node
// Fake of the claude CLI's stream-json surface, for driver tests.
// Reads the prompt from stdin (one stream-json line), then plays a
// scripted session. Failure modes are toggled by env var, mirroring how
// the real thing misbehaves:
//
//   FAKE_CLAUDE_MODE   happy (default) | exit-early | hang | malformed |
//                      dead-session (fails only when --resume is passed)
//                      | stale-session (a --resume launch answers each
//                        message with the error result 2.1.295 gives a
//                        session it no longer has, with no init, and stays
//                        up until stdin ends) | error-result (every launch
//                        answers that way, resumed or not)
//                      | resume-dies-after-init (a --resume launch emits
//                        init, then exits without result or output)
//                      | stream (partial-message text deltas before the
//                        whole-message frame, plus subagent noise to drop)
//                      | not-logged-in (the frames a signed-out CLI really
//                        sends, captured from 2.1.263)
//                      | api-error (the CLI reports a non-auth API error as
//                        assistant text, then an error result; no model output)
//                      | usage-limit (the account's usage limit refused the
//                        call: the api-error frame and result 2.1.295 sends,
//                        code usage_limit_reached, carrying the refused window)
//   A prompt carrying [fake:api-error] plays that one turn as api-error.
//   A prompt carrying [fake:subagent-api-error] starts a sub-agent (Agent)
//                      that never reports back, then fails as api-error.
//   A prompt carrying [fake:context-thrash] (or FAKE_CLAUDE_MODE=context-thrash)
//                      runs one Bash call, then stops the turn the way 2.1.312's
//                      compaction breaker does: an api-error frame with
//                      api_error "autocompact_thrashing" and its words, then an
//                      error result (terminal_reason rapid_refill_breaker).
//                      A prompt that carries Sagax's fresh-session note
//                      ("ran out of context space") answers normally, unless
//                      FAKE_CLAUDE_THRASH_AGAIN=1.
//   FAKE_CLAUDE_API_ERROR_KIND the api-error frame's `error` (default: unknown); FAKE_CLAUDE_API_ERROR_STATUS its
//                      result's api_error_status; FAKE_CLAUDE_NO_TERMINAL_REASON=1: the result has no terminal_reason,
//                      only stop_reason "stop_sequence".
//   FAKE_CLAUDE_API_ERROR text for the api-error frame (default: overloaded;
//                      for usage-limit, the weekly limit's words).
//   FAKE_CLAUDE_LIMITED_FILE path: while it exists, every turn plays
//                      usage-limit with the file's JSON rate_limit_info
//                      (port of OpenMausBot #3074's fixture).
//   FAKE_CLAUDE_LIMIT_MID_TURN_FILE path: the first turn to run (on whatever
//                      --model) takes one Bash step, then that model's own
//                      weekly window refuses it (a usage limit mid-turn); the
//                      model is written to the file and refuses every later
//                      turn at once. Any other model answers as usual.
//   FAKE_CLAUDE_RATE_LIMIT JSON rate_limit_info: each turn reports it in a
//                      `rate_limit_event` after init, as the CLI does from the
//                      API's headers ({status, rateLimitType, resetsAt, …}).
//   FAKE_CLAUDE_GATE_DIR with slow: a prompt carrying [gate:NAME] holds its
//                      reply until <dir>/NAME exists (its last marker).
//   FAKE_CLAUDE_AUTH_AFTER_TURN  1: from the second turn, answer as not-logged-in; FAKE_CLAUDE_AUTH_AFTER_WORK  1: not-logged-in
//     calls a tool first
//   FAKE_CLAUDE_RELEASE with hang: the turn ends normally once this file exists.
//   FAKE_CLAUDE_DUMP   path to write {argv, env, cwd, prompt, systemPrompt,
//                      mcpConfig} as JSON at each turn this process is given
//                      (the latest turn wins), so the test can assert on argv
//                      shape and env hygiene. mcpConfig and systemPrompt are
//                      read once, at the first turn, the way the real CLI
//                      reads its launch files — the driver writes them to a
//                      private temp dir and deletes it when that turn
//                      settles, so a test cannot open them after the fact.
//                      A process kept warm for later turns still has them.
//   FAKE_CLAUDE_TRANSCRIPTS 1: keep the session on disk as the real CLI
//                      does: each prompt is a line of
//                      <CLAUDE_CONFIG_DIR or ~/.claude>/projects/<cwd with
//                      every non-alphanumeric as "-">/<session>.jsonl and of
//                      its history.jsonl ({display, project, sessionId}); a
//                      --resume of a session whose file is gone answers like
//                      stale-session ("No conversation found").
//   FAKE_CLAUDE_EXIT_AFTER_TURN 1: the process exits once its turn is
//                      answered, like a CLI that ended between turns, so
//                      every later turn launches again (with --resume).
//   FAKE_CLAUDE_GONE_AFTER_TURN path: once its turn is answered, the process
//                      stops reading stdin, so a write to it fails (POSIX;
//                      on Windows Node's stdin holds a duplicate handle, so
//                      the write can still land), writes <path>.closed, and
//                      exits once <path> exists — a CLI that ended between
//                      turns before the driver saw it go.
//   FAKE_CLAUDE_TEXT_FILE path whose contents are the one-shot text mode's
//                      reply, read fresh each run so a suite sharing one
//                      server can vary it per test. A missing file, or a body
//                      of exactly __FAIL__, makes the call fail outright —
//                      the shape a caller's fallback path has to survive.
//   FAKE_CLAUDE_TEXT_ROUTES path of a JSON object {"marker": "reply"}, read
//                      fresh each run: a one-shot prompt containing a marker
//                      gets that reply (first match wins), before
//                      FAKE_CLAUDE_TEXT_FILE is consulted.
//   FAKE_CLAUDE_TEXT_DUMP like FAKE_CLAUDE_DUMP, but for one-shot text runs,
//                      so they never overwrite a turn's dump mid-test.
//   FAKE_CLAUDE_TEXT_HANG when set, the one-shot text mode never replies —
//                      the caller's abort signal is the only way it ends,
//                      which is exactly what its tests need to prove.
//   FAKE_CLAUDE_TEXT_RESULT raw --output-format json one-shot response;
//                      unset, wraps the text reply with synthetic usage.
//   FAKE_CLAUDE_REPLIES JSON array of strings (or string arrays for multiple
//                      assistant items) used in order across turns. This makes
//                      bounded multi-turn orchestration deterministic.
//   FAKE_CLAUDE_REPLY_STATE Optional counter file shared by fresh CLI
//                      processes so scripted replies keep their order.
//   FAKE_CLAUDE_TOOL_CALLS JSON array of {name, input?, ok?}: the tool calls
//                      each turn makes, in order and before its reply text —
//                      one tool_use (fresh id, that name and input) followed
//                      by its tool_result (is_error unless ok, default true).
//                      Unset, a turn makes the single default Bash call.
//                      `parent` (another call's id) makes it a sub-agent's
//                      call (parent_tool_use_id); that parent settles last.
//   FAKE_CLAUDE_USES_CLOUD_COMPUTER 1: a turn launched with the cloud
//                      computer's tools (the harness-mcp-proxy `computer`
//                      server in --mcp-config) first takes one screenshot
//                      through them, over stdio, the way a model's first
//                      computer call does; the call and its result are
//                      reported like any tool call before the reply.
//   FAKE_CLAUDE_HOOKS  1: honour the `hooks` block of the --settings file the
//                      way the real CLI does — after each tool_result run
//                      every PostToolUse command with the event JSON on
//                      stdin (synchronously, inheriting this env), and once
//                      at the end run the Stop commands.
//   FAKE_CLAUDE_COMPACT 1: on this process's second and later turns, play a
//                      compaction the way the CLI does — run the PreCompact
//                      hooks (trigger auto), then the SessionStart hooks with
//                      source "compact", and treat whatever SessionStart's
//                      stdout said as context by echoing it into the reply.
//   FAKE_CLAUDE_COMPACT_AT tool: play that compaction while the turn's
//                      first scripted tool call is in flight instead.
//   FAKE_CLAUDE_TURN_STATE path of a counter file shared by fresh CLI
//                      processes, so FAKE_CLAUDE_COMPACT's "second turn"
//                      survives a respawn between turns.
//   FAKE_CLAUDE_CONTEXT_TOKENS report this latest-prompt size in a scripted
//                      room-plan reply, for automatic compaction fixtures.
//   FAKE_CLAUDE_MCP_LIST what `claude mcp list` prints (claude.ai connectors).
//   FAKE_CLAUDE_AUTH   in (default) | out | unsupported | malformed |
//                      inherited-api-key | file (signed in while fake-auth.json
//                      exists in the Claude config dir; `auth logout` removes it)
//                      - what `auth status` reports
//   FAKE_CLAUDE_AUTO_UNAVAILABLE_MODELS comma-separated --model values for
//                      which `--permission-mode auto` starts in "default",
//                      the way the real CLI (2.1.266) does for Haiku 4.5 and
//                      Sonnet 4.5: init reports the mode it actually runs in.
//   FAKE_CLAUDE_LATE_STEER_GATE path: a message that arrives mid-turn landed
//                      after the turn's last model call began. The real CLI
//                      (2.1.282) cannot fold it then: it finishes the turn
//                      with `result` and runs the message as its NEXT turn on
//                      the same stdin — init, tool call, reply. In `slow`
//                      mode that reply waits for this file, so a test can
//                      probe the harness while the continuation is running.
//   FAKE_CLAUDE_LATE_STEER_INIT_GATE path: with the gate above, the late
//                      turn's `init` waits for this file too, so a test can
//                      act while the first result is held and nothing has
//                      announced the continuation yet.
//   FAKE_CLAUDE_LATE_STEER_SILENT 1: the late turn prints `init` and then
//                      nothing at all — a continuation that never speaks.
//   FAKE_CLAUDE_SLOW_FINISH_GATE path: `slow` replies once this file exists;
//                      a body of exactly "fail" then ends the turn as an
//                      engine error (is_error) instead of a success.
//   FAKE_CLAUDE_HOLD_TOOL JSON {name, input}: the call FAKE_CLAUDE_HOLD_AFTER_TOOL
//                      holds open, in place of `Bash sleep 30`.
//   FAKE_CLAUDE_SLOW_TAIL_TOOL 1: `slow` makes one more tool call right
//                      before its reply — a fold seam the harness sees after
//                      a steer that was already too late to be folded.
//   FAKE_CLAUDE_QUEUED_TURN_COUNT unset | zero | count — whether a result
//                      carries queued_turn_count. Unset: absent, an older
//                      CLI. zero: always 0, what 2.1.282 reports for words
//                      waiting on stdin (they are not in its command queue,
//                      yet it runs them next). count: the late steers still
//                      queued, the field's documented meaning.
//   Every result's total_cost_usd is the process's running total (0.01 per
//   result), the way the real CLI reports it: read the latest, never sum.
//   Its modelUsage is the same running count per model (tokens and costUSD).
//   FAKE_CLAUDE_COST_STATE dir: the real CLI (2.1.282) restores a session's
//                      running cost on --resume, so a resumed process's first
//                      total already counts the earlier turns. The fake saves
//                      its running cost per session id here, and a --resume
//                      launch starts from it.
//   FAKE_CLAUDE_ROUTER_PING 1: before each turn's reply, send one POST to
//                      $ANTHROPIC_BASE_URL/v1/messages carrying the headers
//                      the real CLI derives from its env (ANTHROPIC_AUTH_TOKEN
//                      as a Bearer token, ANTHROPIC_API_KEY as x-api-key), so a
//                      test's stub router sees what a real turn would send.
//                      Nothing is sent when ANTHROPIC_BASE_URL is unset.
//   FAKE_CLAUDE_RESUMED_API_ERROR 1: a --resume launch plays its first turn
//                      the `api-error` way — an error result with no cost
//                      figure — and its later turns normally.
//   FAKE_CLAUDE_MCP_CALLS JSON array of {server, tool, arguments}: before its
//                      reply, each turn really talks to the stdio MCP servers
//                      of its --mcp-config whose name matches `server` (a
//                      name, or a prefix ending with *): spawn command, args
//                      and env, then initialize, notifications/initialized,
//                      tools/list and tools/call. The reply then carries
//                      mcp:<tool>:ok, mcp:<tool>:error or mcp:absent.
//                      A call with `when` runs only on a turn whose prompt
//                      contains that text.
//                      An argument "$ATTACHED_FILE" becomes the path the
//                      prompt's first <attached-file> tag names.
//                      An argument "$PROMPT_ID" becomes the id the prompt
//                      names after "PROMPT_ID=" ("$PROMPT_ID2": after
//                      "PROMPT_ID2=").
//                      A call with `onSteer: true` never runs at a turn's
//                      start: it runs when a message steered into the
//                      running turn contains `when` (the model reading it
//                      mid-turn), with "$ROUTE_HANDLE" the handle its
//                      "[Sent while you work · route <handle>" note names.
//   FAKE_CLAUDE_PROXY_FETCH an http URL each such turn GETs through
//                      HTTP_PROXY first; the reply carries proxy:<status>:<body>.
//   FAKE_CLAUDE_MCP_PAUSE_MS a pause between two calls (a test can change
//                      the world in between).
//   FAKE_CLAUDE_MCP_DUMP path to write {servers, calls:[{server, tool, listed,
//                      ok, text}]} as JSON after the calls (text cut at
//                      FAKE_CLAUDE_MCP_TEXT_LIMIT characters, default 500).
//   FAKE_CLAUDE_EXIT_DELAY_MS ms this process keeps running after SIGTERM
//                      before it exits: a CLI that is slow to stop, as one
//                      can be on Windows, where taskkill is asynchronous.
//   FAKE_CLAUDE_MODE=voice a spoken answer with a real CLI's timing
//                      (docs/voice-mode-xai.md, "Latency"): the process
//                      waits FAKE_CLAUDE_COLD_MS at boot, before any prompt
//                      (process boot, MCP servers, the session read back).
//                      A prompt that arrives during that wait pays only what
//                      remains. Every turn waits FAKE_CLAUDE_FIRST_TOKEN_MS
//                      before its first text delta (the model's time to
//                      first token), then streams FAKE_CLAUDE_VOICE_REPLY
//                      word by word, FAKE_CLAUDE_TOKEN_MS apart, and settles.
//                      No tool call.
//   FAKE_CLAUDE_LAUNCH_LOG path to append one JSON line {pid, at} when a
//                      pooled process (--input-format) starts, before any
//                      prompt. Absent: nothing is written.
//   FAKE_CLAUDE_PROBE_LOG path: each snapshot probe appends one line,
//                      `<version|help|auth> <pid>`, as it starts, so a test
//                      can count the probes and find one it is holding.
//   FAKE_CLAUDE_HOLD_VERSION / _HELP / _AUTH path: that snapshot probe
//                      (`--version`, `--help`, `auth status`) answers only
//                      once <path> exists — a CLI that is slow to answer
//                      (the real `auth status` can take a second).
//
// Keep this file dependency-free — it runs as a bare `node` subprocess.
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, closeSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { runRoomHandoffAgent } from "./room-handoff-agent.ts";
import { splitLaunchNote, volatileNoteIn } from "./launch-note.ts";

const mode = process.env.FAKE_CLAUDE_MODE ?? "happy";

// Concurrent bot/room turns share a capture path. Publish whole JSON in one
// rename so neither another writer nor a test reader can see a partial dump.
// Kept local like the Codex fake: subprocess fixtures cannot import ../atomic.
const writeDumpAtomic = (path: string, contents: string): void => {
  const tmp = `${path}.${process.pid}.tmp`;
  const delays = [5, 10, 20, 40, 80];
  try {
    writeFileSync(tmp, contents);
    for (let attempt = 0; ; attempt += 1) {
      try {
        renameSync(tmp, path);
        return;
      } catch (error) {
        // Windows indexers can briefly hold either file open.
        const code = (error as NodeJS.ErrnoException).code ?? "";
        if (!["EPERM", "EACCES", "EBUSY"].includes(code) || attempt >= delays.length) throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delays[attempt]);
      }
    }
  } finally {
    try { unlinkSync(tmp); } catch { /* already renamed, or failed cleanup */ }
  }
};

// Follow the spawning server down, including on Windows where ppid does
// not change after parent exit. Inline: fakes must stay self-contained.
{
  const spawner = process.ppid;
  const orphanWatch = setInterval(() => {
    if (process.ppid !== spawner) process.exit(0);
    try { process.kill(spawner, 0); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") process.exit(0);
    }
  }, 500);
  orphanWatch.unref();
}
{
  const exitDelay = Number(process.env.FAKE_CLAUDE_EXIT_DELAY_MS);
  if (Number.isFinite(exitDelay) && exitDelay > 0) {
    process.on("SIGTERM", () => { setTimeout(() => process.exit(0), exitDelay); });
  }
}
const scriptedReplies = (() => {
  try {
    const parsed = JSON.parse(process.env.FAKE_CLAUDE_REPLIES ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string | string[] =>
      typeof value === "string" || (Array.isArray(value) && value.every((part) => typeof part === "string"))
    );
  } catch {
    return [];
  }
})();
type ScriptedToolCall = { name: string; id?: string; input: Record<string, unknown>; ok: boolean; output?: unknown; parent?: string };
// null = unset (or unparseable): keep the single default Bash call.
const scriptedToolCalls: ScriptedToolCall[] | null = (() => {
  const raw = process.env.FAKE_CLAUDE_TOOL_CALLS;
  if (raw === undefined) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed
      .filter((call): call is { name: string; id?: unknown; input?: unknown; ok?: unknown; output?: unknown; parent?: unknown } => typeof call?.name === "string")
      .map((call) => ({
        name: call.name,
        ...(typeof call.id === "string" ? { id: call.id } : {}),
        ...(typeof call.parent === "string" ? { parent: call.parent } : {}),
        input: call.input && typeof call.input === "object" && !Array.isArray(call.input) ? call.input as Record<string, unknown> : {},
        ok: call.ok !== false,
        output: call.output,
      }));
  } catch {
    return null;
  }
})();
let toolUseCount = 0;
let scriptedReplyIndex = 0;
const nextScriptedReply = (): string[] => {
  const stateFile = process.env.FAKE_CLAUDE_REPLY_STATE;
  let index = scriptedReplyIndex;
  if (stateFile) {
    try {
      index = Number(readFileSync(stateFile, "utf8")) || 0;
    } catch {}
    writeFileSync(stateFile, String(index + 1));
  } else {
    scriptedReplyIndex += 1;
  }
  const reply = scriptedReplies[index] ?? "hello from fake claude";
  return Array.isArray(reply) ? reply : [reply];
};

const argv = process.argv.slice(2);
const settingsHooks: Record<string, Array<{ hooks?: Array<{ type?: string; command?: string; timeout?: number }> }>> = (() => {
  if (process.env.FAKE_CLAUDE_HOOKS !== "1") return {};
  const i = argv.indexOf("--settings");
  if (i === -1) return {};
  try {
    const parsed = JSON.parse(readFileSync(argv[i + 1]!, "utf8"));
    return parsed && typeof parsed.hooks === "object" ? parsed.hooks : {};
  } catch {
    return {};
  }
})();
/** Run every command hook registered for `event`, like the real CLI: JSON on
 * stdin, wait for exit (bounded), ignore its output except to a dump. */
function runHooks(event: string, payload: Record<string, unknown>): string {
  let stdout = "";
  for (const entry of settingsHooks[event] ?? []) {
    for (const hook of entry.hooks ?? []) {
      if (hook.type !== "command" || !hook.command) continue;
      const result = spawnSync(hook.command, {
        shell: true,
        input: JSON.stringify({ hook_event_name: event, session_id: "fake-session", cwd: process.cwd(), ...payload }),
        env: process.env,
        timeout: ((hook.timeout ?? 5) + 1) * 1000,
        stdio: ["pipe", "pipe", "pipe"],
        encoding: "utf8",
      });
      stdout += result.stdout ?? "";
    }
  }
  return stdout;
}
let turnsPlayed = 0;
let resumedErrorPlayed = false;
const argAfter = (flag: string): string | null => {
  const i = argv.indexOf(flag);
  return i === -1 ? null : (argv[i + 1] ?? null);
};

const out = (obj: unknown) => process.stdout.write(JSON.stringify(obj) + "\n");

// Snapshot probes: each answers on argv alone and exits without reading stdin.
const probe = argv[0] === "--version" ? "version" : argv[0] === "--help" ? "help" : argv[0] === "auth" && argv[1] === "status" ? "auth" : null;
if (probe) {
  if (process.env.FAKE_CLAUDE_PROBE_LOG) appendFileSync(process.env.FAKE_CLAUDE_PROBE_LOG, `${probe} ${process.pid}\n`);
  const hold = process.env[`FAKE_CLAUDE_HOLD_${probe.toUpperCase()}`];
  while (hold && !existsSync(hold)) await new Promise((resolve) => setTimeout(resolve, 20));
}

if (argv[0] === "--version") {
  // FAKE_CLAUDE_VERSION lets a test stand in for an older CLI: the driver
  // withholds flags that version predates (CLAUDE_FLAG_FLOORS).
  process.stdout.write(`${process.env.FAKE_CLAUDE_VERSION ?? "2.1.232"} (Claude Code)\n`);
  process.exit(0);
}

if (argv[0] === "--help") {
  // Lists --autocompact in the option column like the real CLI, unless the
  // fake stands in for a build without it: FAKE_CLAUDE_AUTOCOMPACT=0, or a
  // version below the 2.1.122 floor.
  const [maj = 0, min = 0, pat = 0] = (process.env.FAKE_CLAUDE_VERSION ?? "2.1.232").split(".").map(Number);
  const has = process.env.FAKE_CLAUDE_AUTOCOMPACT !== "0" && (maj > 2 || (maj === 2 && (min > 1 || (min === 1 && pat >= 122))));
  process.stdout.write(
    `Usage: claude [options]\n\nOptions:\n  --model <model>  Model\n${has ? "  --autocompact <tokens>  Compaction window\n" : ""}  -h, --help  Display help\n`,
  );
  process.exit(0);
}

// `claude mcp list` (the claude.ai connectors inventory,
// server/harness-connectors.ts): FAKE_CLAUDE_MCP_LIST is printed as is,
// e.g. "claude.ai Gmail: https://example.invalid/mcp - ✓ Connected".
if (argv[0] === "mcp" && argv[1] === "list") {
  process.stdout.write(process.env.FAKE_CLAUDE_MCP_LIST ?? "No MCP servers configured.\n", () => process.exit(0));
  await new Promise(() => {});
}

if (argv[0] === "update") {
  if (process.env.FAKE_CLAUDE_UPDATE === "fail") {
    process.stderr.write("fake-claude: simulated update failure\n");
    process.exit(1);
  }
  process.stdout.write("Claude Code is up to date.\n");
  process.exit(0);
}

const fakeAuthFile = () => join(process.env.CLAUDE_CONFIG_DIR || join(process.env.HOME || homedir(), ".claude"), "fake-auth.json");

if (argv[0] === "auth" && argv[1] === "logout" && process.env.FAKE_CLAUDE_AUTH === "file") {
  rmSync(fakeAuthFile(), { force: true });
  process.stdout.write("Successfully logged out from your Anthropic account.\n", () => process.exit(0));
  await new Promise(() => {});
}

if (argv[0] === "auth" && argv[1] === "status") {
  const auth = process.env.FAKE_CLAUDE_AUTH ?? "in";
  if (auth === "file") {
    let email: string | undefined;
    try { email = (JSON.parse(readFileSync(fakeAuthFile(), "utf8")) as { email?: string }).email; } catch {}
    process.stdout.write(
      JSON.stringify(email ? { loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", email } : { loggedIn: false, authMethod: "none", apiProvider: "firstParty" }) + "\n",
      () => process.exit(email ? 0 : 1),
    );
    await new Promise(() => {});
  }
  if (auth === "unsupported") {
    process.stderr.write("error: unknown command 'auth'\n");
    process.exit(1);
  }
  if (auth === "malformed") {
    process.stdout.write("not json\n");
    process.exit(0);
  }
  const loggedIn = auth === "in" || (auth === "inherited-api-key" && Boolean(process.env.ANTHROPIC_API_KEY));
  process.stdout.write(
    JSON.stringify({ loggedIn, authMethod: loggedIn ? "claude.ai" : "none", apiProvider: "firstParty" }) + "\n",
    () => process.exit(auth === "out" ? 1 : 0),
  );
}

// One-shot helper mode used by generateText/reviewPermission. The prompt is
// deliberately read from stdin so sensitive review text never appears in
// argv or process listings.
if (["text", "json"].includes(argAfter("--output-format") ?? "")) {
  const prompt = await new Promise<string>((resolve) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => resolve(input));
  });
  // Memory upkeep's background one-shots (on for every bot) never overwrite
  // the shared turn dump a test reads; FAKE_CLAUDE_TEXT_DUMP still records them.
  const upkeepCall = /You are the (?:CAPTURE|TIDY|ORGANIZE) step of a memory system/.test(prompt);
  const oneShotDump = process.env.FAKE_CLAUDE_TEXT_DUMP ?? (upkeepCall ? undefined : process.env.FAKE_CLAUDE_DUMP);
  if (oneShotDump) {
    writeDumpAtomic(
      oneShotDump,
      JSON.stringify({ pid: process.pid, argv, env: process.env, cwd: process.cwd(), prompt, mcpConfig: null }, null, 2),
    );
  }
  if (process.env.FAKE_CLAUDE_TEXT_HANG) {
    // a repeating timer keeps the loop alive without settling the
    // top-level await, which Node would otherwise treat as fatal
    await new Promise(() => setInterval(() => {}, 1 << 30));
  }
  const replyText = (text: string, code = 0) => {
    const model = argAfter("--model") ?? "claude-haiku-4-5";
    process.stdout.write(argAfter("--output-format") === "json"
      ? process.env.FAKE_CLAUDE_TEXT_RESULT ?? JSON.stringify({
          type: "result", is_error: code !== 0, result: text,
          usage: { input_tokens: 10, cache_read_input_tokens: 2, cache_creation_input_tokens: 3, output_tokens: 5 },
          total_cost_usd: 0.01,
          modelUsage: { [model]: { inputTokens: 10, cacheReadInputTokens: 2, cacheCreationInputTokens: 3, outputTokens: 5, costUSD: 0.01 } },
        })
      : code === 0 ? text : "");
    process.exit(code);
  };
  // FAKE_CLAUDE_TEXT_ROUTES: a JSON file {"marker": "reply"}, re-read each
  // run; the first marker the prompt contains picks the reply, so one run
  // can answer a capture, a tidy-up and a title differently.
  if (process.env.FAKE_CLAUDE_TEXT_ROUTES && existsSync(process.env.FAKE_CLAUDE_TEXT_ROUTES)) {
    try {
      const routes = JSON.parse(readFileSync(process.env.FAKE_CLAUDE_TEXT_ROUTES, "utf8")) as Record<string, string>;
      const hit = Object.entries(routes).find(([marker]) => prompt.includes(marker));
      if (hit) {
        replyText(hit[1]);
      }
    } catch {
      // a malformed routes file falls through to the plain reply below
    }
  }
  if (process.env.FAKE_CLAUDE_TEXT_FILE) {
    const file = process.env.FAKE_CLAUDE_TEXT_FILE;
    const reply = existsSync(file) ? readFileSync(file, "utf8") : "__FAIL__";
    if (reply.trim() === "__FAIL__") {
      process.stderr.write("fake one-shot text failed\n");
      replyText("fake one-shot text failed", 1);
    }
    replyText(reply);
  }
  replyText("fake generated text\n");
}

// Voice mode pays its cold start at process boot, not on the first prompt.
// A version probe, a help listing, and a one-shot text call exit above and
// never start this timer. The timer is armed before the stdin listener so
// it runs while the process is still starting.
const voiceBoot: Promise<void> = mode === "voice"
  ? new Promise((resolve) => { setTimeout(resolve, Math.max(0, Number(process.env.FAKE_CLAUDE_COLD_MS) || 0)); })
  : Promise.resolve();
if (process.env.FAKE_CLAUDE_LAUNCH_LOG && argv.includes("--input-format")) {
  try {
    appendFileSync(process.env.FAKE_CLAUDE_LAUNCH_LOG, `${JSON.stringify({ pid: process.pid, at: Date.now() })}\n`);
  } catch {
    /* the test path can disappear while the process starts */
  }
}

// Line-driven, like the real CLI under --input-format stream-json: each user
// message starts a turn; a message that arrives WHILE a turn is playing is
// folded into it (the real CLI delivers it before the next model call — the
// harness calls that a steer); the process stays alive with stdin open and
// exits only when stdin ends. `slow` leaves a gap between the tool result
// and the reply so a test can steer into it.
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
const sessionId = argAfter("--resume") ?? argAfter("--session-id") ?? "fake-session";
const model = argAfter("--model") ?? "claude-fake";
// The mode init reports: what was asked for, unless auto is unavailable for
// this model, in which case the real CLI silently runs Manual ("default").
const requestedPermissionMode = argAfter("--permission-mode") ?? "default";
const autoUnavailableFor = (process.env.FAKE_CLAUDE_AUTO_UNAVAILABLE_MODELS ?? "").split(",").filter(Boolean);
const permissionMode =
  requestedPermissionMode === "auto" && autoUnavailableFor.includes(model) ? "default" : requestedPermissionMode;
// The built-in tools init reports, as the real CLI does: --tools when given,
// else its default set. FAKE_CLAUDE_KEEP_BASH=1 plays a CLI that keeps Bash
// whatever it was told.
const toolsFlag = argAfter("--tools");
const tools = [...new Set([...(toolsFlag ? toolsFlag.split(",") : ["Bash", "Read", "Edit", "Write", "Glob", "Grep", "WebFetch", "WebSearch"]),
  ...(process.env.FAKE_CLAUDE_KEEP_BASH === "1" ? ["Bash"] : [])])];
/** The launch files, as the first turn read them (FAKE_CLAUDE_DUMP). */
let launchFiles: Record<string, unknown> | null = null;
let turnRunning = false;
let steered: string[] = [];
/** The folded steers as they were sent, echoed when the reply takes them in. */
let steeredMessages: JsonValue[] = [];
// --replay-user-messages (2.1.282): each stdin user message is echoed, with
// the uuid it was sent with, as a turn takes it in — the prompt as its turn
// starts, a folded steer before the reply that answers it, a late steer as
// its own turn starts.
const replayUserMessages = argv.includes("--replay-user-messages");
let replayCount = 0;
const replay = (sent: JsonValue) => {
  if (!replayUserMessages) return;
  const message = (sent ?? {}) as { uuid?: unknown; message?: unknown };
  const uuid = typeof message.uuid === "string" ? message.uuid : `fake-replay-${process.pid}-${++replayCount}`;
  out({ type: "user", message: message.message ?? null, uuid, session_id: sessionId, parent_tool_use_id: null, isReplay: true });
};
const replaySteered = () => {
  for (const message of steeredMessages.splice(0)) replay(message);
};
// Messages that landed after the running turn's last model call
// (FAKE_CLAUDE_LATE_STEER_GATE): each becomes the next turn once it ends.
const lateSteers: JsonValue[] = [];
let lateContinuation = false;
let lateTurnWaiting = false;
// the running cost behind total_cost_usd and modelUsage; a --resume launch
// starts from the session's saved one (FAKE_CLAUDE_COST_STATE)
type FakeModelUsage = { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number; costUSD: number };
const costStateFile = process.env.FAKE_CLAUDE_COST_STATE ? join(process.env.FAKE_CLAUDE_COST_STATE, `${sessionId}.json`) : null;
const runningCost: { total: number; modelUsage: Record<string, FakeModelUsage> } = (() => {
  if (costStateFile && argv.includes("--resume")) {
    try {
      return JSON.parse(readFileSync(costStateFile, "utf8"));
    } catch {}
  }
  return { total: 0, modelUsage: {} };
})();
let stdinEnded = false;
let steerGateArmed = false;

// Ownership-race fixture: after accepting the first prompt, stop consuming
// stdin until the test creates this file. A large second write then leaves
// adapter.steer() genuinely pending while the first turn settles and another
// HTTP request deletes or switches the bot.
const armSteerGate = () => {
  const gate = process.env.FAKE_CLAUDE_STEER_GATE;
  if (!gate || steerGateArmed) return;
  steerGateArmed = true;
  process.stdin.pause();
  const poll = setInterval(() => {
    if (!existsSync(gate)) return;
    clearInterval(poll);
    process.stdin.resume();
  }, 10);
};

const promptText = (raw: JsonValue): string => {
  const prompt = splitLaunchNote(raw).prompt;
  const m = prompt && typeof prompt === "object" && !Array.isArray(prompt) ? (prompt as { message?: { content?: unknown } }).message : undefined;
  return typeof m?.content === "string" ? m.content : "";
};

/** A message the finished turn could not fold runs as the next turn — once
 * FAKE_CLAUDE_LATE_STEER_INIT_GATE, if set, lets its `init` out. True while
 * one is queued or waiting. */
const startLateTurn = (): boolean => {
  if (lateTurnWaiting) return true;
  const late = lateSteers[0];
  if (late === undefined) return false;
  const initGate = process.env.FAKE_CLAUDE_LATE_STEER_INIT_GATE;
  if (initGate && !existsSync(initGate)) {
    lateTurnWaiting = true;
    const poll = setInterval(() => {
      if (!existsSync(initGate)) return;
      clearInterval(poll);
      lateTurnWaiting = false;
      finishIfDone();
    }, 10);
    return true;
  }
  lateSteers.shift();
  playTurn(late, true);
  return true;
};

const finishIfDone = () => {
  if (turnRunning) return;
  if (startLateTurn()) return;
  if (stdinEnded) process.exit(0);
  if (process.env.FAKE_CLAUDE_EXIT_AFTER_TURN === "1") process.stdout.write("", () => process.exit(0));
  const gone = process.env.FAKE_CLAUDE_GONE_AFTER_TURN;
  if (gone) process.stdout.write("", () => {
    // the read end itself: Node keeps fd 0 open through stdin.destroy()
    process.stdin.pause();
    closeSync(0);
    writeFileSync(`${gone}.closed`, "closed");
    setInterval(() => { if (existsSync(gone)) process.exit(0); }, 10);
  });
};

const finishTurn = () => {
  runHooks("Stop", { stop_hook_active: false });
  out({ type: "result", is_error: false, stop_reason: "end_turn", total_cost_usd: 0.01, usage: { input_tokens: 10, cache_read_input_tokens: 2, output_tokens: 5 } });
  turnRunning = false;
  finishIfDone();
};

/** The --mcp-config, --append-system-prompt-file and --settings files, read
 * the way the real CLI reads them: once, at launch. */
const readLaunchFiles = (): Record<string, unknown> => {
  const configPath = argAfter("--mcp-config");
  let mcpConfig: unknown = null;
  if (configPath) {
    try {
      mcpConfig = JSON.parse(readFileSync(configPath, "utf8"));
    } catch {
      /* leave null — the test will see it */
    }
  }
  const systemPromptPath = argAfter("--append-system-prompt-file");
  const settingsPath = argAfter("--settings");
  const settings = settingsPath ? JSON.parse(readFileSync(settingsPath, "utf8")) : null;
  const settingsMode = settingsPath ? statSync(settingsPath).mode & 0o777 : null;
  let systemPrompt: string | null = null;
  if (systemPromptPath) {
    try {
      systemPrompt = readFileSync(systemPromptPath, "utf8");
    } catch {
      /* leave null — the test will see it */
    }
  }
  return { systemPrompt, mcpConfig, settings, settingsMode };
};

type FakeMcpServer = { command?: string; args?: string[]; env?: Record<string, string>; type?: string; url?: string; headers?: Record<string, string> };
/** The harness's own HTTP servers (server/harness-mcp-http.ts), which the
 * real CLI connects to itself. Other URL servers stay unreached here. */
function harnessHttpServer(server: FakeMcpServer | undefined): { url: string; headers?: Record<string, string> } | null {
  return server?.type === "http" && typeof server.url === "string" && /\/api\/internal\/(browser|computer|data)\/mcp-http$/.test(server.url)
    ? { url: server.url, ...(server.headers ? { headers: server.headers } : {}) } : null;
}
const HTTP_POST_SCRIPT = `let b="";process.stdin.on("data",(c)=>b+=c).on("end",async()=>{try{const r=await fetch(process.env.FAKE_MCP_URL,{method:"POST",headers:{"content-type":"application/json",accept:"application/json, text/event-stream",...JSON.parse(process.env.FAKE_MCP_HEADERS||"{}")},body:b.trim()});const t=await r.text();process.stdout.write((t.includes("data: ")?t.trim().split("data: ").at(-1):t)+"\\n")}catch(e){process.stderr.write(String(e))}})`;

/** One screenshot through the launched cloud computer server, if this turn
 * has one: the server answers once the harness has created or woken the
 * computer (or refused to). Synchronous, like the turn loop around it. */
const useCloudComputer = () => {
  launchFiles ??= readLaunchFiles();
  const server = (launchFiles.mcpConfig as { mcpServers?: Record<string, FakeMcpServer> } | null)
    ?.mcpServers?.computer;
  const http = harnessHttpServer(server);
  if (!http && (!server?.command || server.args?.at(-1) !== "computer" || !/harness-mcp-proxy/.test(server.args[0] ?? ""))) return;
  if (http && !http.url.endsWith("/api/internal/computer/mcp-http")) return;
  const id = `tu-${process.pid}-${++toolUseCount}`;
  out({ type: "assistant", message: { content: [{ type: "tool_use", id, name: "mcp__computer__screenshot", input: {} }] } });
  const input = `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "screenshot", arguments: {} } })}\n`;
  // The real CLI posts to an HTTP server itself; this loop is synchronous,
  // so one short Node child does the POST.
  const ran = http
    ? spawnSync(process.execPath, ["-e", HTTP_POST_SCRIPT], {
      input, env: { ...process.env, FAKE_MCP_URL: http.url, FAKE_MCP_HEADERS: JSON.stringify(http.headers ?? {}) }, encoding: "utf8", timeout: 150_000,
    })
    : spawnSync(server!.command!, server!.args ?? [], {
      input, env: { ...process.env, ...server!.env }, encoding: "utf8", timeout: 150_000,
    });
  let reply: { result?: { isError?: boolean; content?: unknown }; error?: { message?: string } } = {};
  try { reply = JSON.parse(ran.stdout.trim().split("\n")[0] ?? ""); } catch { reply = { error: { message: ran.stderr || "no answer" } }; }
  out({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id,
    is_error: Boolean(reply.error || reply.result?.isError), content: reply.result?.content ?? reply.error?.message ?? "" }] } });
};

/** FAKE_CLAUDE_TRANSCRIPTS: where the real CLI keeps this session. */
function claudeConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || join(process.env.HOME || process.env.USERPROFILE || ".", ".claude");
}
function transcriptPath(): string {
  return join(claudeConfigDir(), "projects", process.cwd().replace(/[^a-zA-Z0-9]/g, "-"), `${sessionId}.jsonl`);
}
function recordTranscript(prompt: JsonValue): void {
  if (process.env.FAKE_CLAUDE_TRANSCRIPTS !== "1") return;
  const file = transcriptPath();
  if (argv.includes("--resume") && !existsSync(file)) return;
  mkdirSync(join(file, ".."), { recursive: true });
  appendFileSync(file, `${JSON.stringify({ type: "user", sessionId, cwd: process.cwd(), message: prompt })}\n`);
  const text = typeof prompt === "string" ? prompt : JSON.stringify(prompt);
  appendFileSync(join(claudeConfigDir(), "history.jsonl"), `${JSON.stringify({ display: text.slice(0, 20_000), project: process.cwd(), sessionId })}\n`);
}

/** The volatile half of the instructions this process last received. */
let volatileNote: string | null = null;

const playTurn = (prompt: JsonValue, late = false) => {
  recordTranscript(prompt);
  turnRunning = true;
  lateContinuation = late;
  steered = [];
  steeredMessages = [];
  // Every prompt this process receives, one JSON object per line.
  // FAKE_CLAUDE_DUMP keeps only the latest turn's.
  if (process.env.FAKE_CLAUDE_PROMPTS) appendFileSync(process.env.FAKE_CLAUDE_PROMPTS, `${JSON.stringify(prompt)}\n`);
  volatileNote = volatileNoteIn(prompt) ?? volatileNote;
  if (!late && process.env.FAKE_CLAUDE_DUMP) {
    launchFiles ??= readLaunchFiles();
    // systemPrompt: what the model is instructed with, the prompt file plus
    // the volatile half a user message carried (claude.ts keeps the file
    // stable for the cache); systemPromptFile: the file alone.
    const file = launchFiles.systemPrompt;
    const systemPrompt = volatileNote && typeof file === "string" ? `${file}\n\n${volatileNote}` : volatileNote && !file ? volatileNote : file;
    writeDumpAtomic(
      process.env.FAKE_CLAUDE_DUMP,
      JSON.stringify({ pid: process.pid, argv, env: process.env, cwd: process.cwd(), prompt, ...launchFiles, systemPrompt, systemPromptFile: file }, null, 2),
    );
  }

  if (process.env.FAKE_CLAUDE_ROUTER_PING === "1" && process.env.ANTHROPIC_BASE_URL) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (process.env.ANTHROPIC_AUTH_TOKEN) headers.authorization = `Bearer ${process.env.ANTHROPIC_AUTH_TOKEN}`;
    if (process.env.ANTHROPIC_API_KEY) headers["x-api-key"] = process.env.ANTHROPIC_API_KEY;
    // Synchronous on purpose: the turn's frames follow the request, as they do
    // for the real CLI, and this fake's turn loop is synchronous.
    spawnSync(process.execPath, [
      "-e",
      "fetch(process.argv[1], { method: 'POST', headers: JSON.parse(process.argv[2]), body: '{}' }).then((r) => r.text(), () => {})",
      `${process.env.ANTHROPIC_BASE_URL.replace(/\/+$/u, "")}/v1/messages`,
      JSON.stringify(headers),
    ], { stdio: "ignore", timeout: 5_000 });
  }

  // A resumed session the CLI no longer has: it exits before any `init`
  // frame, so the prompt on stdin is never read. A FRESH launch (--session-id)
  // works normally, which is what makes recovery observable.
  if (mode === "dead-session" && argv.includes("--resume")) {
    process.stderr.write(`fake-claude: No conversation found with session ID: ${argAfter("--resume")}\n`);
    process.exit(1);
  }
  // The same, as 2.1.295 says it after a long idle: an error result for the
  // message, no `init`, and the process stays up for the next one.
  const transcriptGone = process.env.FAKE_CLAUDE_TRANSCRIPTS === "1" && argv.includes("--resume") && !existsSync(transcriptPath());
  if ((mode === "stale-session" && argv.includes("--resume")) || mode === "error-result" || transcriptGone) {
    out({
      type: "result", subtype: "error_during_execution", duration_ms: 0, is_error: true, num_turns: 0, stop_reason: null,
      session_id: sessionId, total_cost_usd: 0, errors: [`No conversation found with session ID: ${sessionId}`],
    });
    turnRunning = false;
    finishIfDone();
    return;
  }

  if (mode === "exit-early") {
    process.stderr.write("fake-claude: simulated crash before result\n");
    process.exit(3);
  }
  // transient-failure script for retry tests. FAKE_CLAUDE_TRANSIENTS is how
  // many launches fail transiently (503-shaped stderr, exit 5); the count of
  // launches so far lives in a state FILE because child processes cannot
  // mutate the parent's environment. When the quota is exhausted (or
  // FAKE_CLAUDE_STATE is unset) the turn completes normally.
  // FAKE_CLAUDE_PARTIAL_FAILS makes the FIRST launch emit a text delta
  // before failing — the partial-output guard must forbid retrying it.
  if (process.env.FAKE_CLAUDE_TRANSIENTS && process.env.FAKE_CLAUDE_STATE) {
    let launched = 0;
    try {
      launched = Number(readFileSync(process.env.FAKE_CLAUDE_STATE, "utf8")) || 0;
    } catch {}
    const quota = Number(process.env.FAKE_CLAUDE_TRANSIENTS) || 0;
    writeFileSync(process.env.FAKE_CLAUDE_STATE, String(launched + 1));
    out({ type: "system", subtype: "init", session_id: sessionId, model, permissionMode, tools });
    if (launched < quota) {
      if (process.env.FAKE_CLAUDE_PARTIAL_FAILS) {
        out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "half an answer" } } });
      }
      process.stderr.write("claude: API error (503): service temporarily unavailable\n");
      process.exit(5);
    }
  }

  if (mode === "voice") {
    void playVoiceTurn(prompt);
    return;
  }

  // the real CLI re-announces init on every turn of a live process
  out({ type: "system", subtype: "init", session_id: sessionId, model, permissionMode, tools });
  const limitedFile = process.env.FAKE_CLAUDE_LIMITED_FILE;
  const limited = limitedFile && existsSync(limitedFile) ? readFileSync(limitedFile, "utf8") : null;
  const rateLimit = limited !== null ? JSON.parse(limited) : process.env.FAKE_CLAUDE_RATE_LIMIT ? JSON.parse(process.env.FAKE_CLAUDE_RATE_LIMIT) : null;
  if (rateLimit) out({ type: "rate_limit_event", rate_limit_info: rateLimit, session_id: sessionId });

  // a continuation that announces itself and then never speaks again
  if (lateContinuation && process.env.FAKE_CLAUDE_LATE_STEER_SILENT) {
    setInterval(() => {}, 1_000);
    return;
  }
  replay(prompt);

  // The CLI accepted the resumed session — it read the prompt — and then
  // died with nothing to show. The prompt may already have run tools, so
  // the driver must NOT send it again.
  if (mode === "resume-dies-after-init" && argv.includes("--resume")) {
    process.stderr.write("fake-claude: simulated crash after accepting the resumed session\n");
    process.exit(3);
  }

  const resumedError = process.env.FAKE_CLAUDE_RESUMED_API_ERROR === "1" && argv.includes("--resume") && !resumedErrorPlayed;
  if (resumedError) resumedErrorPlayed = true;
  const midTurnFile = process.env.FAKE_CLAUDE_LIMIT_MID_TURN_FILE;
  const midTurnModel = midTurnFile && existsSync(midTurnFile) ? readFileSync(midTurnFile, "utf8").trim() : null;
  if (midTurnFile && (midTurnModel === null || midTurnModel === model)) {
    if (midTurnModel === null) {
      writeFileSync(midTurnFile, model);
      const id = `toolu_mid_${Date.now()}`;
      out({ type: "assistant", message: { content: [{ type: "tool_use", id, name: "Bash", input: { command: "ls /srv/reports" } }] } });
      out({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, is_error: false, content: [{ type: "text", text: "q3.csv q4.csv" }] }] } });
    }
    const info = { status: "rejected", rateLimitType: "seven_day_opus", resetsAt: Math.floor(Date.now() / 1_000) + 3_600 };
    const text = "You've hit your weekly Opus limit";
    out({ type: "rate_limit_event", rate_limit_info: info, session_id: sessionId });
    out({
      type: "assistant", message: { model: "<synthetic>", stop_reason: "stop_sequence", content: [{ type: "text", text }] },
      error: "rate_limit", is_api_error_message: true, api_error: "usage_limit_reached", api_error_params: { rate_limit_info: info },
    });
    out({ type: "result", subtype: "success", is_error: true, stop_reason: "stop_sequence", terminal_reason: "api_error", api_error: "usage_limit_reached", result: text });
    turnRunning = false;
    finishIfDone();
    return;
  }
  if (mode === "usage-limit" || limited !== null) {
    // captured from 2.1.295 for an account past its weekly limit
    const text = process.env.FAKE_CLAUDE_API_ERROR ?? "You've hit your weekly limit \u00b7 resets Oct 12 at 2:30pm (Asia/Calcutta)";
    out({
      type: "assistant", message: { model: "<synthetic>", stop_reason: "stop_sequence", content: [{ type: "text", text }] },
      error: "rate_limit", is_api_error_message: true, api_error: "usage_limit_reached",
      ...(rateLimit ? { api_error_params: { rate_limit_info: rateLimit } } : {}),
    });
    out({ type: "result", subtype: "success", is_error: true, stop_reason: "stop_sequence", terminal_reason: "api_error", api_error: "usage_limit_reached", result: text });
    turnRunning = false;
    finishIfDone();
    return;
  }
  const thrashText = promptText(prompt);
  if ((mode === "context-thrash" || thrashText.includes("[fake:context-thrash]")) &&
      (!thrashText.includes("ran out of context space") || process.env.FAKE_CLAUDE_THRASH_AGAIN === "1")) {
    const id = `toolu_thrash_${Date.now()}`;
    out({ type: "assistant", message: { content: [{ type: "tool_use", id, name: "Bash", input: { command: "nmap -p- 192.0.2.10" } }] } });
    out({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, is_error: false, content: [{ type: "text", text: "PORT STATE SERVICE\n22/tcp open ssh" }] }] } });
    const text = "Autocompact is thrashing: the context refilled to the limit within 3 turns of the previous compact, 3 times in a row. A file being read or a tool output is likely too large for the context window. Try reading in smaller chunks, or use /clear to start fresh.";
    out({ type: "assistant", message: { model: "<synthetic>", stop_reason: "stop_sequence", content: [{ type: "text", text }] }, error: "invalid_request", is_api_error_message: true, api_error: "autocompact_thrashing" });
    out({ type: "result", subtype: "success", is_error: true, stop_reason: "stop_sequence", terminal_reason: "rapid_refill_breaker", api_error: "autocompact_thrashing", total_cost_usd: 0.05, result: text });
    turnRunning = false;
    finishIfDone();
    return;
  }
  // [fake:subagent-api-error]: the turn starts a sub-agent (Agent tool) that
  // never reports back, then fails on an API error.
  if (promptText(prompt).includes("[fake:subagent-api-error]")) {
    const id = `toolu_subagent_${Date.now()}`;
    out({ type: "assistant", message: { content: [{ type: "tool_use", id, name: "Agent", input: { description: "Look around", prompt: "Read the folder and report.", subagent_type: "general-purpose" } }] } });
    const text = "API Error: 529 Overloaded. This is a server-side issue, usually temporary.";
    out({ type: "assistant", message: { model: "<synthetic>", stop_reason: "stop_sequence", content: [{ type: "text", text }] }, error: "unknown", is_api_error_message: true });
    out({ type: "result", subtype: "success", is_error: true, stop_reason: "stop_sequence", terminal_reason: "api_error", result: text });
    turnRunning = false;
    finishIfDone();
    return;
  }
  // a prompt carrying [fake:api-error] fails like api-error, whatever the mode
  if (mode === "api-error" || resumedError || promptText(prompt).includes("[fake:api-error]")) {
    const text = process.env.FAKE_CLAUDE_API_ERROR ?? "API Error: 529 Overloaded. This is a server-side issue, usually temporary.";
    out({ type: "assistant", message: { model: "<synthetic>", stop_reason: "stop_sequence", content: [{ type: "text", text }] }, error: process.env.FAKE_CLAUDE_API_ERROR_KIND ?? "unknown", is_api_error_message: true });
    const status = Number(process.env.FAKE_CLAUDE_API_ERROR_STATUS) || undefined;
    out({ type: "result", subtype: "success", is_error: true, stop_reason: "stop_sequence", ...(process.env.FAKE_CLAUDE_NO_TERMINAL_REASON === "1" ? {} : { terminal_reason: "api_error" }), ...(status ? { api_error_status: status } : {}), result: text });
    turnRunning = false;
    finishIfDone();
    return;
  }

  if (process.env.FAKE_CLAUDE_ROOM_PLAN) {
    const progress = (text: string) => out({ type: "assistant", message: { content: [{ type: "text", text }] } });
    void runRoomHandoffAgent(argv, process.env.FAKE_CLAUDE_ROOM_PLAN, prompt, undefined, progress).then(text => {
      const contextTokens = Number(process.env.FAKE_CLAUDE_CONTEXT_TOKENS);
      const usage = Number.isSafeInteger(contextTokens) && contextTokens > 0 ? { input_tokens: contextTokens, output_tokens: 5 } : undefined;
      // anything steered in was taken in before this turn's result
      replaySteered();
      out({ type: "assistant", message: { content: [{ type: "text", text }], ...(usage ? { usage } : {}) } });
      out({ type: "result", is_error: false, stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 } });
    }).catch(error => {
      if (error?.usageLimit) {
        // the plan's usage limit, in the CLI's own words (as the usage-limit mode)
        const text = String(error.message);
        const info = typeof error.resetsAt === "number" ? { status: "rejected", rateLimitType: "five_hour", resetsAt: error.resetsAt } : null;
        if (info) out({ type: "rate_limit_event", rate_limit_info: info, session_id: sessionId });
        out({ type: "assistant", message: { model: "<synthetic>", stop_reason: "stop_sequence", content: [{ type: "text", text }] },
          error: "rate_limit", is_api_error_message: true, api_error: "usage_limit_reached", ...(info ? { api_error_params: { rate_limit_info: info } } : {}) });
        out({ type: "result", subtype: "success", is_error: true, stop_reason: "stop_sequence", terminal_reason: "api_error", api_error: "usage_limit_reached", result: text });
        return;
      }
      out({ type: "result", is_error: true, result: String(error), stop_reason: "error" });
    }).finally(() => { turnRunning = false; finishIfDone(); });
    return;
  }

  if (mode === "hang") {
    // stay alive until killed — lets tests exercise interrupt + the
    // permission broker while a turn is officially in flight. With
    // FAKE_CLAUDE_RELEASE, the turn ends normally once that file exists.
    const release = process.env.FAKE_CLAUDE_RELEASE;
    const finishGate = process.env.FAKE_CLAUDE_FINISH_GATE;
    const held = setInterval(() => {
      if (finishGate && existsSync(finishGate)) {
        clearInterval(held);
        out({ type: "assistant", message: { content: [{ type: "text", text: "fixture turn completed" }] } });
        finishTurn();
        return;
      }
      if (!release || !existsSync(release)) return;
      clearInterval(held);
      out({ type: "assistant", message: { content: [{ type: "text", text: "released" }] } });
      out({ type: "result", is_error: false, stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 } });
      turnRunning = false;
      finishIfDone();
    }, finishGate ? 10 : 100);
    return;
  }

  if (mode === "malformed") {
    process.stdout.write("this is not json\n{broken\n");
  }

  // A signed-out CLI answers every prompt with this, verbatim: the login
  // instruction arrives as assistant text, and only the frame's own error
  // fields say it is a failure at all.
  if (mode === "not-logged-in" || process.env.FAKE_CLAUDE_AUTH_AFTER_TURN === "1" && turnsPlayed > 0) {
    if (process.env.FAKE_CLAUDE_AUTH_AFTER_WORK === "1") out({
      type: "assistant", message: { model: "claude-fixture", content: [{ type: "tool_use", id: "before-sign-out", name: "Bash", input: { command: "pwd" } }] },
    });
    out({ type: "system", subtype: "status", status: "requesting" });
    out({
      type: "assistant",
      message: { model: "<synthetic>", content: [{ type: "text", text: "Not logged in \u00b7 Please run /login" }] },
      error: "authentication_failed",
      is_api_error_message: true,
    });
    out({
      type: "result",
      is_error: true,
      stop_reason: "stop_sequence",
      terminal_reason: "api_error",
      result: "Not logged in \u00b7 Please run /login",
      total_cost_usd: runningCost.total,
    });
    turnRunning = false;
    finishIfDone();
    return;
  }

  if (mode === "stream") {
    const delta = (d: unknown) => out({ type: "stream_event", event: { type: "content_block_delta", delta: d } });
    delta({ type: "thinking_delta", thinking: "hmm" });
    delta({ type: "text_delta", text: "hello from " });
    delta({ type: "text_delta", text: "fake claude" });
    // subagent narration — the driver must drop this, not render it
    out({
      type: "stream_event",
      parent_tool_use_id: "task-1",
      event: { type: "content_block_delta", delta: { type: "text_delta", text: "SUBAGENT NOISE" } },
    });
  }

  if (process.env.FAKE_CLAUDE_USES_CLOUD_COMPUTER === "1") useCloudComputer();

  if (fakeMcpCalls) {
    const promptText = JSON.stringify(prompt);
    // "$ATTACHED_FILE" in an argument: the path the prompt's first
    // <attached-file> tag names (where the harness said the file is).
    const attached = /<attached-file path=\\"(.*?)\\"/.exec(promptText);
    const attachedPath = attached ? JSON.parse(`"${attached[1]}"`) as string : "";
    // "$PROMPT_ID" in an argument: the id the prompt names after
    // "PROMPT_ID=" (a test that only learns an id at run time sends it).
    const promptId = /PROMPT_ID=([\w-]+)/.exec(promptText)?.[1] ?? "";
    // "$PROMPT_ID2": a second id, after "PROMPT_ID2=" (a page and its thread)
    const promptId2 = /PROMPT_ID2=([\w-]+)/.exec(promptText)?.[1] ?? "";
    const withAttached = (call: FakeMcpCall): FakeMcpCall => ({
      ...call,
      arguments: Object.fromEntries(Object.entries(call.arguments).map(([key, value]) => [key, value === "$ATTACHED_FILE" ? attachedPath : value === "$PROMPT_ID" ? promptId : value === "$PROMPT_ID2" ? promptId2 : value])),
    });
    void runFakeMcpCalls(fakeMcpCalls.filter((call) => !call.onSteer && (!call.when || promptText.includes(call.when))).map(withAttached), argAfter("--mcp-config")).then(
      (note) => playReply(prompt, note),
      (error: unknown) => playReply(prompt, `mcp:error:${error instanceof Error ? error.message : String(error)}`),
    );
    return;
  }
  playReply(prompt, "");
};

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
/** FAKE_CLAUDE_MODE=voice: one turn with a real CLI's timing, streamed.
 * The cold start already began at process boot (voiceBoot). */
async function playVoiceTurn(prompt: JsonValue): Promise<void> {
  await voiceBoot;
  out({ type: "system", subtype: "init", session_id: sessionId, model, permissionMode, tools });
  replay(prompt);
  await pause(Number(process.env.FAKE_CLAUDE_FIRST_TOKEN_MS) || 0);
  const promptText = typeof prompt === "string" ? prompt : JSON.stringify(prompt);
  // The phrase stays in later turns' context. Only the turn that asks, with
  // the words at the end of the prompt, runs the tool.
  const ticketAt = promptText.toLowerCase().lastIndexOf("ticket count");
  const ticketTail = ticketAt >= 0 ? promptText.slice(ticketAt + "ticket count".length) : "";
  const ticketTurn = ticketAt >= 0 && ticketTail.length <= 160 && !/[A-Za-zÀ-ÿ]{4,}/.test(ticketTail);
  if (process.env.FAKE_CLAUDE_VOICE_TOOL === "1" && ticketTurn) {
    const id = `tu-voice-${process.pid}-${++toolUseCount}`;
    out({ type: "assistant", message: { content: [{ type: "tool_use", id, name: "Bash", input: { command: "echo 3" } }] } });
    out({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, is_error: false, content: [{ type: "text", text: "3" }] }] } });
  }
  const reply = process.env.FAKE_CLAUDE_VOICE_REPLY || "Sure. It is sunny in Montreal today, with a high of twenty degrees and a light wind. Do you want the forecast for tomorrow too?";
  const tokenMs = Number(process.env.FAKE_CLAUDE_TOKEN_MS) || 0;
  const words = reply.match(/\S+\s*/g) ?? [reply];
  for (const word of words) {
    out({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: word } } });
    if (tokenMs) await pause(tokenMs);
  }
  replaySteered();
  out({ type: "assistant", message: { content: [{ type: "text", text: reply }], usage: { input_tokens: 10, output_tokens: 5 } } });
  runningCost.total = Number((runningCost.total + 0.01).toFixed(2));
  out({ type: "result", is_error: false, stop_reason: "end_turn", total_cost_usd: runningCost.total, usage: { input_tokens: 10, output_tokens: 5 } });
  turnRunning = false;
  finishIfDone();
}

type FakeMcpCall = { server: string; tool: string; arguments: Record<string, unknown>; when?: string; onSteer?: boolean };
const fakeMcpCalls: FakeMcpCall[] | null = (() => {
  const raw = process.env.FAKE_CLAUDE_MCP_CALLS;
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed
      .filter((call): call is { server: string; tool: string; arguments?: unknown; when?: unknown } => typeof call?.server === "string" && typeof call?.tool === "string")
      .map((call) => ({
        server: call.server,
        tool: call.tool,
        arguments: call.arguments && typeof call.arguments === "object" && !Array.isArray(call.arguments) ? call.arguments as Record<string, unknown> : {},
        ...(typeof call.when === "string" && call.when ? { when: call.when } : {}),
        ...((call as { onSteer?: unknown }).onSteer === true ? { onSteer: true } : {}),
      }));
  } catch {
    return null;
  }
})();

/** One MCP client session over streamable HTTP, JSON answers only. */
function fakeHttpMcpSession(server: { url: string; headers?: Record<string, string> }) {
  let next = 0;
  const post = async (frame: Record<string, unknown>) => fetch(server.url, {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...server.headers },
    body: JSON.stringify(frame), signal: AbortSignal.timeout(20_000),
  });
  const request = async (method: string, params: Record<string, unknown>) => {
    const id = ++next;
    try {
      const response = await post({ jsonrpc: "2.0", id, method, params });
      const text = await response.text();
      // a tool call answers as an event stream: the result is the last event
      return JSON.parse(text.includes("data: ") ? text.trim().split("data: ").at(-1)! : text) as Record<string, unknown>;
    } catch (error) {
      return { id, error: { code: -1, message: error instanceof Error ? error.message : "error" } };
    }
  };
  const notify = (method: string) => { void post({ jsonrpc: "2.0", method }).catch(() => {}); };
  return { request, notify, close: () => {} };
}

/** One stdio MCP client session: newline-delimited JSON-RPC. */
function fakeMcpSession(server: { command: string; args?: string[]; env?: Record<string, string> }) {
  const child = spawn(server.command, server.args ?? [], { env: { ...process.env, ...server.env }, stdio: ["pipe", "pipe", "ignore"] });
  const waiting = new Map<unknown, (frame: Record<string, unknown>) => void>();
  let buffer = "";
  child.stdout.on("data", (chunk) => {
    buffer += String(chunk);
    let nl;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      try {
        const frame = JSON.parse(line) as Record<string, unknown>;
        waiting.get(frame.id)?.(frame);
        waiting.delete(frame.id);
      } catch { /* not a frame */ }
    }
  });
  let next = 0;
  const request = (method: string, params: Record<string, unknown>) => new Promise<Record<string, unknown>>((resolve) => {
    const id = ++next;
    const timer = setTimeout(() => { waiting.delete(id); resolve({ id, error: { code: -1, message: "timeout" } }); }, 20_000);
    waiting.set(id, (frame) => { clearTimeout(timer); resolve(frame); });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
  const notify = (method: string) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`);
  const close = () => { child.stdin.end(); setTimeout(() => child.kill("SIGKILL"), 2_000).unref(); };
  return { request, notify, close };
}

async function proxyFetch(target: string): Promise<string> {
  const proxy = process.env.HTTP_PROXY;
  if (!proxy) return "proxy:none";
  const { request } = await import("node:http");
  const parsed = new URL(proxy);
  return new Promise((resolve) => {
    let settled = false;
    const done = (note: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(note);
    };
    // A hung CONNECT through the desktop tunnel used to stall the whole
    // turn (desktop-bridge.e2e): cap the wait so the scripted reply still
    // lands and the test can assert on proxy:error.
    const timer = setTimeout(() => {
      req.destroy();
      done("proxy:error:timeout");
    }, 5_000);
    const req = request({
      host: parsed.hostname, port: parsed.port, path: target, method: "GET",
      headers: { host: new URL(target).host, "proxy-authorization": `Basic ${Buffer.from(`${decodeURIComponent(parsed.username)}:${decodeURIComponent(parsed.password)}`).toString("base64")}` },
    }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => done(`proxy:${res.statusCode}:${body.slice(0, 200)}`));
    });
    req.on("error", (error) => done(`proxy:error:${error.message}`));
    req.end();
  });
}

// The real CLI reads --mcp-config once, at launch, and keeps its servers
// for every turn of the process; the harness may remove the file after.
let launchServers: Record<string, FakeMcpServer> | null = null;
async function runFakeMcpCalls(calls: FakeMcpCall[], configPath: string | null): Promise<string> {
  let servers: Record<string, FakeMcpServer> = launchServers ?? {};
  if (configPath && !launchServers) {
    try {
      const config = JSON.parse(readFileSync(configPath, "utf8")) as { mcpServers?: typeof servers };
      servers = config.mcpServers ?? {};
      launchServers = servers;
    } catch { /* no servers */ }
  }
  const matches = (pattern: string, name: string) => (pattern.endsWith("*") ? name.startsWith(pattern.slice(0, -1)) : name === pattern);
  const results: Array<{ server: string; tool: string; listed: boolean; ok: boolean; text: string }> = [];
  const notes: string[] = [];
  const pauseMs = Number(process.env.FAKE_CLAUDE_MCP_PAUSE_MS) || 0;
  let first = true;
  // FAKE_CLAUDE_PROXY_FETCH: an http URL this turn GETs through HTTP_PROXY,
  // as a tool's own HTTP call would; the reply carries proxy:<status>:<body>.
  if (process.env.FAKE_CLAUDE_PROXY_FETCH) notes.push(await proxyFetch(process.env.FAKE_CLAUDE_PROXY_FETCH));
  for (const call of calls) {
    const names = Object.keys(servers).filter((name) => matches(call.server, name) && (typeof servers[name]?.command === "string" || harnessHttpServer(servers[name]) !== null));
    if (!names.length) {
      notes.push("mcp:absent");
      continue;
    }
    for (const name of names) {
      if (!first && pauseMs > 0) await new Promise((resolve) => setTimeout(resolve, pauseMs));
      first = false;
      const http = harnessHttpServer(servers[name]);
      const session = http ? fakeHttpMcpSession(http) : fakeMcpSession(servers[name] as { command: string; args?: string[]; env?: Record<string, string> });
      try {
        await session.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "fake-claude", version: "0" } });
        session.notify("notifications/initialized");
        const listed = await session.request("tools/list", {});
        const tools = ((listed.result as { tools?: Array<{ name?: string }> } | undefined)?.tools ?? []).map((tool) => tool.name);
        const answer = await session.request("tools/call", { name: call.tool, arguments: call.arguments });
        const result = answer.result as { isError?: boolean; content?: Array<{ text?: string }> } | undefined;
        const ok = Boolean(result) && result?.isError !== true && !answer.error;
        const text = answer.error ? String((answer.error as { message?: unknown }).message ?? "error") : (result?.content ?? []).map((part) => part.text ?? "").join(" ").slice(0, Number(process.env.FAKE_CLAUDE_MCP_TEXT_LIMIT) || 500);
        results.push({ server: name, tool: call.tool, listed: tools.includes(call.tool), ok, text });
        notes.push(`mcp:${call.tool}:${ok ? "ok" : "error"}`);
      } finally {
        session.close();
      }
    }
  }
  if (process.env.FAKE_CLAUDE_MCP_DUMP) {
    writeFileSync(process.env.FAKE_CLAUDE_MCP_DUMP, JSON.stringify({ servers: Object.keys(servers), calls: results }, null, 2));
  }
  return notes.join(" ");
}

const playReply = (prompt: JsonValue, mcpNote: string) => {
  let replyParts = nextScriptedReply();
  if (mcpNote) replyParts = [...replyParts.slice(0, -1), `${replyParts.at(-1) ?? ""}\n${mcpNote}`];
  const defaultToolId = `tu-${process.pid}-${++toolUseCount}`;
  // FAKE_CLAUDE_TURN_STATE: a counter file so "second turn" survives a
  // respawn between turns (the harness may relaunch the CLI legitimately)
  if (process.env.FAKE_CLAUDE_TURN_STATE) {
    let n = 0;
    try { n = Number(readFileSync(process.env.FAKE_CLAUDE_TURN_STATE, "utf8")) || 0; } catch {}
    turnsPlayed = n;
    writeFileSync(process.env.FAKE_CLAUDE_TURN_STATE, String(n + 1));
  }
  turnsPlayed += 1;
  // The CLI's compaction: PreCompact, the stream's compact_boundary frame,
  // then SessionStart(compact), whose stdout becomes context (echoed here).
  const compactNow = () => {
    runHooks("PreCompact", { trigger: "auto" });
    out({ type: "system", subtype: "compact_boundary", session_id: "fake-session", compact_metadata: { trigger: "auto", pre_tokens: 190_000 } });
    const context = runHooks("SessionStart", { source: "compact" });
    if (context.trim()) replyParts = [`${context.trim()}\n\n${replyParts[0] ?? ""}`, ...replyParts.slice(1)];
  };
  // FAKE_CLAUDE_COMPACT_AT=tool plays it while the first scripted tool call
  // is in flight (after its tool_use, before its tool_result).
  const compactMidTool = process.env.FAKE_CLAUDE_COMPACT === "1" && turnsPlayed >= 2 && process.env.FAKE_CLAUDE_COMPACT_AT === "tool";
  if (process.env.FAKE_CLAUDE_COMPACT === "1" && turnsPlayed >= 2 && !compactMidTool) compactNow();
  const usage = { input_tokens: 10, cache_read_input_tokens: 2, output_tokens: 5 };
  if (scriptedToolCalls) {
    // scripted calls come first, each settled before the reply text
    // A call with `parent` is a sub-agent's (parent_tool_use_id); the
    // parent's own result waits until its sub-agent's calls are done, the
    // way an Agent call settles after the work it started.
    let compactPending = compactMidTool;
    const failureContext: string[] = [];
    const settle = (call: ScriptedToolCall, id: string) => {
      if (compactPending) { compactPending = false; compactNow(); }
      out({ type: "user", ...(call.parent ? { parent_tool_use_id: call.parent } : {}), message: { content: [{ type: "tool_result", tool_use_id: id, is_error: !call.ok, content: call.output }] } });
      if (!call.ok) {
        // Claude Code 2.1.296 runs only PostToolUseFailure for a failed call, with the result text as `error`.
        const printed = runHooks("PostToolUseFailure", { tool_name: call.name, tool_input: call.input, error: call.output, tool_use_id: id });
        try {
          const context = JSON.parse(printed)?.hookSpecificOutput?.additionalContext;
          if (typeof context === "string" && context) failureContext.push(context);
        } catch {}
      } else {
        runHooks("PostToolUse", { tool_name: call.name, tool_input: call.input, tool_response: call.output, tool_use_id: id });
      }
    };
    const waiting = new Map<string, ScriptedToolCall>();
    scriptedToolCalls.forEach((call, index) => {
      const id = call.id ?? `tu-${process.pid}-${++toolUseCount}`;
      out({ type: "assistant", ...(call.parent ? { parent_tool_use_id: call.parent } : {}), message: { content: [{ type: "tool_use", id, name: call.name, input: call.input }], usage } });
      if (scriptedToolCalls.slice(index + 1).some((later) => later.parent === id)) waiting.set(id, call);
      else settle(call, id);
      for (const [parentId, parent] of waiting) {
        if (!scriptedToolCalls.slice(index + 1).some((later) => later.parent === parentId)) {
          waiting.delete(parentId);
          settle(parent, parentId);
        }
      }
    });
    if (failureContext.length) replyParts = [`${failureContext.join("\n")}\n\n${replyParts[0] ?? ""}`, ...replyParts.slice(1)];
    for (const text of replyParts) out({ type: "assistant", message: { content: [{ type: "text", text }], usage } });
  } else {
    replyParts.forEach((text, index) => {
      const content: Array<
        { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
      > = [{ type: "text", text }];
      if (index === replyParts.length - 1) content.push({ type: "tool_use", id: defaultToolId, name: "Bash", input: { command: "echo hi" } });
      out({ type: "assistant", message: { content, usage } });
    });
    if (mode === "tool-heartbeat") {
      // Claude Code 2.1.306 sends this every 30 s while a tool runs.
      out({ type: "tool_progress", tool_use_id: `${defaultToolId}-heartbeat-0`, tool_name: "Bash",
        parent_tool_use_id: defaultToolId, elapsed_time_seconds: 30, heartbeat: true });
    }
    out({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: defaultToolId, is_error: false, content: [{ type: "text", text: "hi" }] }] } });
    runHooks("PostToolUse", { tool_name: "Bash", tool_input: { command: "echo hi" }, tool_response: "hi", tool_use_id: defaultToolId });
  }

  // total_cost_usd is the process's running total (2.1.282: "read the latest
  // result rather than summing across results"); usage is this turn's own.
  const finish = () => {
    // anything steered in was taken in before this turn's result
    replaySteered();
    runHooks("Stop", { stop_hook_active: false });
    runningCost.total = Number((runningCost.total + 0.01).toFixed(2));
    const counted = (runningCost.modelUsage[model] ??= { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0 });
    counted.inputTokens += 10;
    counted.cacheReadInputTokens += 2;
    counted.outputTokens += 5;
    counted.costUSD = Number((counted.costUSD + 0.01).toFixed(2));
    if (costStateFile) writeFileSync(costStateFile, JSON.stringify(runningCost));
    const queued = process.env.FAKE_CLAUDE_QUEUED_TURN_COUNT;
    out({
      type: "result",
      is_error: false,
      stop_reason: "end_turn",
      total_cost_usd: runningCost.total,
      usage: { input_tokens: 10, cache_read_input_tokens: 2, output_tokens: 5 },
      modelUsage: runningCost.modelUsage,
      ...(queued === "zero" ? { queued_turn_count: 0 } : queued === "count" ? { queued_turn_count: lateSteers.length } : {}),
    });
    turnRunning = false;
    finishIfDone();
  };
  if (mode === "background-result") {
    // Claude can emit a synthetic result when a background task finishes.
    // It does not complete the user turn currently waiting on permission.
    out({ type: "result", origin: { kind: "task-notification" }, is_error: false, total_cost_usd: 99 });
    out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "parent still working" } } });
    const poll = setInterval(() => {
      if (!process.env.FAKE_CLAUDE_FINISH_GATE || !existsSync(process.env.FAKE_CLAUDE_FINISH_GATE)) return;
      clearInterval(poll);
      finish();
    }, 10);
    return;
  }
  if (mode === "slow") {
    // a gap a test can steer into; the closing reply carries anything that
    // was folded in, the way the real CLI includes a mid-turn message in
    // the same turn's next model call
    let heldToolId: string | undefined;
    if (process.env.FAKE_CLAUDE_HOLD_AFTER_TOOL) {
      // emit tool_use and wait: interrupt must abort this in-flight call
      heldToolId = `tu-${process.pid}-${++toolUseCount}`;
      const held = process.env.FAKE_CLAUDE_HOLD_TOOL ? JSON.parse(process.env.FAKE_CLAUDE_HOLD_TOOL) as { name?: string; input?: unknown } : {};
      out({ type: "assistant", message: { content: [{ type: "tool_use", id: heldToolId, name: held.name ?? "Bash", input: held.input ?? { command: "sleep 30" } }] } });
    }
    const finishSlowTurn = () => {
      if (heldToolId) {
        out({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: heldToolId, is_error: false, content: [{ type: "text", text: "late-tool" }] }] } });
      }
      if (process.env.FAKE_CLAUDE_SLOW_TAIL_TOOL) {
        // one more tool call before the reply: a fold seam the harness sees
        // AFTER a steer that this turn's stdin drain had already passed by
        const id = `tu-${process.pid}-${++toolUseCount}`;
        out({ type: "assistant", message: { content: [{ type: "tool_use", id, name: "Bash", input: { command: "echo tail" } }] } });
        out({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, is_error: false, content: [{ type: "text", text: "tail" }] }] } });
      }
      const tail = steered.length ? ` + steered: ${steered.join(" | ")}` : "";
      replaySteered();
      out({ type: "assistant", message: { content: [{ type: "text", text: `reply to: ${promptText(prompt)}${tail}` }] } });
      // a finish gate that reads "fail" ends the turn as an engine error
      const gate = process.env.FAKE_CLAUDE_SLOW_FINISH_GATE;
      if (!lateContinuation && gate && readFileSync(gate, "utf8").trim() === "fail") {
        out({ type: "result", is_error: true, stop_reason: "error", result: "fixture turn failed" });
        turnRunning = false;
        finishIfDone();
        return;
      }
      finish();
    };
    // a late steer's turn holds on its own gate, so a test can look at the
    // harness while the CLI is still working on the words it steered
    // FAKE_CLAUDE_GATE_DIR: a prompt carrying [gate:NAME] holds until
    // <dir>/NAME exists, so a test can finish several turns in any order.
    const gateDir = process.env.FAKE_CLAUDE_GATE_DIR;
    // A parallel brief quotes earlier turns under "Recent lines" and puts
    // this request after "Request:". Only this request's [gate:NAME] holds
    // the turn; a quoted gate from the parent would deadlock both.
    const whole = promptText(prompt);
    const requestAt = whole.lastIndexOf("\nRequest:\n");
    const region = requestAt >= 0 ? whole.slice(requestAt) : whole;
    const marker = gateDir ? [...region.matchAll(/\[gate:([\w-]+)\]/g)].at(-1)?.[1] : undefined;
    const finishGate = marker && gateDir ? join(gateDir, marker)
      : lateContinuation ? process.env.FAKE_CLAUDE_LATE_STEER_GATE : process.env.FAKE_CLAUDE_SLOW_FINISH_GATE;
    if (finishGate) {
      const poll = setInterval(() => {
        if (!existsSync(finishGate)) return;
        clearInterval(poll);
        // The steer is already in our stdin pipe when the gate appears — the
        // server flushes it before answering the request that lets the test
        // drop the gate. But this is a timer, and timers run BEFORE the poll
        // phase that reads the pipe, so finishing here can close the turn
        // with the steer unread; it would then open a second turn. Hand off
        // to the check phase, which runs after the read.
        setImmediate(finishSlowTurn);
      }, 10);
    } else {
      setTimeout(finishSlowTurn, 800);
    }
  } else {
    finish();
  }
};

let buf = "";
process.stdin.on("data", (c) => {
  buf += c;
  let nl;
  while ((nl = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    if (!line.trim()) continue;
    let prompt: JsonValue = null;
    try {
      prompt = JSON.parse(line);
    } catch {
      continue;
    }
    // The control request `initialize` lists the slash commands and starts
    // no turn (server/drivers/harness-command-probe.ts).
    // FAKE_CLAUDE_COMMANDS: path of a JSON array of commands to answer with.
    // FAKE_CLAUDE_COMMANDS_DUMP: path to write {argv, cwd, env} of that
    // launch (env: the account and connector switches only, no secret).
    // FAKE_CLAUDE_COMMANDS_LOG: path to append that same line to (one per
    // launch). A `fake-commands.json` in CLAUDE_CONFIG_DIR adds that
    // account's own commands (its user skills and plugins).
    const control = prompt && typeof prompt === "object" && !Array.isArray(prompt) ? prompt as Record<string, any> : null;
    if (control?.type === "control_request" && control.request?.subtype === "initialize") {
      const probe = JSON.stringify({ argv, cwd: process.cwd(), env: { CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR ?? null, ENABLE_CLAUDEAI_MCP_SERVERS: process.env.ENABLE_CLAUDEAI_MCP_SERVERS ?? null } });
      if (process.env.FAKE_CLAUDE_COMMANDS_DUMP) writeFileSync(process.env.FAKE_CLAUDE_COMMANDS_DUMP, probe);
      if (process.env.FAKE_CLAUDE_COMMANDS_LOG) appendFileSync(process.env.FAKE_CLAUDE_COMMANDS_LOG, `${probe}\n`);
      const accountCommands = process.env.CLAUDE_CONFIG_DIR ? join(process.env.CLAUDE_CONFIG_DIR, "fake-commands.json") : "";
      const commands = [
        ...(process.env.FAKE_CLAUDE_COMMANDS ? JSON.parse(readFileSync(process.env.FAKE_CLAUDE_COMMANDS, "utf8")) : [{ name: "compact", description: "Compact", argumentHint: "", builtin: true }]),
        ...(accountCommands && existsSync(accountCommands) ? JSON.parse(readFileSync(accountCommands, "utf8")) : []),
      ];
      out({ type: "control_response", response: { subtype: "success", request_id: control.request_id, response: { commands } } });
      continue;
    }
    // #1373: set_permission_mode changes the running process's mode.
    // FAKE_CLAUDE_PERMISSION_LOG: path to append each mode to.
    // FAKE_CLAUDE_REFUSE_PERMISSION_MODE=1: answer with an error.
    if (control?.type === "control_request" && control.request?.subtype === "set_permission_mode") {
      if (process.env.FAKE_CLAUDE_PERMISSION_LOG) appendFileSync(process.env.FAKE_CLAUDE_PERMISSION_LOG, `${String(control.request.mode)}\n`);
      out(process.env.FAKE_CLAUDE_REFUSE_PERMISSION_MODE === "1"
        ? { type: "control_response", response: { subtype: "error", request_id: control.request_id, error: "refused" } }
        : { type: "control_response", response: { subtype: "success", request_id: control.request_id, response: { mode: control.request.mode } } });
      continue;
    }
    if (turnRunning || lateTurnWaiting) {
      // folded into the running turn, unless it landed after that turn's
      // last model call — then the real CLI queues it for the next turn,
      // behind any queued message whose turn has not been announced yet
      if (process.env.FAKE_CLAUDE_LATE_STEER_GATE) lateSteers.push(prompt);
      else {
        steered.push(promptText(prompt));
        steeredMessages.push(prompt);
      }
      // the model reads the steered words and calls a tool about them
      const steerText = JSON.stringify(prompt);
      const onSteer = (fakeMcpCalls ?? []).filter((call) => call.onSteer && (!call.when || steerText.includes(call.when)));
      if (onSteer.length) {
        const handle = /route ([\w-]+):/.exec(steerText)?.[1] ?? "";
        void runFakeMcpCalls(onSteer.map((call) => ({
          ...call,
          arguments: Object.fromEntries(Object.entries(call.arguments).map(([key, value]) => [key, value === "$ROUTE_HANDLE" ? handle : value])),
        })), argAfter("--mcp-config")).catch(() => {});
      }
      if (process.env.FAKE_CLAUDE_STEER_RECEIVED) writeFileSync(process.env.FAKE_CLAUDE_STEER_RECEIVED, "received");
    } else {
      playTurn(prompt);
      armSteerGate();
    }
  }
});
process.stdin.on("end", () => {
  stdinEnded = true;
  finishIfDone();
});
