# Capabilities lot 5: three config stores

Sagax used to keep capability configuration across about eleven files
(JSON and sealed). Lot 5 folds those records into three stores, one per
scope. Content trees (plugin checkouts, skill files, Flow pack copies)
stay on disk; only the config records move.

## The three stores

| Scope | Path under `DATA_DIR` | Form | Holds |
|---|---|---|---|
| Bot | `bot-capabilities/<botId>/capabilities.json` | JSON 0600 | Plugin enable state, plugin values, assigned library skills |
| Person | `principals/<pid>/capabilities.enc` | AES-256-GCM (lot 2) | MCP, GitHub, personal plugins, skill refs |
| Installation | `installation-capabilities.enc` | AES-256-GCM, AAD `sagax installation-capabilities v1` | Marketplaces state, skills library index, org Flow state, org capability declarations, installation MCP servers |

Person isolation stays under `principals/<pid>/`. A person's Me skill
library (`principals/<pid>/capability-skills/`, index.json and SKILL.md
files) is NOT part of the installation store: `skills-library-index`
covers the organization's `skills-library/index.json` only, and
`server/skill-library.ts` applies the installation bridge to that root
alone. Installation secrets
(MCP env and headers) leave plaintext `config.json` for the sealed file.
GitHub org and marketplace tokens were already folded by
`migrateGithubCredentials` into `github-credentials.enc`; lot 5 only marks
those two sources migrated.

## Inventory (eleven sources)

| Id | Legacy path | Target |
|---|---|---|
| `bot-plugins-state` | `bot-plugins/<bot>/state.json` | bot |
| `bot-plugins-config` | `bot-plugins/<bot>/plugins/config.json` | bot |
| `person-capabilities` | `principals/<pid>/capabilities.enc` | person (already canonical) |
| `person-connections-legacy` | `principals/<pid>/connections.enc` | person |
| `marketplaces-state` | `marketplaces/state.json` | installation |
| `skills-library-index` | `skills-library/index.json` | installation |
| `org-flow-state` | `org-flow-plugins/state.json` | installation |
| `org-capabilities-state` | `org-capabilities/state.json` | installation |
| `config-mcp-servers` | `config.json#mcpServers` | installation |
| `org-github-tokens` | `org-github-tokens.enc` | installation (via github-credentials) |
| `marketplace-tokens` | `marketplace-tokens.enc` | installation (via github-credentials) |

Shared inventory: `shared/capability-stores.ts`
(`CAPABILITY_STORE_INVENTORY`).

## Migration shape

`migrateCapabilitiesStores` (`server/capabilities-store-migration.ts`)
runs at boot, in the style of `migrateGithubCredentials`:

1. Backup each legacy file as `<path>.capabilities-l5.bak` (once).
2. Write the new store atomically.
3. Verify by reading the new store back and comparing the migrated slice.
4. Retire the legacy file to `<path>.migrated` (or drop it if already
   retired). Never delete before verify.

Rules:

- Idempotent: a second boot reports sources as skipped; no rewrite when
  the new store already lists the source in `migrated`.
- Crash-safe: an interrupted run leaves backups and the old file; the next
  boot finishes or no-ops.
- Rollback-safe: restoring a backup and removing the new store file lets
  the next boot migrate again.
- Sealing preserved: person and installation stay encrypted at rest.
- Person isolation preserved: each principal is migrated under its own
  directory; no cross-person merge.
- Repair `skills-library-person-split` (one-time marker in `migrated`):
  development builds of 0.8.24 before 2026-11-01 wrote Me skill entries
  into the installation index while the SKILL.md stayed under the person.
  Each entry with no file under `skills-library/skills/<name>/` and a
  file of the same sha256 under one person's `capability-skills/` goes
  back to that person's `index.json` (written first) and leaves the
  installation document. Production never carried this layout.

`BotPlugins` may take an optional `capabilityStore` so reads and writes
go through `bot-capabilities/.../capabilities.json` once migrated.
`PluginMarketplaces` may take an optional `installationStore` bridge that
overlays the sealed installation document. Installation MCP servers are
overlaid from the sealed store after migration; `config.json` keeps its
other fields and clears only `mcpServers` once verified.

## Canonical routes and aliases

Canonical:

- `GET /api/me/capabilities` (person store surface)
- `GET /api/installation/capabilities` (installation store surface)
- `GET /api/bots/:id/capabilities` (resolved list; already lot 1)

Legacy routes stay as aliases until 2027-11-01
(`CAPABILITY_ROUTE_DEPRECATION` in `shared/capability-stores.ts`). Each
legacy response sets `Deprecation`, `Link` (successor-version) and
`Warning`. Successors:

| Legacy | Successor |
|---|---|
| `/api/me/connections` | `/api/me/capabilities` |
| `/api/me/mcp/servers` | `/api/me/capabilities` |
| `/api/me/github` | `/api/me/capabilities` |
| `/api/me/plugins` | `/api/me/capabilities` |
| `/api/marketplaces` | `/api/installation/capabilities` |
| `/api/skills-library` | `/api/installation/capabilities` |
| `/api/bots/:id/plugins` | `/api/bots/:id/capabilities` |

Code: `server/capability-route-deprecation.ts`,
`server/routes/installation-capabilities.ts`,
`server/routes/person-connections.ts`, `server/routes/marketplaces.ts`.

## Tests

- `server/capabilities-store-migration.test.ts`: inventory, fresh migrate,
  partial crash (backup present, new store absent), rerun no-op, person
  isolation, Me skill repair (once), mcpServers clear after verify.
- `server/skill-library.test.ts` ("library roots after the lot 5
  installation store"): two persons' Me libraries apart from each other
  and from the installation index; the organization's index read through
  the bridge only.
- `server/org-harness-commands.e2e.test.ts`: on one organization server,
  two persons' Me skills and personal MCP servers (and their secret) never
  reach the other person, `config.json` or any plaintext file.
- `server/capability-route-deprecation.test.ts`: headers, alias window,
  `/api/me/capabilities` vs deprecated `/api/me/connections`.

## Bot package

The portable zip still carries `plugins/state.json` and marketplace
catalogues. On disk after lot 5, the bot's capability config record is
`bot-capabilities/<botId>/capabilities.json`. Export reads that store (or
the legacy files before migrate); import writes the new store. See
`docs/bot-package.md`.
