# Proactive bots and Pulsatrix watches

A bot's proactive mode is one switch per bot (`proactiveMode`, Edit bot >
Permissions > Proactive, `sagax_settings` `bot.proactiveMode`). No stored
mode reads as `proactive` (the old `follow-rules`, `propose` and `read-auto`
read the same); a chosen `off` is stored and kept; any other value fails
closed to off. The selector shows the effective value.

## What wakes a proactive bot

The events Sagax already receives (email, calendar, failed runs, bot posts,
webhooks, texts, the daily suggestion) and, since 0.8.75, the **Pulsatrix
watches** of the profiles the bot holds.

## Pulsatrix watches (`server/proactive/flow-watches.ts`)

Every product skill of Pulsatrix Flow declares what to watch
(`px-proactive`). The server reads them with the organization's Flow plugin
helper, `px_flow.py proactive [--product p ...]`, which prints
`{"watches":[{id, skill, products, domain, summary, observe, when, cadence, propose, kind, prompt}]}`.

Every minute, for each bot whose stored mode is exactly `proactive` (an
explicit choice; a bot with no stored mode, an old value or `off` gets no
Pulsatrix watch, until the per-domain choice of #3408):

1. **Products**: the APIs the owner's Pulsatrix connection serves
   (`api_list`) are matched to the Flow products (hourly).
2. **Watches** of those products (`--product`), cached one hour.
3. **Cadence**: `15m`, `1h`, `daily@HH:MM`, `weekly:sun..sat@HH:MM`, in the
   tenant's local time (the person's time zone, else the server's). A
   calendar cadence never catches up on the first sight or after a restart.
4. **Tokens** of `args`, `params` and `when` are resolved first:
   `{{fact:<topic>.<key>}}` from `px_flow.py reference <topic>` (first two
   columns of its tables), `{{today_date_only}}`, `{{days_ago:N}}`,
   `{{days_ahead:N}}`, `{{months_ago:N}}`, `{{hours_ago:N}}`,
   `{{hours_ahead:N}}` (local, no offset). A token the organization does not
   set skips the watch, logged in Events; no call ever carries a raw template.
5. **Observe** runs as a read on a short-lived connection with the owner's
   routine credentials: a tool Perspicax marks read-only, or `flow_action`
   without `confirm` (no write is sent). An observe that is not a read is
   skipped and logged.
6. **When** (JMESPath) on the observed value. True and new (watch id plus a
   key of the result) goes through `ProactiveEngine.consider` (the stored
   mode, 12 watch steps per bot per hour) and `decideProactiveStep`. A
   condition that stays true with the same key never fires twice; it fires
   again once it turned false or its result changed.
7. **Wake**: one proactive turn of the bot (source `watch`, run name
   "Proactive: Pulsatrix watch"), with the watch's consigne, in the bot's one
   conversation. A read step runs. A write is planned as a dry run and goes
   through the ordinary approval path, which asks in that same conversation
   when the person's level and rules say so. The proactive layer never runs
   a write on its own and adds no card of its own.

A skipped watch (a token not set, no Pulsatrix access, an observe that is
not a read or that failed) posts its line in the chat once per cause, then
stays silent until the cause changes or an observe succeeds. Without
Pulsatrix access the watch waits for its next cadence, never every tick.

A fired watch waiting for its wake is kept in
`DATA_DIR/proactive-pending.json` (replay ref `{kind: "watch", watchId}`,
no observed data). After a restart the watch is observed again at the next
tick and fires again if its condition still holds. A gathered watch event
no wake runs for (dropped) is released and fires again at its cadence.

Memory of runs, fired conditions and posted skip causes:
`DATA_DIR/proactive-watches.json`.
The helper runs only from an organization plugin folder on a Perspicax
server, isolated (`python3 -I`, minimal environment, 20 s timeout), with the
organization's tenant plugins in `PX_FLOW_TENANTS`.

Tests: `server/proactive/flow-watches.test.ts`,
`server/proactive/watch-tokens.test.ts`, `server/proactive/proactive-wake.test.ts`,
`server/proactive/proactive-default.test.ts`.
