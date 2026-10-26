# MCP permissions

One permission per action, named `resource:verb` (`memory:save`,
`claims:acquire`, `routines:propose.action`). The registry is
`server/mcp-permissions.ts`; the inventory is `coverage.md`.

## Rules

1. **Deny by default.** A tool with no registered permission, a role that is
   not one of the five, or a tier a role does not hold is refused.
2. **Scope.** Every grant has a widest scope: `self` < `team` < `org`. A call
   reaches a scope (`scopeForCall`): another bot, a room, group or team
   argument means `team`; `scope: "org"` means `org`; otherwise `self`. The
   call is allowed only when the role's grant is at least as wide.
3. **Audit.** One record per audited call: time, principal, role, tool,
   permission, scope, decision, reason, and whether the denial was enforced.
   It never holds arguments, message text or results. It goes to the server's
   activity log (see Audit below), with a stderr `[mcp-audit]` line as the
   fallback. A sink that throws never changes the decision. In `enforce` every
   call is audited, allowed and denied; in `shadow` every denial is, and an
   allowed call only within `SAGAX_MCP_AUDIT_SAMPLE` (see "Audit volume").
4. **Mode.** `SAGAX_MCP_PERMISSIONS`: `off`, `shadow` (default: denials are
   audited and the call goes through, so existing bots keep working while the
   audit shows what would break), `enforce` (denials are refused with a
   sentence naming the permission). The harness hands the server's mode, deny
   rules and audit sample to the agents proxy it spawns (`mcpPolicyEnv`), so
   both guards judge alike.
5. **Identity.** `SAGAX_MCP_ROLE` (default `member`), `SAGAX_MCP_PRINCIPAL`
   (default the bot id), `SAGAX_MCP_TEAMS`. The harness sets these when it
   builds the integration; the server remains the authority on what a route
   allows, this layer only narrows.

## Tiers

| Tier | Meaning |
|---|---|
| read | changes nothing |
| own | the caller's own work: memory, skills, files, widgets, reactions, proposals |
| dispatch | puts other bots, people, routines or cloud agents to work |
| claim | holds on shared work (acquire, renew, release) |
| admin | creates bots, rooms or credentials, runs host commands, settings (2026-10-19: a bot's own rules and docs, its person's logins, computer choice and creating a pairing for the speaking person are `own`, never for a service turn, see docs/member-admin-audit.md) |

## Roles (widest scope per tier)

| Role | read | own | dispatch | claim | admin |
|---|---|---|---|---|---|
| viewer | team | no | no | no | no |
| member | team | self | self | self | no (a few self-scope exceptions: create a bot or room of their own) |
| operator | team | team | team | team | no |
| admin | org | org | org | org | org |
| service | team | self | self | self | no (and never `vm:exec` or `actions:invoke`) |

The `service` role holds claims at `self`: automation can hold work it
started, not take over someone else's.

## Tool names

The Perspicax names are the ones Perspicax 1.8.28 serves (connector
`mcp/meta_tools.rs`, `mcp/memory_tools.rs`, `mcp/flow_tools.rs`,
`mcp/sagax_tools.rs`): `api_list`, `api_search`, `api_describe`,
`api_result_query`, `api_lookup`, `api_plan`, `api_upload`, `api_reload`,
`identity`, `flow`, `flow_action`, `review_write`, the memory and work tools,
and the Sagax tools. A Perspicax tool that stands for a Sagax capability is an
alias of its permission (`sagax_send` is `bots:send`); the memory v2 names of
the draft behind a switch (Perspicax #326: `memory_find`, `memory_save`,
`memory_remove`, `memory_suggestions`) are aliases too. A test lists every
name 1.8.28 serves and fails when one has no permission, so enforce cannot
refuse a real tool by omission.

The per-profile tools are matched by name (`profileToolCall`); the
`-` separator of Perspicax's `tool_name_separator` is read too:

| Name | Permission | Tier |
|---|---|---|
| `<profile>__query` | `api:query` | read |
| `<profile>__write`, `<profile>__<resource>_write` | `api:write` | dispatch |
| `<profile>__action` | `api:action` | dispatch |
| `<profile>__read_action` | `api:action.read` | read |
| any other `<profile>__<operation>` | `api:operation` | dispatch (not known to be a read) |

## Dynamic keys

A per-profile call also gets a resource key, `<profile>:<resource>.<verb>`,
from its name and arguments:

| Call | Key |
|---|---|
| `cw_psa__query` `{ resource: "tickets" }` | `cw_psa:tickets.read` |
| `cw_psa__write` `{ resource: "tickets", action: "update" }` | `cw_psa:tickets.update` |
| `cw_psa__tickets_write` `{ action: "delete" }` | `cw_psa:tickets.delete` |
| `cw_psa__action` `{ action: "merge" }` | `cw_psa:merge.run` |
| `cw_psa__read_action` `{ action: "usage" }` | `cw_psa:usage.read` |
| `cw_psa__find_tickets` | `cw_psa:find_tickets.run` |

A call is allowed when the role holds the kind's permission and no deny rule
matches the key. `SAGAX_MCP_DENY` lists the rules, comma separated: an exact
key, `cw_psa:tickets.*` or `cw_psa:*`. A denied key is reported as
`resource_denied` and the audit row carries `resource`. Segments must be
plain slugs; when a catalog of the Perspicax APIs is passed to the guard
(`ApiCatalog`), a profile it does not list, or a query or write on a resource
it does not list, gives no key. Reading that catalog from Perspicax at turn
time is not wired yet.

## Where the guard runs

- The agents proxy, for every tool of the agents catalog (the native
  Perspicax tools and the claim tools included).
- `PerspicaxMcp.relay`, for every `tools/call` a bridge relays to a Perspicax
  profile, with the same mode and identity. `PerspicaxMcp.callTool` (the
  native tools' path to Perspicax) relays with `judged`, since the proxy
  already judged and audited that call: it is not judged twice.

Identity is set by the harness when it builds the integration
(`mcpIdentityEnv`): the speaking person, their role (Perspicax admin is
`admin`, manager is `operator`, anyone else `member`) and teams; a turn with
no person is `service`.

## Audit

Both guards write to the server's activity log (category `security`, actions
`mcp.call`, `mcp.shadow`, `mcp.deny`) through `POST /api/internal/mcp-audit`
for the proxy and directly for the relay. Only the whitelisted fields of the
record are kept. If the server cannot be reached, the proxy writes the
`[mcp-audit]` line on stderr.

### Audit volume

Auditing every allowed call costs one local POST and one activity-log line
per tool call, and a turn makes many tool calls (reads, memory, transcript
pages). In shadow mode nothing is refused, so those rows would mostly bury
the denials the shadow period exists to find. The choice:

- `shadow` audits every denial (`mcp.shadow`) and no allowed call by default.
  `SAGAX_MCP_AUDIT_SAMPLE` (0 to 1) audits that share of the allowed calls
  (`mcp.call`), to measure what enforce would write before turning it on.
- `enforce` audits every call, allowed and denied: the record of what ran is
  then the point, and that mode is opted into.
- `off` audits nothing.

## Adding a tool

Add the tool to the catalog, add its row to `MCP_PERMISSIONS` with a tier,
and update `coverage.md`. The registry test fails while a catalog tool has no
permission. Never rename a key; retire it and add another.
