# Connectors across engines: design and decision (issue #3286)

Study date: 2026-11-10. Read-only study of main at commit 830da5d9. Lot L1 (#3344) added this file to the repository and built the registry of part P1.

## How to read the marks

- [code]: read in origin/main at that commit. File and line are given.
- [cli]: read from the `--help`, the bundled user guide or the generated protocol schema of a CLI installed on the study machine: Claude Code 2.1.322, grok 1.0.77, codex-cli 0.166.0, cursor-agent 2026.11.05. No sign-in was made, no credential file was read, no account was called. The Gemini, Kimi, Qwen, Droid, OpenCode, Copilot, Cline and Hermes CLIs were not installed on the study machine.
- [docs]: public documentation as I know it, not read again for this study.
- [not verified]: could not be established here. Lot 0 says how to settle it.
- [estimate]: my estimate, to be measured in lot 0.

## 0. Decision

1. A person's connectors belong to the person, not to the engine of the turn. Sagax keeps one registry of them per person, whatever provider brings them (claude.ai, grok.com, ChatGPT).
2. Every bot, on every engine, gets two Sagax tools in the `agents` server it already has: `connectors` (the one list, find a tool, read its arguments) and `call_connector` (call any tool of any connector). They are ordinary tool calls and show in the bot's chat like any tool.
3. The Sagax server runs the call on the person's own sign-in of the provider that has the connector, through one small "connector host" per provider. Codex's app-server calls the tool directly, with no model. Grok and Claude run one pinned call through a short process of their own CLI (one small model round). This is the pattern the `claude_artifact` tool already uses in production.
4. The decision to run a call is taken once, in the calling bot's own turn, by the existing approval pipeline (`request.opened`), with the provider's own tool id and the same facts as a native connector call. No new card type and no new confirmation.
5. The native mounts that work today stay as a faster shortcut (claude.ai connectors on the person's own Claude turn, grok.com connectors on a Grok turn of a bot that opted in). The hub is the guarantee: it never depends on the engine of the turn.
6. One blocking matrix test (engine of the bot by provider of the connector, on the existing fakes) and one live check at every release keep it from coming back. The keyword engine switch and the relay hint are retired once the matrix is green.

Shortest argument: every past break came from deciding connector reach inside each engine's own launch flags, read by fourteen places, plus a cross-engine path that was only advice to a model. Moving the call into one Sagax tool served by one registry removes both causes, and it leaves the bot's own engine process free of any provider gateway, which is what issue #2747 asked for.

## 1. Today

### 1.1 The rule

"Speaker pays, speaker connects": a turn keeps connectors only when it runs on the speaker's own subscription (server/harness-connectors.ts:19-24) [code].

Whose connectors: `connectorPrincipalFor` (server/harness-connectors.ts:65-75). A conversation uses its speaker's, a routine its bot owner's, an unknown person nobody's, and on a solo server an unnamed person is the operator [code].

Whose account: `accountConnectorsForTurn` (server/harness-connectors.ts:108-117) answers "none" when a managed policy restricts MCP or the driver is not one of `claudeAgent`, `grokAgent`, `grok` (line 96 and line 109). On an organization server it answers "none" unless the access is `subscription` (line 112), "foreign" when the payer is not the person the turn is for (line 113). On a solo server it answers "own" only for the local operator (line 116) [code].

### 1.2 What each engine gets

Claude (driver `claudeAgent`).
- Gets the claude.ai connectors of the account the turn runs on, as MCP servers named "claude.ai <Service>", tools prefixed `mcp__claude_ai_` (server/harness-connectors.ts:5-9) [code].
- Conditions: `claudeAiConnectorsForTurn` is true, which means the account is the person's own (server/harness-connectors.ts:121-123), and in the driver the turn is not a guest's confined turn and has no tool selection (server/drivers/claude/turn-prepare-args.ts:194). Then the driver does not pass `--strict-mcp-config` (turn-prepare-args.ts:222) and does not set `ENABLE_CLAUDEAI_MCP_SERVERS=false` (server/drivers/claude/turn-prepare-mcp.ts:301). In every other case both are set and the turn has none [code].
- Their tools are never pre-allowed: each call rides the approval flow (AGENTS.md:8035-8036) [code].
- Solo server, a second switch: `claudeUserMcpEnabled` is on by default on a solo server (server/config.ts:1357-1359) and is passed as `mcpFromUserConfig` on every turn (server/turns/start-turn-dispatch.ts:215, server/turns/group-member-turn-launch-dispatch.ts:303). With it the driver also skips `--strict-mcp-config` and the environment switch (turn-prepare-args.ts:199 and 222, turn-prepare-mcp.ts:301). So on a solo server a Claude turn without a tool selection loads the machine's own Claude Code MCP servers and its claude.ai connectors whoever the speaker is, while the prompt of a turn that is not the operator's says they belong to someone else (server/harness-connectors.ts:205-207) [code, not verified at runtime].

Grok CLI (driver `grokAgent`).
- Gets the grok.com connectors of the xAI account through xAI's managed MCP gateway, as `use_tool` targets (shared/grok-cloud-connectors.ts:45-57) [code].
- Conditions: `grokCloudConnectorsForTurn` (server/harness-connectors.ts:130-145): the bot opted in (`grokAccountConnectors`, a bot setting that is off by default) or the turn is a `run_with_engine` part (`engineRelay`), and the driver is `grokAgent`, and the account is the person's own. In the driver there must be no tool selection (server/drivers/acp/grok.ts:184-197 and 202-204). Then `GROK_MANAGED_MCPS_ENABLED` and `GROK_MANAGED_MCP_GATEWAY_TOOLS_ENABLED` are both "true" (grok.ts:196 and 1124-1126). Otherwise both are "false" [code].
- Every bot turn runs on an isolated Grok home with none of the person's own MCP servers (server/drivers/acp/grok.ts:1115-1119, server/drivers/acp/grok-mcp-isolation.ts:45-47) [code].
- A turn that loads the connectors never runs Grok's own auto or bypass mode, so every call asks Sagax (grok.ts:223-230) [code].
- Result by default: a Grok bot has no grok.com connector in its own turn.

Grok API (driver `grok`, chat completions). None. Only the CLI loads them (server/harness-connectors.ts:141-144) [code].

Codex (driver `codex`).
- Sagax mounts none and announces none (server/harness-connectors.ts:26-30). The person's page answers `codex: not_supported` (server/harness-connectors.ts:405) [code].
- A Codex turn on the person's own `codex login` runs on that `CODEX_HOME` (server/drivers/codex/launch-args.ts:93-98). Sagax does not turn Codex's `apps` feature off on ordinary turns (server/drivers/codex-tool-surface.ts:8-20; it is turned off only for background calls, server/drivers/codex-background-text.ts:62-66), and the driver knows how to answer the access form of "Codex's own ChatGPT apps" (server/drivers/codex/tools.ts:120-125, server/drivers/codex/approvals.ts:41-97) [code]. So the ChatGPT apps may already load by themselves on such a turn, unannounced by Sagax [not verified: needs a ChatGPT sign-in].
- On the ChatGPT plan mode (a token passed to a custom provider with an ephemeral credential store, launch-args.ts:42-58) and on API keys they cannot load (server/harness-connectors.ts:26-30) [code].

Gemini, Kimi, Qwen, OpenCode Go, Hermes, Droid, Cursor, Copilot, Cline, DeepSeek, custom ACP, pi, Muse Code, Antigravity, and the API engines (OpenAI compatible, Mistral, MiniMax, Cerebras, Groq, Meta).
- None. `accountConnectorsForTurn` answers "none" for any driver outside the three (server/harness-connectors.ts:96 and 109). The shared table knows two engines only (shared/engine-connectors.ts:20). See also AGENTS.md:8067-8068 and docs/TODO.md:86 [code].
- All of them can mount Sagax's own MCP servers when tools are on: `customMcp` is true for the ACP family (server/drivers/acp/create-instance.ts:315), Claude (server/drivers/claude/instance-api.ts:240), Codex (server/drivers/codex/instance-api.ts:171), Muse Code (server/drivers/muse-code.ts:627), pi (server/drivers/pi.ts:1430) and the chat engines (server/drivers/openai-chat.ts:333) [code].

Boat native. docs/tool-selection.md:79 says meaningful tool restrictions are unsupported. Not studied further [not verified].

### 1.3 What happens when a bot on engine A needs a connector only provider B brings

Four things exist. None of them is a call.

1. The prompt. The section `claude-ai` of the turn prompt (server/turns/start-turn-prompt.ts:191 for a direct turn, server/turns/group-member-turn-launch-prompt.ts:263 for a room) is `engineConnectorsPrompt` (server/harness-connectors.ts:201-215). A turn with none is told its engine brings none. When the relay is offered it is told to call `run_with_engine` (`RELAY_HINT` at line 163, `relayHint` at lines 180-186), with the person's other engines named when known. The named list exists on an organization server only (server/index-leaves/connectorsElsewhereFor.ts:10) and only for a reach already known in memory (lines 21-22 and 35-39) [code].
2. `run_with_engine` (server/run-with-engine.ts:1-13, route server/routes/internal-rooms-engine.ts). The bot hands a sentence to itself on another engine: a fresh thread of the same bot (internal-rooms-engine.ts:104-105), a whole turn there with the bot's persona, and the result text comes back (lines 140-147). It waits up to five minutes and is delivered later past that (lines 117-139). It is refused in a room (line 55, and absent from the room catalog, server/drivers/agents-catalog.ts:343), one hop away (agents-catalog.ts:348-353, and the hint needs `commsDepth === 0`, start-turn-prompt.ts:191), from a part (line 64) and from a confidential thread (line 81). The model must decide to call it [code].
3. The connector switch (server/connector-switch.ts:1-12). Before the turn, when the person's own message holds a mail, calendar, Teams or SharePoint need read from its words (`connectorNeed`, shared/engine-connectors.ts:216-296), the whole turn runs on another engine of the person whose connector is known (server/turns/start-turn-prepare-validate.ts:223-252). Only for a person's own new direct message: never a routine, a peer request, Auto, a card continuation or a room (lines 238-248). Only four capabilities exist (shared/engine-connectors.ts:17). The bot changes model for that turn [code].
4. A teammate bot on that engine, offered in words (server/harness-connectors.ts:214) [code].

So the bot answers that it has no such connector in a room, at a peer hop, for any connector that is not mail, calendar, Teams or SharePoint, on a solo server (no named list), right after a restart (reach not known yet), or whenever the model does not pick the relay tool.

### 1.4 Inconsistencies found in main while reading

All [code], none verified at runtime.

a. Since #2747 the reach of a Grok sign-in is computed through `grokCloudConnectorsForTurn`, which now needs the bot opt-in or the relay flag. `connectorsElsewhereFor` (server/index-leaves/connectorsElsewhereFor.ts:33-34) and `engineReachFor` (server/index-leaves/engineReachFor.ts:24) pass neither. For a bot with default settings the person's Grok accounts are therefore never named in the relay list and never a switch target. PR #3174 fixed the part's own loading in five call sites and not these two.
b. `open_connector_setup` answers a Grok bot "already connected on this person's Grok account, find its tools with search_tool and call them with use_tool" from the account's reach (server/routes/connector-setup.ts:171-175, server/index-leaves/connectorSetupStore.ts:15-28), although that bot's own turn does not load the gateway without the opt-in (server/harness-connectors.ts:143).
c. A room turn with no connector is told "Sagax moves such a request on its own when it finds one" (server/harness-connectors.ts:214), but the switch exists for direct turns only (start-turn-prepare-validate.ts:238-248).
d. Solo Claude: see 1.2.
e. A read of the person's own connector passes with no card at any level only when the ask is marked `accountConnector`, which only the ACP driver does (server/drivers/acp/session-permission.ts:140-141 and 265, server/runtime-events/request-opened.ts:479-480, server/approvals/auto-approve.ts:391-393). The Claude driver never sets it. The approval of the same act already differs by engine.
f. The marker of a relay part is an in-memory map (server/index.ts:17708-17715). After a server restart a part still running or retried is no longer a part and does not load the gateway.
g. Found by L1: `PrincipalEngineLogins.warmReach` had no probe wired on the server (`probeReach` was never passed), so a Grok sign-in's reach stayed unknown until a turn on it loaded the gateway, which a bot with default settings never does. L1 makes the person's own Grok CLI the default probe.

## 2. Why it kept breaking

### 2.1 History, and what was a regression of what

Dates come from `git log` of main and from the issues of this repository.

- 2026-10-01, commit 7c0d39bac1: claude.ai connectors on the speaker's own Claude turns.
- 2026-10-16, hotfix 0.5.10: a claude.ai connector call on a member's bot is the member's card, not an admin's (server/engines/engine-access.ts:185-193).
- 2026-10-22, #943: mail, Teams, calendar and SharePoint through the engines' connectors, and the connector switch. #966: `open_connector_setup`.
- 2026-10-27, #1390: `use_tool` read as the tool it runs on every decision layer.
- 2026-10-28, #1475: the person's Grok connectors reach their Grok turn (the gateway had been forced off on every turn).
- 2026-10-28, #1540: defect of #1475 found the same day. Sagax looked for an `outlook` server while the gateway lists one server `managed_gateway:cursor`, and told a turn that had Teams and Outlook that it had no tool (AGENTS.md:2401-2412).
- 2026-10-28, #1477: `run_with_engine`. 2026-10-29, #1618: two Grok accounts and the named relay list.
- 2026-10-30, #1769: regression of #1475 by an upstream change. xAI stopped fetching the managed configs by default, the gateway variable alone brought nothing, and Outlook and Teams vanished from Grok turns two days after #1475 (AGENTS.md:2500-2511).
- 2026-10-30, #1773: Grok connectors on a solo server.
- 2026-11-03, issue #1930: a member's own Grok connector call waits for an admin. It is the bug of the 2026-10-16 Claude hotfix, back on Grok.
- 2026-11-03, issue #1931, and 2026-11-04, issue #1956: the card and the rows misread gateway tool names. It is #1390 again, for the name shape that #1540 introduced.
- 2026-11-04, issues #1977 and #1982: Codex at Full access refuses every MCP call, then the same class is checked on Claude, Grok, the chat engines and pi.
- 2026-11-04, issue #1943: 403 on the owner's own mailbox. The cause was outside Sagax (tenant consent). It was closed with guidance in the prompt (PR #2150).
- 2026-11-06, issue #2384: regression of the connector paths by multi-account (#2373, #2377). Connectors, reach, the relay and the setup card still read only the first account.
- 2026-11-08, issue #2747: the opposite failure. A Grok bot inherited every MCP server of the person's own config and the account's managed gateway, and a production tool was called. It took four pull requests (#2816, #2844, #2860, #2867): isolated home, gateway off on every bot turn, opt-in per bot.
- 2026-11-08, issue #2749: a connector that needs a new sign-in fails silently in routines.
- 2026-11-09, issue #3170: regression of the fix of #2747 (#2844 and #2860). Since 0.8.66 the relay to Grok no longer loaded the connectors. Fixed by #3174.
- 2026-11-09, issue #3149: defect of the 2026-10-22 design (words decide). The keyword switch moved four Grok bots out of five to Claude on a negated or passing word. Patched with more word rules (#3155).
- 2026-10-26, issue #1132, and 2026-11-06, issue #2306: the pages counted or listed engine connectors from another source than the list they opened.
- 2026-11-09, issue #3223 (QA of 0.8.77): routines still failing after the roll, among them "connecteur absent" and "re-authentification requise".

### 2.2 Causes

A. One fact, fourteen readers. "Which connectors does this turn have, and whose" is computed again in each of these places, with slightly different inputs: server/turns/start-turn-dispatch.ts:221-226; server/turns/group-member-turn-launch-dispatch.ts:309-310; server/index-leaves/engineConnectorsPromptFor.ts:12-17 and 26; server/index-leaves/turnReachPrompt.ts:12-15 and 44-45; server/index-leaves/turnConnectorsFor.ts:10-14 and 44; server/index-leaves/botCapabilitiesAs.ts:58-59 and 154-158; server/index-leaves/connectorsElsewhereFor.ts:17-18 and 33-34; server/index-leaves/engineReachFor.ts:11-12 and 24; server/index-leaves/connectorSetupContext.ts:19-25; server/index-leaves/connectorSetupStore.ts:15-28; server/index-leaves/harnessCommandAccount.ts:25-26; server/drivers/claude/turn-prepare-args.ts:194; server/drivers/acp/grok.ts:202-204 and 1124; server/harness-connectors.ts:401-419. Each fix changed the rule and some of the readers. PR #3174 threaded one flag through five files and still left three readers behind (1.4 a and b) [code].

B. The path across engines is advice to a model, not a mechanism. It is a hint in the prompt, a tool the model must choose, and a word reading of the person's message. Its outcome cannot be tested, it changes with every prompt edit and every model, and it does not exist in a room, at a hop or for any other connector.

C. Two opposite goals edit the same switches. Reach (#1475, #1773, #3170) and isolation (#2747) are both built as "load or do not load the provider gateway into the bot's own engine process". Every fix for one is a regression risk for the other. The test of the last fix pins its rule, not the product's outcome: server/harness-connectors.test.ts:423-435 still asserts that a relay part does not load the gateway (the rule of #2747), which is exactly the regression #3170, beside the newer test at lines 140-147 that asserts the opposite with the relay flag [code].

D. Upstream drift, found in production. Within two weeks xAI changed the default of managed configs, the shape of the gateway (one `cursor` server, or one server per connector) and the escapes in names (AGENTS.md:2401-2525). Claude's `--strict-mcp-config` does not behave as its documentation says (server/harness-connectors.ts:14-17). The fixtures are JSON captured by hand, and the fake CLI encodes the assumption of the day (server/testing/fake-acp-cli.ts:970-974) [code].

E. Approvals are read per engine. Whether a connector call is the person's own is decided by engine-specific tests (server/engines/engine-access.ts:190-193 for `claude_ai_` and "subscription", lines 209-211 for Grok's `accountConnector` and "subscription"), and the tool is read from each engine's own ask format through several layers per engine (server/use-tool-parity.test.ts lists five entries) [code].

F. The facts live in memory. The Grok reach (server/drivers/acp/grok-tool-catalog.ts:300), the relay parent map (server/index.ts:17708) and the claude.ai inventory (server/harness-connectors.ts:294, five minutes at line 303) are empty after each restart, and a reach that is not known is left out of the prompt (connectorsElsewhereFor.ts:21-22 and 36-39). The product ships often, so the first turns after each release know less [code].

G. Several turn paths are wired by hand. Direct turns and room turns compute the flags separately (start-turn-dispatch.ts:221-226, group-member-turn-launch-dispatch.ts:309-310), the room path has no relay, and routines, peer hops, parts, guests and warm-ups each have their own conditions [code].

H. A new dimension arrived late: several accounts per person and per engine (#2384) and the second Grok sign-in (#1618).

### 2.3 What no test catches today

1. An outcome across engines. No test runs "a bot on engine A obtains the result of a tool of provider B". The tests assert predicates and prompt sentences (server/harness-connectors.test.ts), approvals for Grok on Grok (server/grok-account-connectors.e2e.test.ts) and one switch case (server/connector-switch.e2e.test.ts) [code].
2. Agreement between what the prompt says and what the process loads (1.4 a to d).
3. Rooms, peer hops, routines and parts, for a connector of another provider.
4. The state right after a restart.
5. The same decision for the same act on two engines (1.4 e).
6. A change of behaviour of a CLI between two versions. Nothing compares the captured shapes with the CLI version pinned in `engines.lock.json`.
7. Several accounts through the relay.
8. The real product. No connector check is part of a release. #3149 and #3223 were found by QA passes.

## 3. How each provider's connectors can be reached from another engine

General finding: for the three providers, the connectors are served to the provider's own CLI with the person's session of that provider. None documents an address that another MCP client may mount [cli] [docs].

### 3.1 claude.ai connectors

(a) Direct mount in another engine's turn.
- Claude Code lists each connector as an HTTP server: `claude mcp list` prints "claude.ai <Name>: <url> - <status>" (parsed at server/harness-connectors.ts:228-251) [code]. It signs in to one with `claude mcp login <name>`: "Authenticate with an MCP server (HTTP, SSE, or claude.ai connector)" [cli]. They load only on a claude.ai subscription login (server/harness-connectors.ts:11-13) [code].
- Mounting that address elsewhere needs the account's OAuth token, which only the Claude CLI holds. Sagax would have to read it from the CLI's credential store and hand it to another client. That is a third-party token handled outside its engine, against the owner's constraint and outside what a subscription sign-in is issued for [docs]. Whether the address accepts another client is [not verified].
- Rejected.

(b) A call the server makes through the Claude CLI.
- Established: it exists in production for one tool family. `claude_artifact` runs one call as a short `claude -p` in the config dir of the person who speaks (server/claude-artifacts/runner.ts:1-13). Its arguments are `-p`, `--model haiku`, stream-json output, `--permission-mode dontAsk` and a one-line system prompt (runner.ts:27-31 and 64-85). Its prompt is "Call the tool X exactly once with this input JSON, then stop" (runner.ts:97-104). The tool result is read from the stream, not from the model's words (runner.ts:124-159). A bot on any engine calls it (server/drivers/agents-call-claude-artifact.ts) [code].
- The same works for connectors when the account's connectors are left on: no `--strict-mcp-config` (it drops them, measured on CLI 2.1.287, server/harness-connectors.ts:14-17) and no `ENABLE_CLAUDEAI_MCP_SERVERS=false` [code]. A run on the real account is [not verified] here.
- No way to call a tool without a model turn appears in the CLI: `claude mcp` only manages configuration, and `claude mcp serve` is described as "Start the Claude Code MCP server" [cli]. Public documentation describes it as serving Claude Code's own tools, not the servers it is connected to [docs]. Lot 0 confirms it with a local fake server, which needs no account.
- Latency [estimate]: a one-shot process, the account's connectors to connect, one tool search round and one call round on a small model: 5 to 15 seconds. With a warm process: 2 to 5 seconds. The runner's own limit is 90 seconds (runner.ts:28).
- Tokens [estimate]: two small-model rounds of a few thousand tokens each with tool search on. With tool search off the prefix can reach 95k to 175k tokens (issue #1997), so it must stay on, as the runner does (runner.ts:92).
- Sign-in needed: the person's own Claude subscription sign-in in Sagax (their own login directory on an organization server, the machine's login for the operator on a solo server), and the connector connected on claude.ai.
- Impossible: on an API key, a setup-token, Bedrock, Vertex or Foundry (server/harness-connectors.ts:11-13), and for anyone but the operator on a solo server.

(c) Other.
- The native mount on the person's own Claude turn, as today.
- `claude mcp login <name> --no-browser` could give the sign-in link of one connector for the Connect card [cli, not verified].

### 3.2 grok.com connectors

(a) Direct mount. The gateway is reached by the CLI with the grok.com session. The config reference has switches only (`managed_mcps.enabled`, `managed_mcps.gateway_tools_enabled`, `managed_mcps.allow_external_auth`, "API keys still don't qualify") and no address for another client (~/.grok/docs/user-guide/26-config-reference.md:398-404) [cli]. Same objections as for Claude. Rejected.

(b) A call the server makes through the Grok CLI.
- Established: a standalone `grok agent --no-leader stdio` on the person's sign-in home, with the gateway on, lists the account's connectors with no prompt, in about one second for 488 tools on grok 1.0.70 (`probeGrokReach`, server/drivers/acp/grok.ts:441-520) [code].
- The list carries tool names, titles and descriptions (server/testing/grok-gateway-mcp-list.json) [code]. Input schemas are not in the captured shape [not verified on the raw answer].
- A gateway call is a `use_tool` call. In `default` mode Grok asks before it runs it, and the ask carries the tool name and its arguments (server/drivers/acp/connector-ask.ts:48-73, docs/grok-approval-gate.md:51-66, measured on 1.0.70 per server/drivers/acp/grok.ts:155-163) [code]. So the server can prompt "call this tool with this input", compare the ask with the approved call, allow exactly that one, read the tool result from the ACP stream and cancel. One model round.
- A call with no model: the ACP of grok 1.0.70 had none (AGENTS.md:2439-2443, no `_x.ai/mcp/call`) [code]. The user guide of 1.0.77 documents `host.mcp.call(server, tool, args)` inside workflow modules "on the daemon route", and `grok -p '/<name> args'` that starts a workflow directly with no model turn (~/.grok/docs/user-guide/04-slash-commands.md:446 and 14-headless-mode.md:657-659) [cli]. Whether Sagax's Grok sessions run on that route, whether the managed gateway is among those servers and how its approval asks arrive are [not verified]. If it holds, the Grok host calls with no model behind the same interface.
- Latency [estimate]: warm, one fast-model round plus the gateway call, 2 to 5 seconds. Cold, 1 to 2 seconds more.
- Tokens [estimate]: one round over Grok's base context. A Grok round over a bot's whole context was measured near 20k tokens on 1.0.62 (server/drivers/acp/grok-tool-catalog.ts:7-8). A bare session with no Sagax server is smaller.
- Sign-in needed: the person's own grok.com sign-in in Sagax, first or second account.
- Impossible: on an xAI API key [cli], and for a connector added under another xAI account or team workspace (AGENTS.md:2419-2421).
- Note on an earlier choice: on 2026-10-29 this route was set aside because "a second process mounted as an MCP server would be a model prompt per tool call", and the relay was chosen (AGENTS.md:2439-2443). The relay costs a whole agent turn with the bot's persona and catalog for each request and needs the model to choose it. One small pinned round per call is cheaper, and deterministic in effect.

(c) Other. The native load on a Grok turn of a bot that opted in, and the relay, as today.

### 3.3 ChatGPT apps (through Codex)

(a) Direct mount. Nothing is documented for another client, and they need "Codex backend auth" (server/harness-connectors.ts:26-30) [code]. Rejected for the same reasons.

(b) A call the server makes through Codex's app-server.
- Established from the installed CLI: the stable app-server protocol of codex-cli 0.166.0 has `mcpServerStatus/list` (for each server its auth status and its `tools` as full MCP tool objects), `mcpServer/tool/call` (parameters `server`, `threadId`, `tool`, `arguments`; result `content`, `isError`, `structuredContent`), `app/list`, `app/installed`, `app/read` and `mcpServer/oauth/login` [cli: `codex app-server generate-json-schema`, with and without `--experimental`, the six methods are in the stable set]. The feature `apps` is stable and on [cli: `codex features list`].
- So the server can open a thread on the person's `CODEX_HOME`, list, and call a tool with no model turn and with real input schemas.
- [not verified]: that the ChatGPT apps appear as a server in that list and can be called that way on a real ChatGPT sign-in, and which approval Codex itself raises for a call made by the client.
- Latency [estimate]: no model. Warm, under a second plus the app. Cold, the app-server start and its MCP start-up.
- Tokens: none.
- Sign-in needed: the person's own ChatGPT sign-in through `codex login --device-auth` in Sagax (server/drivers/codex-device-auth.ts). The ChatGPT plan mode and API keys do not qualify.

(c) Other. The apps may already load in the person's own Codex turn (1.2).

### 3.4 Gemini and the others

No provider-managed connector is known in the code (docs/TODO.md:86), and their CLIs were not installed on the study machine [not verified]. There is nothing to bridge. The registry of section 4 accepts a new provider as one adapter.

### 3.5 Other routes, for any provider

- The person adds the service as their own MCP server in Sagax (Connect apps). Sagax already mounts it on every engine the same way. The token is then in Sagax's own vault. It is the fallback where a provider offers no route, and the fastest route for a service that publishes its own remote MCP server. Sagax does not build it for mail or calendar (decision of 2026-10-21, AGENTS.md:8059-8062).
- The whole turn on another engine (the switch) and a teammate bot exist. They are what this design replaces.

### 3.6 Summary

Route (a) is closed for the three providers unless a provider token is taken out of its engine. Route (b) is open for the three: with no model for Codex, with one small model round for Grok and for Claude.

## 4. Recommended design: the connector hub

### 4.1 Invariants (each one has a test in section 6)

- I1. One registry of a person's connectors, and one plan per turn computed once. Every reader reads the plan.
- I2. A hub call never depends on the engine of the bot.
- I3. A provider's connectors load in two kinds of process only: the provider's connector host (always, isolated), and the native mounts that exist today, under today's rules, as a shortcut.
- I4. One decision per call, in the calling turn, by `request.opened`, on the provider's own tool id.
- I5. Only the person the turn is for (`connectorPrincipalFor`). A host runs only in that person's own login directory.
- I6. Nothing invisible: the call, its card and its error are in the bot's chat.
- I7. Sagax stores no provider token. The engines keep theirs.

### 4.2 The parts

P1. Registry (new `server/connectors/registry.ts`).
- For one person it lists, over all of that person's own sign-ins (Claude, Grok first and second account, added accounts, Codex), each connector with: provider, account label ("Claude", "Grok (personal account)"), name, state (connected, needs sign-in, failed, unknown), its tools (the provider's own tool id, title, description, whether the name reads or acts), and the time it was read.
- Sources: the existing claude.ai inventory (`ClaudeAiConnectorInventory`, server/harness-connectors.ts:293-342), the existing Grok probe (`probeGrokReach`, server/drivers/acp/grok.ts:449-520, read by `readGrokCatalog`, server/drivers/acp/grok-tool-catalog.ts:50-76), and Codex's `mcpServerStatus/list`.
- It is kept on disk per person (names and states only, never a token, an address or an email), so it is known right after a restart. It is refreshed in the background, at sign-in and sign-out, and on request.
- It feeds the turn's list, the two tools, the person's pages (the route at server/harness-connectors.ts:379-420), the setup card and the dev panel record. It replaces `connectorsElsewhereFor`, `engineReachFor` and the in-memory reach as sources of decisions.

P2. Turn plan (new `server/connectors/turn-plan.ts`).
- `connectorPlanForTurn(bot, instance, speaker, threadId, via)` returns the connector principal, the native flags of this turn (today's rules, unchanged) and the person's entries from the registry.
- It is computed once in turn setup, for a direct turn (server/turns/start-turn-setup.ts) and for a room turn (server/turns/group-member-turn-launch-tools.ts), and every reader of cause A reads it.
- A guard test forbids any other file from naming the predicates or the provider switches.

P3. Two tools in the `agents` server.
- `connectors`: with no argument it returns the one list. With `connector` and `query` it finds tools and returns their names, descriptions and input schema when the provider gives one. It reads only and never asks.
- `call_connector`: `{ connector, tool, arguments }`. It runs exactly that call and returns the tool's own result, fenced as untrusted data like `claude_artifact` does (server/drivers/agents-call-claude-artifact.ts:8).
- Why inside `agents` and not a new MCP server: `agents` is already mounted on every engine with tools, its tools already answer themselves on every engine when they stay in the person's own scope (server/sagax-internal-tools.ts:16-27 and 169-172, server/approvals/auto-approve.ts:410-424), it costs no extra process per turn, and a Grok bot's tool list still holds `agents` only, which is the blocking test of #2747.
- They are present in every catalog profile, rooms and peer hops included. `run_with_engine` is absent from both (server/drivers/agents-catalog.ts:343 and 348-353).
- An engine with no `agents` server (tools off) has no tools at all and is out of scope.

P4. Connector hosts (new `server/connectors/hosts/`), one per provider, behind one interface: `list`, `describe`, `call`.
- Codex host: an app-server on the person's `CODEX_HOME`, `thread/start` with no turn, `mcpServerStatus/list`, `mcpServer/tool/call`. No model.
- Grok host: the launch of `probeGrokReach` (isolated home, gateway on, `--permission-mode default`, `--no-leader`, a fast model). A call is one prompt that names the tool and its input. Grok's own ask is allowed once only when its tool and input equal the approved call. The result is read from the tool update, then the prompt is cancelled.
- Claude host: the pinned call of `server/claude-artifacts/runner.ts`, with the account's connectors on and only the one tool allowed. The input is checked before the tool runs (the permission prompt tool Sagax already ships, server/proxy-paths.ts:41), because `dontAsk` alone would run whatever input the small model wrote.
- Exactness: an outward call whose tool or input differs from the approved one is never run, and the bot gets a plain error with what the provider tried. A read that differs only in form is allowed.
- Each host has one launch profile function. Its flags and variables are pinned and tested against the fakes and against the CLI version of `engines.lock.json`. This is the only place where the provider switches of cause C and D are set for the hub.
- Hosts respect the engine start limit and the memory guard, stop when idle, at sign-out and at shutdown, and never outlive the server.

P5. Approvals: one server-held request.
- When `call_connector` arrives, the route does not run it. It opens a permission request on the calling turn, as an engine would, and waits for the verdict. The event carries the provider's own tool id as `mcpTool` (so `normalizeRuleTool`, server/approvals/owner-approval.ts:110, gives the same rule key as a native call), the exact arguments as `input`, `accountConnector` and `engineConnector` true, and `outbound` read by `connectorWriteKind` and `connectorCallReads` (shared/engine-connectors.ts:171-212).
- The existing handler then decides exactly as for a native call (server/runtime-events/request-opened.ts): organization Refuse and Ask first rules, the person's own rules, Always allow, allowed recipients, the safety review, Full access (server/approvals/full-access-gate.ts), and "a read of your own connector" with no card (server/approvals/auto-approve.ts:391-393).
- New plumbing, one piece: `server/harness/held-requests.ts`. Every answer already goes through `adapter.respondToRequest` (server/index-leaves/answerRequest.ts:53-59, server/approvals/auto-approve.ts:34, the refusals in request-opened.ts, the expiry in server/index-leaves/scheduleApprovalExpiry.ts:21). One wrapper around it resolves a held id before the engine is asked. Requests held outside an engine already exist: a machine's approvals (answerRequest.ts:15-24), Sagax's own ask (`harnessAsk`, shared/runtime-events.ts:209-214) and the safety hold (server/index-leaves/confirmHeldCard.ts:31).
- A new field `connectorHub` on the event, set by the server only and dropped from anything an adapter sends (the bus already does this for `screenApp`, server/harness/bus.ts:168-173), tells the handler that the call is the connector principal's own whatever pays the turn. It is read where `ownAccountConnector` is read (request-opened.ts:277), so a member never gets an admin card (the #1930 shape).
- The wrapper tool itself never shows a card: it is one of Sagax's own tools in the person's scope (server/people/member-tool-scope.ts, like `run_with_engine` at line 51).
- Why not rely on each engine's own ask for the wrapper: the tool and its arguments would then be read from each engine's ask format through several layers per engine (cause E), and some engines do not share the arguments (server/drivers/acp/connector-ask.ts:5-6). The server has both, exactly.
- The same facts are set once, in the bus, for native connector calls too (a `claude_ai_` call on a turn whose plan says "own"), so the same act gets the same verdict on every engine (1.4 e).
- The wait for a person is bounded like a safety hold (nine minutes, server/safety/safety-review.ts:364). Past it the call is declined with a plain result and the card expires. A routine keeps its own wait.

P6. The one list in the prompt (new `server/connectors/list-prompt.ts`).
- It replaces the text of `engineConnectorsPrompt`. Same text for the same person on every engine, sorted, with no number that drifts: one line per connector with its account and state, how to call it (`call_connector`, and the direct tools when this turn also mounts them natively), and `open_connector_setup` when it needs a sign-in.
- It keeps the outward rule (server/harness-connectors.ts:153-160) and the "/me" rule (line 150).
- Grok's catalog section reads the same plan (server/drivers/acp/grok.ts:271).

P7. Visibility, errors, sign-in.
- The call is one tool row in the bot's chat that names the connector, the tool and the account ("Outlook, Send mail, through your Grok personal account"), with the existing readers of gateway names (shared/approval-describe.ts:256, src/lib/step-label.ts).
- A failure shows the provider's own error. "Needs a new sign-in" posts the existing Connect card once (the behaviour of #2749).
- The small model round of a host is recorded as usage on the calling thread.
- The server counts hub calls per engine and provider, with the last success and the last error, for the dev panel.

P8. What is retired, once the matrix is green.
- The connector switch: server/connector-switch.ts, server/index-leaves/connectorSwitchForTurn.ts, server/turns/start-turn-prepare-validate.ts:223-252, `connectorNeed` (shared/engine-connectors.ts:214-296).
- The relay hint and its list: server/harness-connectors.ts:161-186, server/index-leaves/connectorsElsewhereFor.ts, server/index-leaves/engineReachFor.ts.
- The relay exception of #3174: server/harness-connectors.ts:91-93 and 138-143 and its five call sites. A part gets the hub like any turn.
- The sentences that send a bot to `run_with_engine` or to `use_tool` for a connector: server/routes/connector-setup.ts:171-180, server/drivers/agents-tools/agent-api.ts:188.
- `run_with_engine` stays for its first purpose, a part of the work on another model. The bot setting `grokAccountConnectors` stays as the native shortcut on the bot's own Grok turn.

### 4.3 How one call runs

1. The bot, on any engine, reads the list in its prompt or calls `connectors`.
2. It calls `call_connector` with the connector, the tool and the arguments.
3. The route reads the person from the turn's own capability, never from the arguments, and finds the entry in the registry.
4. It opens the held request on the calling turn. A read passes at once. A write follows the bot's level and the rules. A card, when there is one, is in the bot's chat.
5. On "allow", the provider's host runs exactly that call on the person's own sign-in and returns the tool's result.
6. The row in the chat shows the connector, the tool, the account and the outcome.

### 4.4 Isolation between people

- The person is `connectorPrincipalFor` of the turn: the speaker of a conversation, the owner for a routine, the same person at a peer hop, nobody for an unknown person, the operator only on a solo server.
- A turn paid by someone else's account serves the speaker's own connectors and never the payer's. Today that turn has none (server/harness-connectors.ts:113).
- A guest's confined turn gets none, as today (server/drivers/claude/turn-prepare-args.ts:190-194). A managed policy that restricts MCP gives none, as today (server/harness-connectors.ts:109). A tool selection decides whether the two tools are offered, as for any `agents` tool.
- The matrix runs two people and checks that each host was launched in its own person's directory only.

### 4.5 What changes for a bot, by engine

- Claude: keeps its native claude.ai tools on the person's own subscription, and gains every other connector of the person through the hub (Grok, ChatGPT), also when the turn runs on a key or on someone else's account.
- Grok CLI: gains every connector of the person through the hub with no opt-in. Its own tool list still holds `agents` only.
- Grok API, Codex, Gemini, Kimi, Qwen, OpenCode Go, Hermes, pi, Muse Code, the chat engines: gain the same list and the same call.
- Rooms, peer hops, routines and parts: same as a direct turn.

### 4.6 Scope

The hub serves provider-managed connectors of the person's accounts. A server the person configured locally in one CLI is not an account connector: the person adds it in Connect apps and Sagax mounts it on every engine, as today.

### 4.7 Risks, one line each

- Every bot of a person can call every connector of that person's accounts, third-party ones included (the case of #2747, a production tool on the account); only the bot's level and the Refuse and Ask first rules stand in the way, as decided.
- Each hub call to Claude or Grok spends one small model round on the person's own subscription of that provider.
- A read of the person's own claude.ai connector no longer shows a card at Ask, as is already the case on Grok.
- The bot no longer changes model for a mail or calendar request, since the switch is retired.
- For Claude, and for Grok until measured, the calling bot may get no input schema before its first call; the provider checks the arguments and its error comes back as is.

## 5. Implementation, in lots of half a day

Each lot is one issue, one worktree, one pull request, with the fast gate on the touched files (typecheck, lint, `check:terms`, the tests named below). Fixtures and examples use neutral names, since the repository is public. Lots L1 to L11 and L13, L14 touch the same server files, so one server developer takes them in order. L0, L12 and L15 can run beside them.

L0. Measures. Role: live QA. No product code.
- What: settle every [not verified] of section 3 on the real CLIs, and capture the shapes as fixtures.
- M1 Claude: the stream-json frames of one pinned call to a harmless claude.ai read tool, with tool search on and no strict flag: spelling of the tool id, the tool use and tool result frames, time from a cold start.
- M2 Claude: whether the permission prompt tool can check the input before the tool runs in `-p` mode, and what happens when the model deviates.
- M3 Claude: `claude mcp serve` with a local fake server in a scratch config directory: does its `tools/list` hold that server's tools. No account needed.
- M4 Grok 1.0.77: the `initialize` answer (any method that calls an MCP tool), the raw tool objects of `_x.ai/mcp/list` (any input schema), one pinned `use_tool` (shape of the ask, of the result, behaviour of cancel), time.
- M5 Grok: a workflow that calls `host.mcp.call`: does it see the managed gateway, can an ACP client start it, how do approvals arrive.
- M6 Codex 0.166.0 on a ChatGPT sign-in: `thread/start`, `mcpServerStatus/list` (is there an apps server, under which name), `mcpServer/tool/call` on a read tool, what Codex asks.
- M7 Codex: does a turn on a ChatGPT sign-in already carry the apps today (1.2).
- M8 Claude on a solo server: does a turn that is not the operator's carry the operator's connectors (1.4 d).
- Files: fixtures under `server/testing/fixtures/connectors/`, a note `docs/verification/connectors-hub-measures.md`.
- Proof: `server/testing/connector-fixtures.test.ts` replays each fixture in `fake-claude-cli.ts`, `fake-acp-cli.ts` and `fake-codex-app-server.ts`.
- Needs: the QA sign-ins (Claude, Grok, ChatGPT) with one harmless connector each. M3 needs none.

L1. Registry and persisted inventory. Role: server.
- Files: new `server/connectors/types.ts`, `server/connectors/registry.ts`, `server/connectors/providers/claude-ai.ts` (wraps `ClaudeAiConnectorInventory`), `server/connectors/providers/grok-com.ts` (wraps `probeGrokReach` and `readGrokCatalog`, keeps names, titles, descriptions), `server/connectors/providers/chatgpt-apps.ts` (lists nothing until L10), a per-person file under `DATA_DIR/connectors`. `server/engines/principal-engine-logins.ts` (refresh at sign-in and sign-out, where `warmReach` is, lines 419-427). `server/harness-connectors.ts:379-420` answers its present shape from the registry. Readers moved to it: `server/index-leaves/connectorsElsewhereFor.ts`, `engineReachFor.ts`, `connectorSetupStore.ts`.
- Proof: `server/connectors/registry.test.ts`: only the person's own accounts; two Grok accounts and an added account (#2384) are all listed; a new registry on the same data directory lists the same connectors before any CLI call (restart); a bot with default settings is told of the person's Grok account (the case 1.4 a, red today).

L2. One plan per turn. Role: server. May be split in two pull requests (dispatch readers, then the others).
- Files: new `server/connectors/turn-plan.ts`, computed once in `server/turns/start-turn-setup.ts` and `server/turns/group-member-turn-launch-tools.ts`. Readers switched: `server/turns/start-turn-dispatch.ts:221-226`, `server/turns/group-member-turn-launch-dispatch.ts:309-310`, `server/index-leaves/engineConnectorsPromptFor.ts`, `turnReachPrompt.ts`, `turnConnectorsFor.ts`, `botCapabilitiesAs.ts:58-59 and 154-158`, `connectorSetupContext.ts`, `harnessCommandAccount.ts:25-26`. No change of behaviour.
- Proof: `server/connectors/turn-plan.test.ts` (own, foreign, key, routine, room, peer, guest, tool selection, policy, solo operator and not, second account) with today's flags. New `server/connectors/one-source.guard.test.ts`: outside `server/connectors` and the two driver launch files, no file names `claudeAiConnectorsForTurn`, `grokCloudConnectorsForTurn`, `GROK_MANAGED_MCPS_ENABLED`, `ENABLE_CLAUDEAI_MCP_SERVERS` or `--strict-mcp-config` (the style of `server/approvals/full-access-gate.guard.test.ts`).

L3. Server-held approval requests. Role: server.
- Files: new `server/harness/held-requests.ts` (open, resolve, retire at the end of the turn), the wrapper of `respondToRequest` where instances are attached (`server/harness/bus.ts:134-148`), `shared/runtime-events.ts` (the field `connectorHub`, dropped from adapters in `bus.ts:168-173`), `server/runtime-events/request-opened.ts:277`.
- Proof: `server/harness/held-requests.e2e.test.ts` on `server/testing/fake-driver.ts`: a held read with the connector facts is approved with no card at Ask (source "connector-read"); a held send shows one card at Ask and at Auto, and that card offers Always allow; Deny returns deny; Always allow saved from the card answers the next identical request; Full approves with no card; an organization Refuse rule refuses; a member's bot gets the member's card and never an admin card; the card expires when the turn ends; an answer after a restart is "unavailable".

L4. The `connectors` tool and the route. Role: server.
- Files: new `server/drivers/agents-tools/connectors.ts`, `server/drivers/agents-call-connectors.ts`, new `server/routes/internal-connectors.ts` (the person comes from the turn's capability through `connectorPrincipalFor`, never from the arguments). Registries of a new `agents` tool: `server/drivers/agents-catalog.ts` (every profile, rooms and peer hops included), `agents-catalog-budget.ts` and the goldens, `server/agent-api.ts:107`, `server/people/member-tool-scope.ts` ("conversation"), `server/mcp/mcp-permissions.ts:186`, `server/tools/agent-tool-policy.ts:7` (read only), `server/drivers/acp/grok-tool-catalog.ts:129` (a direct shortcut for Grok), `docs/mcp/coverage.md`.
- Proof: `server/drivers/agents-catalog-connectors.test.ts` and the existing reachability and golden tests; `server/routes/internal-connectors.test.ts`: the list of the turn's person only, a token of another thread or person lists nothing.

L5. `call_connector`, the hub and a test host. Role: server.
- Files: the same tool files, new `server/connectors/hub.ts`, `server/connectors/hosts/types.ts`, a host used by tests only. The route opens the held request, then asks the host. A provider with no host yet is not offered as callable.
- Proof: `server/connectors/hub.e2e.test.ts`: a bot on the fake Claude CLI and a bot on the fake ACP CLI call `call_connector` and receive the test host's marker; a denied send reaches no host; a room turn and a peer turn can call. This file is the first rows of the matrix of section 6.

L6. Same decision everywhere, and the labels. Role: server, with translations for the strings.
- Files: new `shared/connector-call.ts` (the provider's own id of a call, reads or acts), `server/harness/bus.ts` (the same connector facts on a native `claude_ai_` call of a turn whose plan says "own"), `shared/approval-describe.ts:256`, `src/lib/step-label.ts`, `shared/working-step.ts:213`.
- Proof: `server/connectors/approval-parity.test.ts`, in the style of `server/use-tool-parity.test.ts`: the same read and the same send, entered as a native Claude ask, a native Grok ask and a hub call, get the same verdict and the same rule key at Ask, Auto and Full, with an Always allow rule and with a Refuse rule. `src/lib/step-label.test.ts`.

L7. Grok host. Role: server. Needs M4.
- Files: new `server/connectors/hosts/grok-host.ts` (from `probeGrokReach`, `server/drivers/acp/grok.ts:449-520`), `server/connectors/providers/grok-com.ts` (call, describe), `server/testing/fake-acp-cli.ts` (a mode "pinned": obeys, alters the input, calls another tool, answers "needs sign-in").
- Proof: `server/connectors/hosts/grok-host.test.ts`: exactly one call with equal arguments; an altered send is not run and the bot gets a plain error; the second account runs in its own directory; "needs sign-in" posts the Connect card; no process is left after the call.

L8. The one list in the prompt. Role: server, with translations.
- Files: new `server/connectors/list-prompt.ts`, `server/harness-connectors.ts:201-215`, `server/turns/start-turn-prompt.ts:191`, `server/turns/group-member-turn-launch-prompt.ts:263`, `server/drivers/acp/grok.ts:271`.
- Proof: `server/connectors/list-prompt.test.ts`: the same text for the same person on Claude, Grok, Codex, pi and a chat engine, in a direct turn and in a room; a connector also mounted natively names its direct tools; "needs sign-in" names `open_connector_setup`; no dash; the same bytes for an unchanged registry.

L9. Claude host. Role: server. Needs M1 and M2.
- Files: new `server/connectors/hosts/claude-host.ts`, which shares one pinned call with `server/claude-artifacts/runner.ts:64-159`, `server/connectors/providers/claude-ai.ts` (call), `server/testing/fake-claude-cli.ts` (a connector mode).
- Proof: `server/connectors/hosts/claude-host.test.ts` (the cases of L7), and the runner's own tests unchanged.

L10. Codex host. Role: server. Needs M6.
- Files: new `server/connectors/hosts/codex-host.ts`, `server/connectors/providers/chatgpt-apps.ts`, `server/testing/fake-codex-app-server.ts` (three methods), `server/harness-connectors.ts:405`.
- Proof: `server/connectors/hosts/codex-host.test.ts`: list, call, and no model turn (the fake counts `turn/start`: zero).
- If M6 shows the apps cannot be reached this way, the lot ends at "not available" with its reason, the entry is hidden, and the owner is told.

L11. The matrix and the guards in the gate. Role: server.
- Files: `server/connectors/connector-matrix.e2e.test.ts`, `server/connectors/launch-profile.contract.test.ts`, a `package.json` script beside `test:routine-smoke`, `docs/releasing.md` (the gates step).
- Proof: the test itself, and three changes shown in the pull request that turn it red: the tools removed from the room profile; `GROK_MANAGED_MCPS_ENABLED` set to false in the Grok host; the route reading the person from the arguments.

L12. Live check. Roles: live QA, then the release step.
- Files: `scripts/verify/release/connectors-live.mjs`, `docs/verification/connectors-live.md`, `docs/releasing.md`.
- Proof: the same script with `--fake` against a local server on the fakes, run with the matrix.

L13. Retire the old paths. Roles: server, then documentation.
- Files: the list of P8. `AGENTS.md` sections at lines 2253-2271, 2434-2498 and 8019-8127 become one "Connectors" section; `docs/grok-approval-gate.md:13`; `docs/tool-selection.md`.
- Proof: the matrix stays green; `server/harness-connectors.test.ts` loses the tests of removed code; a test that a person's message with a mail word never changes the bot's model.

L14. Speed and accounting. Role: server.
- Files: new `server/connectors/host-pool.ts` (one warm host per person and account, an idle limit, the start limit and the memory guard, stop at sign-out and at shutdown), the usage of each pinned round recorded on the calling thread, `server/turns/turn-connectors.ts` and `shared/turn-connectors.ts` (the dev panel card).
- Proof: `server/connectors/host-pool.test.ts`: several calls, one launch (`FAKE_ACP_LAUNCH_COUNT_FILE`); idle exit; nothing left running.

L15. The pages read the registry. Roles: web interface with the UX review, then iOS.
- Files: `src/components/PluginsPanel.tsx-parts/useHarnessConnectors.ts`, `src/components/plugins/HarnessConnectorGroups.tsx` (Grok rows with their real state, the ChatGPT group), `ios/Sources/CompanionCore/ProviderConnectorGroups.swift`.
- Proof: the component tests and the side by side capture of the UX gate.

Order and dependencies: L1, L2, L3, L4, L5, L6, then L7 and L8 (the list goes live with the first provider that can be called), L9, L10, L11, L12, L13, L14, L15. L0 runs from the first day. The hub is offered to bots from L7 on, for Grok first.

## 6. The checks that keep it from coming back

### 6.1 The matrix, with no real account

`server/connectors/connector-matrix.e2e.test.ts`.

Rows, the engine of the bot. They are generated from `BUILT_IN_DRIVERS` (server/drivers/builtIn.ts:29-54), by driver family and its fake: `claudeAgent` on `server/testing/fake-claude-cli.ts`; `codex` on `server/testing/fake-codex-app-server.ts`; `pi` on `server/testing/fake-pi-cli.ts`; each ACP driver on `server/testing/fake-acp-cli.ts`; the chat driver family on a local chat-completions stub, as `server/drivers/openai-chat.test.ts` does; Muse Code. A driver with no row fails the test until it is added or exempted with a written reason (the pattern of `server/engines/engines-self-check.test.ts`).

Columns, the provider of the connector: claude.ai (the fake Claude CLI in connector mode); grok.com in its personal account shape (`server/testing/grok-gateway-mcp-list.json`); grok.com in its team account shape (`server/testing/grok-gateway-team-mcp-list.json`); a second Grok account; ChatGPT apps (the fake Codex app-server).

Each cell asserts outcomes, never flags:
1. List: the turn's prompt names the connector, and `connectors` returns it.
2. Read: `call_connector` on a read tool brings the provider fake's marker into the bot's turn, with no card at Ask.
3. Write at Ask: exactly one `request.opened` on the calling thread, with the provider's own tool id and `outbound`. Denied: the provider fake recorded no call. Allowed: exactly one call, with equal arguments.
4. Always allow, saved from that card, answers the same call on another row, which is another engine.
5. Full access: no card. A Refuse rule: refused on every row.
6. Isolation: with two people, each host was launched in its own person's directory only; a turn for one never lists the other's connectors; a turn paid by someone else serves the speaker's.
7. Visible: the calling thread holds one tool row that names the connector, the tool and the account; no other thread got a row or a card.
8. Diagonal: the native shortcut is still mounted where the plan says so (Claude: no `--strict-mcp-config` and no `ENABLE_CLAUDEAI_MCP_SERVERS=false`; Grok: both variables true only with the opt-in), and the hub call works there too.

Turn kinds, on one row per family: a room turn, a routine run, a peer hop, and a turn right after a server restart (memory cold, registry read from disk).

It runs on fakes only, in about two minutes [estimate]. It is part of the fast gate of any pull request that touches `server/connectors`, `server/drivers`, `server/turns`, `server/approvals`, `server/runtime-events`, `server/harness` or `shared/engine-connectors.ts`, and it is a gate of the release beside `pnpm test:routine-smoke` (docs/releasing.md, the gates step).

### 6.2 The launch contract, against upstream drift

`server/connectors/launch-profile.contract.test.ts` snapshots the arguments and the environment of each host. Each flag and variable must be known for the CLI version pinned in `engines.lock.json` (the pattern of `CLAUDE_FLAG_FLOORS` and `claudeCliSupports`, server/drivers/claude.ts:390-391 and 490). When a pin changes, the capture script (the pattern of `scripts/capture/engine-native-tools.ts`) records the three shapes again: Claude's frames, Grok's list and ask, Codex's methods. A shape that changed fails the fixture test at the bump, not in production.

### 6.3 The guards

- One source: the guard of L2.
- Both turn paths compute the plan with the same function (the pattern of `server/turns/start-turn-structure.test.ts` and `group-member-turn-structure.test.ts`).
- The two tools are in every catalog profile.

### 6.4 The live check, at each release

About five minutes. Reads only.

- Before: one QA person with Claude and Grok signed in (and ChatGPT once L10 is in), one harmless connector with a read tool on each; one QA bot per engine family (Claude, Grok CLI, Codex, one API engine, pi or a local model).
- The script drives the product through its own agent API, as the QA passes already do (`send_prompt`, then `await_turn`). For each bot and each provider it sends: "List your connectors. Then read <a fixed harmless thing> through <connector> and answer with the first item."
- It reads the thread's events: a `call_connector` row with the provider's label, success, a result that is not empty, no approval card, and the time taken.
- Once per provider: a send attempted at Ask must show its card; the script denies it; the row must say it did not run. No write reaches a third party.
- Result: a grid, engine by provider, pass or fail with the time, written to `docs/verification/connectors-live.md` and to the release notes. A red cell stops the release announcement and opens an issue.
- Between releases: the server's own counters per engine and provider (P7) show a break the day it lands.

## 7. What is impossible, and what needs the owner

Impossible:
1. A call with no model round for claude.ai connectors, and for grok.com connectors as far as measured: their CLIs expose no call outside the model, and a direct mount needs the provider's token.
2. Any connector of a person who has no subscription sign-in of that provider in Sagax (an API key only), and anyone but the operator on a solo server.
3. Another person's connectors. By design.
4. Gemini and the other engines as providers: nothing provider-managed is known.
5. Input schemas before the first call for Claude, and for Grok until measured. Codex gives full schemas.

Needs the owner:
1. Sign-ins for L0 and for the live check: a QA person with Claude, Grok and ChatGPT signed in on the QA server, one harmless connector on each.
2. ChatGPT apps: the answer of measure M6. If they cannot be reached through the app-server, say whether that column waits or is dropped.
3. Two changes of behaviour follow from the requirement and are reported, not added as limits: the bot no longer changes model for a mail or calendar request; a read of the person's own claude.ai connector no longer shows a card at Ask.
4. The two risks of 4.7 on reach and on the small model round.

Nothing else needs a decision. No release, deploy or roll is part of these lots.
