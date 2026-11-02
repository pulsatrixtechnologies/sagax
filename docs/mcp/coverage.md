# MCP coverage: Sagax and Perspicax capabilities vs MCP tools

Inventory of what the Sagax server and the Perspicax gateway can do, against
the tools the Sagax MCP ("agents" server, `server/drivers/agents-catalog.ts`)
exposes to a bot or an AI client. The machine-readable form is the registry in
`server/mcp-permissions.ts`; `server/mcp-permissions.test.ts` fails when a
catalog tool has no permission.

Totals: capabilities 156, covered 156, gaps 0.

Sources read: the agents tool catalog, the internal routes it calls
(`/api/internal/*`), the member API (`docs/org-member-api.md`), and the
Perspicax tool surface (`docs/mcp-surface.md` there): API meta-tools, the
per-API query/write/action tools, the memory tools, flow and review tools.

Reading the table:

- **covered**: one MCP tool carries it, and it is now gated by the permission
  shown.
- **covered (bridge)**: a Perspicax tool the agents catalog does not list
  natively but a bot reaches through the Perspicax bridge
  (`server/perspicax-mcp.ts`, a profile mounted on the turn). The relay judges
  it with the same permission, so enforce never refuses it by omission.
- **MISSING**: no MCP tool.
- Tool names are the ones Perspicax 1.8.28 serves (connector
  `mcp/meta_tools.rs`, `mcp/memory_tools.rs`, `mcp/flow_tools.rs`,
  `mcp/sagax_tools.rs`). The per-profile tools are matched by name pattern:
  `<profile>__query` (read), `<profile>__write` or `<profile>__<resource>_write`
  (write), `<profile>__action` (action), `<profile>__read_action` (read), any
  other `<profile>__<operation>` (an operation's own tool, judged as an
  action). The `-` separator (`cw_psa-query`) is read too.
- Per-resource fine grain (a ticket update in the PSA) is not a separate
  registry row: it is the kind's permission narrowed by a resource rule,
  `<profile>:<resource>.<verb>` such as `cw_psa:tickets.update` (see
  `permissions.md`, "Dynamic keys").
- Priority: P0 = coordination safety (claims); P1 = day-to-day work; P2 =
  administrative.

| Capability | Source | MCP tool | Proposed permission | Priority / status |
|---|---|---|---|---|
| bots:list | sagax | `list_bots` | `bots:list` | covered |
| rooms:list | sagax | `list_rooms` | `rooms:list` | covered |
| rooms:targets | sagax | `list_room_targets` | `rooms:targets` | covered |
| threads:list | sagax | `list_threads` | `threads:list` | covered |
| teamsetup:list | sagax | `list_team_setup` | `teamsetup:list` | covered |
| computers:list | sagax | `list_shared_computers` | `computers:list` | covered |
| terminal:list | sagax | `list_terminal_resources` | `terminal:list` | covered |
| resources:usage | sagax | `resource_usage` | `resources:usage` | covered |
| connectors:setup | sagax | `open_connector_setup` | `connectors:setup` | covered |
| delegation:check | sagax | `check_delegation` | `delegation:check` | covered |
| delegation:wait | sagax | `wait_delegation` | `delegation:wait` | covered |
| sessions:search | sagax | `session_search` | `sessions:search` | covered |
| sessions:read | sagax | `session_read` | `sessions:read` | covered |
| topics:recall | sagax | `recall_topic` | `topics:recall` | covered |
| toolresult:read | sagax | `tool_result_read` | `toolresult:read` | covered |
| routines:list | sagax | `list_routines` | `routines:list` | covered |
| skills:list | sagax | `skills_list` | `skills:list` | covered |
| workspace:read | sagax | `workspace_read` | `workspace:read` | covered |
| workspace:search | sagax | `workspace_search` | `workspace:search` | covered |
| agents:list | sagax | `list_agents` | `agents:list` | covered |
| agents:find | sagax | `find_agents` | `agents:find` | covered |
| agents:get | sagax | `get_agent` | `agents:get` | covered |
| agents:await | sagax | `await_turn` | `agents:await` | covered |
| transcript:read | sagax | `read_transcript` | `transcript:read` | covered |
| transcript:page | sagax | `read_transcript_page` | `transcript:page` | covered |
| transcript:latest | sagax | `read_latest_page` | `transcript:latest` | covered |
| transcript:latest.threads | sagax | `read_latest_page_with_threads` | `transcript:latest.threads` | covered |
| transcript:cold | sagax | `read_transcript_cold` | `transcript:cold` | covered |
| cloudagents:list | sagax | `list_cloud_agents` | `cloudagents:list` | covered |
| cloudagents:get | sagax | `get_cloud_agent` | `cloudagents:get` | covered |
| cloudagents:find | sagax | `find_cloud_agent_by_pr` | `cloudagents:find` | covered |
| cloudagents:transcript | sagax | `cloud_agent_transcript` | `cloudagents:transcript` | covered |
| cloudagents:artifacts | sagax | `list_cloud_agent_artifacts` | `cloudagents:artifacts` | covered |
| memory:save | sagax | `memory_update` | `memory:save` | covered |
| memory:log | sagax | `memory_log` | `memory:log` | covered |
| groupmemory:save | sagax | `group_memory_update` | `groupmemory:save` | covered |
| files:attach | sagax | `attach_file` | `files:attach` | covered |
| widgets:check | sagax | `check_widget` | `widgets:check` | covered |
| help:read | sagax | `sagax_help` | `help:read` | covered |
| web:search | sagax | `sagax_web_search` | `web:search` | covered |
| widgets:show | sagax | `show_widget` | `widgets:show` | covered |
| widgets:update | sagax | `update_widget` | `widgets:update` | covered |
| apps:show | sagax | `show_html` | `apps:show` | covered |
| apps:update | sagax | `update_html` | `apps:update` | covered |
| artifacts:save | sagax | `save_artifact` | `artifacts:save` | covered |
| artifacts:update | sagax | `update_artifact` | `artifacts:update` | covered |
| artifacts:list | sagax | `list_artifacts` | `artifacts:list` | covered |
| artifacts:delete | sagax | `delete_artifact` | `artifacts:delete` | covered |
| pages:propose | sagax | `propose_page` | `pages:propose` | covered |
| pages:comments | sagax | `page_comments` | `pages:comments` | covered |
| phone:call | sagax | `place_phone_call` | `phone:call` | covered |
| cards:options | sagax | `create_options_card` | `cards:options` | covered |
| cards:ask | sagax | `ask_choice` | `cards:ask` | covered |
| rooms:react | sagax | `react_to_message` | `rooms:react` | covered |
| rooms:unreact | sagax | `remove_reaction` | `rooms:unreact` | covered |
| rooms:post | sagax | `post_to_room` | `rooms:post` | covered |
| threads:close | sagax | `close_thread` | `threads:close` | covered |
| voice:note | sagax | `send_voice_note` | `voice:note` | covered |
| voice:end | sagax | `end_call` | `voice:end` | covered |
| skills:manage | sagax | `skill_manage` | `skills:manage` | covered |
| profile:propose | sagax | `propose_profile` | `profile:propose` | covered |
| model:propose | sagax | `propose_model` | `model:propose` | covered |
| routines:propose | sagax | `propose_routine` | `routines:propose` | covered |
| routines:propose.action | sagax | `propose_routine_action` | `routines:propose.action` | covered |
| waits:set | sagax | `wait_until` | `waits:set` | covered |
| waits:list | sagax | `list_waits` | `waits:list` | covered |
| waits:cancel | sagax | `cancel_wait` | `waits:cancel` | covered |
| shapes:generate | sagax | `generate_shape_avatar` | `shapes:generate` | covered |
| terminal:offer | sagax | `offer_shell_terminal` | `terminal:offer` | covered |
| remote:publish | sagax | `publish_remote_session` | `remote:publish` | covered |
| remote:snapshot | sagax | `remote_session_snapshot` | `remote:snapshot` | covered |
| remote:exec | sagax | `remote_session_exec` | `remote:exec` | covered |
| meetings:join | sagax | `join_meeting` | `meetings:join` | covered |
| bots:ask | sagax | `ask_bot` | `bots:ask` | covered |
| bots:delegate | sagax | `delegate_bot` | `bots:delegate` | covered |
| engines:relay | sagax | `run_with_engine` | `engines:relay` | covered |
| bots:send | sagax | `send_to_bot` | `bots:send` | covered |
| bots:coordinate | sagax | `coordinate_bots` | `bots:coordinate` | covered |
| agents:send | sagax | `send_prompt` | `agents:send` | covered |
| threads:start | sagax | `start_thread` | `threads:start` | covered |
| threads:route | sagax | `route_message` | `threads:route` | covered |
| threads:retry | sagax | `retry_thread` | `threads:retry` | covered |
| cloudagents:launch | sagax | `launch_cloud_agent` | `cloudagents:launch` | covered |
| cloudagents:followup | sagax | `cloud_agent_follow_up` | `cloudagents:followup` | covered |
| cloudagents:cancel | sagax | `cancel_cloud_agent` | `cloudagents:cancel` | covered |
| cloudagents:archive | sagax | `archive_cloud_agent` | `cloudagents:archive` | covered |
| bots:create | sagax | `create_bot` | `bots:create` | covered |
| bots:delete.propose | sagax | `propose_bot_deletion` | `bots:delete.propose` | covered |
| bots:archive | sagax | `archive_bot` | `bots:archive` | covered |
| agents:create | sagax | `create_agent` | `agents:create` | covered |
| agents:delete | sagax | `delete_agent` | `agents:delete` | covered |
| rooms:create | sagax | `create_room` | `rooms:create` | covered |
| rooms:manage | sagax | `manage_room` | `rooms:manage` | covered |
| teamsetup:propose | sagax | `propose_team_setup` | `teamsetup:propose` | covered |
| teammemory:propose | sagax | `propose_team_memory` | `teammemory:propose` | covered |
| rules:update | sagax | `rules_update` | `rules:update` | covered |
| rules:propose | sagax | `propose_rule` | `rules:propose` | covered |
| docs:update | sagax | `docs_update` | `docs:update` | covered |
| mcp:add | sagax | `add_mcp_server` | `mcp:add` | covered |
| credentials:request | sagax | `request_credential` | `credentials:request` | covered |
| credentials:login | sagax | `request_login` | `credentials:login` | covered |
| credentials:http | sagax | `vault_http_request` | `credentials:http` | covered |
| openapi:call | sagax | `openapi_*` | `openapi:call` | covered |
| video:make | sagax | `make_video` | `video:make` | covered |
| tasks:update | sagax | `task_list` | `tasks:update` | covered |
| phone:tool | sagax | `phone_tool` | `phone:tool` | covered |
| github:connect | sagax | `connect_github` | `github:connect` | covered |
| computers:select | sagax | `select_computer` | `computers:select` | covered |
| computers:use | sagax | `shared_computer` | `computers:use` | covered |
| vm:exec | sagax | `vm_exec` | `vm:exec` | covered |
| actions:invoke | sagax | `act` | `actions:invoke` | covered |
| claims:acquire | sagax | `claim` | `claims:acquire` | covered |
| claims:renew | sagax | `claim_renew` | `claims:renew` | covered |
| claims:release | sagax | `claim_release` | `claims:release` | covered |
| claims:list | sagax | `claim_list` | `claims:list` | covered |
| memory:search | perspicax | `memory_search` (v2 `memory_find`) | `memory:search` | covered |
| memory:recall | perspicax | `memory_recall` | `memory:recall` | covered |
| memory:write | perspicax | `memory_write` (v2 `memory_save`) | `memory:write` | covered |
| memory:forget | perspicax | `memory_forget` (v2 `memory_remove`) | `memory:forget` | covered |
| memory:feedback | perspicax | `memory_feedback` | `memory:feedback` | covered |
| memory:promote | perspicax | `memory_promote` | `memory:promote` | covered (bridge) |
| memory:propose | perspicax | `memory_propose` (v2 `memory_suggestions`) | `memory:propose` | covered |
| memory:review | perspicax | `memory_review` | `memory:review` | covered (bridge) |
| memory:files | perspicax | `memory` | `memory:files` | covered (bridge) |
| work:search | perspicax | `work_search` | `work:search` | covered (bridge) |
| work:check | perspicax | `work_check` | `work:check` | covered (bridge) |
| work:open | perspicax | `work_open` | `work:open` | covered (bridge) |
| people:ask | perspicax | `ask_person` | `people:ask` | covered (bridge) |
| approvals:answer | sagax | `answer_approval` (Perspicax `sagax_approve`) | `approvals:answer` | covered |
| routines:run | sagax | `run_routine` (Perspicax `sagax_routine_run`) | `routines:run` | covered |
| routines:update | sagax | `update_routine` (Perspicax `sagax_routine_update`, member `PATCH routines/{id}`) | `routines:update` | covered |
| people:nudge | sagax | `nudge_person` (Perspicax `sagax_nudge`) | `people:nudge` | covered |
| api:list | perspicax | `api_list` | `api:list` | covered |
| api:search | perspicax | `api_search` | `api:search` | covered |
| api:describe | perspicax | `api_describe` | `api:describe` | covered |
| api:lookup | perspicax | `api_lookup` | `api:lookup` | covered |
| api:plan | perspicax | `api_plan` | `api:plan` | covered |
| api:resultquery | perspicax | `api_result_query` | `api:resultquery` | covered |
| api:upload | perspicax | `api_upload` | `api:upload` | covered |
| api:reload | perspicax | `api_reload` | `api:reload` | covered |
| identity:search | perspicax | `identity` | `identity:search` | covered |
| flow:read | perspicax | `flow` | `flow:read` | covered |
| flow:action | perspicax | `flow_action` | `flow:action` | covered |
| review:write | perspicax | `review_write` | `review:write` | covered |
| remotesupport:open | perspicax | `remote_support_open` | `remotesupport:open` | covered |
| remotesupport:status | perspicax | `remote_support_status` | `remotesupport:status` | covered |
| remotesupport:close | perspicax | `remote_support_close` | `remotesupport:close` | covered |
| api:query | perspicax | `<profile>__query` | `api:query` | covered (bridge) |
| api:write | perspicax | `<profile>__write`, `<profile>__<resource>_write` | `api:write` | covered (bridge) |
| api:action | perspicax | `<profile>__action` | `api:action` | covered (bridge) |
| api:action.read | perspicax | `<profile>__read_action` | `api:action.read` | covered (bridge) |
| api:operation | perspicax | `<profile>__<operation>` | `api:operation` | covered (bridge) |
| pairing:manage | sagax | `manage_pairing` | `pairing:manage` | covered |
| settings:manage | sagax | `manage_settings` | `settings:manage` | covered |
| settings:change | sagax | `sagax_settings` | `settings:change` | covered |
| approvals:primary | sagax | `sagax_approvals` | `approvals:primary` | covered |


## Gap summary by priority

No gap left in the registry. The claim tools came with #497 (merged into this
branch). The Perspicax names follow 1.8.28; the memory v2 names of the draft
behind a switch (Perspicax #326, Sagax #496) are aliases of the same
permissions, so either model is judged.

`approvals:answer` (`answer_approval`), `people:nudge` (`nudge_person`),
`pairing:manage` (`manage_pairing`) and `settings:manage` (`manage_settings`)
are thin wrappers over `act`, so the person's rights and the bot's approval
mode still decide. Perspicax's own Sagax tools (`sagax_bots`, `sagax_send`,
`sagax_thread`, `sagax_routine_run`, `sagax_routine_update`, `sagax_approve`,
`sagax_nudge`) are aliases of the Sagax permissions they stand for.
`sagax_routine_update` is the person's own write through the member API
(`PATCH /api/org/member/routines/{id}`); a bot still uses
`propose_routine_action`, which follows Ask or Auto. The Perspicax gateway tools
(`PERSPICAX_TOOLS`: the memory tools, the `api_*` meta-tools, `identity`,
`flow`, `flow_action`, the `remote_support_*` tools, `review_write`) are listed only on an organization
server linked to Perspicax (`SAGAX_PERSPICAX_TOOLS`) and forwarded by
`/api/internal/perspicax/tool` to the profile mounted in the turn, after the
misuse and safety review. Reading the Perspicax catalog to vet resource names
at turn time (`ApiCatalog`) is not wired yet.
