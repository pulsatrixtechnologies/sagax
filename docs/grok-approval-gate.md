# Grok approval gate (Sagax gates MCP calls; Grok runs in default mode)

## Why
In `--permission-mode auto`, Grok runs its safety classifier before **every** MCP tool call. On production this measured 4–9 s (up to 17 s, and once an approval card for the read-only `agents__list_bots`) for tools that answer in under 0.5 s. Allow rules do not skip it over ACP (repro below). In `default` mode Grok runs MCP tools supplied by the ACP client with no prompt at all, so Sagax gates them itself.

## How it works
- **Default:** on for every bot since 2026-10-19 (engine parity: Approve for me decides through Sagax on Grok as on Claude since #797, so the owner's setup #820 and the member rules apply the same way).
- **Opt-out:** `DATA_DIR/grok-approval-gate.json`, either `{"off": ["<botId>"]}` or `{"bots": "none"}`. Those bots' Auto turns run Grok's own auto mode. A missing, empty or invalid file means on; the earlier opt-in list `{"bots": [...]}` no longer narrows anything. The file is read on every turn; the next turn of each bot respawns Grok in the new mode.
- **Scope:** only Auto turns (`approvalMode: "auto"`, not Full access). Ask, Edits and Full access are unchanged.
- **When the flag is on:**
  - Grok starts with `--permission-mode default`. Its built-in tools prompt through ACP and each prompt is a card (the classifier no longer answers them); on an organization server they are withheld anyway.
  - A solo turn whose Grok config (`$GROK_HOME/config.toml` or the project's `.grok/config.toml`) declares `[mcp_servers.*]` keeps Grok's own auto mode: Sagax does not mount those servers, so the gate could not hold their calls.
  - The xAI account's cloud connectors load only when host tools are withheld (an organization turn): Grok reaches them through `use_tool`, and a server Sagax did not mount keeps its card. A solo turn forces `GROK_MANAGED_MCPS_ENABLED=false`, because `default` mode can call those servers with no prompt. Gateway tools stay off. A tool selection turns the connectors off too.
  - Every MCP server, built-in or not, is mounted through `mcp-gate` with an approval socket (`server/mcp-gate-approval.ts`).
  - Only reviewed read-only tools run unasked:
    - agents: `READ_ONLY_AGENT_TOOL_NAMES`
    - harness-spawned Perspicax bridges: `PERSPICAX_READ_ONLY_TOOLS`
  - Every other call, including unknown, new and third-party tools, waits for a canonical approval card. A server's own `readOnlyHint` is ignored.
- **Fail closed:** a decline, the 15 min timeout, a stopped turn, no running turn, a closed or unreachable socket, an answer other than an explicit allow, a corrupt config, and JSON-RPC batches or unreadable frames all mean the call never reaches the server.
- **No replay:** each call is its own card. An "always" answer is not reused.

## Rollback
Add the bot to `"off"` in the flag file (or write `{"bots": "none"}`). That needs no deploy.

## Grok bug: allow rules do not skip the auto classifier over ACP
xAI has no public issue tracker (`xai-org/grok-build` has issues disabled), so the repro lives here.

**Docs claim** (user guide 22-permissions-and-safety, "How a tool call is authorized"): rules (`--allow`, `[permission] allow`) are evaluated before the mode's prompt policy, where the auto classifier runs.

**Observed** with grok 1.0.46 (server) and 1.0.50 (Mac), `grok --permission-mode auto [rules] agent stdio`:
1. The client is `initialize` with `clientInfo: {name: "openmausbot"}`.
2. `session/new` passes one stdio MCP server `clock` with one tool, `query_time`.
3. The prompt is "call clock__query_time once".

The classifier gap is the time between `pending_interaction kind=permission` and `interaction_resolved`:

| Mode / rule | Gap | Card |
|---|---|---|
| auto, no rule | 4.5 s | none |
| auto, `--allow 'MCPTool(clock__query_time)'` | 7.9 s | none |
| auto, project `.grok/config.toml` `[permission] allow = ["MCPTool(clock__query_time)"]` | 6.7 s | none |
| auto, `--allow MCPTool` | 7.3 s | none |
| auto, `--allow mcp__clock__query_time` | 6.1 s | none |
| auto, `--allow '*'` | 6.8 s | none |
| default, any rule or none | 0 s | none (the tool runs) |

On production, the live ACP wire log shows `pending_interaction` for `agents__list_bots` from 00:25:43.001 to 00:25:51.474 UTC, with `--allow MCPTool(agents__list_bots)` on argv.

PreToolUse hooks cannot pre-approve: per the docs, a hook "allow" only means "not blocked".

## Production finding: Grok's `use_tool` ask (2026-10-11)

The first live gated turn (Cryptic, thread 84c81700…, 2026-10-12T01:04Z)
showed that with many MCP tools mounted (158 in production) Grok defers them
behind its `use_tool` meta tool, whose `_meta["x.ai/tool"].read_only` is
false. In `default` mode Grok therefore sends `session/request_permission`
for every MCP call, reads included:

```json
{"toolCall":{"kind":"other","title":"agents__list_bots",
  "rawInput":{"variant":"UseTool","tool_name":"agents__list_bots","tool_input":{}},
  "_meta":{"x.ai/tool":{"name":"use_tool","kind":"use_tool","read_only":false}}},
 "options":[{"optionId":"always-allow","kind":"allow_always"},
            {"optionId":"allow-once","kind":"allow_once"},
            {"optionId":"reject-once","kind":"reject_once"}]}
```

The local repro had a handful of tools, so Grok called them directly and never
asked. On a gated turn the driver now answers that ask **allow once** (never
always) only when every name in it resolves to one of the turn's gated mounts
(`server/drivers/acp/gated-mcp-ask.ts`): the call then reaches the MCP gate,
which runs it only if it is a reviewed read and otherwise holds it for the
person's card. Built-in tools, commands, file changes, unmounted servers and a
`use_tool` without a target keep their card.
