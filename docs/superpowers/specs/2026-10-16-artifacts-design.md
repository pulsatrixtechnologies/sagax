# Artifacts

## Summary

Owner (2026-10-16): "add a category in Files, which will be Artifacts, which you
can ask the bot to save interactive widget as artifact that will auto refresh
automatically based on the interval you define while discussing with the bot.
Those artifacts can be saved as favorite so they show up in a separate section
under Files tab. They also can be popped out as modal. They need to be able to
automatically pop back and remember their positioning on the screen if you
close and reopen Sagax. (Those settings are hidden and only the bot can manage
them.)"

An artifact is an HTML widget a bot saved for the person, with an optional
data source the server re-runs on an interval, without a model turn, and
whose fresh JSON is handed to the widget. It lives in the Files tab of the bot
that saved it.

Decisions taken by the owner:

- Refresh is a data source, never an LLM turn. The bot saves a source (one
  tool call with fixed arguments, or one command on its computer) and an
  interval. Sagax re-runs the source alone and posts the JSON into the
  widget's sandboxed frame. Approvals and tool policy are respected: only a
  source that reads, or that is already allowed, runs with nobody there.
  Failures are counted, the refresh pauses itself after a few, and the state
  shows on the row.
- Scope is per bot plus a global view: artifacts sit in their bot's Files
  tab (new "Artifacts" view, a separate "Favorites" section on top), and the
  command palette has an "Artifacts" group with the favorites of every bot
  (grouped palette, #602).

## Model (`shared/artifacts.ts`)

`Artifact`: `id` (`art_...`), `botId`, `threadId` (where it was saved),
`ownerPrincipalId` (on a shared server, the person whose conversation saved
it), `title`, `html`, `source?` (`{kind:"tool", tool, args}` or
`{kind:"command", command}`), `intervalSeconds?` (30 s to 1 day),
`favorite`, `popped`, `bounds?` (the bot's suggested window), `rev`,
`refresh` (`idle | ok | error | paused | blocked`, failures, last run, last
success, last error scrubbed of secrets) and `data?` (last good JSON, at most
256 KB). Limits: 50 artifacts per bot, 200 KB of HTML.

Storage: `DATA_DIR/artifacts.json`, written whole with `writeFileAtomic`,
mode 0600, like `delegations.json`. A deleted bot's artifacts go with it.

## Bot tools (agents catalog)

`save_artifact`, `update_artifact`, `list_artifacts`, `delete_artifact`
(`server/drivers/agents-artifact-tools.ts`, carried by
`agents-call-artifacts.ts` to `POST /api/internal/artifacts`, behind the
turn's capability). The bot is always the capability's: a bot never sees or
changes another bot's artifacts. `list_artifacts` is a reviewed read. The
tools add about 3.3 KB to every non-external catalog profile.

The settings are the bot's. The person's UI only opens (in its own window),
closes that window, stars, refreshes now and deletes (with a confirmation); a PATCH with any other
field is refused with "Ask the bot".

## Person's routes (`server/routes/artifacts.ts`, member scope)

- `GET /api/artifacts`: every artifact this viewer may see (palette, pop-outs).
- `GET /api/bots/:id/artifacts`, `GET|PATCH|DELETE /api/bots/:id/artifacts/:aid`.
- `POST /api/bots/:id/artifacts/:aid/refresh`, `POST /api/artifacts/watch`.

Lists carry summaries (no HTML, no data). On a server with private threads a
member sees only the artifacts saved from their own conversations; an admin
sees all. Live: the store broadcasts an `artifacts` frame with ids only
(`botId`, `artifactId`, `deleted`), filtered per member like any frame that
names a bot; the client fetches the change with its own rights.

## Rendering

The widget runs in the chat widgets' sandbox (`WidgetFrame.tsx`): iframe
`sandbox="allow-scripts"` only, opaque origin (no cookies, storage or DOM of
the app), the widget CSP (`default-src 'none'`, `connect-src 'none'`, inline
code only). A small bridge is added before the widget's markup:
`window.sagax.data` is the last data and `window.sagax.onData(fn)` is called
with every refresh. The app posts `{type:"sagax-artifact-data", data, at}` to
the frame; the bridge accepts only messages from its parent. A refresh never
reloads the document.

## Refresh (`server/artifacts/artifact-refresh.ts`)

Sober choice: a source runs only while its artifact is visible or a favorite.
Visible means open somewhere (its own window): the client
renews a 90 second lease with `POST /api/artifacts/watch` every 45 seconds
while a frame is mounted. A row in the list shows no data and holds no lease.
Favorites refresh on their interval even when no window is open, so the
palette and the Favorites section open on fresh data. Nothing else runs.

Runner rules (`server/artifacts/artifact-sources.ts`), checked before every run
(never cached), with nobody there:

- `workspace_read`: the bot's reviewed read of a text file in its own
  workspace (a JSON file it keeps up to date), through `readWorkspaceText`,
  which refuses a path outside the workspace, a link or a binary file.
- `dispatch_kpi` (2026-11-04, `server/artifacts/dispatch-kpi.ts`): the
  dispatch KPI snapshot Sagax computes itself, with no model turn, from
  fixed read-only Perspicax calls in the artifact owner's name, in one
  session: `identity_switch` to `args.profile`, `memory_find` of the team
  journal (today, yesterday) and of the lessons tag, `flow`
  `journal_summary` / `journal_read` (lease-free; null with a reason when
  Flow does not serve them, never 0), then `cw_psa_query` `calculateSla`
  and `service.tickets` by id for the tickets the journal cites. Args:
  `place` (team:<id>, required), `profile`, `time_zone`, `journal_tag`,
  `lessons_tag`, `lessons_limit`, `board`, `doc` (default
  `docs/dispatch-kpi.md`, rewritten only when the numbers change),
  `refresh_after` (routine name prefixes, default `morning-dispatch`,
  `dispatch`). It runs as soon as the artifact opens (a new lease, last run
  older than 30 s) and after every completed or failed run of a routine of
  the same bot named by `refresh_after`, past the cache; otherwise a
  3 minute cache answers repeated opens.
- Perspicax tool: only the reviewed read-only list
  (`PERSPICAX_READ_ONLY_TOOLS`, e.g. `cw_psa_query`), in the name of the
  artifact's owner (else the bot's owner), through the same delegated path a
  routine uses.
- A tool on one of the bot's remote MCP servers: only when that exact tool is
  allowed for the bot (an "Always allow" rule, `mcp:<server>__<tool>`).
- Command: only on the bot's own Local VM and only while the bot runs in Full
  Access (where its shell already runs without asking). Stdout is parsed as
  JSON, or handed as text. A stopped VM, or a person controlling it, is not a
  failure: the run waits for the next interval (Sagax never starts a VM for
  a refresh).
- Anything else is `blocked`: it never runs alone and the row says why. No
  failure is counted; a later run checks again, so a rule added since lets it
  run.

A run that fails counts a failure; three in a row pause the artifact
(`paused`); the bot resumes it (`update_artifact` with `paused: false`) or
the person presses Refresh now. At most two runs at once, 30 seconds each.

## Floating windows (removed 2026-10-28)

Until 2026-10-28, Pop out opened the artifact in a floating window drawn
inside Sagax (`src/lib/floating-windows.ts`), and a desktop window of its own
(#1140, #1464) was a second, separate option. Decision of 2026-10-28: an
artifact opens in one way only, its own window; a window inside Sagax is
useless. The floating panel, Pop out, the open dialog, the drag out of the app
and `contain` are gone (the generic manager stays for the terminal).

## An artifact's own window (2026-10-28)

- Open (the Library row, its menu, the palette) opens the artifact in its
  system window in the desktop app (`openArtifactInOwnWindow`,
  `electron/artifact-window.mjs`): one window per artifact, opening it again
  brings it forward, its place is kept per artifact and it can sit on another
  screen. The bot's `bounds` give its first size.
- In a browser (no `window.ogb.artifactWindow`) Open opens
  `/artifact-window#bot=<botId>&artifact=<id>` in a new tab
  (`window.open`, `noopener`). Never a panel inside the app.
- `popped` on the server is "open in its window": Open sets it, closing the
  window (or Close window in the Library menu or in the window) clears it,
  the bot may set it. `reconcileArtifactWindows` reopens the windows of
  popped artifacts at start with `focus: false` and closes those docked or
  deleted.
- Migration: floating panels of kind `artifact` restored from
  `omb.floatingWindows.v1` are dropped with their places, and
  `omb.artifactOwnWindows.v1` is erased (`migrateLegacyArtifactPanels`); the
  `popped` flag reopens them in their system window.
- Page windows share the bridge with an id `page:<pageId>`
  (`isPageWindowId`): the close event and reconcile ignore them.
- An open window holds a watch lease, so its source refreshes while it is on
  screen.

## Delivery

1. `feat/artifacts-core`: model, store, tools, routes, Files tab (Artifacts
   view, Favorites section), open in a dialog, star, delete, palette group.
2. `feat/artifacts-refresh`: the refresher, Refresh now, state on the row,
   watch leases, e2e with a fake engine.
3. `feat/artifacts-floating`: floating windows and their persistence.

## Not in v1

Artifacts in team backups and exports; personal (per person) MCP servers and
Composio apps as sources; a source on the host computer or a cloud computer;
artifacts on iOS and Android.
