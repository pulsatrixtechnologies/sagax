# Capabilities: plugins, skills, MCP servers and connectors

Descriptions of the code: how it works today, its files and its tests.
Moved out of `AGENTS.md` (#3292), which keeps the rules only. When a
description here and a rule in `AGENTS.md` disagree, the rule wins and this
text is fixed. A pointer such as `AGENTS.md, "<section>"` in an older comment
now means the section of that title in one of the files of `docs/code/`.

## MCP after a cold cloud start (2026-11-04)

Turn setup can preopen Perspicax before the person's cloud environment is
ready. If its idle session expires before the engine's first `initialize`,
`PerspicaxMcp.relayFrame` reopens once through the entry's single flight and
returns the fresh initialize result with the engine's request id. Reopening
retains the same person, bot and generation, clears the old catalogue and
restores a selected role. It never replays a tool call. Regression:
`server/perspicax/perspicax-mcp.test.ts`.

## Skills follow the dispatched engine (#1987, 2026-11-04)

Real turns project the scoped inventory into their private task folder's
native skill directories (`server/skills/turn-skill-links.ts`), including
organization Flow, personal and bot plugins on a limit backup. Claude keeps
its native plugin loader; other file engines project the same selected
plugin files even when rows were marked native under a Claude primary.
Organization turns await the selected plugin copies in the person's
environment before dispatch, on every engine. Readiness resolves the thread
override and Auto choice for both the engine and skill probes
(`server/routines/routine-readiness-target.ts`). Previews and receipts
remain reads. Regressions: `turn-skill-links.test.ts` and
`start-turn-computer-workspace.test.ts` (temporary files and fake dispatch).

## Agents catalog budget (#1703, 2026-11-01)

The agents `tools/list` wire is pinned and size-budgeted by
`server/drivers/agents-catalog-wire.test.ts`. Default listing stays the full
catalog (Grok, Codex and Pi discover by name, #1314). Measured provider
limits: 128 tools per request (chat-completions), 160_000 UTF-8 bytes soft
ceiling for an agents listing (`AGENTS_CATALOG_BYTES_SOFT_CEILING`). The +2%
ratchet around `BUDGET_BASELINE` still catches accidental growth; raise the
baseline on purpose when a tool lands, do not shorten descriptions only to
squeeze under the old cap.

Growth path: `SAGAX_CATALOG_GROUPS=1` lists the chat-turn core plus
`list_tool_groups`, `load_tool_group` and `use_tool`
(`server/drivers/agents-catalog-budget.ts`). Every other tool stays reachable
by group. Claude already has deferred rare tools and the find_tool bridge;
Codex merges families. Prefer groups or an existing lazy path before cutting
copy. Margin per profile is printed by the wire-size tests.

## Scoped skill discovery and API plugin delivery (2026-10-31)

The turn, preview, Capabilities `promptIndex` and `skills_list` share
`scopedSkillInventory` and `server/skills/skill-discovery.ts`. The prompt renders
it per capability (`server/capabilities/capability-prompt.ts`, lot 3: 4,000 bytes and 30
full entries each, whole files only; past that budget every enabled reference
is still named with its route, never dropped, #3295); native Claude plugins stay native.
`skills_list` reads independently of skill authoring and pages by stable
scoped identity. Never restore the plugin scanner's silent 40-file cutoff.
Keep disabled descriptions and staged gists out of discovery, and derive
Me from the turn speaker.
API engines always receive the whole files in their prompt within the same
per-capability budget (Q8 C, say then fill, 2026-11-01), read through the
same checks as `workspace_read`: with both retrieval tools allowed they are
named by alias and the tools reach the rest; tools off, they are named by
file name and the prompt is all they get. File engines keep path delivery.
Preserve native file paths separately from aliases. The
organization's Flow reaches every engine (lot 3). Plugin hooks and LSP stay
out of non-Claude discovery; say so rather than claiming they execute.
The live plugin scan stays bounded per turn; durable metadata under
`DATA_DIR/plugin-metadata/` (built on install/update/config, dropped on
remove; a file or directory stamp change is a miss) keeps references beyond
that bound discoverable through `skills_list`. A miss uses the bounded scan,
is partial only when that scan stopped early, and queues one rebuild after
the turn; never rebuild inside the turn. `workspace_read` uses the same
selected plugin folders as discovery (Flow included on every engine). A partial or unreadable inventory is explicit in the
prompt, list and receipt.
`workspace_read` also resolves exact `skill-library/<name>/SKILL.md` and
`plugins/<name>/...` aliases, rechecking the current enabled assignment,
integrity and shadow winner. Engine switch and failover keep the same
selected skill bytes and per-person dependencies when the backup engine can
use the same retrieval tools.
Contract, preserved strengths and subsequent lots:
[`docs/plans/2026-10-31-grok-convergence.md`](docs/plans/2026-10-31-grok-convergence.md).
Lot 2 evidence: [`docs/plans/grok-convergence-engines-evidence.md`](docs/plans/grok-convergence-engines-evidence.md).

## Capabilities: one word for what a bot receives (2026-10-30)

The owner chose one notion for everything a bot receives on top of its
engine: a **capability** (fr « capacité »): a plugin, a skill, an MCP server,
a connector of an engine account, a Perspicax Role, Pulsatrix Flow. The page
that was Connect apps / Connecter des applications / Connected apps / Apps is
**Capabilities** (fr « Capacités ») everywhere: sidebar pill, palette, title,
iOS, server errors, the bot's prompt lines, sagax_help and the docs site
(`apps/docs/content/docs/connected-apps/`, path kept). Words, shared with
Perspicax (`docs/design/lexique.md` there):

- Source: where a capability comes from (a Git marketplace, Perspicax, the
  person's engine account, a file of the person, the Sagax catalog). The
  Sources tab lists marketplaces.
- Scope: This bot, Me, Organization (fr Ce bot, Moi, Organisation). Today
  the toggle names these three scopes. Me is the default; a bot panel
  opens This bot. Organization is offered to the installation manager.
- State: available, installed, on, to connect, update offered, set by the
  organization, offered by the organization, not served by this engine.
- Never « plugiciel »: a plugin is a plugin in both languages.

Rules kept by `src/locales/words.test.ts` ("names the Capabilities page and
no retired tab"): no English string says Connect apps, Connected apps,
Plugins →, Manage > Advanced, > Manage or Managed on Grok; no French string
says Connecter des applications, Applications connectées, plugiciel, Gérer >
Avancé or Géré dans Grok. A text that sends the person somewhere names a tab
that exists: Capabilities > Discover, Installed, Providers, Pages, Sources.
Grok's cloud connectors are listed from Grok's own catalog and say « Non
vérifiable » (Sagax cannot check them). `plugins.claudeOnly` says what a
non-Claude engine really gets (skills, commands and agents, the
organization's Flow included, in the prompt index on a file engine; on Grok
and API engines, when skills_list and workspace_read are allowed, whole
files in the prompt and those tools for the rest; hooks/LSP stay on Claude).

## Capabilities: personal references and complete plugins (lot 2, 2026-10-30)

`PersonCapabilities` (`server/people/person-connections.ts`, legacy export
`PersonConnections`) keeps MCP, GitHub, plugin records/config values and
skill references in `principals/<pid>/capabilities.enc`. Its first read
migrates `connections.enc` only if the new file is absent. A corrupt new
file never falls back or overwrites it; an empty new file never revives
old connections. Keep the existing file/AAD compatibility tests.

- `BotPlugins` uses the same installer and update calculation for bot and
  Me; `personalPluginStorage` encrypts Me records and namespaces credential
  picks by person. `/api/me/plugins` and `/api/me/skills-library` derive
  the person only from the session (solo: the local operator), never from
  a query/body id. Me and a bot's owner manage their own scope without an
  admin permission. Sharing a marketplace remains organization impact.
  Skill commands resolve the actual local operator in solo mode and the
  active speaker in organization mode, without an owner fallback.
- `selectPluginScopes` chooses current folders Organization > Me > Bot.
  `scopedPluginFolders` and `scopedPluginMcp` feed execution and the receipt.
  Missing copies claim no name. Bot-private installs stay in their owner's
  environment when another person speaks through a shared bot.
  `workspace_read` resolves these same folders for the active turn's speaker,
  including Me skills. Organization prompts publish the copied sandbox paths
  (`/workspace/sagax-plugins/<name>` and `/workspace/sagax-capability-skills/me`);
  only these exact mounts have absolute aliases in `workspace_read`. An
  unselected mount cannot fall back to a stale workspace copy.
- MCP declarations are private execution data, stripped from native plugin
  folders and public lists/packages, then mounted separately. Commands
  cross `sagax-stdio` into the turn person's environment on org servers;
  solo uses the actual installed root. The per-frame relay revalidates
  the current install. Existing namespace, environment, address and MCP
  policies apply. Keep bin files needed by those sandbox commands.
- `InstallationPlugins` restores complete sanitized copies from the old
  marketplace records at startup and after install/update. It serves
  agents, commands and skills to file engines; newly declared commands
  use the same sandbox relay. MCP already mapped into config keeps its
  switches, bot selections and OAuth: the complete copy cannot bypass
  those settings. Reinstall is Update, rather than an already-installed
  409; transient concurrent-update conflicts remain meaningful.
- Skills library defaults on. `PersonalSkills` owns one verified source
  referenced by all the person's bots. A saved Me skill is reviewed by
  the person; a changed-on-disk or disabled file is not indexed. The same
  source supports explicit /name commands. Me names replace lower-scope
  bot prompt entries and managed native links without changing that
  bot's stored switch; imposed org skills win. The per-capability index
  and its consolidated budget follow in lot 3.
- Validation: `capabilities-scopes.e2e.test.ts` drives the real HTTP routes
  for two bots and all three plugin scopes; personal-skills, plugin scope,
  install, receipt, integrity and native-link tests cover isolation.

## Built-in plugins: REA (2026-11-06)

Sagax ships plugins of its own, on for every bot. The first is REA
(https://github.com/morluto/rea, MIT, npm `rea-agents`): reverse
engineering of binaries, .NET assemblies, APKs and JS/Electron bundles,
plus runtime observation.

- One constant: `shared/builtin-plugins.ts` (`REA_VERSION`, `REA_PLUGIN`).
  The launch is `npx -y rea-agents@<REA_VERSION> mcp` with
  `REA_MCP_INPUT_SCHEMA_PROFILE=compact`; `REA_MCP_OUTPUT_SCHEMA_PROFILE`
  stays unset (6.8.0 takes only `full` or `off`, exits at start on
  anything else, and `off` fails at start too, #3181). Bumping REA = that constant,
  its NOTICE line, a smoke run of `npx -y rea-agents@<ver> --help`.
- Never interactive: `npx -y` and `npm_config_yes` answer npm, the update
  notifier is off, and the Hopper first-run demo/license dialog is a macOS
  window REA waits for a bounded time (`REA_HOPPER_DEMO_DIALOG_TIMEOUT_MS`,
  10 s) before the tool call answers an error. Sagax never runs
  `rea-agents setup`: the mount is Sagax's own, no harness config changes.
- On by default: `WireBot.builtinPlugins[id] === false` is the only off.
  A bot saved before a built-in existed has no entry and has it on (no data
  migration). PATCH `builtinPlugins` takes known ids with booleans
  (`parseBuiltinPluginsPatch`), merged into the bot's map; permission
  `bots.behaviour`; settings action `bot.builtinPlugins`; zip `settings`.
- Mounts: `scopedPluginMcp` appends `builtinPluginMcp(bot)` last (an
  installed server keeps its name), as scope `bot`, key `builtin:<id>`, so
  `mountPluginMcp` mounts it like any plugin server: on the desktop as is,
  on an organization through `personalStdioIntegration` in the person's
  sandbox (whose relay re-resolves the same entry).
- Missing runtime: on the desktop `builtinRuntimeMissing` looks `npx` up
  on PATH (cached 60 s). Missing: no mount, and the row keeps its place
  with reason `needs_runtime` ("Needs Node.js 22.23 or later"). An
  organization does not check: the sandbox relay answers the error.
- The list: `resolveBotCapabilities` adds one `plugin:bot:builtin:<id>` row
  (`builtin: <id>`, source Sagax with the version); the pluginMcp loop turns
  it on with its mounts. Plugins > Installed draws the icon chip, the
  translated description (`capabilities.builtin.<id>.description`) and a
  switch (`onToggleBuiltin`: updateBot, flush, reload). There is no
  Capabilities tab in the bot panel (2026-11-01): `CapabilitiesTab` is the
  list Plugins > Installed draws.
- Tests: `shared/builtin-plugins.test.ts`,
  `server/capabilities/builtin-plugin-mounts.test.ts` (spawn mocked),
  `server/capabilities/capabilities.test.ts`,
  `src/components/bot-settings/CapabilitiesTab.test.ts`. Gallery:
  `bot-capabilities.html?rea=on|off|missing`.

## Capabilities: one resolved list per bot (lot 1a, 2026-10-30)

One server function says, for ONE bot and ITS engine, everything the bot
receives on top of its engine, read from today's stores with nothing
migrated and nothing a turn mounts changed: `resolveBotCapabilities`
(`server/capabilities/capabilities.ts`), served by `GET /api/bots/:id/capabilities`
(`server/routes/bot-capabilities.ts`, member scope `orgDirectory`, the
handler checks `viewerBotLevel`; `?engine=<instanceId>` previews another
engine), by the console admin API's `GET bots/{id}/capabilities`
(`server/org/org-admin-bots.ts`, lot 1d: the same list for the console person,
manager in reach or the owner by `own-bot`, `docs/org-admin-api.md`) and by
the main bot's `sagax_settings` get `bot.capabilities` (read only).
Every screen reads this list (Capabilities > Installed in the
bot's scope, the iPhone, the Perspicax console's bot
sheet). Keep these rules, covered by `server/capabilities/capabilities.test.ts`,
`shared/capabilities.test.ts` and `server/routes/bot-capabilities.test.ts`:

- The contract is `shared/capabilities.ts` (`Capability`, `BotCapabilities`):
  form (plugin, skill, mcp, connector, role, flow), source, scope (bot, me,
  organization, installation, account), state (on, off, to_connect,
  imposed, not_held, not_served, reserved, unverifiable), `reason`, what the
  engine receives (`engine`) and the MCP names it mounts (`mounts`). The
  desktop, iOS and the console read these field names: add fields, never
  rename one without saying so in the PR. Names are readable
  (`shared/readable-name.ts`, moved from `src/lib/installed-model.ts`);
  `key` is stable and never shown; no id in a name.
- One engine matrix, `engineReceipt` (shared/capabilities.ts), for the
  resolver and the texts: Claude loads plugins whole (`--plugin-dir`:
  native); other engines with files read plugin skills, commands and
  agents through the turn's per-capability file index; engines without
  files (`ENGINES_WITHOUT_FILES`, which `supportsWorkspaceFiles` reads)
  always receive whole instruction files from the same selected scopes
  (`server/capabilities/capability-prompt.ts`, Q8 C): named by alias with those tools
  for the rest when `skills_list` and `workspace_read` are allowed
  (`skillDiscovery`), by file name when the tools are off. The organization's Flow reaches every
  engine through this contract (lot 3). MCP is `mounted` by an
  engine with files, `proxied` by Sagax for one without, `none` without
  `customMcp`.
- An installed plugin record is historical, not proof of ownership. Fold
  an installation MCP server or library skill into a plugin only when its
  current `source` matches the marketplace and exactly one record claims
  that name. A replacement or an ambiguous claim keeps its own row, with
  one mount. Read library provenance even while the library is off. Flow
  name priority follows the actual bot folders passed to Claude, never an
  enabled record whose copy is missing.
- The list and the turn use the same functions (`server/turns/turn-mounts.ts`):
  `engineServerMcp` and `serverMcpAsPerson` (this installation's servers,
  `engineMcpServers` / `mcpServersAsPerson`), `personalMcpPrecheck` (the
  person's own servers, `mountPersonalMcp`), `turnPluginDirs` and
  `turnPluginPromptDirs` (`pluginDirsFor`, `turnCapabilityPrompt`). The fixed
  `perspicax` account mount is added by the turn and capabilities paths. The
  test "a turn mounts exactly what the list says" checks, for Claude, Codex
  and Grok, that the MCP names and plugin folders a turn gets equal the
  list's capabilities that are on (or imposed) and received. Change one,
  change both through these functions.
- The viewer stands in for the speaker of a turn: their own MCP servers,
  their GitHub connection, the Roles they hold (`not_held` otherwise, C-5).
- What used to be silent is a row with a reason: a personal server whose
  name another server of the turn has (`name_taken`, C-18), an
  installation server a command on an organization server (`host_command`),
  refused by the policy, left out of the bot's own list, waiting for
  GitHub; a plugin "Everyone" whose library skills reach no bot
  (`library_off`, `not_assigned`, C-2); the organization's Flow held back
  (`guard_off`). An installation server that needs a sign-in is still
  mounted (state on, `connect.reason: sign_in`); a personal one is not
  (`to_connect`). A plugin "Everyone" folds its servers into its row.
- `promptIndex` reports the exact prompt bytes, file count and omissions
  per capability (`Capability.promptIndex`) and in aggregate, from
  `capabilityPrompt` fed by `scopedSkillInventory`: 4,000 bytes and 30
  full entries per capability, whole instruction files for chat engines, paths
  for file engines, never a cut file; references past the budget are listed
  by name with their route (`named`), never dropped (#3295). Oversized files
  do not prevent smaller files or another capability from being served.
  Preview and receipts do not touch native links.
- Linked Flow has one row `flow:organization:pulsatrix-flow`, combining
  product and tenant instructions and the installed signed pack digest.
  An official GitHub `pulsatrix-flow@pulsatrix` installation is an alias,
  never a second mount and never a way around the organization's Flow switch.
- Grok's account connectors are a static catalog: `unverifiable`, never
  "connected".

## Personal capability storage (lot 2, 2026-10-30)

`PersonCapabilities` (`server/people/person-connections.ts`, also exported under
the existing `PersonConnections` name) owns one encrypted
`principals/<pid>/capabilities.enc`: MCP servers, GitHub, installed plugin
state, plugin configuration and assigned library skills. Existing connection
routes use that same store. The first successful read of `connections.enc`
writes version 2 atomically and keeps the encrypted original for recovery.
An existing new file always wins, including an empty document; a corrupt
new file is never replaced from the legacy copy. A store that cannot be
decrypted is never overwritten.

Plugin records share `server/capabilities/capability-plugin-state.ts`. `BotPlugins` takes
an optional scoped storage adapter; `personalPluginStorage`
(`server/plugins/person-plugins.ts`) keeps its state and values encrypted and its
source files under that person's `capability-plugins/`. It writes no
plaintext `state.json` or `config.json`. Credential selections use a
`person:` namespace so a person and a bot with the same id cannot share a
selection. Forgetting that scope removes plugins and their values while
preserving the person's other capabilities and GitHub connection.

## Capabilities: three config stores (lot 5, 2026-11-01)

Eleven legacy capability config files become three stores. Inventory and
deprecation window: `shared/capability-stores.ts`
(`CAPABILITY_STORE_INVENTORY`, `CAPABILITY_ROUTE_DEPRECATION` until
2027-11-01). Design and file map: `docs/migration/capabilities-stores.md`.

- Bot: `bot-capabilities/<botId>/capabilities.json`
  (`server/bots/bot-capability-store.ts`). Absorbs
  `bot-plugins/<bot>/state.json` and `plugins/config.json`. Plugin source
  trees stay under `bot-plugins/<bot>/plugins/`.
- Person: `principals/<pid>/capabilities.enc` (lot 2). Legacy
  `connections.enc` is backed up and retired after verify.
- Installation: `installation-capabilities.enc`
  (`server/capabilities/installation-capability-store.ts`, vault key, AAD
  `sagax installation-capabilities v1`). Absorbs marketplaces state,
  skills-library index, org-flow and org-capabilities state, and
  `config.json` mcpServers. Org and marketplace GitHub tokens stay in
  `github-credentials.enc` (`migrateGithubCredentials`); lot 5 only marks
  those sources migrated.

Migration at boot: `migrateCapabilitiesStores`
(`server/capabilities/capabilities-store-migration.ts`), same shape as
`migrateGithubCredentials` (backup `.capabilities-l5.bak`, write new,
verify, retire to `.migrated`). Idempotent; crash-safe; sealing and person
isolation preserved. Bridge:
`server/capabilities/installation-capability-bridge.ts`. Optional `capabilityStore` on
`BotPlugins` and `installationStore` on `PluginMarketplaces`.
The installation store holds the ORGANIZATION's library index only
(`skills-library/`): `server/skills/skill-library.ts` consults the bridge for
that root alone (`installationLibraryBridge`). A person's Me library
(`PersonalSkills.root`, `principals/<pid>/capability-skills/index.json`)
and every other root stay on disk under their own directory; never route a
per-person or per-bot root through the installation bridge (2026-11-01:
two persons' Me skills collided and leaked into the room prompt). The
one-time repair `skills-library-person-split` returns entries a dev build
misplaced. Regression: `server/skills/skill-library.test.ts` ("library roots"),
`server/org/org-harness-commands.e2e.test.ts` (two persons, Me skills and
personal MCP secrets apart from each other and from the installation).

Canonical routes: `GET /api/me/capabilities`,
`GET /api/installation/capabilities` (plus the lot 1 resolved
`GET /api/bots/:id/capabilities`). Legacy `/api/me/connections`,
`/api/marketplaces`, `/api/skills-library` and related fragments stay as
aliases with `Deprecation` / `Link` / `Warning` headers
(`server/capabilities/capability-route-deprecation.ts`). Tests:
`server/capabilities/capabilities-store-migration.test.ts`,
`server/capabilities/capability-route-deprecation.test.ts`. Bot package store shape:
`docs/bot-package.md`.

## Connect Apps: a Bots tab and one search (2026-10-29)

Browse Bots is Connect Apps' Bots tab, right after Discover (Discover · Bots
· Installed · Providers · Pages · Sources, `CONNECT_APPS_TABS`). The tab is
`BotCatalogPane` with `tabLabel` (its pages' back row says Bots; its home has
no back row and no search). Everything stays: categories, Featured, Shared
with me, My Bots, Organization, Templates and their tools, the xAI Bot
Marketplace, View all, a bot's page, Open. Discover's Browse Bots link opens
the tab. Every link to Browse Bots (`openBotCatalog`, New bot's and the
wizard's Browse templates, an install link) opens Connect apps on that tab
(`pluginsPage: "bots"`, Templates through `botCatalogTarget`); the
standalone window (`BotCatalogModal`, `botCatalogOpen`) keeps its content.
Browse Bots' lists are read once by Connect Apps
(`useBotCatalogSources`) for the tab and the search.

One search sits under the title and the scope, on every tab
(`ConnectAppsSearch.tsx`, model `src/lib/connect-apps-search.ts`). It looks
at plugins, apps, skills, MCP servers, bots (mine, shared, organization),
templates (xAI Bot Marketplace too), published pages and sources, groups the
matches by kind, and replaces Discover's and Browse Bots' own fields (one
option, one place). With text, the results take the tab's place; empty, every
tab shows its list. A result opens its page or its tab and empties the field.
Keyboard: arrows, Enter, Escape empties (then Escape steps back or closes as
before). The tabs' own filters (category pills) stay in their tab. Tests:
`src/lib/connect-apps-search.test.ts`, `src/components/PluginsPanel.gestures.test.ts`,
captures `scripts/capture/bots-tab.mjs`.

## A bot installs plugins, attaches MCP servers, rotates a routine's webhook key (2026-10-29)

`sagax_settings`: `bot.plugin` installs, updates, turns off or removes a
plugin of a configured marketplace for one bot (`/api/bots/:id/plugins`) or
for every bot (`everyone: true`, `/api/marketplaces/:m/plugins/:p`, the
organization's card on an organization server), as Connect apps does.
`bot.mcpServer` {name, attached} attaches or detaches one server (the handler
reads the bot's list; none means every server). `routine.webhook` reads a
webhook routine's address (no key in it: the key is a Bearer header) and,
with "rotate", gives it a new key that waits for the person to copy once in
the app (Show the token): a bot's replay of `POST /api/webhooks/:id/rotate`
(`x-sagax-bot-act`, or a bot act session) keeps the key pending
(`WebhookManager.rotatePending`) and never answers it. Tests:
`server/settings-actions.test.ts`, `server/triggers/webhooks.test.ts`.

## Web search with the person's own key (2026-10-26)

Decision: an engine with no web search of its own (OpenAI-compatible
endpoints and the local models served through them, Groq, Mistral,
Cerebras, MiniMax, the xAI API, pi, Cline, a custom ACP agent) searches with
the person's own provider: Brave Search, Exa, Parallel, Firecrawl, or their
SearXNG (base URL, optional key).

- Settings > Models and voice > Web search (`WebSearchSettings`): provider,
  key, Verify. The person's own setting, no admin right, also on an
  organization server (`/api/me/web-search`, `server/routes/web-search.ts`).
- The key is sealed with the vault key (AES-256-GCM, AAD `sagax web-search v1`,
  `server/web-search/store.ts`): `<data>/web-search.enc` solo,
  `principals/<id>/web-search.enc` per person on an organization server;
  left out of workspace backups. An answer carries `keyConfigured` and the
  last four characters, never the key.
- The tool is `sagax_web_search` (agents catalog,
  `server/drivers/agents-web-search-tools.ts`). It is shown only when the
  turn's engine has no native search (`server/web-search/native.ts`:
  Claude Code, Codex, Cursor, Antigravity keep theirs everywhere; Grok Build,
  Gemini, Qwen, Kimi, OpenCode, Droid and Hermes keep theirs unless an
  organization turn withholds their host tools) and the turn's person
  (speaker, or a routine's payer) saved a ready provider
  (`SAGAX_WEB_SEARCH`, a local file read, no network). An engine with its
  own search is never given it.
- `/api/internal/web-search` (`server/routes/web-search-internal.ts`) reads
  the key from the store and adds it to the HTTP request
  (`server/web-search/providers.ts`). The key is never in the tool's
  arguments, its result, an error, a log line, the prompt or the transcript.
  Results come back in `wrapUntrusted("web search", ...)`.
- `sagax_settings` `connections.webSearch` reads it (configured or not) and
  sets the provider or the SearXNG address, or forgets it; it refuses a key:
  the person pastes it in Settings.
- On an organization server a SearXNG address must resolve to public
  addresses (the server's own network is not a member's to reach); a solo
  server may use one on localhost or the LAN.
- Tests: `server/web-search/*.test.ts`, `server/routes/web-search*.test.ts`,
  `server/drivers/agents-catalog-web-search.test.ts`.

## A person's own connections, plugins and skills (organization mode, 2026-10-02)

Owner report: in production nobody could add the GitHub MCP, log into GitHub or
install plugins. Why: the server-wide MCP list was admin-only, hidden with
Connected apps, shared one token by all and ran commands on the host;
`claude plugin ...` typed by a bot hit the host Bash denial whatever
`SAGAX_CLAUDE_ALLOW` said; skills routes were admin-only; the environment
had no gh. Keep these rules, each covered by `server/org/org-connections.e2e.test.ts`
(OC-1 to OC-9), `server/people/person-connections.test.ts`,
`server/org/org-person-connections.test.ts`,
`server/github/github-connect.test.ts`, `server/bots/bot-plugins.test.ts`,
`server/turns/plugin-turn.test.ts`, `server/bot-plugin-act.test.ts`,
`server/sandbox/sandbox-stdio-mcp.test.ts`, `server/sandboxd.test.ts` or
`src/components/settings/MyConnectionsSettings.test.ts`:

- Settings > Mes connexions (organization server only,
  `organizationHidesSection`): `/api/me/connections`, `/api/me/github/*`,
  `/api/me/mcp/servers/*` (`server/routes/person-connections.ts`), the
  session's person only, member scope (CLIENT_ALLOW, `orgDirectory`).
- One encrypted file per person (`principals/<pid>/capabilities.enc`,
  AES-256-GCM with the mcp-oauth vault key; `server/people/person-connections.ts`)
  holds their own MCP servers, GitHub token, plugin state and skill
  references (`connections.enc` migrates at first read); OAuth sign-ins live in
  their own `principals/<pid>/mcp-oauth.enc` (one `McpOAuthManager` per
  person, `ownsState` routes `/api/mcp-oauth/callback` to it). No answer
  carries a token.
- A personal server mounts for the turn's person only (`mountPersonalMcp`:
  the speaker, the owner for a routine; the workplace decision's person),
  never under a name already taken, never while it needs a sign-in, a token
  or GitHub. A remote one must resolve to a public address (checked at add
  and, cached, at mount; `SAGAX_PERSONAL_MCP_ALLOW_PRIVATE=1` is for a lab or
  a test only). A command runs in the person's server environment through
  `sagax-stdio` (`server/sandbox/sandbox-stdio-mcp.ts`, sandboxd's signed stdio
  stream), never on the host; without server environments it is refused.
- A server-wide MCP command is never added (403 `org_host_command`) nor
  mounted (`withoutHostCommands`) on an organization server.
- Connecter GitHub (`server/github/github-connect.ts`): always the device
  flow first (a link and a code, owner 2026-11-08), with Sagax's built-in OAuth
  App (`server/github/builtin-client.ts`); `organization.githubClientId` from
  Settings > Organization, then `SAGAX_GITHUB_CLIENT_ID`, override it. A
  pasted token is a fallback only, under Advanced, offered by the bot only
  when the person asks or the device flow fails. The token goes into the person's environment for gh and git
  (`githubSandboxArgv`, through `SAGAX_GH_TOKEN`, never the argv), into their
  personal servers with auth `github`, and into Sagax's own fetches for them
  (private skills, private marketplaces), and since 2026-10-28 into the
  GitHub plugin's MCP server (its `${GITHUB_PERSONAL_ACCESS_TOKEN}`, see "Providers
  > GitHub" below). One connection per person. `#1775`: `GET /api/me/connections`
  and `connect_github` call `probeStatus` (GitHub `/user`); a 401 Bad credentials
  sticks as `state: "error"` with `login` (Reconnect, never a healthy Connected)
  until a new connection or disconnect. Network blips keep Connected. Tests:
  `server/github/github-connect.test.ts`.
- Organization access tokens: since 2026-10-28 the organization's labeled
  credentials of the one list (`server/github/github-credentials.ts`, owner `org`),
  changed by an organization admin through `POST /api/me/github/credentials`
  `{ scope: "org" }` (a bot through `act` on that route). `PATCH
  /api/org/settings` no longer takes `githubTokens` and `GET /api/org` no
  longer lists them. `server/org/org-github-tokens.ts` stays as the reader the
  migration uses.
- Plugins (`server/bots/bot-plugins.ts`, `/api/bots/:id/plugins/*`): per bot, the
  owner or a person with manage changes them, use reads. One marketplace
  list (`server/plugins/plugin-marketplaces.ts`, 2026-10-09) serves both install
  scopes of Connect apps: everyone (a plugin's MCP servers and skills,
  `/api/marketplaces`, `apps.marketplaces`) and one bot (the whole plugin,
  the scope toggle "For <bot>", `src/lib/plugin-scope.ts`). A member adds a
  marketplace through the bot route and it joins that list (the
  organization's policy still applies); removing it from a bot uninstalls
  its plugins there and takes it off the list only for a workspace manager
  or the person who added it, once no bot nor workspace install uses it
  (the workspace route answers 409 `in_use` while a bot does). Each bot's
  older marketplaces moved into the list at boot (`migrateBotMarketplaces`,
  a clashing name gets a suffix, installs kept; tests
  `server/bots/bot-plugins.test.ts`, `server/routes/bot-plugins.test.ts`). A
  marketplace known only by its marketplace.json address cannot install on
  a bot (422 `manifest_only`). Added or fetched again through a bot, a
  private marketplace reads with the credential that bot picks for it (the
  one list, on the GitHub plugin's page), else the person's GitHub connection, then
  their other credentials and the organization's; the bot listing says
  `hasToken` (a pick), never the token, and `updateAvailable` when
  the marketplace offers another version or other files (Install again
  updates in place, its switch kept). A bot zip restored on a new bot takes
  its marketplaces into the list the way the migration does, without one
  the organization does not allow. Sagax clones the
  marketplace (git with the actor's GitHub token in an extra header, only the
  server's proxy, certificate and git config variables), copies a plugin
  without links, hooks, `.mcp.json`, `.lsp.json`, `bin/` or those manifest
  keys. Claude loads each enabled plugin with `--plugin-dir`. Every other
  harness of that bot gets the same enabled skills and commands in the skills
  section of the turn prompt. Hooks, MCP, LSP and bin stay stripped. A bot
  installs, updates, enables, disables and removes a plugin through `act`
  (plugins actions: list, add marketplace, install, set enabled, uninstall,
  remove marketplace), not an engine CLI. `organization.pluginMarketplaces`
  (any by default, or a list of owner/repo, owner/* or https URLs; PATCH
  `/api/org/settings`) applies to marketplaces and to a plugin's own repository.
- Skills routes (`/api/bots/:id/skills*`, `skill-template`) are member scope
  on an organization server: use reads, owner or manage changes; an import
  from a private repository reads with the person's GitHub connection.
- Library tab: Files | Skills (`bot-settings/LibraryTab.tsx`) and a link that
  opens Connect apps on that bot (`togglePlugins` with `botId`); there is no
  Plugins tab any more (`src/components/plugins/BotPluginCard.test.ts`).
- Who manages them: the person, with no admin. The Sagax permission
  `apps.ownIntegrations` is the only rule (`ownIntegrationsRefusal` in
  `server/index.ts`: a member without it reads, and every change answers
  `403 { error: "forbidden", permission: "apps.ownIntegrations" }`; plugins
  listing `canChange: false`). The Perspicax field `sagax_integrations` is
  ignored if an older Perspicax still sends it (removed 2026-10-30: no
  `managedByAdmin`, no `viewer.integrationsManagedByAdmin`, no notice).
  `run_command` in their environment and on their desktop refuses the
  engines' plugin, MCP and extension subcommands
  (`enginePluginCommandRefusal`, `server/people/person-integrations.ts`). The tool
  result tells the bot to install through Sagax `act` plugin actions. The
  check is a courtesy: a turn loads only what Sagax keeps. `/plugin` and
  `/mcp` are managed for everyone. An organization admin changes a person's
  bot plugins and skills for them.
- An organization admin lists and removes another person's connections
  (`GET /api/org/people/<principalId>/connections` and
  `POST .../connections/revoke`, `server/org/org-person-connections.ts`): admin
  scope, `orgAdminCaller` (a service loopback is not an admin), not in
  `CLIENT_ALLOW`. A solo server answers 403 `identity_perspicax`. The list
  names MCP servers (hostname or command only), the GitHub connection
  (login, never a pending `userCode`) and plugins on bots that person owns,
  with kind, created date and last stdio use when a session is open. No
  token, env value, argument, header name or path. Remove deletes the
  stored credential, forgets that server's OAuth entry, stops the stdio
  child (`closePerson`) and writes `connections.revoke` (category `people`)
  only when something was removed. One target that is missing is 404 with
  no audit; remove-all of nothing is 200 and no audit.
  Tests: `server/people/person-integrations.test.ts`,
  `server/perspicax/perspicax-link.test.ts`, `server/org/org-person-connections.test.ts`,
  OC-7, OC-8 and OC-9, `MyConnectionsSettings.test.ts`,
  `PersonConnectionsSection.test.ts`.

A change under `server/` needs the server image redeployed (sandboxd is the
same image); `deploy/sandbox/Dockerfile` (gh, node, npm) needs the sandbox
image rebuilt.

## Connect apps: one page, one place per subject (2026-10-27)

Owner's redesign (after #1153 and #1194): "Manage plugins and skills" moved up
into Connect apps, which is now one page (`src/components/plugins/ConnectAppsView.tsx`,
wired in `PluginsPanel.tsx`; iOS `ConnectAppsPage.swift`): the title with
"N connected", the install scope, then five tabs (since 2026-10-28:
Discover, Installed, Providers, Pages, Sources). No sub-page repeats a tab
(the old home, Manage and a section opened alone with View all are gone).
Tests: `src/components/plugins/ConnectAppsView.test.ts`,
`src/components/PluginsPanel.layout.test.ts`, `src/lib/installed-model.test.ts`,
`src/components/plugins/OrgSourcesAccess.test.ts`,
`src/components/settings/MyConnectionsSettings.test.ts`; captures:
`scripts/capture/connect-apps-grokbot.mjs` (`--role admin`, `--scheme light`;
gallery `connect-apps.html?view=manage|org-settings`).

- Discover (where a person lands; `DiscoverView`): the catalog that can
  still be added (`discoverItems`: not installed, no engine connector; an
  app a conversation needs stays until it connects), its search with
  Browse Bots beside it, every category pill, View all in place.
- Installed (`InstalledView`): one line per thing (`installedEntries`,
  `src/lib/installed-model.ts`): rows with the same readable name
  (`readableName`: "github-github" is "GitHub"), the same MCP address or a
  parent plugin fold into one entry with its logo (`providerMark`), what it
  brings ("app + 2 connectors", "plugin (marketplace) · 3 skills"), its
  state and a "..." menu: Update, For which bots, Remove. Private skills
  follow, only when there are some. The MCP surface opens here.
- Providers (`AccountsView`): a pill per service (All, then each engine
  with connectors: Claude, Grok, ChatGPT once the server lists Codex's, and
  My MCP servers; fewer than two services, no pills). The engines'
  connectors grouped by engine (`HarnessConnectorGroups`), each card naming
  its service; the person's own MCP servers (`MyMcpServers`, organization
  server); Claude Code on this computer (solo). The "What your engines
  reach" panel is gone. Providers was called My accounts until 2026-10-28
  (tab id `providers`; the old id `accounts`, in a `togglePlugins` page or
  `normalizeConnectAppsTab`, still leads there). GitHub is not a provider
  (2026-10-29): no pill, no card; see "GitHub: on the GitHub plugin's
  page" below.
- Pages (`PublishedPagesSettings personal`, 2026-10-28, owner: pages get
  their own tab, nothing about pages stays in Providers): "Your pages" with
  Audience, Share, versions and Delete, and the empty line when there are
  none. A link to `togglePlugins` page `pages` (Settings search, old
  Settings > Pages links) opens it. iOS keeps the pages in Settings >
  Published pages.
- Sources (`SourcesView`): a GitHub connection row first (a link to the
  GitHub plugin's page, 2026-10-29), the marketplaces (add, list, fetch
  again, remove, who sees each), then for an organization admin the allowed
  marketplaces (`OrgSourcesAccess`). The GitHub OAuth App's client id is in
  Settings > Organization (`OrgGithubApp`). Settings > Organization shows one
  link to Sources (`togglePlugins` page `sources`, also an old link to
  `organization.plugins`).
- "N connected" (`connectedTab`) opens Installed, or Providers when only
  engine connectors are connected (#1194).
- Every empty section is hidden. iOS has the same tabs (segmented) and
  pills (All, Claude, Slack, My MCP servers); its GitHub card is under Your
  connections.

## GitHub: on the GitHub plugin's page (2026-10-28, moved 2026-10-29)

Owner: Sources showed a GitHub section beside the GitHub plugin already
Connected in Installed ("that should be only marketplaces"). One GitHub
connection, the person's own (`server/people/person-connections.ts`,
`/api/me/github/*`), serves every use: private marketplace clones, gh and
git in their environment, private skills, and the GitHub plugin's MCP
server. It sat in Providers > GitHub (#1550) until the owner asked "Why is
GitHub listed as a provider?" (2026-10-29): Providers keeps the engines'
connectors and My MCP servers only.

- Where: the GitHub plugin's page (`GithubAccountSection`, first on the
  detail page of `githubPluginKey`: the marketplace plugin named github,
  else one whose server reads the GitHub account, an installed one
  first), in both scopes, installed or only listed in Discover. With no
  such plugin in any marketplace, a page of its own (`{ page: "github" }`)
  with the same section; it turns into the plugin's page once the
  marketplaces answer. Connect GitHub, the account, More credentials, Add a
  credential, Rename, Replace secret and Remove are all there.
- Every link goes through `openGithub` (PluginsPanel): Sources' GitHub
  connection row (`SourcesView`, shown whenever the connection is in
  reach), the private marketplaces' "Open the GitHub plugin", the MCP
  server page of a server that reads the account. Texts (UI, server errors,
  the bot's prompt line when a GitHub server is withheld) say "the GitHub
  plugin's page (Connect apps > Sources > GitHub connection)". iOS never
  listed GitHub under Providers (its GitHub is in Sources).

- The GitHub plugin (claude-plugins-official) ships its server with
  `Authorization: Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}`. Sagax never
  expanded it, so the row said Connected for nobody's account. Now
  `server/github/github-mcp-token.ts` replaces that placeholder (also
  `GITHUB_TOKEN`, `GH_TOKEN`, in headers or env) at each 1:1 and room turn
  with the turn person's GitHub connection (`githubAccountToken`: the
  person's connection on an organization server, the operator's own
  credential solo, never the organization's), never in config.json. `GET
  /api/mcp/servers` says `github: "connected" | "missing"` for that viewer;
  the Installed row and the server's page follow it, with "Open the
  GitHub plugin".
- Connection (organization server): `MyGithubConnection`, one Connect
  GitHub for everyone, with no admin step: the main button is always the
  device flow (an error says so with Try again), the token only under
  Advanced, collapsed.
- A load that meets a proxy's bare 502/503/504 (Sagax restarting behind
  Caddy during a deploy) is asked again (`retryTransient`); a failure is one
  plain line (`readableError`), never the raw status.
- One list (`server/github/github-credentials.ts`, `github-credentials.enc`, vault
  key, AAD `sagax github-credentials v1`, out of workspace backups): labeled
  credentials owned by a person (principal id, `local` solo) or by the
  organization (`org`, marked Organization). `GET/POST
  /api/me/github/credentials` (`server/routes/github-credentials.ts`, member
  scope): a person adds, renames, replaces and removes their own with no
  admin; the organization's need an organization admin. No answer carries a
  token (label, last 4). The list is only for what the GitHub account cannot
  reach (another GitHub organization, another git host).
- Each marketplace reads with the GitHub account by default (Automatic: the
  person's connection, their credentials, the organization's, a label or
  login naming the repository's owner first). A row shows a small selector
  only when the person has another credential (`PUT
  /api/bots/:id/plugins/marketplaces/:name/credential`, owner or manager;
  `PUT /api/marketplaces/:name/credential`, the workspace's managers;
  `credential` on add). The listing carries `credential: { chosen?, used? }`
  (what read it last). The former token routes (`.../token`, `token` on add)
  are gone: a credential is added on the GitHub plugin's page and picked.
- Migration at first use (`migrateGithubCredentials`): `org-github-tokens.enc`
  (ids and labels kept) and `marketplace-tokens.enc` (each token becomes an
  `onlyWhereChosen` credential of the person who added it, else the bot's
  owner; the workspace's become the organization's) move in; each
  marketplace keeps the same effective credential; idempotent; the old files
  are removed after the new one is written. Tests:
  `server/github/github-credentials.test.ts`, `server/routes/github-credentials.test.ts`,
  `server/bots/bot-plugins.test.ts`, `server/github/github-mcp-token.test.ts`,
  `src/components/plugins/GithubAccountSection.test.ts`,
  `src/components/PluginsPanel.gestures.test.ts`,
  `src/components/plugins/ConnectAppsView.test.ts`. Captures:
  `scripts/capture/github-plugin.mjs`, `docs/screenshots/github-plugin/`.

## Capabilities on iPhone and iPad (lot 1c, 2026-10-30)

Library > Capabilities opens the server's one resolved list on the iPhone
and iPad (`BotCapabilityList`, `ios/Sources/CompanionCore/BotCapabilities.swift`).
It shows scope, state, source and the engine's receipt summary, including
whole files omitted by the prompt budget. Each capability shows its own
file/byte budget, and Flow shows the loaded pack and its version (lot 3), in
this same list: no new tab. Keys and bot ids never appear. Unknown
future fields and values remain decodable. The view's identity follows the
bot, so a different bot creates a fresh state model.

`BotCapabilitiesModel` calls existing plugin, server, Role and skill routes
for switches that `canToggle` allows. Skill enablement still opens the skill
text for review. A disabled installation server and a library whose feature
is off stay unchanged. Sidecar pairings use the existing bot-plugins surface
gate. Tests: `ios/Tests/CompanionCoreTests/BotCapabilitiesTests.swift`.

## Capabilities: the same resolved list on desktop (lot 1b, 2026-10-30)

Bot panel > Capabilities and Capabilities > Installed in a bot's scope read
`GET /api/bots/:id/capabilities` through `useBotCapabilities`
(`src/lib/capabilities.ts`). The server's rows are the only list source in
that scope, including personal servers, skills, organization Flow, Roles and
account connectors. Installed preserves its existing plugin detail, update
and remove actions. A bot change or an engine preview hides the previous
list immediately; late answers cannot replace the new bot's list.

Plugins > Installed (there is no Capabilities tab in the bot panel,
2026-11-01) switches only the rows whose `canToggle` allows it through
the existing routes, and a server switch waits for `flushBotPatches` before
reading the list again. A skill still goes through its review. The detail
and the receipt summary use the shared engine matrix and say when the prompt
index omits skills. Tests: `src/lib/capabilities*.test.ts`,
`src/components/bot-settings/CapabilitiesTab.test.ts`,
`src/components/plugins/ConnectAppsView.test.ts`.

## Reserved MCP server names (2026-10-17, one rule since 2026-10-30)

One rule, `reservedMcpName` (`shared/mcp-reserved-names.ts`), for this
installation's servers (`server/mcp/mcp-registry.ts`), a person's own servers
(`addPersonalMcpServer`, `personalMcpPrecheck`) and the turn's Connectors
record (`server/turns/turn-connectors.ts`): `mcp`, any name with `__`, the
built-in names and the families `sagax`, `perspicax`, `openmausbot`,
`claude_ai`, `claude-ai-`/`claude-ai_` and `mcp`, with or without a
separator (#695; since 2026-10-30 the strictest of the three former rules,
the one a person's servers had: `mcp-github`, `mcpx` or `sagaxy` on this
installation are now reserved too). An imported name in a reserved family
takes the name without it (`mcp.example.com` is `example-com`). A server an
older build saved under such a name is never mounted, whatever a bot's own
list says, and is never switched on again under that name. It is not silent:

- the start and the first mount log `MCP server "<name>" is not mounted:
  its name is reserved by Sagax...` once per name (`warnReservedMcpServers`);
- `GET /api/mcp/servers` lists it apart (`reserved: [{ name,
  suggestedName }]`), and Connect apps > Installed shows a warning on it
  with a rename field (a free name offered) and Remove
  (`McpReservedServers`);
- `POST /api/mcp/servers/:name/rename {to}` (`server/routes/mcp-server-rename.ts`,
  admin) moves only a reserved name, to an allowed free one, re-reads the
  entry under it, saves it off, forgets the sign-ins of both names, and
  moves the bots that listed it (their account choice for it is dropped).
  Policy and the organization host-command refusal apply to the new name.
- A personal connection (`server/people/person-connections.ts`) saved before #695
  under a name with `__` is no longer mounted (since 2026-10-30,
  `personalMcpPrecheck`) and the capabilities list shows it `reserved`.
- Tests: `server/mcp/mcp-registry.test.ts`, `server/config.test.ts`
  (customMcpServers), `server/routes/mcp-server-rename.test.ts`,
  `src/components/McpServersPanel.reserved.test.ts`,
  `server/mcp-reserved-rename.e2e.test.ts`.

## Connectors

Any bot, on any engine, calls any connector of the person it serves
(#3286, design `docs/design/connectors-across-engines.md`). Sagax builds no
GitHub, Outlook, Teams, calendar or SharePoint integration of its own (no
Graph client, no Teams bot registration, no mailbox), and stores no
provider token: each provider's CLI keeps its own sign-in.

- Whose: only the turn's connector principal (`connectorPrincipalFor` in
  `server/harness-connectors.ts`: the speaker, a routine's owner, the same
  person at a peer hop, nobody for an unknown person, the operator only on a
  solo server). Never read from tool arguments, never another person's. A
  turn paid by someone else's sign-in is told that account's own connectors
  are not this person's. A guest's confined turn and a managed policy that
  restricts MCP get none.
- Registry (`server/connectors/registry.ts`): the person's connectors over
  all of their own sign-ins (Claude, both Grok accounts, added accounts,
  Codex's ChatGPT apps), by name and state only, kept on disk per person so
  it is known right after a restart. Providers in
  `server/connectors/providers/`.
- One plan per turn (`server/connectors/turn-plan.ts`), computed once in
  turn setup for a direct and a room turn; every reader reads it.
  `server/connectors/one-source.guard.test.ts` fails when another file
  names the predicates or the provider switches.
- One list in the prompt (`server/connectors/list-prompt.ts`, the
  "claude-ai" section): the same text for the same person on every engine
  and turn kind, one line per connector with its account, its state and how
  to reach it from this turn; `open_connector_setup` when it needs a sign-in.
- The hub: `connectors` (list, find tools) and `call_connector` (one exact
  call) in the `agents` server, offered in every catalog profile, rooms and
  peer hops included (`server/drivers/agents-tools/connectors.ts`, route
  `server/routes/internal-connectors.ts`, `server/connectors/hub.ts`). One
  host per provider (`server/connectors/hosts/`: Grok, Claude, Codex) runs
  exactly the approved call on the person's own sign-in; a call whose tool
  or input differs is never run.
- Approvals: a hub call is a server-held request on the calling turn
  (`server/harness/held-requests.ts`), decided by `request.opened` exactly
  as a native call: organization Refuse and Ask first rules, the person's
  rules and Always allow, Full access, and "a read of your own connector"
  with no card. The same act gets the same verdict and rule key on every
  engine (`shared/connector-call.ts`, `server/connectors/approval-parity.test.ts`).
  A member's bot gets the member's card, never an admin's. Nothing is
  invisible: the call, its card and its error are in the bot's own chat.
- Native shortcuts, under the same rules:
  - Claude keeps the claude.ai connectors (`mcp__claude_ai_*`) of the account
    it runs on when that account is the speaker's own (organization server:
    `via: "subscription"` only; solo: the operator and the operator's
    routines). The driver then drops `--strict-mcp-config` (it also drops
    claude.ai connectors, measured on CLI 2.1.287) and keeps
    `--setting-sources project`; every other isolated turn sets
    `ENABLE_CLAUDEAI_MCP_SERVERS=false`. Their tools are never pre-allowed;
    an engine tool denial blocks host built-ins, never them.
  - Grok CLI loads its account's grok.com gateway only when the bot opted in
    (`grokAccountConnectors`, off by default, #2747) on the person's own
    sign-in, with no tool selection, and on an organization server an
    engine that withholds host tools (`grokCloudConnectorEnv` in
    `server/drivers/acp/grok.ts`). Grok reaches them through `use_tool`, and a
    server Sagax did not mount keeps its card. Any other bot on Grok reaches
    them through the hub, its tool list still holding `agents` only.
  - Codex: ChatGPT apps need Codex's own ChatGPT login (the Codex sign-in in
    Sagax), which Sagax's ChatGPT plan mode and API keys do not have. On that
    login the Codex host calls one with no model turn
    (`server/connectors/hosts/codex-host.ts`, #3353).
- Connected apps (or Model providers while Connected apps is off) shows them
  read-only (`GET /api/me/harness-connectors`, the caller's own account only,
  no email or URL) with a link to claude.ai/customize/connectors.
  Always on: there is no server switch (the admin checkbox and
  `config.harnessConnectors.claudeAi` are retired, a stored false is ignored,
  `PUT /api/harness-connectors/settings` is a no-op kept for older clients).
  `SAGAX_CLAUDE_ALLOW` is a separate thing (standing tool allow rules, see
  docs/self-hosting.md) and stays.
- What each engine's connectors reach is one pure table,
  `shared/engine-connectors.ts` (capabilities by claude.ai connector name and
  Grok cloud connector id); it also reads which calls act outside the app.
- Every outward call through a connector waits for the approval card
  (`isOutboundTool` via `connectorWriteKind`, same reading for an MCP tool):
  sends, automatic replies (out of office, mailbox
  settings), Teams posts and chats, events and meetings (create, insert,
  change, cancel), answering an invitation, every SharePoint, OneDrive or
  Google Drive write (upload, save, permissions, grant access). On an
  engine connector server (`isEngineConnectorServer`), an unclassified
  `other-write` follows the bot's level and explicit rules. Moving,
  labeling, marking or deleting mail is not an outbound send and never
  gets a draft/send hold, including with misuse guardrails in enforce.
  Deletes and bulk operations keep their destructive classification;
  organization Ask/Deny, isolation and sensitive paths still apply.
  Reads, drafts and reply drafts send nothing. Full access and the primary
  bot rule are unchanged. Regression: `server/safety/safety-review.test.ts` uses
  the measured Outlook catalog in `server/testing/`.
- An outward card offers Always allow like every card (#3294): the owner
  rule for this bot and this tool (`cardRuleCandidate`,
  `server/approvals/always-allow-sends.regressions.test.ts`), which answers
  the next call of that tool. The engine's own session-wide allow is not
  what it uses: the ACP driver answers Grok's ask once, never
  `allow_always`, since Grok's `allow_always` on `use_tool` would cover
  every other connector call too (`server/drivers/acp/connector-ask.ts`). A Grok `use_tool` call to a
  server Sagax did not mount is an engine connector: the card gets its
  `tool_input`, or says Grok did not share the details
  (`approval.held.connectorNoDetails`), and is outward unless its name
  plainly reads.
- The card shows every recipient's address (`Name <address>`; a name that
  looks like another address or a domain is dropped): a display name is
  the sender's to choose.
- Retired (#3356, lot L13): the keyword switch of 2026-10-21 (a mail,
  calendar, Teams or SharePoint word moved the request to another engine:
  `server/connector-switch.ts`, `connectorNeed`, `SAGAX_CONNECTOR_SWITCH`),
  the relay hint and its list (`connectorsElsewhereFor`, `engineReachFor`),
  the exception of #3174 (a run_with_engine part loaded the Grok gateway
  without the opt-in, `engineRelay`), and every sentence that sent a bot to
  `run_with_engine` or to `use_tool` for a connector. A request with a mail
  word runs on the bot's own engine and model
  (`server/connectors/no-connector-switch.e2e.test.ts`). Lines "Passé à ...
  pour ..." already stored still render (`tool.connectorSwitch`).
- Gates: `pnpm test:connector-matrix` (engine of the bot by provider of the
  connector, on fakes) and the launch contract of each host.
- Needs its own infrastructure, so not built here (flagged for later): a
  dedicated inbound address per bot (B21, iOS CO5), a Teams app per bot
  (B20, needs a Bot Framework registration), a free message in a Meet or
  Zoom meeting chat (G10).

## Connect a connector from the chat: open_connector_setup (2026-10-22)

Decision (Sagax 0.7.2): « peux tu le connecter » (Microsoft Teams)
took 13 tool calls and ended in "I can't". Now one call posts a card.

- Agents tool `open_connector_setup` (`server/drivers/agents-connector-setup.ts`,
  loaded directly, never deferred; Grok is told to call
  `agents__open_connector_setup` with use_tool without search_tool):
  connector by name, optional `via` (grok, claude) and `language`.
- Where (`shared/connector-setup.ts` `chooseConnectorSetupRoute`): engine
  connectors first. A bot on the Grok engine, on the person's own xAI account:
  https://grok.com/connectors (xAI documents no per-connector link). A Claude
  bot on the person's own subscription: https://claude.ai/customize/connectors.
  Else Sagax's Capabilities page (Installed). An engine account that is someone
  else's (#943 `accountConnectorsForTurn` "foreign") is refused. Only a
  person's own turn (`connectorSetupSpeaker`: person or operator, never a
  routine or a peer).
- Card (`connectorSetup` on the message, `src/components/connector-setup/`):
  one primary button "Connecter Microsoft Teams" that opens the page through
  `openExternalLink` (Electron open-external, else a new tab); nothing opens
  without the click. Hosts allowed: grok.com and claude.ai over https
  (`isConnectorSetupUrl`, checked by server and card). The row's text is the
  fallback with the link, for iOS and Android until they draw the card.
- "Connecté" only on evidence (`POST /api/connector-setup/:id/check`, the
  person the card is for only: an owner digest on the card, never their id).
  Claude: that person's own claude.ai inventory read again (cache
  refreshed), never a call. Grok (no API says which connectors are
  connected): a successful call to that connector after the card, recorded
  as it settles with whose turn and which bot (`ConnectorSetupProofs`, in
  memory, bounded) and matching the card's person and bot; `use_tool` input
  is read only for exactly that meta tool; any tool with "auth" in its name
  is no proof. Until then "Pas encore confirmé". Checked on "J'ai terminé"
  and when the window regains focus after the click.
- Desktop: the button goes through its own IPC `desktop:open-connector-setup`
  (desktopUiOnly, `connectorSetupUrl` allows grok.com and claude.ai only),
  else `openExternalLink`. That one logs a bridge refusal and falls back to
  `window.open` (a silent rejection made "Manage on Grok" do nothing); when
  neither opens, the caller shows "Ce lien ne peut pas être ouvert d'ici."
- Tests: `shared/connector-setup.test.ts`, `server/routes/connector-setup.test.ts`,
  `server/drivers/agents-connector-setup.test.ts`,
  `src/components/connector-setup/ConnectorSetupCard.test.ts`,
  `src/lib/app-links.test.ts`. Not yet: a native iOS card, the card in rooms
  (GroupView), Grok rows in iOS Connect apps.

## Plugins parity 2F: configuration, data centers, link (2026-10-21)

- Plugin configuration (`server/plugins/plugin-config.ts`): the `userConfig` fields a
  Claude Code plugin declares in `.claude-plugin/plugin.json`, filled per bot
  (`PUT /api/bots/:id/plugins/:key/config { values }`, owner or manager,
  `bot-plugins/<bot>/plugins/config.json` 0600). Values replace
  `${user_config.KEY}` in the plugin's skills, agents and commands, from each
  file's original kept under `.claude-plugin/sagax-originals/`; an update
  copies the plugin again and the values go back in; uninstall forgets them.
  A `sensitive` field is never stored nor written: 400 `sensitive_field`,
  the form points to Settings > Credentials.
- Data centers: a catalog entry may list `regions` (the default `url` among
  them) and a registry remote whose address has one `{variable}` with
  `choices` becomes one address per choice (`registryRegions`). Add asks
  first (`plugins/DataCenterDialog.tsx`), `POST /api/plugins/install`
  takes `region` and refuses an id the listing does not offer
  (`unknown_region`). No catalog entry has regions yet: add one only with
  the provider's documented regional addresses.
- Copy link to this plugin (`src/lib/plugin-link.ts`): a marketplace
  plugin's repository, a reviewed server's documentation, else its https
  address; nothing for a connected app or a local server.
