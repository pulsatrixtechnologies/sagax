import { DRIVER_KIND as CLAUDE_CODE_DRIVER_KIND } from "../drivers/claude/config.ts";
// How a model calls the Perspicax tools reliably (#1209). Small and local
// models in particular get these wrong: they put fields beside `action`
// instead of in `set`, write before checking, filter on names and statuses,
// pass offsets on local times, pull a huge result into the chat and add
// totals by hand. The Perspicax server's own instructions say how to find and
// describe operations; this is the calling discipline on top, added to the
// prompt of a turn that has Perspicax tools mounted. The server instructions
// win when they say otherwise.
export const PERSPICAX_CONVENTIONS_PROMPT =
  "\n\nPerspicax tool conventions (the server's own instructions win if they differ):"
  + "\n- Tool discovery (#3019): never guess a tool id. Call only an id your tool list shows (the Tool ids point below says which server lists which tool); a guessed id fails and costs a visible step. To find a vendor operation, the first call is `api_search` (a result names your tool for it and the resource or action to pass), then `api_describe` for its fields when needed, then the tool it named. `api_search` and `api_describe` search vendor API operations only, never MCP tool names such as `identity_switch` or `memory_find`. Only when a server lists `search_tools` (a large catalog) find its other account tools there and run them with `call_tool`; a server that does not list it has none. After `identity_switch`, search again for the selected role's vendor tools. Pass every argument in the shape the tool's schema gives: an object (a `filter`, `set`, `expect`) stays a JSON object, never a string."
  + "\n- Roles (2026-11-05): Sagax starts the turn under its role (the routine's \"Au nom de\", the person's pick, else the person's own access) and shows it on every step. Do not call `identity_switch` before each operation. Switch when the work needs another held role, and back again: switches go back and forth in a turn, one per call when needed (#2960). When the person names a role to use (\"lis-les comme Dispatch Agent\", \"avec le rôle Gestionnaire de service\"), that is their GO: call `identity_switch` with that role's profile, then the read; never refuse before trying it, even when an earlier turn ended on a STOP for that read (a STOP holds for its own turn only). On a read refused with 403, Sagax itself tries each other held role that may read it, in turn, before answering: a read never needs an approval card and never waits for the person (QA 0.8.69, #3062). Never \"no data\". A read refused under every held role is a block: report the API member and role that refused it and the missing permission, never route around it with other tools or connections (#2581). A write 403: Sagax tries a held role that writes it (rule or card); its STOP blocks that call only, never `identity_switch`. A guard or policy refusal (`flow_guard`, unknown resource) is no permission problem: fix the call. When Sagax's note says it read once under another role, or you switched to one for the read, say so to the person in one line, by the role's name, never an id (\"Lu avec le rôle Technicien\") (#2670)."
  // QA 0.8.66 F2/F10, moved here and corrected by #2912: `identity` searches
  // records; the held roles come from `identity_switch` without arguments,
  // and only when Sagax sent no note (a STOP note means no role is left).
  + "\n- A read refused with 403 under a limited role (Dispatch Agent included): when Sagax's note names a held role, follow it. When no Sagax note came with the 403, `identity_switch` without arguments lists the roles you hold and what each can do (a read, no switch); try one that may read it, then the next one if it is refused too. A Sagax note starting with STOP means no held role is left for that read or the person chose to stay in that role: no `identity_switch` for that read, name the API member and role that refused it and the exact missing permission at once. Never answer \"it needs an admin\", \"our rules forbid that role\" or \"it cannot be changed\": name the exact missing permission instead."
  // QA 0.8.66 F2/F3, corrected by #2912: filter on the board's id, and a
  // count per board never comes from a page cut by `limit`.
  + "\n- ConnectWise ticket counts (\"mes billets ouverts\", \"combien de billets sur <tableau>\"): filter service.tickets on ids and flags (owner/id=<member id>, board/id=<board id>, closedFlag=false) and read `total`. Get the board's id from service.boards or from a ticket on that board; a boards listing cut short by your permissions does not mean the board is missing, and a board name is never a filter. A count per board is one call per board read for its own `total`, or an aggregate over every matching ticket, never grouped from a result cut by `limit`. Give the real total and say when the rows shown are only part of it (\"15 au total, voici les 10 premiers\"); never build a person's list from one board. A list read under one role covers only the boards that role sees (QA 0.8.67 G1, #2960): Sagax reads the first cross-board list of a turn under every held role and keeps the one that sees the most boards (QA 0.8.69, #3062); give that count as the total and say in one line which role read it (\"15 billets, lus avec le rôle Gestionnaire de service\"). When Sagax only notes that other held roles may see more boards, never present the count as complete: read it again under each of them yourself (identity_switch, then back; no approval needed for a read) and give the widest."
  // QA 0.8.67 G3 (#2960): the week's time took 413 s in a 403 loop on
  // project tickets; one time.entries read with the server's total answers it.
  + "\n- A member's time for a week (\"mon temps de la semaine\", \"mes heures\"): one time.entries read filtered on member/id=<member id> and timeStart from the week's first day (local, no offset) to its end, with the total from the tool or an `api_result_query` aggregate (sum(items[].actualHours)) and a per-ticket sum the same way (items[?chargeToId==`N`]), never added by hand. Ticket or project titles are optional: read them only when the current role reads them, else name the ticket by its number and the entry's notes (\"d'après les notes\"); on a 403 for a title Sagax already tried the other held roles: on its STOP, skip the titles. A 403 on project or service tickets never blocks the hours: give the total first."
  + "\n- Direct reads (#2577): a simple read or lookup (one ticket, one list, one record) calls the vendor tool directly, first. No skills_list, workspace_read, sagax_help, flow_run or identity_switch before it. Flow (flow_run and the Flow skills) is for a routine or a multi-step procedure only. A tool already listed or found in this conversation is known: call it, do not search for it again. In Sagax this order wins over the Flow skills' \"catalog first\" rule (#2670): a clarifying question and a single-record read come before any `catalog`; the catalog is read once a routine or a multi-step procedure actually starts."
  + "\n- Served products (#2578): the Guide's Scope line and `api_list` say which products are served. When the product asked for (an RMM, a backup tool, any vendor) is not served, answer in one line that it is not served here (\"Datto RMM n'est pas servi ici\"), after at most one `api_list` check, and do not search other sources for its data. Never report \"no X\" when the source of X is not served: a missing source is not a source with nothing in it. Say which case it is."
  + "\n- A write tool takes `resource` and `action` (create, update or delete); every field to write goes inside `set`, never beside `action`. An update or delete names the record with `id`; a sub-resource also takes `parent`. Pass `expect` (the fields the record must still have) to refuse a write on a record that changed."
  + "\n- Run the write with `_dry_run: true` first and read what it would send; send it for real only once that is right."
  + "\n- Filter on ids and flags (a reference is `{\"id\": N}`, a status or board is its id), never on a display name or a translated status label: look the id up first."
  + "\n- Pass local times and dates without an offset (\"2026-10-26T09:30:00\"); the connector converts them. Results show local times with their offset."
  + "\n- A result above the size limit comes back as a handle: read it in one projection with `api_result_query` (a JMESPath that keeps only the fields you need), never page through it or paste it whole. The query is plain JMESPath plus two aggregates: its functions are length, sum, avg, min, max, min_by, max_by, sort_by, reverse, contains, starts_with, ends_with, join, keys, values, to_string, to_number, type, not_null, count_by and sum_by. There is no split, regex, lower, upper, trim, replace or date function: filter with contains or starts_with on the raw field, compare ISO dates as strings, and do any other transformation on the rows you read back."
  + "\n- Totals, counts and sums come from an aggregate the tool computes, never from adding rows yourself.";

/** Whether a prompt section already carries the conventions (the Perspicax
 * mount's section), so a turn never reads them twice. */
export function hasPerspicaxConventions(text: string | undefined): boolean {
  return Boolean(text && text.includes(PERSPICAX_CONVENTIONS_PROMPT));
}

/** Review of #2912: a Claude turn on the person's own account can reach
 * ConnectWise through a claude.ai connector (a "Pulsatrix Perspicax" or
 * ConnectWise one) without Sagax's Perspicax mount. That turn gets the
 * same conventions, once: not when the mount already brought them, not when
 * no such connector is connected. */
const CONNECTOR_CW = /perspicax|connectwise/i;
export function connectorConventionsPrompt(connectors: ReadonlyArray<{ name: string; status: string }> | undefined, alreadySent: boolean): string {
  if (alreadySent || !connectors) return "";
  const names = connectors.filter((connector) => connector.status === "connected" && CONNECTOR_CW.test(connector.name)).map((connector) => connector.name);
  if (!names.length) return "";
  return `\n\nThe claude.ai connector${names.length > 1 ? "s" : ""} ${names.map((name) => `"${name}"`).join(", ")} reach${names.length > 1 ? "" : "es"} ConnectWise and the other Perspicax products: the conventions below apply to ${names.length > 1 ? "their" : "its"} tools (prefixed mcp__claude_ai_).${PERSPICAX_CONVENTIONS_PROMPT}`;
}

/** The driver kinds a turn's instance carries (server/drivers/claude/config.ts
 * DRIVER_KIND, server/drivers/acp/grok.ts support.driverKind). */
export const CLAUDE_DRIVER_KIND = CLAUDE_CODE_DRIVER_KIND;
export const GROK_DRIVER_KIND = "grokAgent";

/** QA 0.8.67 G8 ("No such tool available: Api search"): a routine named a
 * Perspicax tool by its title or bare name, and the engine had no tool by
 * that name. Each engine exposes the mount's tools under its own exact id;
 * this names that id form for the engine the turn runs on.
 *
 * #3019: on a server linked to Perspicax, the agents server lists the
 * gateway tools (PERSPICAX_TOOLS: api_search, api_describe, api_result_query,
 * identity, flow...), and the account mount withholds its copy of them (#2189,
 * agents-tool-priority.ts). Naming `mcp__perspicax__api_search` there sent the
 * bot to a tool that does not exist, then to a guessed `search_tools`, before
 * `mcp__agents__api_search`. `gatewayServer` names the server that really
 * lists them; the profile's own tools (`cw_psa_query`, `identity_switch`)
 * stay on the account mount. */
export const GATEWAY_FINDER_TOOLS = ["api_search", "api_describe", "api_list", "api_result_query", "api_lookup", "identity", "flow"] as const;
export function perspicaxToolIdsPrompt(server: string, driverKind: string | undefined, gatewayServer?: string): string {
  const gateway = gatewayServer && gatewayServer !== server ? gatewayServer : server;
  const finders = GATEWAY_FINDER_TOOLS.map((tool) => `\`${tool}\``).join(", ");
  const never = `never a display title such as "Api search", never a name from a routine's text without its prefix, never a server prefix your tool list does not show`;
  if (driverKind === CLAUDE_DRIVER_KIND) {
    const id = (on: string, tool: string) => `\`mcp__${on}__${tool}\``;
    const split = gateway !== server
      ? ` The finding tools (${finders}) are on the \`${gateway}\` server: ${id(gateway, "api_search")}, ${id(gateway, "api_describe")}, ${id(gateway, "api_result_query")}; \`${server}\` does not list them. The account's own tools are on \`${server}\`: ${id(server, "cw_psa_query")}, ${id(server, "identity_switch")}, each product's \`<product>_query\`, \`_write\` and \`_action\`.`
      : ` For example ${id(server, "api_search")}, ${id(server, "api_result_query")}.`;
    return `\n- Tool ids: tools are named \`mcp__<server>__<tool>\`.${split} Call them by that exact id, ${never}. A tool your list shows as deferred is loaded with ToolSearch (select:<id>) before its first call.`;
  }
  if (driverKind === GROK_DRIVER_KIND) {
    const split = gateway !== server
      ? ` The finding tools (${finders}) are \`${gateway}__<tool>\` (\`${gateway}__api_search\`, \`${gateway}__api_result_query\`); the account's own tools are \`${server}__<tool>\` (\`${server}__cw_psa_query\`, \`${server}__identity_switch\`).`
      : ` For example \`${server}__api_search\`, \`${server}__api_result_query\`.`;
    return `\n- Tool ids: reach this server's tools with use_tool and tool_name \`<server>__<tool>\`, the exact id.${split} ${never.charAt(0).toUpperCase()}${never.slice(1)}. search_tool is a native tool: call it directly, never through use_tool. A server's own \`search_tools\` is a different tool, reached with use_tool as \`${server}__search_tools\` and only when that server lists it.`;
  }
  const split = gateway !== server ? ` (the finding tools ${finders} on the \`${gateway}\` server, the account's own tools such as \`cw_psa_query\` on \`${server}\`)` : ` (the \`${server}\` server's \`api_search\`, with the prefix your tool list gives it)`;
  return `\n- Tool ids: call each tool by the exact id your tool list shows for it${split}, ${never}.`;
}

/** #3019: the server whose catalog lists the Perspicax gateway tools. The
 * agents server serves them (SAGAX_PERSPICAX_TOOLS, agentsIntegration.ts) on a
 * server linked to Perspicax; elsewhere the account mount lists its own. */
export function perspicaxGatewayServer(identityKind: string | undefined, perspicaxLinked: boolean): string | undefined {
  return identityKind === "perspicax" && perspicaxLinked ? "agents" : undefined;
}
