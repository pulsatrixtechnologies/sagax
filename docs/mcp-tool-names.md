# MCP tool names on Grok: never drop a connector tool

**Incident (2026-10-11).** Bots on Grok on the production server did not have
`cw_psa__query`, `cw_psa__write` or `cw_psa__action` from any Perspicax
profile (`perspicax_profil_ottoline_limited`, `perspicax_quasar_agent`).
Grok names an MCP tool `server__tool` and *skips* a tool whose qualified key it
cannot admit (grok 1.0.50 user guide, `07-mcp-servers.md`, "What Grok admits"):

| Rule | Skipped example |
|---|---|
| exactly one `__` in `server__tool` | `cw_psa__query` |
| tool in `[A-Za-z0-9_-]` | `files.read`, `ns:do` |
| no `___` (tool starting with `_`) | `_private` |
| key at most 256 characters | very long names |

The CLI only wrote `Skipping MCP tool` to its own log; the bot saw nothing.

## What Sagax does now

- **Explicit alias map, never re-splitting.** Grok's ACP support sets
  `mcpToolNames: "grok"`; every connector server (Perspicax profiles, URL
  and stdio servers) is mounted through `server/mcp-gate.ts` with
  `SAGAX_GATE_TOOL_NAMES=grok`. The gate registers each tool under an
  admissible name (`server/mcp/mcp-tool-names.ts`) and keeps `alias -> upstream
  name`; a `tools/call` is translated through that map before any check.
  `cw_psa__query` becomes `cw_psa_query`. Every `__` in a tool name, on
  any API, collapses to one `_`.
- **The bot never sees a name it cannot call (2026-11-02).** A bot on Grok
  copied `cw_psa__query` from Perspicax's text, called
  `<server>__cw_psa__query`, and Grok answered "Tool not found" before the
  call reached the gate. The gate now rewrites every renamed tool's
  connector name to its alias in the server's instructions, the tool
  descriptions and input schemas, the results of the gateway's own tools
  (the ones without `__` in their name: api_search, api_describe, api_list,
  api_plan, flow...) and every error text; a product tool's result is
  vendor data and stays as it came. An argument value that is exactly an
  alias (api_describe's `name`, an api_plan step's `tool`) is mapped back to
  the connector name before any check. It is a pure name mapping: nothing
  else in the text changes, and a name that was not renamed stays. The
  instructions come before the catalog, so they use the alias the catalog
  will give (same rule); the gate warns if the catalog registered a
  different one.
- **Deterministic, collision-free, never dropping.** Invalid characters become
  `-`, `_` runs one `_`, a leading `_` goes; a name that would collide with
  another tool, or exceed 256 characters, gets an 8-hex sha256 suffix of its
  original name. Admissible names always keep their own name.
- **Loud, visible failures.** Each rename is a `WARNING` and any tool still
  unregistrable an `ERROR` on the gate's stderr; each gate writes
  `DATA_DIR/mcp-tool-names/<server>.json` (`advertised`, `registered`,
  `renamed`, `unregistrable`, `parity`, `status: ok|renamed|mismatch`),
  served at `GET /api/mcp/tool-names`. Settings > Plugins > a server > Test
  shows each renamed or unregistrable tool on its row. A URL server the ACP
  driver cannot mount is logged instead of skipped silently.
- **Parity check.** `toolNameParity` asserts a bijection between advertised
  and registered names, every one admissible by Grok's rule. The gate runs it
  on every catalog it relays (report `parity`); CI runs it through the real
  gate process (`server/mcp-gate-tool-names.test.ts`) and the smoke script
  (`scripts/smoke-mcp-tool-names.test.ts`).

## Post-deploy smoke

1. Gate parity inside the deployed image (fails with exit 1 on a mismatch):

   ```bash
   docker exec -i -e SMOKE_GATE=/app/dist-server/mcp-gate.js pulsatrix-pulsabot-1 node - < scripts/smoke-mcp-tool-names.mjs
   ```

2. Live, read-only: in a NEW thread, ask a bot on Grok that has a Perspicax
   profile to list that connector's tools and call `cw_psa__query` (via its
   registered name) for one ticket or system info. Compare the tool list with
   the profile's own catalog (Perspicax `api_search`, or the same profile from
   another MCP client): every tool must be there, `cw_psa__*` under their
   aliases. Then check `GET /api/mcp/tool-names` shows no `mismatch`.

## Known limit

Tool selection selectors (`mcp:<server>:<tool>`) still accept server names of
at most 32 characters (`shared/tool-scope.ts`); a 40-character Perspicax
profile slug cannot be narrowed by a selection. Unselected bots are not
affected.
