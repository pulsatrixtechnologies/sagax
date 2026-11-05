# xAI Bot Marketplace in Browse Bots

Browse Bots lists the bots of the official xAI Bot Marketplace
(https://x.ai/bot/marketplace) in a section of its own, **xAI Bot
Marketplace**, beside Templates. A click opens the bot and its import
preview; Add makes it a new Sagax bot.

## The source

The marketplace pages are public and rendered on the server: no sign-in.

- The list page streams every bot's card in its Next.js flight data
  (`self.__next_f.push([1,"…"])`): `id` (slug), `name`, `creatorName`,
  `description`, `categories`, `color`, `shape`, `addHref` (the x.ai share
  link `/bot/<id>`). Its JSON-LD `ItemList #catalog` gives the order.
- A bot's page (`/bot/marketplace/bots/<slug>`) streams the same record
  with `memories`, `skills` (name and one line), `routines` (name and one
  line) and `integrations` (app name and why). A long text sits in a row of
  its own (`"$6b"` → `6b:T<hex bytes>,<text>`).
- `instructions` is empty on every page read so far: a bot's identity is
  its first memory. Full instructions, skill bodies, routine prompts and
  schedules stay inside the x.ai app.

`server/plugins/xai-marketplace.ts` reads both (x.ai only, redirects that stay on
x.ai, 20 s, 4 MB), keeps them six hours, and answers through
`GET /api/team-library/xai[?refresh=1]` and
`GET /api/team-library/xai/bots/:slug` (`server/routes/xai-marketplace.ts`).
A failure is a code, never x.ai's error: `xai_unreachable`, `xai_format`
(the page changed), `xai_blocked` (401, 403, 429 or a redirect off x.ai,
such as a sign-in), `xai_not_found`. A refresh that fails keeps the list
read earlier (`stale`).

## The import

`shared/xai-marketplace.ts` makes the bot a package through the agent
import (`grokExportToPackage`), so the same rules apply: skills off,
routines paused, no model, no key, apps as empty connections, keys in the
text replaced. Instructions: a short brief that quotes the public
description as a description, never as instructions; the memories become
`MEMORY.md`. A routine's own words give its clock ("Every Friday" at 9:00
when no time is named); one that starts on an event is left out with its
text. The colour and shape draw a Shapes mascot in the catalogue; the bot
keeps the colour.

The desktop converts in the app and goes through the bot import
(`BotZipImportPanel`, as `AgentImport.tsx`). The phone sends
`POST /api/bots/import/agent { marketplace: slug }`; the server reads the
bot and stages the same package.

Tests: `server/plugins/xai-marketplace.test.ts` (parser on
`server/fixtures/xai-marketplace-*.html`, the real structure with neutral
names), `server/routes/xai-marketplace.test.ts`,
`shared/xai-marketplace.test.ts`, `server/routes/bot-zip.test.ts`,
`src/components/bot-catalog/bot-catalog.test.ts`, iOS `BotCatalogTests`.
Screenshots: `scripts/capture/bot-catalog-xai.mjs`.
