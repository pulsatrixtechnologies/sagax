# Connectors hub: measures of the provider CLIs (L0)

Issue #3343, part of #3286 (a bot on any engine calls any connector of the
person). This note settles the points of the design that could not be read
from code alone (M1 to M8), on the real CLIs signed in on one test machine,
2026-11-10. The captures are under `server/testing/fixtures/connectors/`,
scrubbed of every name, address, identifier and text of the account; only
the shapes are kept. `server/testing/connector-fixtures.test.ts` replays each
one through the fakes (`fake-claude-cli.ts`, `fake-acp-cli.ts`,
`fake-codex-app-server.ts`) and checks the scrub.

CLIs measured: Claude Code 2.1.322, grok 1.0.77, codex-cli 0.166.0. The pins
in `engines.lock.json` are older (claude 2.1.318, grok 1.0.46, codex 0.160.0):
the hosts of L7, L9 and L10 should run on the measured versions or newer, and
the launch contract of L11 should check that.

How it was read: account reads only. At most one harmless read per provider
went to a connector (Claude: a mail connector's granted scopes; Grok: a public
documentation lookup; Codex: a mail connector's category list). No token was
printed or stored, no credential file was opened, no write was sent. One
extra read happened by accident and is reported under M5.

## Claude

**M1. One pinned call.** `claude -p --model haiku --output-format stream-json
--verbose --tools ToolSearch --allowedTools ToolSearch,<tool> --permission-mode
dontAsk` with tool search on and no strict flag, prompt "Call the tool X
exactly once with this input JSON, then stop" (the runner of
`server/claude-artifacts/runner.ts`). Fixture `claude-pinned-call.jsonl`.

- The tool id is `mcp__claude_ai_<Service_with_underscores>__<tool>`, for a
  connector the CLI lists as `claude.ai <Service>`.
- The connector tools are deferred: the model first calls `ToolSearch` with
  `select:<tool id>` (its result is a `tool_reference`), then the tool.
- The tool use frame carries `tool_use_meta`: `server_display_name` (the
  service, without "claude.ai "), `tool_name` (the bare tool), `display_name`,
  `server_id`. The result frame carries the tool's own content and
  `tool_use_result`, and `tool_result_meta.permission_decision`.
- `parseClaudeArtifactStream` reads the result as it is: the Claude host can
  share it.
- Time: 6.2 s from a cold start to exit, 5.4 s inside the CLI, first token at
  1.7 s. Three model rounds (ToolSearch, call, a closing sentence), about 23k
  tokens, almost all cache. Cost 0.0025 USD on the small model.

**M2. Checking the input before the tool runs.** `--permission-mode default
--permission-prompt-tool mcp__<server>__<tool>` in `-p` mode, measured with a
local MCP server (no account). Fixtures `claude-permission-allow.jsonl`,
`claude-permission-deny.jsonl`, `claude-permission-log.json`.

- The prompt tool is called before the tool with `{tool_name, input,
  tool_use_id}`, the input exactly as the model wrote it.
- `{"behavior":"allow","updatedInput":...}` runs the tool once.
- `{"behavior":"deny","message":...}` leaves the tool uncalled; the model gets
  a tool result with `is_error: true` and the message, the result frame lists
  the call under `permission_denials`, and the model did not retry.
- So the Claude host can compare the model's input with the approved call and
  refuse a deviation before anything runs. The same path applies to a
  claude.ai connector tool (any tool not pre-allowed goes through it); that
  was not run on a connector, to keep to one connector read.

**M3. `claude mcp serve`.** Run on a scratch config directory whose user
config has one local MCP server. Fixture `claude-mcp-serve.json`. It serves
Claude Code's own 23 tools (`Bash`, `Read`, ...) and none of the configured
server's. It is not a way to call a connector without a model.

**M8. Which launch loads which servers.** Fixture
`claude-connector-reach.json`, read from `init.mcp_servers` (and the deferred
tool count when init left them out) over 36 launches on a signed-in config
directory.

- No flag, or `--setting-sources user,project`: the claude.ai connectors and
  the account's own Claude Code servers load (7 of 7).
- `--strict-mcp-config`, or `ENABLE_CLAUDEAI_MCP_SERVERS=false`: no claude.ai
  connector, ever. The variable alone keeps the user config servers.
- `--setting-sources project`: claude.ai connectors loaded in 1 launch of 11.
  `--setting-sources ""`: 3 of 12. When they load, init lists them as
  `pending` or not at all.
- Answer to M8: the CLI has no notion of the Sagax speaker. A launch with
  neither switch on the machine's config directory carries the operator's
  claude.ai connectors and servers whoever speaks, so design 1.4 d holds when
  the launch keeps user settings.
- New finding, reported and not changed here (no product code in L0): the
  isolated Claude turn passes `--setting-sources project`
  (`server/drivers/claude/turn-prepare-args.ts`), so on 2.1.322 the native
  claude.ai shortcut of the person's own Claude turn is mostly absent, and the
  user config servers of the solo switch too. The Claude host of L9 must not
  launch with `--setting-sources project` or `""`; L2 or L13 should settle the
  native turn.

## Grok

**M4. The ACP surface, on `grok --permission-mode default agent --no-leader
stdio` with both `GROK_MANAGED_*` variables true.**

- `initialize` (fixture `grok-initialize.json`): auth methods `xai.api_key`,
  `cached_token`, `grok.com`; `agentCapabilities` with `loadSession`,
  `mcpCapabilities` http and sse; `_meta` with `agentVersion`, `x.ai/mcp/sdk`.
  It names no method list.
- `_x.ai/mcp/list` (fixture `grok-gateway-list.json`): settled in about 3 s.
  The gateway is two servers, `managed_gateway:cursor` (every connector, 561
  tools on the measured account) and `managed_gateway:tasks` (Grok's own
  automations, 10 tools). Each tool object has `name`, `displayName`,
  `description`, `enabled`, and **no input schema**. Names keep the shape
  `cursor__user-<Connector>-<tool with _5f for _>___<n>`.
- One pinned `use_tool` (fixture `grok-pinned-use-tool.json`), prompt "Call
  the tool use_tool exactly once with tool T and this input JSON", model
  `grok-4.7-build-fast`: a `tool_call` (title `use_tool`, `rawInput {tool_name,
  tool_input}`), a pending `tool_call_update`, then
  `session/request_permission` whose `rawInput` is `{variant: "UseTool",
  tool_name, tool_input}` with options `always-allow`, `allow-once`,
  `reject-once`. After `allow-once`, a `tool_call_update` with `status` and
  `rawOutput {type: "MCP", tool_name, server_name, output, is_error}`. The
  measured call ended `failed`: the provider refused the arguments (a required
  field the model could not know, since the list gives no schema), which is
  the risk of design 4.7 seen live. `session/cancel` right after the result
  ends the prompt `cancelled` within 50 ms, with the usage in `_meta`.
- Time: 5.7 s from the prompt to the result, 2.3 s of it after the ask; one
  model call, about 30k tokens (Grok's base context).
- **No-model call.** `_x.ai/mcp/call {sessionId, server, tool, arguments}`
  exists on 1.0.77 (fixture `grok-mcp-call.json`). It calls a tool of a server
  mounted on the session with no model turn and no permission request. The
  managed gateway servers are not among its servers under any name tried
  (`managed_gateway:cursor`, `cursor`, the display names, ...): "server not
  found". So the Grok host still needs one model round for a gateway tool.

**M5. Workflows and `host.mcp.call`.** The ACP session Sagax starts
(`agent --no-leader stdio`) runs the shell route: its tools are `use_tool` in
namespace `grok_build`, workflows there are Rhai, and the user guide offers
`host.mcp` on the daemon route only. A headless `grok -p '/<workflow>'` with a
JavaScript workflow in a trusted scratch repository did not start it: the
slash went to the model (168 s), which reported that the session has no
`Execute` cell nor `host.mcp`. Answer: not reachable from the routes Sagax
uses; the daemon route was not measured. Incident: in that headless run the
model also called one read tool of the gateway on its own (a listing of a
connected service's APIs) with no ask, under the default permission mode of
`grok -p`. Nothing was written. The Grok host must keep `agent --no-leader
stdio` in `default` mode, where every gateway call asks (M4).

## Codex

**M6. The app-server on a ChatGPT sign-in.** `initialize` with
`experimentalApi`, `thread/start {cwd, ephemeral: true}`, no turn. Fixtures
`codex-thread-start.json`, `codex-mcp-server-status.json`,
`codex-tool-call.json`.

- `mcpServerStatus/list {detail: "toolsAndAuthOnly"}` answers in under 100 ms.
  The ChatGPT apps are one server, **`codex_apps`** (`authStatus`
  `bearerToken`, `serverInfo.name` `plugin-runtime`), with `tools` as a map
  keyed by the tool name (`<connector>.<tool>`, 286 tools of 11 connectors on
  the measured account). Each tool has a full `inputSchema`, `annotations`
  (`readOnlyHint`, `destructiveHint`, `openWorldHint`) and the connector in
  `_meta` (`connector_id`, `connector_name`, `link_id`).
- `mcpServer/tool/call {server: "codex_apps", threadId, tool, arguments}` ran
  the call with no model turn (no `turn/start`) and Codex sent the client **no
  approval request**, with the thread's approval policy `on-request`. The
  measured read came back as the provider's own error: `isError: true`,
  `content` text and `structuredContent {error, error_code}`. Time 1.4 s.
- `app/list` lists every app of the catalogue (5021, 8 of them accessible) and
  takes about 30 s: the registry should read `mcpServerStatus/list`.
- Answer: the ChatGPT apps can be listed and called from the app-server with
  no model, with real schemas. L10 can go ahead. Since Codex asks nothing for
  a client call, the decision of design P5 (one held request in the calling
  turn) is the only one, as designed.

**M7. Does a Codex turn already carry the apps?** Yes. A thread started on
the default `CODEX_HOME` of a ChatGPT sign-in lists `codex_apps` before any
turn, and Sagax turns the `apps` feature off only for background calls
(`server/drivers/codex-background-text.ts`). A model turn was not run.

## What the next lots can rely on

- Claude host (L9): the runner's argv with the account's connectors on means
  no `--strict-mcp-config`, no `ENABLE_CLAUDEAI_MCP_SERVERS=false`, and user
  settings kept (no `--setting-sources project` or `""`); the
  `--permission-prompt-tool` check rejects a deviating input before it runs;
  the result is read from the stream with `parseClaudeArtifactStream`.
  `FAKE_CLAUDE_CONNECTOR_REPLAY` and `FAKE_CLAUDE_CONNECTOR_REACH` replay the
  frames and the measured reach.
- Grok host (L7): one model round through `use_tool` in `default` mode; the
  ask carries the exact tool and input; cancel after the result. No input
  schema before the first call. `FAKE_ACP_MODE=connector-replay` with
  `FAKE_ACP_CONNECTOR_REPLAY`, `FAKE_ACP_INITIALIZE_REPLAY`,
  `FAKE_ACP_MCP_LIST_FILE` and `FAKE_ACP_MCP_CALL=1` replay it.
- Codex host (L10): `thread/start`, `mcpServerStatus/list`,
  `mcpServer/tool/call` on `codex_apps`, no turn, no ask.
  `FAKE_CODEX_CONNECTOR_REPLAY=<fixtures folder>` replays it.
- Not measured: a successful Grok gateway result (`status: completed`), a
  refused Grok ask (the fake ends the prompt with no result, as a guess), a
  claude.ai connector behind the permission prompt tool, the Grok daemon route.
