# Proactive bots and Pulsatrix watches

A bot's proactive mode is one switch per bot (`proactiveMode`, Edit bot >
Permissions > Proactive, `sagax_settings` `bot.proactiveMode`). No stored
mode reads as `proactive` (the old `follow-rules`, `propose` and `read-auto`
read the same); a chosen `off` is stored and kept; any other value fails
closed to off. The selector shows the effective value. Since #3423 a change
of the switch records who set it (`proactiveModeSet: {principalId, at}`);
absent means the server wrote the default, which is never a choice.

## Two families

- **Addressed**: someone or something aimed an event at one bot: email,
  calendar, a failed run, a bot's post that names it, a teammate's message,
  a webhook, a text. It reaches that bot; the switch and the direct triggers
  govern it, as before.
- **Ambient**: the server goes looking on the person's behalf. The
  **Pulsatrix watches** are ambient: they never run until the person said
  yes to their domain (#3423).

## The person's choices (`server/proactive/proactive-choices.ts`)

`DATA_DIR/proactive-choices.json` (mode 0600), one row per person
(`shared/proactive-choices.ts`). Per watch domain: `on`, `off` or `never`;
the one bot of the person that carries it; the watches switched off inside
it; `coversReads` (the yes covers the domain's read-only tools inside its
alerts, decision 3); when, how (`card`, `settings`, `words`, `alert`) and by
whom it was set. Also the ask ledger and when the first question was asked
(used by the card, below; also when each bot asked its first question). Absent is off: nothing in it is ever filled
from a default or from a stored `proactiveMode` (`createBot` and the startup
both write `proactive`).

- `GET /api/me/proactive[?botId=]`: the session person's choices
  (`domains`) and the domains they can choose (`available`, from the watch
  loop's listing on that bot, else their main bot): each with its slug,
  label, audience, `eligible`, and its watches (id, summary, cadence,
  products, `runs`, `missing: product|skill`). When none can be listed,
  `unavailable` says why.
- `PUT /api/me/proactive`: `{domain, state: on|off|never, botId?}` (a yes
  without `botId` goes to the person's main bot, else another bot of
  theirs; the bot must be the person's own, visible and not temporary) or
  `{domain, watch, on}`. A yes to a domain that is unknown (404) or that
  cannot run on that bot (409) is answered, with the list, never stored. A
  no to a domain the listing does not have is stored only when it cannot be
  checked or is already in the choices. Client scope, the person only, no
  admin.
- There is no screen yet (a later lot). A person chooses by asking any of
  their bots in words: the bot reads `available` and writes through
  `sagax_settings` `notifications.proactiveChoices`.
- One bot per person and domain, by construction. A carrying bot that is
  deleted hands its domains to the person's main bot, else another bot of
  theirs, which says so in one line with the domain's label; without any
  bot, the domain pauses.
- The "never" of a watch alert's row stops those watches for good, in the
  person's choices, so the reads stop too. It no longer mutes every watch of
  the bot.

## The bot asks, and proposes one domain (`server/proactive/proactive-ask.ts`)

Decided by the server, no model. Only an organization server linked to
Perspicax has watches: elsewhere nothing below runs and nothing is shown.

- **One proposer per person and domain.** Among the person's bots that can
  carry a domain (the watch loop's listing, `offered`), the one whose title
  and description share the most words with the domain's "who it is for"
  line; on a tie or with no match, the person's main bot. The other bots stay
  silent on that domain. The person can still turn it on for any eligible bot
  in Settings or by asking in words.
- **The first question**, one sentence in the bot's own chat that names up to
  three domains it proposes and asks what the person does, their
  responsibilities and their team's, and what they would like to receive. A
  new bot adds it to the closing line of its intro. After the upgrade (the
  store's `since`), the person's main bot writes it once, first saying that
  nothing is sent on its own any more; every other bot asks the first time the
  person writes to it. A bot with nothing to offer asks nothing.
- **The prompt section** (`proactive-ask`, volatile), in the owner's
  one-to-one turns only: at most three domains not yet decided, each with its
  "who it is for" line and watches, ranked by words shared with About me,
  then with the bot's title. Empty when nothing is eligible, and
  `propose_proactive` is then not listed (`SAGAX_PROACTIVE_ASK`).
- **`propose_proactive`** (`POST /api/internal/proactive/propose`):
  `about_person` appends what the person said about their work to their
  About me (the learned list, Remove in Settings); `domain` (with `watches`,
  and `quote` for a second card) posts one choice card on the proposal
  plumbing (`proactiveProposal` plus `proactiveChoice`, the folded details).
  A refusal is one line for the bot (200, `applied: false`), nothing shown.
- **Bounds**: the owner's own one-to-one turn only (never a wake, a routine,
  a room, a call or another person's turn); one open card per person; one
  bot-initiated ask per person per local day (a card or a first question);
  two cards per domain at most, the second after "Not now", 14 days later,
  when the quote is in the person's own message of that turn and is about the
  domain; "Ne plus proposer" final for bots; an unanswered card ends after
  three days and counts as "Not now"; no push.
- **The answer** (`POST /api/bots/:id/proactive/:proposalId`, `{accept,
  watches?}`): a yes writes the person's choice with the proposing bot, the
  watches it named on and the domain's others off (`watches` is the card's
  switches when sent); "Pas maintenant" is kept in the ledger; "Ne plus
  proposer" (`/feedback` `never`) stores `never`.
- **Reads covered by the yes** (decision 3): inside a watch wake, a tool the
  watch declares and the connection marks read-only runs without a card
  (`watch-read`), while the domain is on, on that bot, with that watch on.
  The organization's Refuse and Ask first rules and the person's own come
  first; a write keeps the ordinary approval path.

## Pulsatrix watches (`server/proactive/flow-watches.ts`)

Every product skill of Pulsatrix Flow declares what to watch
(`px-proactive`). The server reads them with the organization's Flow plugin
helper, `px_flow.py proactive [--product p ...]`, which prints
`{"watches":[{id, skill, products, domain, summary, observe, when, cadence, propose, kind, prompt, tools?}], "domains"?: {<slug>: {label, for}}}`.
Without `domains` a domain's label is its slug; without `tools` the observe
tool stands for the reads the yes covers.

Every minute, on an organization server, the loop walks the people's
choices, not the bots. No choice: no session, no helper call, no read, no
offer. For each chosen domain:

1. **Eligibility** (no model): the carrying bot is the person's own,
   visible, not temporary, and its turns mount the person's account
   connection; the connection serves **every** product a watch names; the
   bot holds the watch's skill (the resolution of a turn's Skills index).
   What is not eligible is not run.
2. **Products**: the APIs the person's Pulsatrix connection serves
   (`api_list`) are matched to the Flow products, once a day per person.
3. **Watches** of those products, cached one hour, kept when their domain is
   chosen and the watch is not switched off. A new watch the organization
   adds to a chosen domain is on.
4. **Cadence**: `15m`, `1h`, `daily@HH:MM`, `weekly:sun..sat@HH:MM`, in the
   tenant's local time (the person's time zone, else the server's). A
   calendar cadence never catches up on the first sight or after a restart.
5. **Tokens** of `args`, `params` and `when` are resolved first:
   `{{fact:<topic>.<key>}}` from `px_flow.py reference <topic>` (first two
   columns of its tables), `{{today_date_only}}`, `{{days_ago:N}}`,
   `{{days_ahead:N}}`, `{{months_ago:N}}`, `{{hours_ago:N}}`,
   `{{hours_ahead:N}}` (local, no offset). A token the organization does not
   set skips the watch, logged in Events; no call ever carries a raw template.
6. **Observe** runs as a read on a short-lived connection with the person's
   routine credentials: a tool Perspicax marks read-only, or `flow_action`
   without `confirm` (no write is sent). An observe that is not a read is
   skipped and logged.
7. **When** (JMESPath) on the observed value. True and new (watch id plus a
   key of the result, per person) goes through `ProactiveEngine.consider`
   (12 watch steps per bot per hour) and `decideProactiveStep`. A condition
   that stays true with the same key never fires twice; it fires again once
   it turned false or its result changed.
8. **Wake**: one proactive turn of the carrying bot (source `watch`, run
   name "Proactive: Pulsatrix watch"), with the watch's consigne, in the
   bot's one conversation. The person's choice passes the bot's switch, as a
   direct trigger does. A read step runs. A write is planned as a dry run
   and goes through the ordinary approval path. The proactive layer never
   runs a write on its own and adds no card of its own.

A chosen domain that cannot run (the bot is gone or no longer eligible, no
Flow plugin or one that does not answer, no Pulsatrix access, no watch of
the domain eligible, a domain the organization's Flow does not have) pauses
and says so once in the carrying bot's chat (the person's main bot, else
another bot of theirs, when the carrier is gone), with its cause; it resumes
by itself once the cause is gone. Every watch switched off on purpose is no
pause. A skipped watch (a token not set, an observe that is not a read or
that failed) posts its line in Events once per cause.

A fired watch waiting for its wake is kept in
`DATA_DIR/proactive-pending.json` (replay ref `{kind: "watch", watchId}`,
no observed data). After a restart the watch is observed again at the next
tick and fires again if its condition still holds. A gathered watch event
no wake runs for (dropped) is released and fires again at its cadence.

Memory of runs, fired conditions, posted skip causes and told pauses, per
person: `DATA_DIR/proactive-watch-memory.json`. The per-bot file of before
(`proactive-watches.json`) is not read: memory restarts per person.
The helper runs only from an organization plugin folder on a Perspicax
server, isolated (`python3 -I`, minimal environment, 20 s timeout), with the
organization's tenant plugins in `PX_FLOW_TENANTS`.

The turn prompt no longer names the watches: they are the person's choice,
not a property of the mode.

Tests: `server/proactive/flow-watches.test.ts`,
`server/proactive/proactive-choices.test.ts`,
`server/routes/proactive-choices.test.ts`,
`server/proactive/watch-tokens.test.ts`, `server/proactive/proactive-wake.test.ts`,
`server/proactive/proactive-default.test.ts`.
