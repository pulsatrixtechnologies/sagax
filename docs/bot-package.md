# The bot package: one bot as a zip

A bot travels whole as `<bot-name>.sagaxbot.zip`. One format for every
path:

- the persona editor, Overview, quick action **Export as zip**;
- **Import from zip** in New bot and in Browse Bots > Templates;
- the organization admin console, `GET bots/{id}/package?format=zip` and
  `POST bots/import` with the zip as the body (docs/org-admin-api.md).

Code: `shared/bot-zip.ts` (manifest schema, limits, preview shape),
`server/zip.ts` (writer and defensive reader), `server/bot-zip.ts` (what
goes in, what comes out), `server/routes/bot-zip.ts` (HTTP),
`src/lib/bot-zip.ts` and `src/components/BotZipImport.tsx` (app).

## What the zip holds

| Path | What |
|---|---|
| `manifest.json` | `format: "sagax.bot"`, `version: 1`, `appVersion`, `exportedAt`, the bot's id and name, `includes` (counts per part), `redacted` (secrets replaced on the way out), marketplaces with `needsToken`, MCP servers by name, what is never included |
| `bot.json` | the bot record's portable fields: `identity` (name, label, description, colour, mascot, character and skins, picture crop and focus, notifications), `settings` (model and effort, fallbacks, approval level, tool scope, voice and alerts, memory switches, peers, outbound policy, library skills, Perspicax profiles, team, projects, playbooks, pin), `host` (computer, cloud computer, working folder, browser and its profile, MCP servers, always allowed tools) |
| `SOUL.md` | the standing instructions |
| `avatar/<file>` | an uploaded or generated picture |
| `bot-folder/**` | the rest of the bot's own folder (`RULES.md` and the like) |
| `workspace/**` | the bot's desk: `MEMORY.md`, `memory/` (topics, `log/`, `archive.md`), `docs/`, `skills/` and every other file it keeps |
| `skills.json` | each skill's source, hash, review warnings and enabled state |
| `plugins/state.json` | portable plugin enable flags and marketplace refs (exported from the bot capability store; see below) |
| `plugins/marketplaces/<name>/marketplace.json` | each marketplace's catalogue |
| `plugins/files/<marketplace>/<plugin>/**` | the installed plugins (already without hooks, MCP, LSP and `bin/`): skills, commands, agents |
| `routines.json` | the bot's routines (not room goals) |
| `webhooks.json` | its webhooks: name, prompt, delivery, event types, limits |
| `sharing.json` | optional: grants by email (or team id) and visibility |
| `conversations/tasks.json`, `conversations/threads/<id>.json` | optional: every thread with its messages, branches and summaries |
| `conversations/files/<id>/**`, `attachments/<file>` | optional: each thread's work folder and the messages' attachments |

`BOT_FIELD_POLICY` in `server/bot-zip.ts` classifies every `BotRecord`
field: kept, host setting, sharing, conversation, or dropped with its
reason. A new field does not compile until someone decides.

## What never travels

- Tokens and secrets: marketplace tokens (only `needsToken`), webhook
  bearer tokens (a webhook gets a new one), MCP header and environment
  values (only their names), connected app credentials (only the service
  names). Every text file, `bot.json`, routine prompts and messages pass
  the redactor (`shared/redact.ts`) on the way out; `manifest.redacted`
  counts the replacements.
- This server's own state: engine session handles, live and unread state,
  request receipts, an approval change in flight, the memory upkeep undo
  journal, the organization library's update bookkeeping, a Browse Bots
  listing.
- What belongs to a person, not the bot: achievements, personal settings,
  a person's own Full access confirmation, the Primary Bot choice.
- Rooms with other bots, and context files attached to routines.

## Import

1. `POST /api/bots/import/upload` streams the file (512 MB at most) to a
   staging folder, for 30 minutes, for the person who sent it. The answer
   is the preview: what will be created, what is left out and why, what
   needs a step after (a token, a sign-in, an MCP server to add).
2. `POST /api/bots/import/:id` `{ name?, conversations?, sharing? }`
   creates the bot. Conversations and sharing are off unless chosen.

Rules, none optional:

- Never overwrite: a new id, and the name gets a suffix when it is taken.
- Routines and webhooks arrive off; each webhook has a new token.
- Full access and Custom arrive as Ask (they need their own confirmation).
- An organization member's copy drops host settings (`memberImportReset`:
  computer, browser and its profile, MCP servers, always allowed tools,
  working folder), as the Browse Bots member clone does.
- Skills land with the manifest, switched off, then the ones that were on
  are turned on again only when their `SKILL.md` matches the reviewed hash.
- Marketplaces come back with their catalogue and installed plugins: each
  joins the installation's one marketplace list (the same source is reused,
  a name taken by another source gets a suffix, one the organization does
  not allow is left out with its plugins). Update fetches them again, with
  a token added in Connect apps for that bot (Manage > Marketplaces) when
  the manifest says `needsToken`.
- An engine this server does not have (or the organization does not
  allow) falls back to the default model; a working folder or browser
  profile that is not usable here is left out, with a warning.
- Sharing (organization server): people are matched by email; someone
  unknown here is reported, not invented.
- Any failure removes everything the import wrote.
- Audited `bot.export` and `bot.import`.

An older `openmaus.package` file (the Share dialog's and the console's
earlier format, JSON or the BotMRR Markdown playbook) goes through the same
upload and preview, and imports with the package importer: identity,
instructions, skills and routines.

## Safety of the reader

`server/zip.ts` checks the central directory before inflating anything and
refuses: ZIP64, split archives, encryption, methods other than store and
deflate, a path that is absolute, has a drive letter, a backslash, a NUL or
a `..` segment, a symbolic link, the same path twice, more than 20 000
entries, more than 512 MB declared, an entry over 100 MB, and a ratio no
real file has (zip bomb). Each entry inflates with an output cap at its
declared size, and its CRC and size are checked. Files are written only
under the new bot's own folders.

## Private marketplaces and skills

A bot's marketplace, and a skill imported from GitHub, is read with, in
order: the token saved for that marketplace on that bot, the acting
person's GitHub connection (Connect apps > Sources), then the
organization's GitHub tokens (Connect apps > Sources > Organization sources and access).
GitHub's API says first which one reads the repository; the clone then
sends that token as a basic auth header through git's environment, never
the URL, the argv, a file or a log. When none reads it, the answer names
the cause (`code`) and the fix (`fix`):

| `code` | GitHub said | Fix |
|---|---|---|
| `private_needs_token` | 404 without a token: private, or missing | connect GitHub, or add a token |
| `not_found_or_no_access` | 404 with a token | check the address, or a token that can read it |
| `bad_token` | 401 | replace the token |
| `sso_required` | 403 with `x-github-sso` | authorize the token for the organization (GitHub's link is in the message) |
| `rate_limited` | 403 or 429 with `x-ratelimit-remaining: 0` | wait for the reset |
| `forbidden` | 403 | a token with Contents: read (or the repo scope) |

A private marketplace reads with the person's GitHub account (Connect apps >
the GitHub plugin's page) by default. Another credential (another GitHub
organization, another git host such as GitLab or Gitea) is added beside the
account, in the one list (`github-credentials.enc`, AES-256-GCM with the vault
key, never shown again, never in a zip), and each marketplace row of Connect
apps > Sources picks it (`PUT /api/bots/:id/plugins/marketplaces/:name/credential`,
with "For <bot>" chosen; the marketplace itself is in the installation's one
list). Removing the marketplace from that bot or deleting the bot drops the
pick.

A bot's own plugins reach its turns: Claude loads each enabled plugin with
`--plugin-dir` (skills, commands, agents); every other workspace engine
gets their paths in the turn prompt (`server/plugin-turn.ts`).

## Capability store shape (lot 5)

On disk, bot capability **config** lives in one file per bot:

`DATA_DIR/bot-capabilities/<botId>/capabilities.json`

(`server/bot-capability-store.ts`). It holds plugin enable state, plugin
config values, assigned library skills, and a `migrated` list. The zip
still uses the portable `plugins/state.json` path so older packages import;
export fills that entry from the bot store (or from the legacy
`bot-plugins/<bot>/state.json` before migration). Plugin **content** trees
stay under `bot-plugins/<bot>/plugins/` and travel as
`plugins/files/...` in the zip.

Person and installation capability config are not in the zip:

- Person: `principals/<pid>/capabilities.enc` (never exported).
- Installation: `installation-capabilities.enc` (marketplaces, org skills
  library, org Flow, org declarations, installation MCP). A marketplace
  the bot uses is reattached to the installation's one list on import, as
  before.

Migration of the eleven legacy config files into these three stores:
`docs/migration/capabilities-stores.md`.
