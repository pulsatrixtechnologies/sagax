# Organization admin API (`/api/org/admin/*`)

The API the Perspicax console reads through its proxy to administer a Sagax
organization server. Design: Perspicax
`docs/superpowers/specs/2026-10-08-sagax-admin-console-design.md`, section 5.
Code: `server/org-admin-routes.ts` (the gate and the first routes),
`server/org-admin-console.ts` (the route table, paging, refusals) and one
module per area (`server/org-admin-*.ts`).

## The gate

- Answered before the session gate and before loopback trust. The only
  credential is a console assertion Perspicax signs per request
  (`Authorization: Bearer <assertion>`, `typ` `pulsabot-console+jwt`, at most
  120 s, single use `jti`, `server_id` equal to the link's, `act.sub`
  `console`). A session cookie is ignored here. An AI client's assertion
  (`act.sub` `perspicax-mcp`) is refused here: it opens the member API only
  (`docs/org-member-api.md`).
- The role is the assertion's Perspicax role: `admin`, `manager` or
  `employee`. A manager reads only their reach: themselves plus the people of
  the teams they manage, and the bots those people own or that are shared
  with them. Out of reach reads as `404 not_found`.
- An optional `locale` claim (`fr`, `en`, `fr-CA`) chooses the language of
  every readable `label`. English otherwise.
- Every answer carries `X-Sagax-Admin-Api: 1` and `Cache-Control: no-store`.
- A refusal is `{code, message, reason, error}`: `reason` is the sentence the
  console shows (`message` and `error` carry the same text for older
  readers). A server fault is `500 server_error` with a generic sentence; its
  detail goes to the server log only.
- Lists page by an opaque cursor: `limit` (1 to 200, default 50), `cursor`
  (the `next` of the previous page) and `q` (search, at most 200
  characters). The answer is `{items, next}`; `next` is null on the last
  page.
- Every POST writes one row of the admin activity log, actor
  `{kind: "person", principalId, via: "console"}`, and answers the changed
  record.
- No answer carries a secret: model keys, tokens and passwords are named by
  provider or reported as set or not set, never shown.

## Routes

| Method and path | Role | What |
|---|---|---|
| `GET capabilities` | employee | the release, every route this server serves and the permission catalogue |
| `GET overview` | manager | health, engines, sandboxes, presence, turns, routines, errors, latency, host, deploy, backup |
| `GET bots` | manager | every bot in reach; paged and filtered when asked |
| `GET usage?from&to` | manager | usage per day, bot, speaker and engine |
| `GET approvals` | employee | the cards the caller may decide |
| `POST approvals/{thread}/{request}` | employee | `{decision: "allow" or "deny"}` |
| `GET audit?from&to&limit&before&category&target` | admin | the admin activity log, newest first |
| `GET files/{bot}/roots,list,stat,read,download` | manager | a bot's files, read only |

### `GET capabilities`

```http
GET /api/org/admin/capabilities
```

```json
{
  "version": "0.4.15",
  "api": 6,
  "routes": ["GET audit", "GET bots", "GET capabilities", "GET overview", "GET usage"],
  "permissionsVersion": 1,
  "permissionGroups": [{ "id": "bots", "label": { "en": "Bots", "fr": "Bots" } }],
  "permissions": [
    {
      "key": "bots.create",
      "group": "bots",
      "label": { "en": "Create and own bots", "fr": "Créer et posséder des bots" },
      "description": { "en": "Create bots, bring them from a solo Sagax, ...", "fr": "..." },
      "memberDefault": true,
      "adminOnly": false
    },
    {
      "key": "host.shell",
      "group": "host",
      "label": { "en": "Run commands on the server", "fr": "Exécuter des commandes sur le serveur" },
      "description": { "en": "...", "fr": "..." },
      "memberDefault": false,
      "adminOnly": true,
      "adminOnlyReason": { "en": "It runs programs on the server's own machine, outside anyone's space.", "fr": "..." }
    }
  ],
  "engines": [
    { "id": "claude", "name": "Claude", "kind": "cloud", "installed": true, "auth": "oauth" },
    { "id": "openai", "name": "OpenAI", "kind": "cloud", "installed": true, "auth": "apiKey" },
    { "id": "ollama", "name": "Ollama", "kind": "local", "installed": true, "auth": "none" }
  ],
  "mascotFamilies": ["classics", "shapes", "animals"],
  "mascots": [
    { "id": "owl", "family": "classics", "colors": true, "skins": ["none", "snowy", "..."], "defaultSkin": "none", "defaultColor": null },
    { "id": "shape", "family": "shapes", "colors": true, "skins": ["plain", "pastel", "..."], "defaultSkin": "plain", "defaultColor": null, "shapes": ["circle", "bean", "squircle", "pill", "pick", "hexagon", "cloud", "drop"] }
  ]
}
```

`version` is the Sagax release people know (`package.json` `forkVersion`, or
`SAGAX_RELEASE_VERSION`), not the base version the link sends. `api` is 1 for
a server that predates this route (it answers `404 not_found`), 2 since
the console routes, 3 since the permission catalogue, 4 since `engines`
(both 2026-10-09) and 5 since the bots' `look` and `persona` with `mascots`
(2026-10-11). A route
missing from `routes` is not offered by this server: the console says so
instead of calling it.

`permissions` is the permission catalogue of this server
(`shared/permissions.ts`, spec
`docs/superpowers/specs/2026-10-09-sagax-permission-matrix.md`): one row per
key, in catalogue order, with its group, English and French label and
description, whether a plain member holds it when Perspicax sends no list
(`memberDefault`), and whether only an organization admin may hold it
(`adminOnly`, with `adminOnlyReason`). Perspicax draws its permission matrix
from these rows and sends back, in the directory, each person's effective
keys (`permissions` on the person: the union of the default permission
set, the permission sets given to the person and those of their teams,
every key for an admin; `sagax_permission_sets` names those sets for
display, and a profile's `sagax_permissions` is null since Perspicax 0051). Keys are stable; a server that predates the
catalogue answers without `permissions`.

`engines` lists every engine (model provider) of this server, from the same
catalogue as Sagax's model picker: `id` is the engine instance id that
`allowedEngines` takes, `name` the name the picker shows, `kind` the group the
picker's provider column puts it in (`local` for a custom engine such as a
local model server, `cloud` for a subscription or API key engine),
`installed` whether it runs on this server, and `auth` how a person gets
access (`oauth`: a sign-in with the provider's account, `apiKey`: a key,
`none`: nothing to sign in to). A server before api 4 answers without
`engines`. Since 2026-10-16 each engine also says `orgKey`: the
organization's key serves it (never the key), and when the organization
has an xAI key a row `{ "id": "xaiVoice", "voice": true, "orgKey": true }`
stands for voice mode (and read aloud and voice notes when the voice
engine is xAI), and a row `{ "id": "xaiImage", "image": true, "orgKey":
true }` for bot avatars generated on that key. These are the ids a person sheet's
`sagax_server_engines` (Perspicax) gives a member; see "The organization's
key, per person" in self-hosting.md.

`mascots` (api 5) lists every character a bot's `look` can name, in the
app's registry order (`shared/mascot-catalog.ts`, checked against
`src/components/floating-bots/mascots.tsx`): its `family` (one of
`mascotFamilies`, the Appearance gallery's chips), whether it is painted in
the bot's color (`colors`; Trombi is not), its skins in the picker's order,
the skin it wears by default and the color it shows where no bot gives one.
See "A bot's look and persona" below for the whole list.

### `GET overview`

Counts are within a manager's reach; host, engines, sandboxes, deploy and
backup are server facts.

```json
{
  "version": "0.4.14",
  "startedAt": 1791500000000,
  "deploy": { "image": "ghcr.io/pulsatrixtechnologies/sagax:0.4.14", "builtAt": 1791400000000, "commit": "fc6af09" },
  "host": { "diskTotalBytes": 136000000000, "diskFreeBytes": 80000000000, "memTotalBytes": 16000000000, "memUsedBytes": 9000000000, "load": [0.4, 0.5, 0.6], "cpus": 4 },
  "engines": [
    { "id": "claude", "name": "Claude Code", "version": "2.1.0", "state": "ok", "reported": "2.1.0 (Claude Code)", "reason": null, "checkedAt": 1791500005000 },
    { "id": "cursor", "name": "Cursor", "version": null, "state": "not_preinstalled", "reported": null, "reason": "No Linux arm64 build", "checkedAt": 1791500005000 }
  ],
  "sandboxes": { "enabled": true, "running": 2, "limit": 10 },
  "presence": { "online": 3, "idle": 0, "away": 1, "offline": 6 },
  "turns": { "today": 41, "last24h": 57 },
  "routines": { "runs24h": 12, "failed24h": 1 },
  "errors": { "last24h": 3, "byReason": [{ "reason": "rate_limited", "label": "The provider is rate limiting", "count": 2 }] },
  "latency": [{ "engine": "claude", "turns": 50, "p50Ms": 8200, "p90Ms": 31000 }],
  "backup": { "lastAt": 1791472000000, "ok": true }
}
```

- `engines`: the boot self-check of the image's engines
  (`server/engines-self-check.ts`); without an image manifest, the configured
  instances as their probes found them (`checkedAt` null).
- `presence`: Sagax knows online, away and offline; `idle` is always 0.
  Hidden presence counts as offline.
- `errors`: failed, stalled and unstartable runs, failed routines and refused
  turns of the last 24 hours (`server/org-problem-log.ts`), grouped by reason
  code. `label` is the readable reason in the assertion's language.
- `latency`: from the duration each usage row now carries (`durationMs`, the
  turn's start to its settle); an engine whose rows predate it reads null.
- `deploy`: `SAGAX_IMAGE`, `SAGAX_IMAGE_BUILT_AT` (ISO or seconds) and
  `SAGAX_IMAGE_COMMIT` from the environment; null when unset.
- `backup`: the deployment's backup job writes
  `SAGAX_BACKUP_STATUS_FILE` (default `<data>/backup-status.json`):
  `{"enabled": true, "schedule": "daily 03:00 UTC", "lastAt": "<ISO or ms>", "ok": true}`.
  Sagax takes no scheduled backup itself; with no file every fact is null.

### `GET bots` (extended)

Without paging parameters the answer is unchanged: `{bots, truncated}`, at
most 2,000. With any of `q`, `status` (`active` or `archived`), `engine`
(instance id or driver), `owner` (principal id or Perspicax user id),
`limit` or `cursor`, the answer is a page:

```http
GET /api/org/admin/bots?status=active&q=atl&limit=50
```

```json
{
  "items": [{
    "id": "5e38e819-...", "name": "Atlas",
    "owner": { "principalId": "pr_1abf...", "sub": "01J9...", "name": "Alice" }, "ownerRole": "admin",
    "engine": { "instanceId": "claude", "driverKind": "claudeAgent", "installed": true }, "model": "claude-opus-4-1",
    "access": "org-key", "mcpProfiles": [], "grants": [], "sections": [], "routines": 1,
    "createdAt": 1791500000000, "lastActivityAt": 1791500100000,
    "status": "active", "label": null, "threads": 3,
    "look": { "kind": "mascot", "character": "shiba", "family": "animals", "color": "orange", "colorHex": "#E78531", "skin": "sesame", "shape": null, "expression": null, "image": null },
    "persona": { "displayName": "Atlas", "title": "Sales assistant", "description": "Prepares the weekly sales digest." }
  }],
  "next": null
}
```

Every bot carries `look` and `persona` (api 5, "A bot's look and persona"
below), with or without paging.

Every bot now carries `status` (`archived` is Sagax's archived bot: out of
the sidebar, skipped by rooms, its routines do not run, until restored),
`label` (the sidebar section it is filed under) and `threads` (its main
conversation plus its tasks).

### `GET usage` (extended)

Each row gains `engine`: the engine instance the turns ran on, from the
ledger row, null for rows that did not know it. Rows are grouped by day, bot,
speaker and engine.

### `GET audit` (extended)

`category` (one of the admin activity categories: `config`, `people`,
`session`, `webhook`, `mcp`, `engine`, `bot`, `budget`, `visibility`,
`rights`, `section`, `org`, `approval`, `computer`) and `target` (the id of a
bot, a person or a routine) narrow the page. Without `category`, the
organization categories are read as before.

## People

| Method and path | Role | What |
|---|---|---|
| `GET people?q&role&presence&disabled&limit&cursor` | manager | every person of the organization in reach |
| `GET people/{principal}` | manager | a person's page |
| `POST people/{principal}/disable` | admin | turn a person off or on in this Sagax |
| `POST people/{principal}/reset-access` | admin | delete their engine sign-ins, end their sessions |
| `POST people/{principal}/connections/revoke` | admin | remove their own connections |
| `POST people/{principal}/routines/pause` | admin | pause every routine that runs as them |
| `POST people/{principal}/routines/resume` | admin | resume every routine that runs as them |

### `GET people`

`role` is `admin` or `member`, `presence` one of `online`, `idle`, `away`,
`offline`, `disabled` `true` or `false`, `q` searches the name and the
Perspicax user id.

```json
{
  "items": [{
    "principalId": "pr_7c1e...", "sub": "01J9...", "name": "Bob", "role": "member",
    "disabled": false, "disabledBy": null,
    "presence": { "state": "online", "lastSeenAt": 1791500000000 },
    "bots": 2, "routines": 1, "lastTurnAt": 1791500100000, "turns30d": 48, "costUsd30d": 3.2,
    "engines": [{ "id": "claude", "via": "subscription" }, { "id": "codex", "via": "org-key" }]
  }],
  "next": null
}
```

- `disabledBy`: `perspicax` when Perspicax says the person is out,
  `sagax` when an admin turned them off here, null otherwise.
- `routines`: the routines that run as this person.
- `turns30d`, `costUsd30d`, `lastTurnAt`: the turns this person spoke (a
  routine counts for the person it ran as) over the last 30 days.
- `engines[].via`: what their own turns run with on each engine:
  `subscription` (their own sign-in here), `key` (their model key in
  Perspicax, named by provider only), `org-key`, or `none`.

### `GET people/{principal}`

The row above, plus:

```json
{
  "bots": ["AdminBot, as GET bots answers it"],
  "shared": [{ "botId": "5e38...", "botName": "Atlas", "level": "use", "via": "team" }],
  "connections": {
    "engines": [{ "id": "claude", "via": "subscription", "signedIn": true, "key": false }],
    "mcpServers": [{ "id": "github", "name": "github", "transport": "remote", "state": "enabled" }]
  },
  "routinesAsRunner": [{ "id": "r_1", "name": "Daily digest", "botId": "5e38..." }],
  "permissions": {
    "source": "perspicax",
    "effective": ["bots.create", "bots.fullAccess", "sharing.grants", "apps.ownIntegrations", "usage.view"],
    "narrowedBy": []
  }
}
```

`permissions` (2026-10-09) is what this server enforces for the person:
`source` is `admin` (every key), `perspicax` (the list the directory sent,
unknown and admin-only keys dropped) or `defaults` (Perspicax sent none: the
member defaults). `narrowedBy` names the person sheet settings applied on top
(`sagax_bots` when it says use only, `sagax_integrations` when off).

`mcpServers[].state` is `paused` while Perspicax `sagax_integrations` is off
for the person.

### `POST people/{principal}/disable`

```json
{ "disabled": true, "reason": "Contract ended" }
```

Answers `{person}` (the row). Disabling ends every session of the person at
once; while disabled no request of theirs is served (401
`principal_disabled`), a new sign-in is refused at its first request, their
routines do not run, and a console assertion naming them is refused. It is
independent of Perspicax's own disable: a sign-in does not clear it, only
`{"disabled": false}` does. An admin cannot disable themselves (409 `self`).
Audited `person.console_disable` and `person.console_enable`.

### `POST people/{principal}/reset-access`

```json
{ "scope": "engine-logins" }
```

`scope` is `engine-logins` (delete the person's subscription sign-ins on
this server), `sessions` (end every session; they sign in again) or `all`.
Answers `{person, cleared: {engineLogins, sessions}}`. Audited
`person.reset_access`.

### `POST people/{principal}/connections/revoke`

The body of the session route: `{"all": true}`, `{"kind": "mcp", "name"}`,
`{"kind": "github"}` or `{"kind": "plugin", "botId", "key"}`. Answers
`{removed, connections}` (the listing after the change). Audited
`connections.revoke` when something was removed.

### `POST people/{principal}/routines/pause`, `resume`

`{}` (or no body). Pauses, or resumes, every routine that runs as the
person: its chosen run-as person, else its bot's owner (the routines `GET
people/{principal}` lists in `routinesAsRunner`). A routine already in that
state is left alone. Answers `{person, changed, routines: [{id, name,
botId, enabled}]}` (`changed` the number moved). One admin activity row for
the whole action, `person.routines_pause` or `person.routines_resume`
(category `people`, target the person, `after.routines` the ids moved), and
none when nothing moved. Pausing does not change whom a routine runs as, and
a resume brings back routines an admin or their owner had paused one by one
too. The procedure when someone leaves: pause their routines, transfer
their bots or change whom the routines run as, then disable them (a
disabled person's routines stop anyway). Listed in `GET capabilities` as
`POST people/{principal}/routines/pause` and `.../resume`.

## Bots

| Method and path | Role | What |
|---|---|---|
| `GET bots/{id}` | manager | a bot's page |
| `GET bots/{id}/avatar` | manager | the bot's uploaded picture |
| `POST bots/{id}/clone` | manager (bot and new owner in reach) | a copy for its owner or another person |
| `POST bots/{id}/archive` | manager in reach, admin | archive |
| `POST bots/{id}/restore` | manager in reach, admin | restore |
| `POST bots/{id}/transfer` | admin | another owner |
| `POST bots/{id}/model` | manager in reach, admin | another engine or model |
| `POST bots/{id}/stop` | admin | stop every running turn, task and routine run |
| `POST bots/{id}/delete` | admin | delete, with the bot's name as confirmation |
| `POST bots/bulk` | admin | archive, restore, transfer or model on 1 to 100 bots |
| `GET bots/{id}/package` | admin | the package document, secrets redacted; `?format=zip`: the whole bot as a zip |
| `POST bots/import` | admin | a package or a bot zip becomes bots of a chosen owner |

### `GET bots/{id}`

```json
{
  "bot": {
    "id": "5e38...", "name": "Atlas", "status": "active", "label": "Sales",
    "owner": { "principalId": "pr_1abf...", "sub": "01J9...", "name": "Alice" },
    "engine": { "instanceId": "claude", "driverKind": "claudeAgent", "installed": true }, "model": "claude-opus-4-1",
    "threads": { "count": 4, "lastAt": 1791500100000 },
    "soul": { "chars": 1840, "summary": "Prepares the weekly sales digest." },
    "skills": [{ "id": "digest", "name": "digest", "source": "https://github.com/acme/skills" }],
    "permissions": { "approvalMode": "ask", "fullAccess": false },
    "routineList": [{ "id": "r_1", "name": "Daily digest", "enabled": true, "schedule": "Every weekday at 09:00" }]
  }
}
```

The AdminBot fields of `GET bots`, plus the facts above. `soul.summary` is
the first line of the instructions (at most 140 characters), never the
instructions themselves; no message, memory or routine prompt is answered.

### A bot's look and persona

`look` is what the bot wears, as the app resolves it
(`server/org-admin-look.ts`, the rule of `src/components/Avatar.tsx`); the
console draws the character itself from it.

```json
{
  "kind": "image",
  "character": "owl", "family": "classics",
  "color": "blue", "colorHex": "#377FE6",
  "skin": "galaxy", "shape": null, "expression": "happy",
  "image": { "crop": "circle", "zoom": 1.4, "focusX": 0.5, "focusY": 0.35, "version": "9f2c41d07ab3e655", "type": "image/png" }
}
```

- `kind`: `image` when the bot has an uploaded picture shown with a photo
  crop (`GET bots/{id}/avatar` serves it); `mascot` when its owner chose a
  character or a skin; `default` when they chose nothing: the owl in the
  bot's color, as every bot wore before. The character fields are always
  there: they are what the app draws when the picture fails to load.
- `character`: `owl`, `crab`, `shape`, `trombi`, `bunbu`, `shiba`,
  `grump`, `ogre` or `frog`. `family`: `classics` (owl, trombi), `shapes`
  (shape) or `animals` (crab, bunbu, shiba, grump, ogre, frog).
- `color`: the bot's color name (`shared/mascot-colors.ts`, six palettes);
  `colorHex` its value, null for a name this server does not know. Trombi
  ignores it.
- `skin`: the character's skin. The owl's is the bot's owl skin (`none`,
  `snowy`, `barn`, `carbon`, `gold`, `frost`, `neon`, `lightning`,
  `chrome`, `inferno`, `holo`, `galaxy`, `spirit`); the other characters'
  are listed per character in `GET capabilities` `mascots[].skins`
  (shape: `plain` ... `galaxy`; trombi: `classic` ... `molten`; bunbu,
  shiba, grump, ogre, frog and crab: `plain`, their own coats, then the
  premium set). An older stored name reads as its current id.
- `shape`: the shape character's shape (`circle`, `bean` the heart,
  `squircle`, `pill` the capsule, `pick` the triangle, `hexagon`, `cloud`,
  `drop` the teardrop), else null.
- `expression`: the owl's resting face when the owner picked one, else null.
- `image`: null unless `kind` is `image`. `crop` is `circle`, `rounded`
  (22 % radius) or `square`; `zoom` 1 to 3 over a cover fit; `focusX` and
  `focusY` the point of the picture kept in the middle, 0 to 1; `version`
  changes when the picture changes (it is the avatar route's ETag); `type`
  the picture's media type.

Sagax stores no accessory on a bot (nothing beyond character, skin, shape,
color and the owl's face), so `look` has none. A bot's legacy `mascotBody`
is not drawn by the app any more and is left out.

`persona` is what the persona window shows: `displayName` (the bot's name),
`title` (its role or tagline, null when empty) and `description` (null when
empty, at most 500 characters; `descriptionTruncated: true` when the stored
one was longer).

### `GET bots/{id}/avatar`

The bytes of the bot's uploaded picture (PNG, JPEG, GIF or WebP, at most 10
MiB) with its `content-type`, a strong `ETag` (`"<look.image.version>"`),
`Cache-Control: private, no-cache` and `X-Content-Type-Options: nosniff`;
`If-None-Match` with that tag answers `304`. `404 not_found` when the bot
has no picture (or shows its mascot), `413 too_large` past the cap, and the
bot route's reach rules (out of a manager's reach is 404). The answer never
names a file or a path; the picture is read without following a link. Not
audited (a read of what the bot shows everyone it talks to).

### `POST bots/{id}/clone`

```json
{ "ownerSub": "01J9...", "name": "Atlas for Bob" }
```

Every route that names an owner (clone, transfer, bulk transfer, import)
takes `ownerSub` (the Perspicax user id, how the console names people) or
`ownerPrincipalId` (Sagax's id), not both. Both fields are optional here:
the owner defaults to the bot's owner, the name to
a numbered copy ("Atlas 2"). Answers `201 {bot}`. The copy has the
instructions, the skills (on when they were on), the appearance, the model
and the settings (voice, memory switches, browser, computer, tool scope, MCP
servers, approval level except Full access and Custom, which start on Auto);
it has no threads, no memory, no grants, no routines and no connected-app
grants. Audited `bot.clone` (`after.from` names the source).

### `POST bots/{id}/archive`, `restore`

`{}`. Answers `{bot}`. Archiving a Primary Bot is refused (409
`primary_bot`): its owner chooses another one first. Archiving an archived
bot changes nothing and writes no row. Audited `bot.archive`, `bot.restore`.

### `POST bots/{id}/transfer`

`{"ownerSub": "01J9..."}` (or `ownerPrincipalId`). Answers `{bot}`. Grants are kept; the
former owner keeps the bot at `manage`; a grant the new owner had becomes
ownership; a Primary Bot stops being one. 404 `owner_not_found` for an
unknown or disabled person. Audited `bot.transfer`.

### `POST bots/{id}/model`

`{"engineInstanceId": "codex", "model": "gpt-5"}`; `engineInstanceId` is
optional (the bot's engine); `model` null means the bot's model on the same
engine, else the engine's default model. Answers `{bot}`. Refusals: 400
`engine_not_installed`, 400 `engine_not_allowed` (the organization's engine
policy, Settings), 400 `bad_request` (a model the engine does not offer), 409
`busy` (the bot is working). Audited `bot.model`.

### `POST bots/{id}/stop`, `POST bots/{id}/delete`

Stop: `{}`, answers `{bot}`. Delete: `{"confirm": "Atlas"}` (the bot's exact
name, else 400 `confirm_required`), stops the bot first, answers `{deleted:
id}`. The owner is told (a notification to them alone) when someone else
acted. Audited `bot.force_stop`, `bot.force_delete`.

### `POST bots/bulk`

```json
{ "action": "transfer", "ids": ["5e38...", "77ab..."], "ownerSub": "01J9..." }
```

`action` is `archive`, `restore`, `transfer` (with `ownerSub` or `ownerPrincipalId`) or
`model` (with `model`, and optionally `engineInstanceId`); `ids` 1 to 100
distinct bot ids. Each bot is done on its own:

```json
{ "results": [{ "id": "5e38...", "ok": true }, { "id": "77ab...", "ok": false, "code": "primary_bot", "message": "..." }] }
```

One audit row per bot that changed.

#### `action: "approvalMode"` (2026-10-16)

```json
{ "action": "approvalMode", "ids": ["5e38...", "77ab..."], "mode": "auto", "threads": true }
```

The console's "Approve for me for the members' bots": sets each bot's
default level to `auto` (Approve for me) or `ask`, as its owner would in the
bot's settings. Nothing else: `full`, `custom` and `edits` answer 400, and a
bot already on Full access or Custom is refused (`elevated_level`, 409),
because those levels need the owner's own confirmation. Other refusals, per
bot: `busy` (409, a turn is running or its level is being confirmed),
`mode_not_supported` (400, its engine has no such mode), `not_found`.

The level belongs to each conversation (docs/approval-levels.md): the bot's
default reaches its main conversation and every conversation without a
level of its own, and its future ones. A conversation that saved its own
level keeps it, unless `threads: true`: then each conversation saved on Ask
moves to Auto too. A conversation on any other level is never changed, so
the action never lowers one. Each bot that changed writes one admin
activity row, category `approval`, action `approval.mode`, actor the console
person, with the level before and after and how many conversations moved.

On an organization server a member's bot used to run Auto as Ask
(approvalModeForTurn). That rule is lifted separately; until the server
carries that change, a member bot's saved Auto takes effect at turn time
only once it is deployed.

`GET bots` carries each bot's default level as `approvalMode` (`ask`,
`edits`, `auto`, `full` or `custom`), with `ownerRole`, so the console lists
the members' bots not on Auto.

### `GET bots/{id}/package`

The package document v2 (`openmaus.package`, the Share dialog's format) of
this bot alone: its instructions, appearance, skills that fit, its routines
(they arrive off on import) and the address of its remote MCP servers with
their value names. Secrets are never in it; `X-Sagax-Package-Redacted` counts
the redacted values. At most 4 MiB (else 413 `too_large`). Served as an
attachment. Audited `bot.export`.

### `POST bots/import`

```json
{ "package": { "format": "openmaus.package", "version": 2, "...": "..." }, "ownerSub": "01J9...", "name": "Atlas" }
```

The body may be up to 4 MiB plus 64 KiB. The owner is the person of `ownerSub`
(a Perspicax user id: how another linked server names them too) or
`ownerPrincipalId`, else the console person. The package is read as a file (it
cannot claim a publisher; skills, routines and connections arrive off).
Answers `201 {bot, warnings}` (the first bot it made; every bot it made
belongs to the owner). 400 `invalid_package`. Audited `bot.import`.

### The bot zip

`GET bots/{id}/package?format=zip` streams the bot as `<bot-name>.sagaxbot.zip`
(docs/bot-package.md): identity, instructions, memory, docs, skills,
plugins, settings, routines and webhooks; `conversations=1` adds threads,
messages and attachments, `sharing=1` the grants by email. At most 512 MB
(else 413 `too_large`). Audited `bot.export` with `format: "zip"`.

`POST bots/import` with the zip as the body (`content-type:
application/zip`, at most 512 MB) imports it; the fields ride the query
string: `ownerSub` or `ownerPrincipalId`, `name`, `conversations=1`,
`sharing=1`, and `preview=1` for the preview without importing
(`{ preview }`). Answers `201 {bot, warnings}`. The copy has a new id and a
suffixed name when the name is taken; routines and webhooks are off, Full
access arrives as Ask. An older package file works the same way. Audited
`bot.import` with `format: "zip"`.

"Copy to another server" is `GET bots/{id}/package?format=zip` on one
server and `POST bots/import` with that file on the other (the package
document without `format` still works).

## Routines

| Method and path | Role | What |
|---|---|---|
| `GET routines?q&status&bot&owner&limit&cursor` | manager | every routine in reach |
| `GET routines/{id}` | manager | one routine |
| `GET routines/{id}/runs?limit&cursor` | manager | its runs, newest first |
| `GET routines/runs?from&to&scope&bot&routine&state&q&limit&cursor` | employee | the calendar: every run in a window, past and planned |
| `POST routines/{id}/run` | manager in reach, admin | run now |
| `POST routines/{id}/pause` | manager in reach, admin | pause or resume |

A manager reaches a routine whose bot owner or whose runner is in their
reach. No routine prompt, run output or message is ever answered.

The Automations page of Sagax itself (2026-10-09) widens its own view with
two permissions of the catalogue, independent of this console route:
`routines.viewTeam` (the routines of the people in the caller's teams and of
the bots shared with those teams) and `routines.viewAll` (every routine of
the organization); an admin holds both, a member holds neither by default.
They gate `GET /api/routines?scope=mine|team|all&teamId&botId&ownerId&status`
and `DELETE /api/routine-runs?scope=...` on the Sagax server, not these
console routes, whose `status`, `bot` and `owner` filters already match
(`status` there is `enabled|paused|failing`, the Sagax page says
`active|paused|failing`). A console that wants a team filter can filter its
items by `owner.principalId` against the directory's teams; no new console
parameter is needed.

### `GET routines`

`status` is `enabled`, `paused` or `failing` (its last run failed); `bot` a
bot id; `owner` the bot owner's principal id or Perspicax user id.

```json
{
  "items": [{
    "id": "r_1", "name": "Daily digest", "botId": "5e38...", "botName": "Atlas",
    "owner": { "principalId": "pr_1abf...", "sub": "01J9...", "name": "Alice" },
    "runAs": { "principalId": "pr_1abf...", "sub": "01J9...", "name": "Alice" },
    "schedule": "Every weekday at 09:00", "enabled": true, "nextRunAt": 1791580000000,
    "lastRun": { "at": 1791500000000, "status": "failed", "reason": "rate_limited", "label": "The provider is rate limiting" },
    "failures7d": 1
  }],
  "next": null
}
```

- `schedule` is the schedule in words (times in the server's zone, `once`
  in UTC).
- `lastRun.status`: `ok` (completed), `failed`, `skipped` (cancelled or
  missed) or `running` (queued, running or waiting). `reason` is a code,
  `label` its readable words in the assertion's language.
- `suspended` (`person_out` or `no_right`) is present when Sagax paused the
  routine for its person.

### `GET routines/{id}/runs`

```json
{
  "items": [{ "id": "run_9", "startedAt": 1791500000000, "endedAt": 1791500050000, "status": "ok", "reason": null, "label": null, "threadId": "a5fe...", "turns": 2, "costUsd": 0.04 }],
  "next": null
}
```

`turns` and `costUsd` come from the usage ledger (the run's own cost when
the run carries one). The thread opens in Sagax at
`<server>/#thread=<threadId>&bot=<botId>`.

### `GET routines/runs` (the calendar)

```http
GET /api/org/admin/routines/runs?from=2026-10-05&to=2026-10-11&scope=all&limit=200
```

```json
{
  "from": 1791158400000, "to": 1791763199999, "scope": "all",
  "items": [
    {
      "id": "run_9", "routineId": "r_1", "routineName": "Daily digest", "botId": "5e38...", "botName": "Atlas",
      "owner": { "principalId": "pr_1abf...", "sub": "01J9...", "name": "Alice" },
      "runAs": { "principalId": "pr_1abf...", "sub": "01J9...", "name": "Alice" },
      "startedAt": 1791500000000, "endedAt": 1791500050000, "durationMs": 50000,
      "state": "failed", "planned": false, "trigger": "schedule",
      "reason": "rate_limited", "label": "The provider is rate limiting", "threadId": "a5fe..."
    },
    {
      "id": "planned:r_1:1791586400000", "routineId": "r_1", "routineName": "Daily digest", "botId": "5e38...", "botName": "Atlas",
      "owner": { "principalId": "pr_1abf...", "sub": "01J9...", "name": "Alice" }, "runAs": { "principalId": "pr_1abf...", "sub": "01J9...", "name": "Alice" },
      "startedAt": 1791586400000, "endedAt": null, "durationMs": 1800000,
      "state": "planned", "planned": true, "trigger": "schedule", "reason": null, "label": null, "threadId": null,
      "redacted": true
    }
  ],
  "next": "bzoyMDA",
  "truncated": false
}
```

- `from` and `to`: milliseconds, an ISO date (`to` as a date covers that
  whole UTC day) or an ISO date and time; at most 92 days apart. Without
  them: the last 7 days and the next 7. The answer echoes the window in
  milliseconds.
- Items are every run that overlaps the window (started or scheduled
  before `to`, ended or still going after `from`), then the planned
  occurrences from now (or `from`, when later) to `to`, computed from each
  enabled routine's schedule in the routines' time zone; a suspended or
  paused routine plans nothing, and an occurrence already queued is listed
  once, as that run. Sorted by `startedAt`, then routine.
- `state`: `ok`, `failed`, `skipped` (cancelled or missed), `running`
  (queued, running or waiting; `startedAt` is then its scheduled time until
  it starts) or `planned`. `reason` and `label` as on `GET routines` (codes,
  words in the assertion's language). `trigger`: `schedule`, `manual` or
  `webhook`. `durationMs`: the run's own length once it ended; on a planned
  item, the routine's calendar length (its `durationMinutes`).
- `scope` (default `mine`), the console's reach and the Automations scope
  together:
  - `mine`: the routines whose bot the caller owns or that run as them.
  - `team`: mine, plus every routine whose bot owner or run-as person is in
    one of the caller's teams (the assertion's `teams`), or whose bot is
    shared with one of them; for a manager also every routine in their
    reach. Managers, admins, and anyone holding `routines.viewTeam` or
    `routines.viewAll`.
  - `all`: every routine. Admins and holders of `routines.viewAll`.
  A scope the caller may not ask for is `403 routine_scope_not_allowed`
  with the missing `permission`.
- A run outside the caller's console reach (an admin reaches everyone, a
  manager their teams' people, anyone else themselves) comes with
  `redacted: true` and `threadId` null. No prompt, output or message is
  ever answered.
- `bot`, `routine` (ids) and `state` narrow the list; `q` searches the
  routine, bot, owner and run-as names. Pages of `limit` 1 to 500 (default
  200) by `cursor`. A routine plans at most 500 occurrences per window and
  a window at most 20,000 items; past either, `truncated` is true.

### `POST routines/{id}/run`

`{}`. Answers `{run: {id, startedAt, status: "running"}}`; 409
`already_running` while a run of the routine is queued, running or waiting.
Audited `routine.run_now`.

### `POST routines/{id}/pause`

`{"paused": true}` or `{"paused": false}`. Answers `{routine}`. Pausing does
not change whom the routine runs as. Audited `routine.pause`,
`routine.resume`.

## Approvals

| Method and path | Role | What |
|---|---|---|
| `GET approvals` | employee | the cards the caller may decide (unchanged) |
| `GET approvals?scope=org` | admin | every pending card of the organization |
| `GET approvals/history?q&limit&cursor` | admin | decided cards of the last 90 days |
| `POST approvals/{thread}/{request}` | employee | allow or deny (unchanged) |

`GET approvals?scope=org` answers `{approvals}` in the shape of `GET
approvals`, at most 2,000, oldest first; `decidable` is true only on a card
this admin may answer here (an admin card, or a card of their own bot, a
plain tool card on the fleet host). An owner card of someone else's bot is
listed, never decidable.

### `GET approvals/history`

```json
{
  "items": [{
    "botId": "77ab...", "botName": "Beacon", "threadId": "c1d2...", "requestId": "req_4",
    "type": "tool", "tool": "Bash", "summary": "uptime", "decision": "allow",
    "by": { "principalId": "pr_1abf...", "sub": "01J9...", "name": "Alice" }, "at": 1791500000000
  }],
  "next": null
}
```

From the decision log: the cards a person answered (in Sagax or from the
console), and since 2026-10-11 the permission cards nobody answered before
their own timeout (`decision: "expired"`, `by` null), newest first. `by`
names the person when Sagax knows them, else the device label. A card that
expired before that day has no row.

### Organization approval rules (2026-10-21)

| Method and path | Role | What |
|---|---|---|
| `GET org-approvals` | admin | `{ alwaysAllow, rules }` |
| `POST org-approvals` | admin | `{ alwaysAllow: true \| false }` |
| `POST org-approvals/rules` | admin | `{ when, behavior: "ask" \| "deny" }`, 201 `{ rule }` |
| `POST org-approvals/rules/{id}` | admin | `{ when?, behavior?, enabled? }` |
| `POST org-approvals/rules/{id}/remove` | admin | remove one rule |

An organization rule is a custom rule in plain words
(`shared/custom-rules.ts`) that an admin writes for every person and every
bot of the server. It only restricts: Ask first or Refuse, never Allow
(400). It wins over a person's own rule of the same behavior, and members
see it in their bot's Rules card, marked "Required by your administrator",
without a way to change or remove it (`/api/custom-rules/:id` answers 403
`org_rule_locked`). A rule view is `{ id, when, behavior, enabled,
recognized, createdAt, updatedAt }`; `recognized` false means the words name
nothing the reviewer can test, so the rule holds nothing. At most 100.

`alwaysAllow` false (on by default) turns "Always allow" off for everyone:
an Allow answers that one card. Every answer that would save a standing
grant (a session allow, a saved command, an Always allow rule or key) is
refused with 403 `org_always_allow_off`, no allow rule is saved or turned
on, and the standing grants people already saved stop answering while it is
off (they answer again when it is back on). Each change is an `approval`
row of the admin activity (`org.approvals.*`). Kept in
`custom-approval-rules.json` under `org`; `server/custom-rules-org.ts`.

## Connections

| Method and path | Role | What |
|---|---|---|
| `GET connections` | admin | engines, people's connections, MCP servers, marketplaces, skills library |
| `POST connections/test` | admin | test one line |

### `GET connections`

```json
{
  "engines": [{ "id": "claude", "name": "Claude Code", "installed": true, "version": "2.1.0", "orgKey": true, "people": 7 }],
  "people": [{
    "person": { "principalId": "pr_7c1e...", "sub": "01J9...", "name": "Bob" },
    "engines": [{ "id": "claude", "via": "subscription", "ok": null, "checkedAt": null }],
    "mcpServers": 1
  }],
  "mcpServers": [
    { "id": "docs", "name": "docs", "scope": "org", "owner": null, "transport": "remote", "state": "enabled" },
    { "id": "github", "name": "github", "scope": "person", "owner": { "principalId": "pr_7c1e...", "sub": "01J9...", "name": "Bob" }, "transport": "remote", "state": "enabled" }
  ],
  "marketplaces": [{ "id": "acme", "name": "acme", "url": "acme/plugins", "allowed": true, "plugins": 12 }],
  "skills": [{ "id": "digest", "name": "digest", "source": "https://github.com/acme/skills", "version": "3f2a9c1b7d4e", "bots": 2 }]
}
```

- `engines[].people`: active people whose own turns can run on the engine
  (subscription, key or organization key). `orgKey` says whether the
  organization's key is set, never the key.
- `people[].engines[].ok` and `checkedAt` stay null: Sagax does not check a
  person's engine in the background; `POST connections/test` with
  `principalId` does it on demand.
- `skills`: the organization's skills library (empty while the library is
  off); `version` is the first 12 hex of the skill's SHA-256.

### `POST connections/test`

```json
{ "kind": "engine", "id": "claude", "principalId": "pr_7c1e..." }
```

Answers `{ok, latencyMs, reason, label}`, for example
`{"ok": false, "latencyMs": 12, "reason": "no_access", "label": "This person has no access to this engine (...)"}`.

- `engine`: the engine answers its probe (and, with `principalId`, that
  person can run on it).
- `mcp`: a remote MCP server (the organization's, or the person's with
  `principalId`) answers over HTTP with a status below 500. No credential is
  sent. A server started by command (stdio) is started with its configured
  arguments and variables (the organization's on this host, a person's in
  their server environment), must answer the MCP `initialize` handshake and
  `tools/list` within 8 s, and is stopped after. Success:
  `{"ok": true, "reason": null, "label": "The server answered with 12 tools."}`.
  A failure names its cause in `reason`: `spawn_failed`, `exited` (the label
  carries the exit code), `handshake_refused`, `tools_refused`, `protocol`,
  `timeout`, `environment_refused` or `no_environment`. No variable value,
  argument or stderr line is ever in the answer or the log.
- `marketplace`: its address (or `https://github.com/<owner/repo>`) answers.

Each test has 10 s. Audited `connections.test`.

## Usage and cost

`GET usage` (above) carries `engine` on each row; the console groups by
engine, person, bot or day and exports CSV from the rows it holds.

## Logs

| Method and path | Role | What |
|---|---|---|
| `GET logs?level&limit&before` | admin | the server log tail |
| `GET incidents?kind&q&limit&cursor` | admin | failed, stalled and unstartable runs, failed routines |
| `GET audit` | admin | the admin activity log (above) |

### `GET logs`

`level` is `info`, `warn` or `error` (that level and above), `limit` 1 to 500
(default 200), `before` the `seq` of a line (the `next` of the last page).

```json
{
  "lines": [{ "seq": 1841, "at": 1791500000000, "level": "error", "area": "omb-turn", "message": "bot=5e38... refused: no_access (claude)" }],
  "next": 1841
}
```

The last 2,000 lines the server wrote to its console, each at most 2,000
characters, secrets redacted when captured (`redactSecretsInText`). Since
2026-10-11 the window also lives on disk (`<data>/server-log/`, two files of
at most 2 MiB each, mode 0600, left out of workspace backups), so a restart
keeps the last lines and `seq` keeps growing across restarts; the answer's
shape is unchanged. The container's log driver keeps the whole log.

### `GET incidents`

`kind` is `failed`, `stalled`, `could-not-start` or `routine-failed`; the
last 90 days, newest first.

```json
{
  "items": [{
    "id": "6f9b...", "at": 1791500000000, "kind": "failed", "bot": { "id": "5e38...", "name": "Atlas" },
    "threadId": "a5fe...", "title": "Weekly digest", "reason": "rate_limited", "label": "The provider is rate limiting",
    "detail": "429 Too Many Requests"
  }],
  "next": null
}
```

From the problem log (`<data>/problems/`, 180 days): every incident Sagax
reports to a Primary Bot, written before its delivery rules. `detail` is the
cause the person reads in the thread (redacted, at most 300 characters),
never a message; a routine failure carries `routineId`.

## Settings

| Method and path | Role | What |
|---|---|---|
| `GET settings` | admin | organization settings, policies, backup |
| `POST settings` | admin | change policies |

### `GET settings`

```json
{
  "org": { "orgKeyConfigured": true, "allowFullAccess": true, "memberEnvironmentAutonomy": true, "memberAutoApproval": true, "pluginMarketplaces": { "mode": "any" }, "github": { "clientId": null, "fromEnvironment": false }, "interimAttach": { "until": null, "people": 0 } },
  "policies": {
    "allowedMarketplaces": null,
    "allowedEngines": ["claude", "codex"],
    "defaults": { "engine": "claude", "model": "claude-opus-4-1", "approvalMode": "ask" }
  },
  "backup": { "enabled": true, "schedule": "daily 03:00 UTC", "lastAt": 1791472000000, "ok": true }
}
```

`org` is what `GET /api/org` answers as `settings` (no token).
`memberEnvironmentAutonomy` (on unless an admin turns it off, 2026-10-16): a
bot runs its owner's commands in the owner's own isolated environment (their
server environment, their Local VM) without a card
([approval levels](approval-levels.md#the-owners-own-environment)).
`confidentialThreadsByDefault` (off unless an admin turns it on in Sagax,
Settings > Organisation, 2026-10-16): new threads start confidential
([confidential threads](confidential-threads.md)); read only here.
`memberAutoApproval` (on unless an admin turns it off, 2026-10-16): a bot a
member owns runs Approve for me and Auto-accept edits as such; off, they run
as Ask and a member cannot choose them
([approval levels](approval-levels.md#a-members-bot-on-an-organization-server)).
The first time it is turned off, the levels members saved go back to Ask
once; turning it on again brings none back. `null` in a
policy list means any. `defaults` are the New bot defaults (engine, model,
approval level).

### `POST settings`

```json
{ "allowFullAccess": false, "memberEnvironmentAutonomy": true, "memberAutoApproval": false, "pluginMarketplaces": { "mode": "list", "allow": ["acme/plugins", "acme/*"] }, "allowedEngines": ["claude"], "defaults": { "engine": "claude", "model": "claude-opus-4-1", "approvalMode": "ask" }, "interimAttachDays": 0 }
```

Any subset. Answers `{settings}` (the GET shape). Refusals: 400
`bad_request` (an unknown field or value), 400 `engine_not_installed` (an
engine in `allowedEngines` this server does not have), 400 `invalid_policy`
(a marketplace entry). Each changed setting writes its own `org.settings`
row with its before and after.

`allowedEngines` (engine instance ids, `null` for every engine; an empty
list means no engine at all since 2026-10-17, Perspicax 1.8.34) is enforced
everywhere since 2026-10-09:

- The console's model changes (`POST bots/{id}/model`, bulk `model`) answer
  400 `engine_not_allowed`.
- Sagax refuses a model on another engine (a bot or thread model change
  answers 403) and a turn on one (409 `engine_not_allowed`); Auto never picks
  one.
- When the list changes (and at server start), a bot on an engine no longer
  allowed moves to Auto, based on the New bot default when its engine is
  allowed, else on the first allowed engine installed here; a thread's own
  model on such an engine follows its bot again.
- The list reaches every open Sagax app in its config (`allowedEngines`,
  refreshed live): the model picker lists only these providers and their
  models. A provider the person already connected but no longer allowed
  shows once, disabled, as "Not allowed by your organization".

## Computers

| Method and path | Role | What |
|---|---|---|
| `GET computers?kind&state&owner&q&limit&cursor` | admin | every server environment and every connected desktop |
| `GET computers/{id}` | admin | one computer and its recent activity |
| `POST computers/{id}/start`, `stop`, `pause`, `resume`, `update` | admin | power and rebuild a server environment (`{}`, or `{"confirm": true}` while a bot works there) |
| `POST computers/{id}/reset`, `delete` | admin | erase a server environment (`{"confirm": true}` required) |

Code: `server/org-admin-computers.ts`. A server environment is the
organization's machine for one person (sagax-sandboxd,
`docs/user-sandbox.md`): an admin acts on it with the calls the person's
own Computer tab makes. A desktop computer is the person's own (the Sagax
app signed in to this server, the desktop bridge): it is listed read only,
by its name, platform, presence and last contact, and never acted on; the
console never reaches its files, its system facts or its Local VM.

### `GET computers`

```json
{
  "items": [
    {
      "id": "env:pr_7c1e...", "kind": "server-environment", "name": "Bob",
      "owner": { "principalId": "pr_7c1e...", "sub": "01J9...", "name": "Bob" },
      "state": "running", "lastUsedAt": 1791500000000,
      "resources": { "cpus": 2, "memoryLimitBytes": 2147483648, "diskLimitBytes": 10737418240, "workspaceBytes": 512000000, "workspaceQuotaBytes": 10737418240, "overQuota": false, "cpuPercent": 12.5, "memoryBytes": 314572800 },
      "image": "sagax-sandbox:0.4.20", "os": "Debian GNU/Linux 12 (bookworm)", "arch": "x86_64",
      "platform": null, "busy": 0, "pendingDeletionAt": null, "localVm": false, "appVersion": null,
      "bots": [{ "id": "5e38...", "name": "Atlas" }],
      "actions": ["stop", "pause", "update", "reset", "delete"]
    },
    {
      "id": "desktop:3f9a0c2e71b4d856", "kind": "desktop", "name": "Bob's MacBook",
      "owner": { "principalId": "pr_7c1e...", "sub": "01J9...", "name": "Bob" },
      "state": "online", "lastUsedAt": 1791500005000,
      "resources": null, "image": null, "os": null, "arch": null,
      "platform": "darwin", "busy": 0, "pendingDeletionAt": null, "localVm": true, "appVersion": "0.4.20",
      "bots": [{ "id": "77ab...", "name": "Beacon" }],
      "actions": []
    }
  ],
  "next": null,
  "environments": { "configured": true, "reachable": true, "maxRunning": 10, "idleMinutes": 10 }
}
```

- `id`: `env:<principal id>` for a server environment, `desktop:<16 hex>`
  for a desktop (a digest of its person and the app's own id, which never
  reaches the wire). Stable while the desktop stays registered.
- `kind`: `server-environment` or `desktop`. `name`: the owner's name for
  an environment, the name the Sagax app registered (`os.hostname()`) for a
  desktop.
- `state`: a server environment is `running`, `paused`, `stopped` or
  `unavailable` (the provisioner did not answer for it within 3 s); one that
  was never created, or was deleted, is not listed. A desktop is `online`
  (it polled within 40 s) or `offline`; one whose session ended is gone.
- `lastUsedAt`: the environment's last use (the idle stop counts from it),
  or the desktop's last contact.
- `resources` (environments only): the limits (`cpus`, memory, disk), the
  workspace size and quota, and, while it runs, `cpuPercent` (of its own CPU
  quota) and `memoryBytes`. `image`, `os` and `arch` come from the same
  sample (the provisioner's image name and tag; the OS once read inside).
- `busy`: commands running in the environment now. `pendingDeletionAt`:
  set while its person is signed out by Perspicax (it is stopped and deleted
  at that time unless they come back).
- `localVm` (desktops): the app can run a Local VM for its person. Its VM's
  own state is not asked for: that is a call to the person's computer.
- `bots`: the owner's bots whose Works on sends their tools there: Auto and
  Cloud to the environment, This computer and Local VM to the desktop. A
  bot shared with the person also works in the person's environment when
  they talk to it; routines work in the bot owner's.
- `actions`: what an admin may do now (a desktop: none). `start` when
  stopped or paused (not while its person is signed out), `stop` when
  running or paused, `pause` when running, `resume` when paused, `update`
  and `reset` unless unavailable or signed out, `delete` unless unavailable.
- `environments`: whether this server has the provisioner (`configured`),
  whether it answers (`reachable`), its limit of running environments and
  its idle stop in minutes. Without it the list holds the desktops only.
- `kind`, `state` (any value above) and `owner` (principal id or Perspicax
  user id) narrow the list; `q` searches the name, owner, image and
  platform. Each listing asks the provisioner for every person of the
  organization, eight at a time.

### `GET computers/{id}`

`{computer, activity}`: the item above, and the newest 20 admin activity
rows about it (`audit` row shape): the console's actions on it and, from
the last 30 days, the bots' `computer.switch` rows for its person to or
from it (Auto choosing the cloud, This computer or the Local VM). Unknown,
deleted or gone computers are `404 not_found`.

### `POST computers/{id}/{action}`

| Action | What it does | Body |
|---|---|---|
| `start` | create or start it; a paused one resumes | `{}` |
| `stop` | stop it; `/workspace` stays | `{}`, `{"confirm": true}` while busy |
| `pause` | freeze it; bots are refused until it resumes | `{}`, `{"confirm": true}` while busy |
| `resume` | unfreeze it | `{}` |
| `update` | rebuild it from the provisioner's current image; `/workspace` stays | `{}`, `{"confirm": true}` while busy |
| `reset` | erase it and its `/workspace`, start a fresh one | `{"confirm": true}` |
| `delete` | erase it and its `/workspace`; the next use creates a new one | `{"confirm": true}` |

Answers `{computer}` (the item after the change), or `{deleted: id}`.
Refusals: `400 confirm_required` (reset or delete without `confirm: true`),
`409 confirm_running` (a bot turn or a command runs there: send `confirm:
true` to go on), `409 not_offered` (not in `actions` now), `409
personal_computer` (any action on a desktop), `409 person_out` (its person
is signed out), `429 capacity` (the provisioner runs its limit), `502
unavailable` (the provisioner did not do it), `404 not_found`. Each action
writes one admin activity row: category `computer`, action
`computer.start` ... `computer.delete`, target `{kind: "computer", id,
name}` (the owner's name), `before.state`, `after.state` (`deleted` after a
delete), `after.ownerPrincipalId` and `after.confirmed` when confirmed.
The person is not told; their Computer tab shows the new state.

## Link routes (`/api/org/link/*`)

Routes Perspicax calls on its own behalf, not for a person: their only
credential is the link token Perspicax wrote to this server's link file
(`SAGAX_PERSPICAX_LINK_FILE`, the `link_token` field), never a console
assertion. Code: `server/org-link-routes.ts`.

| Method and path | Credential | What |
|---|---|---|
| `POST /api/org/link/directory-refresh` | link token | read the directory now |

### `POST /api/org/link/directory-refresh`

```http
POST /api/org/link/directory-refresh
Authorization: Bearer pxat1.<link token>
```

Sagax re-reads the directory (`GET /api/v1/pulsabot/directory`) every
`SAGAX_PERSPICAX_DIRECTORY_SECONDS` (300 by default), so a rights change
made in Perspicax (a permission set or its assignment, `sagax_bots`,
`sagax_integrations`, a team, a profile, a role) reached Sagax up to five
minutes later. Perspicax calls this route right after such a change, and
Sagax fetches the directory at once. Call it once per change; no body.

- Answers `202 {"ok": true, "refresh": "started"}`, or `"queued"` when a
  fetch is running or one started less than 2 s ago: exactly one more fetch
  then follows, so a change committed during a running fetch is still read.
  The fetch runs after the answer; its outcome is in the server log and in
  `GET overview` like a poll's. Nothing else is written.
- `401 {"error": "unauthorized"}` for a missing or wrong token, a token sent
  any other way than `Authorization: Bearer` (query, Basic, cookie) included.
  A token Perspicax just rotated is accepted: a mismatch re-reads the link
  file once.
- `429 {"error": "rate_limited"}` with `Retry-After: 60` after 10 failed
  authentications from one socket address in 60 s (even with the good token
  until the window passes), or beyond 60 accepted calls in a minute.
- `404 {"error": "not_found"}` on a solo server or an organization server
  with no link file; `405` for another method.
- Every answer carries `Cache-Control: no-store`.

Perspicax holds the link token only where it writes the link file itself
(the server of `pulsabot_origin` with `PXC_PULSABOT_LINK_FILE`); a server
linked from the console keeps the poll and the refresh at each sign-in.

## Not offered yet

| Route | Why |
|---|---|
| `people[].engines[].ok` in `GET connections` | no background check: null, test on demand |
| `presence.idle` | Sagax knows online, away and offline only: always 0 |
| actions on a desktop computer, its files, system facts or Local VM | a person's own computer is theirs: listed read only (`409 personal_computer`) |
| the Local VM's own state in `GET computers` | it lives on the person's computer; asking is a call to it |
| `look` accessories | Sagax stores none on a bot |
