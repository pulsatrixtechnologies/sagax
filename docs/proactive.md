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
(used by the card, a later lot). Absent is off: nothing in it is ever filled
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
