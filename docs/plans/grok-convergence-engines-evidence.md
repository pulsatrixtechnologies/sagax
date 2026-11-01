# Lot 2 evidence: engine continuity and complete plugin delivery

Branch: `feat/grok-convergence-engines`
Pinned base: `81e0dd358a7db3b1a5b8be1559ddb03f8dc373be`
Owner: Grok CLI engine worker
Date: 2026-10-31

Synthetic fixtures and mock OpenAI-compatible upstream only. This note does
not claim real provider or comparative Grok Bot qualification.

## Acceptance map

| Acceptance | Code | Tests |
| --- | --- | --- |
| Enabled plugin skills/commands/agents discoverable on API engines when `skills_list` and `workspace_read` are allowed | `scopedSkillInventory` in `server/index.ts` includes plugins for every instance; Flow folders stay Claude-only; `skillDiscoveryIndex` / `skills_list` page them | `server/plugin-api-delivery.e2e.test.ts` (real turn prompt + tools); `server/skill-discovery.e2e.test.ts` (Lot 1 regression) |
| Bodies readable through managed aliases (`plugins/<name>/...`) | `workspace_read` via `readWorkspaceText` + `scopedPluginFolders` | e2e tool loop calls `workspace_read` and receives unique skill bytes |
| Declared MCP dependencies keep existing proxied path on API engines | plugin `.mcp.json` / plugin.json mcpServers sanitized into turn mounts; receipt MCP branch `proxied` when `customMcp` | e2e installs packing with `packing-track`; prompt and reach list it; `shared/capabilities.test.ts` |
| Truthful supported/unsupported receipts | `engineReceipt` serves plugin skills/commands/agents as `prompt` when `skillDiscovery`; Flow remains `none` on non-Claude; tools-off / denied list stays `none` | e2e denied `skills_list` asserts `engine.skills === "none"` and no `promptIndex`; capabilities unit tests |
| Turn connectors claim plugins only when delivery tools are allowed | `turnConnectorsFor` uses `skillDiscoveryAvailable(integrations.agents, toolScope)` and the same engine-scoped folders as the inventory (`enginePluginFolders`) | e2e asserts plugin connector present on allowed turn and absent after deny |
| Native Claude plugin loading stays native (`--plugin-dir`) | `turnPluginDirs` / `claudePluginDirs` unchanged; inventory marks Claude plugin rows `native: true` | `server/plugin-turn.test.ts`; capabilities Claude cases; e2e Claude preview `skills: "native"` |
| Organization Flow engine decision preserved | `fileReceipt` for `flow` is Claude-native only; org folders filtered out of non-Claude inventory | capabilities tests; e2e asserts no served Flow on API |
| `/skill` keeps inline for API/org; managed index still available when tools allow | comment + existing `skillCommandInline` path | existing `server/skill-command.test.ts` |
| Engine switch preserves selected skill bytes | Same bot and thread: API primary -> fake Codex file engine; alias read, `skills_list` and the installed file on disk are byte-identical to the API read | `server/plugin-engine-continuity.e2e.test.ts` |
| Provider failover preserves bytes and dependencies | Same thread, primary returns a spent-quota 429; limit failover continues the same message once on the API backup, whose prompt carries the alias, whose `workspace_read` returns identical bytes, and whose `skills_list` and plugin MCP tool work | `server/plugin-engine-continuity.e2e.test.ts`; capability gate `recoveryCapabilityError` also asserted in `plugin-api-delivery.e2e.test.ts` |
| Plugin declared MCP dependency executes on API engines | `mountPluginMcp` proxies the plugin's stdio server (`customMcp`); the fake MCP server records the `tools/call` | `server/plugin-engine-continuity.e2e.test.ts` (primary and backup) |
| Large-plugin metadata lifecycle (manifest/cache/invalidation) | `server/plugin-metadata-cache.ts` v3: rebuilt on install/update/config (`bot-plugins`, `installation-plugins`), dropped on remove, marketplace removal and bot deletion; hot path = memoized manifest + lstat of known directories (mtime stamps catch additions) and files; miss = bounded live scan, partial only if that scan stopped early, one deduplicated rebuild queued after the turn (30 s cooldown) | `server/plugin-metadata-cache.test.ts` (add/move/rename/delete/tamper/mtime, miss heals off the turn, config write heals, memoized 2,000-file verification, write soft-fail, 600-file cache) |
| Partial/unreadable cases reported honestly | inventory `truncated` / `unreadable`; opendir/lstat failures mark incomplete/truncated (except ENOENT at depth 1); cache IO soft-fail | metadata cache + plugin-turn tests |
| Flow stays Claude-only for reads too | `workspace_read` resolves plugin aliases from `enginePluginFolders` on the running engine | code path shared with the discovery filter; no organization Flow e2e fixture exists (see remaining) |
| Disabled/staged privacy and stable discovery/pagination | unchanged Lot 1 `skillDiscoveryPage` rules; disable returns no such file on `workspace_read` | e2e disable + library unassign |
| No host paths in discovery aliases | managed `plugins/<name>/...` in prompt skills block | e2e asserts skills block omits host plugin folders |
| Hooks/LSP unavailable outside Claude, stated honestly | discovery still skips hooks/bin/LSP; UI copy `plugins.claudeOnly` | locale en/fr + `BotPluginCard.test.ts` |
| Authoring off does not block list/read | e2e sets `skillAuthoring: false` | `server/plugin-api-delivery.e2e.test.ts` |
| Direct and room speaker delivery | same managed plugin index on channel turn | e2e room send asserts packing alias in prompt |

## Independent review fixes (post `d9be40640`)

1. Hot path no longer fingerprints or rebuilds the tree on every turn. Cache hit = JSON read + lstat of known files only. Miss = bounded 4096-entry live scan with explicit `truncated`.
2. Fingerprint uses `f\0rel\0size\0mtime` and `d\0rel/` markers. Move `skills/a/b/SKILL.md` to `skills/b/SKILL.md` changes fingerprint; delete/rename/tamper/mtime invalidate.
3. Cache write failures soft-fail; `consider`/`walk` mark incomplete on opendir/lstat errors.
4. `turnConnectorsFor` gates plugin claims on `skillDiscoveryAvailable`.
5. e2e sends real turns through dispatcher + mock upstream (prompt, tools, MCP, connectors, deny, room, switch, disable).
6. Evidence below matches the executed suite; no overstated acceptance.

## Second independent review (Claude, 2026-11-01)

Findings on `81e0dd358..1bcd54d73`, all fixed:

1. Cache miss was permanent and falsely partial. Installs made before the
   cache existed, and any plugin whose files changed after install, never got
   a cache again (no rebuild outside install/update), so every turn ran the
   live scan and every prompt/list/receipt said "partial" even for a small,
   fully scanned plugin. Now a miss is partial only when the live scan stops
   early, and one deduplicated rebuild runs after the turn.
2. Plugin configuration (`setPluginConfig`) rewrites plugin files and
   silently invalidated the cache. It now rebuilds it.
3. A reference added on disk after the build stayed invisible while the
   cache kept hitting (the old unit test asserted this). Directory mtime
   stamps make it a miss.
4. Hot path re-parsed and re-hashed the whole manifest JSON every call. The
   parsed manifest is memoized by its file stamp; verification is stats only.
5. `workspace_read` resolved aliases from every selected folder, including
   organization Flow, on any engine. It now uses the same engine-scoped
   folders as discovery, on the running engine.
6. Turn Connectors omitted installation "Everyone" copies that the inventory
   did deliver. Same engine-scoped folders now.
7. Cache files were left behind on marketplace removal and bot deletion.
8. Evidence gap: the "switch" step used a second bot, failover was only the
   static capability gate, and the plugin MCP fixture was not an MCP server.
   The new e2e uses one bot and thread across API primary, the fake Codex
   file engine and an API backup reached through an actual limit failover,
   and calls the plugin's real stdio MCP fixture on both API engines.

Checked and not a defect: receipts use `skillDiscoveryAvailable` with the
bot's tool scope (denied `skills_list` gives `none`, asserted in e2e);
native Claude `--plugin-dir` loading and Flow receipts are unchanged.

## Verification run (worker)

```
pnpm exec vitest run shared/capabilities.test.ts server/capabilities.test.ts \
  server/plugin-metadata-cache.test.ts server/plugin-turn.test.ts \
  server/skill-discovery.test.ts server/turn-connectors.test.ts \
  server/plugin-api-delivery.e2e.test.ts
# 7 files, 58 tests passed

pnpm exec tsc -p tsconfig.json --noEmit
# exit 0
```

Full suite, `verify:merge`, native builds and repository-wide formatter were
not run in this worker (root owns the integration gate).

## Verification run (second review)

```
pnpm exec vitest run shared/capabilities.test.ts server/capabilities.test.ts \
  server/plugin-metadata-cache.test.ts server/plugin-turn.test.ts \
  server/bot-plugins.test.ts server/installation-plugins.test.ts \
  server/skill-discovery.test.ts server/skill-discovery.e2e.test.ts \
  server/turn-connectors.test.ts server/workspace-files.test.ts \
  server/plugin-api-delivery.e2e.test.ts server/plugin-engine-continuity.e2e.test.ts
# 12 files, 114 tests passed
pnpm exec vitest run server/plugin-engine-continuity.e2e.test.ts   # 3 consecutive passes
pnpm exec tsc -p tsconfig.json --noEmit         # exit 0
pnpm exec tsc -p tsconfig.server.json --noEmit  # exit 0
pnpm exec oxlint --deny-warnings <touched files> # exit 0
```

Full suite and `verify:merge` remain for the version cut / integration gate.

## Commits

- `293f7de41` feat: deliver plugin skills to API engines through managed discovery
- `c507878ad` feat: cache exhaustive plugin metadata beyond the turn scan bound
- `0ecdada13` test: cover API plugin delivery, switch continuity and Lot 2 evidence
- `0c6c3f108` docs: record Lot 2 evidence commit SHAs
- `d9be40640` docs: close Lot 2 evidence commit list
- `fb7ab468b` fix: bound plugin metadata hot path and path-aware fingerprints
- `b119d5398` fix: claim turn plugin connectors only with skill discovery tools
- `f7bcd247b` test: exercise API plugin delivery through real mock turns
- `1bcd54d73` docs: update Lot 2 evidence for review fixes and real-turn e2e
- `b99df6ecf` fix: detect plugin additions, heal stale metadata off the turn, no false partial
- `1e3715066` fix: keep Flow folders Claude-only for workspace_read and turn connectors
- `60df19013` test: same-bot engine switch and API limit failover keep plugin bytes and run its MCP dependency
- the docs commit that records this section (AGENTS.md cache rule, this file)

HEAD at evidence close: see `git log --oneline 81e0dd358..HEAD` on
`feat/grok-convergence-engines`.

## Status

Lot 2 is done for its synthetic end state (fake engines, isolated fixtures):
Bot/Me/Library/plugin content and plugin MCP dependencies are served on API
and file engines that can execute them, with identical bytes through a
same-thread engine switch and an API limit failover, and receipts follow the
actual tool scope. The items below are external evidence for later lots.

## Remaining external evidence

- Real xAI / OpenAI / other provider turns with live plugin MCP stdio or remote
  servers (fixture uses a mock chat completions upstream only).
- Comparative reliability or visual parity with Grok Bot (Lots 5 and 6).
- Physical device / bilingual voice (Lot 6).
- Engine-specific executable hooks and LSP on non-Claude engines remain
  unavailable by design; richer Claude native behavior is preserved.
- Failover with a live provider's limit was not exercised; the synthetic
  spent-quota failover between two API instances is covered end to end.
- No organization Flow fixture exists for an e2e of the `workspace_read`
  Flow exclusion; it shares the discovery filter (`enginePluginFolders`).
- Gallery / docs native app openings are root work, not comparative evidence
  for this lot.

## Risk (one line)

API engines discover and read the same plugin reference set through managed
tools with bounded per-turn work; hooks/LSP still do not execute there, and
Flow stays Claude-only.
