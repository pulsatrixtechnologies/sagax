# Repository: tests, upstream sync and legacy names

Descriptions of the code: how it works today, its files and its tests.
Moved out of `AGENTS.md` (#3292), which keeps the rules only. When a
description here and a rule in `AGENTS.md` disagree, the rule wins and this
text is fixed. A pointer such as `AGENTS.md, "<section>"` in an older comment
now means the section of that title in one of the files of `docs/code/`.

## Where work goes

All work stays in `pulsatrixtechnologies` repositories. Never open a pull
request, issue, or push against the original OpenMausBot project
(`milind-soni/OpenMausBot`) or any other upstream. Push branches only to
`origin` (`pulsatrixtechnologies/sagax`) and target PRs at it. Pass
`--repo pulsatrixtechnologies/sagax` to `gh` so it never picks a parent
repository. Do not add an upstream remote with push access.

More specific `AGENTS.md` files override this note within their directories.

## Tests

The pi driver drains every turn's stderr, keeps only its last 8 KiB, and
includes the last 300 characters when the process exits before replying
(`#1718`, `server/drivers/pi.test.ts`).

Claude's closed-session volatile prompt cache holds at most 500 threads,
like its neighboring session caches, and clears on dispose (#1719).
An evicted entry resends the full volatile half on resume.

`pnpm test` runs every vitest file in one serial process (about 45 minutes),
then the broker, Electron and packaged-server checks. For day-to-day work use
the sharded runner `scripts/testing/vitest-shards.mjs`, which runs N vitest
processes at once (default: half the cores, at most 8), prints one summary
and exits 1 on any failure:

- `pnpm test:unit`: files that never boot the real server (about 2.5 minutes).
- `pnpm test:e2e`: `*.e2e.test.ts` plus any test that spawns
  `server/index.ts` or calls `launchVerificationServer(` (about 11 minutes).
- `pnpm test:shards`: both groups. Options: `--shards N`, `--logs DIR`,
  `--list`, and vitest flags after `--`.

The groups come from `scripts/testing/test-groups.mjs` (no hand-kept list;
covered by `test-groups.test.mjs`). The e2e files are slow because each test
boots its own server and drives fake engines through real turns; keep that
isolation rather than sharing a server between tests. Suites pick free ports
with `server/testing/ports.ts` and each vitest process gets its own Local VM
namespace, so shards do not collide.

## Legacy names kept for compatibility

The product is Sagax and the code reads `SAGAX_*`. These old spellings stay
on purpose; `scripts/rebrand-upstream.mjs` (PROTECT, SKIP) knows them, so run
it after an upstream merge instead of renaming by hand.

- Environment: an old `OMB_*`, `OPENMAUSBOT_*` or `OPENMAUS_*` variable is
  moved onto `SAGAX_*` at start for one release (`bridgeLegacyEnv`; names
  saved as data go through `currentEnvName`/`readEnvName`). The fleet unit
  template and instance env files (`server/fleet/fleet.ts`), the `Dockerfile`, the
  compose files, `.env.example` and `deploy/` still write `OMB_*`: installed
  units and operators' `.env` files use them.
- Data: `~/.sagax` (an old `~/.openmausbot` moves there once), but the lease
  `openmausbot-server.lease`, `.openmausbot-server-child`, the container path
  `/data/.openmausbot` and `~/.openmausbot-companion` keep their names.
- Identity: `appId` `com.openmausbot.app` and `desktopName` (auto-update
  signature, Windows install id), the package.json `name` and the
  `openmausbot` command (`server/openmausbot.ts`, `dist-server/openmausbot.js`,
  named by installed service units).
- Not kept: the npm package. It is `@pulsatrixtechnologies/sagax` and installs one
  command, `sagax` (`scripts/build-npm-package.mjs`, `server/npm-package.ts`,
  `docs/releasing.md`). The unscoped names belong to others; nothing
  installs, suggests or publishes them, and `fleet upgrade` installs an
  exact `@pulsatrixtechnologies/sagax@X.Y.Z`, never a floating tag. Until the first
  publish, the checkout (`pnpm omb`) is the way to run the CLI.
- Links: both `/.well-known/sagax/` and `/.well-known/openmausbot/`, and the
  health body's
  `app: "openmausbot"` beside `product: "sagax"`.
- Tokens: `sgx_` is issued and `omb_` still accepted; pairing codes stay
  `omb_pair_` (released phone apps check it); other `omb_*` prefixes (cookies,
  relay tokens) are wire values.
- Wire and stored names: `x-openmausbot-*`/`x-omb-*` headers, storage keys and
  IPC channels (`openmausbot:`, `openmausbot.`, `omb.`, `omb-`), file formats
  (`openmaus.*`, `.openmaus.json`, `.ombbackup` still imported, `OMB-WORKSPACE-1`), the
  `omb-ask` block, `com.openmausbot.*` container and launchd labels,
  `_openmausbot._tcp`, MCP server names, systemd units and host paths
  (`/etc/openmausbot`, `/var/lib/openmausbot`), the upstream's hosted
  domains (`*.openmausbot.com`). Workspace backups the app writes use
  `.sagaxbackup`. An older `.ombbackup` file still imports.
- Stored field names that predate a rename of their own, such as a bot's
  `chiefOfStaff` (the Primary Bot, see above).
- The native apps (`ios/`, `android/`): bundle ids, keychain services and
  package names change only with a store release of their own. Their
  user-visible copy (Android string values and the English copy of its
  helpers, the App Store text) says Sagax; resource names keep the old word.
  Android release signing reads `SAGAX_KEYSTORE_FILE`,
  `SAGAX_KEYSTORE_PASSWORD`, `SAGAX_KEY_ALIAS` and `SAGAX_KEY_PASSWORD`
  first, and still reads the `OPENMAUSBOT_*` names for two releases. A set
  variable, even an empty one, wins over `keystore.properties`; an empty
  `SAGAX_*` one counts as unset only for the fallback to the old name.
- Not kept: the deploy stack (`deploy/docker-compose.yml`) builds its image
  from the checkout as `sagax:local`, never the upstream author's image.
  There is no public Sagax image yet. The self-hosting and VPS docs run the
  CLI from a checkout (`pnpm omb <command>`) or in the container. The
  remaining npm install hints name `@pulsatrixtechnologies/sagax`. This batch
  does not rewrite them into checkout commands: `docs/verification/fleet.md`
  (the VPS recipe), the npx cache warning in `server/cli/service-unit.ts`, the
  npm package README (`scripts/build-npm-package.mjs`), the npm line of the
  release notes (`.github/workflows/npm-package.yml`) and `fleet upgrade` in
  `server/fleet/fleet.ts`. The rebrand script re-applies the image, the native copy
  and the signing names after a merge, and reports `npx openmausbot` or
  `npm install -g openmausbot` in the docs for a person to replace.
- Legal and history: the OpenMausBot lines of `NOTICE`, the README attribution,
  About's "Based on OpenMausBot" in every language, CONTRIBUTING's licensing
  note, the upstream pull requests a port names ("port of OpenMausBot #N"),
  "Where work goes" and "Upstream sync" below.

## Upstream sync

Last sync: 2026-10-19, upstream `milind-soni/OpenMausBot` main at
`34cbd59b` (0.1.107, PR #2718, the last one before upstream split
`server/index.ts` into route files) merged into Sagax; `baseVersion` follows
it. The rest of upstream (the route split #2740 to #2759 and the repository
wide comment deletion #2827, through 0.1.116) still has to be merged: do it
as a planned merge, porting our organization rules into upstream's route
files, never by keeping both handlers. Upstream
removed `ios/` and `android/` in 0.1.97 (#2382); Sagax keeps its own native
apps, so those paths stay ours on every later merge. To repeat:

- Keep the `upstream` remote fetch-only (`git remote set-url --push
  upstream no_push`). Never push, open a pull request or file an issue
  upstream.
- `git fetch upstream`, branch from `origin/main`, then `git merge
  upstream/main` (a real merge, never a rebase) so history stays traceable.
- Run `node scripts/upstream-drop.mjs`: it `git rm`s every path of
  `scripts/upstream-dropped.txt` (the upstream files Sagax deleted on
  purpose: Cloud, Pro, lending, `enterprise/` and the like) that the merge
  brought back, which settles their modify/delete conflicts; `--check` only
  lists them. To restore one of those files on purpose, remove its line
  first (`scripts/upstream-drop.test.mjs` fails while a listed path is
  tracked). A line `old -> new` is a file Sagax moved (server/ by domain):
  its old path coming back carries an upstream change git did not follow
  through the rename, so the script never removes it and lists where to
  port it (exit 1); port the change, then `git rm` the old path.
- On conflict our behavior wins and upstream improvements are layered in.
  Merge `src/locales/*.json` and `source-hashes.json` as a union of keys and
  run `pnpm i18n:check`.
- Run `node scripts/rebrand-upstream.mjs` (a report), then `--write`, and
  review the diff: upstream code comes back with the old names.
- Run `pnpm install --frozen-lockfile`, typecheck, lint, the unit suites and
  `pnpm build`; compare failures with `origin/main` before pushing to
  `origin` only.
- MCP sign-in is ours (`server/mcp/mcp-oauth.ts`, vault `mcp-oauth.enc` and
  `mcp-oauth.key`, both left out of workspace backups). Upstream's own
  MCP sign-in manager and routes were not taken.
