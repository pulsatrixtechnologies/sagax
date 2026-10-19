# Routines

## Monthly and custom cron

See [schedule behavior and examples](../routine-schedules.md). In the isolated
renderer below, create a monthly routine for day 1 at 09:00 in Asia/Kolkata.
Check that the next three dates are all on the 1st, then save, reload and edit
the title without changing its expression or zone. Switch to Custom cron and
try `0 9 31 2 *`: the inline error must disable Save and leave the stored rule
untouched. Check `0 9 L * *` and `0 9 * * MON#2` for real month-end/nth-weekday
previews. Calendar calls deliberately retain their existing scheduling choices.

The automated cron tool fixture calls the real MCP proxy through a disposable
server, confirms the resulting card, and verifies list/update/pause/resume,
persisted timing and HTTP 400 validation failures. It scripts the tool call;
it does not measure a real model's natural-language-to-cron accuracy.

It also retries an existing schedule under a different name through the real
tool, checking that the response identifies the existing routine and creates
neither a second approval card nor a second schedule. The proposal-service
tests cover competing confirmations, Full Access, per-bot ownership, explicit
interval starts, meaningful punctuation and differing execution settings.
This guard only applies to agent creation proposals; intentional duplicates
in the manual editor remain possible. Existing routines are never removed.

```sh
pnpm exec vitest run shared/routine-schedule.test.ts server/routine-cron.e2e.test.ts server/routine-requests.test.ts server/routines.test.ts server/routines-startup.test.ts src/components/routines/cron-editor.test.ts src/lib/routine-calendar.test.ts src/lib/schedule-label.test.ts server/bot-package.test.ts server/package-export.test.ts
SAGAX_UI_E2E=1 pnpm exec vitest run scripts/testing/cron-routines-ui.e2e.test.ts
```

## Launch the isolated renderer

Run the launcher directly so Ctrl-C reaches the fixture owner:

```sh
node --experimental-strip-types scripts/verify-routines.ts
```

Open the printed `previewUrl`, not the user's running app. The launcher uses
`launchVerificationServer()` from the shared control surface, a temporary home
and data directory, free ports, and only the repository's fake Claude engine.
It mounts the real App and StoreProvider through Vite, with `/api` proxied to
that exact fixture. It does not use a real provider account, inbox, desktop,
cloud VM, or external service.

The launcher prepares these cases:

- **Pepper** receives a pending **Agent-created inbox check** confirmation card.
  The real `propose_routine` MCP handler creates the card using credentials
  captured from a running fixture turn. The fake model does not decide to call
  the tool, and the launcher does not confirm the card.
- **Manual inbox check** is created through the routine API and run twice for
  Pepper. Both fresh executions report into **Fleet health reports**, inside
  the **OMB management** folder. Its next scheduled occurrence is an hour later.
- **Provider failure example** is created for **Miso** and run once. Miso's
  isolated fake engine deliberately exits early, producing a failure receipt.
- **Automatic scheduled check** is scheduled for Pepper about twelve seconds
  after creation. The real scheduler must dispatch it without clicking Run now.

The final startup JSON includes the server `url`, `previewUrl`, `pepperId`,
`misoId`, `scheduledRoutineId`, `manualRoutineId`, `resultsThreadId`,
`resultsFolderId`, temporary `dataDir`, and persistent `logPath`.

## Real UI checks

1. In Pepper's source chat, inspect the pending routine card. Confirm it once;
   the card must become settled and exactly one matching routine must appear.
   Reloading must preserve both the routine and the card's settled state.
   Open that routine and run it. Its lifecycle receipt lands in Pepper's main
   thread (the open conversation the person last wrote in, here the source
   chat), not a new "· Results" thread, and leads to the isolated execution
   thread.
2. Open **Automations → Schedule**. Toggle **List / Calendar**. The list must
   show paused and finished schedules as well as active ones; changing views
   must not change a routine or start a run. Filter by Pepper and Miso and
   confirm that routine ownership stays correct.
3. Use **New → Scheduled task** to create a distinctly named Pepper routine.
   Check its saved schedule and prompt, edit it, then pause and resume it.
   **Run now** should create one run and show its eventual saved result.
   For the agent-created interval, compare `/api/routines` before and after a
   title-only edit: `schedule.anchorAt` and `nextRunAt` must not shift. An
   unchanged one-time schedule must likewise retain its exact `schedule.at`,
   including seconds and milliseconds omitted by the editor's time field.
4. Open **Run logs**. Verify the successful manual run, the Miso failure and its
   error, and the automatic run. Open the automatic receipt and verify it was
   **Scheduled**, not **Manual**. A finished one-shot schedule must not be
   described as a successful run merely because its date has passed.
5. Exercise bot and status filters, search by name or result/error text, and
   open a routine's scoped **Run logs** link. **Show all routines** removes that
   routine-only filter. Opening a run must show its own saved details and its
   actual execution thread when that thread still exists.
6. Return to Pepper and open its Computer side panel. The **Routines** tab next
   to Computer and the compact entry below the computer section must reach the
   same bot-scoped list. Check next-run dates, latest results and log links.
   Switch to Miso and back; never show Pepper's routines under Miso. Each bot's
   selected side-panel tab should survive closing and reopening the panel.
7. Open bot settings → Routines. It must use the same routine editor and central
   logs, without creating a second definition or competing history page.
   Confirm that the chat's model header and Ask composer retain their positions.
8. Expand Pepper's threads. **OMB management** contains one **Fleet health
   reports** thread, not separate sidebar entries for the two executions.
   Right-click the folder (or use its actions menu) → **Mark folder as read**.
   Its unread dots clear without selecting a conversation or resolving any
   pending approvals. Open the results thread: both dated reports remain.
9. Use a report's **Open run** to inspect its fresh execution transcript, then
   **Back to results**. **Run logs** retains the full execution history.
   A user follow-up sent in a completed execution makes it an ordinary visible
   thread; marking the older run seen must not hide that conversation again.
10. In the routine editor, **Post results to** offers visible threads grouped by
    folder or **The bot's main thread** (the default). Save to Fleet health
    reports, reload, and confirm the selection persists. In quick create,
    **More options** must preserve the chosen destination. Changing the owning
    bot, including via Call/Team goal selectors, must reset a foreign destination.
    Run a new routine twice: both reports use the chosen thread, while Run logs
    links to two different executions. The default reports every run into the
    bot's main thread and never creates a "· Results" thread.

Every routine reports into its bot's main thread unless the user chooses another
destination, whether it was made in a chat, the editor or the API, and whether a
teammate (such as a Chief) asked for it. The main thread is the open
conversation a person last wrote in (until anyone has, the selected one, then
the oldest); a bot with hidden threads opens there too. Conversations from
before the server kept that take it, once on upgrade, from the newest line a
person sent there from the app. Each run looks it up
again, so the routine saves nothing and its results follow the person. A routine
still pointing at an automatic "<name> · Results" thread from an older version
moves to the main thread on its next run; that thread and its reports stay. The
oldest thread that v0.1.98 to v0.1.107 saved on routines as if it were chosen is
cleared once on upgrade, also when it was archived since. On a Cloud home, a routine written by someone other
than the owner keeps its own results conversation, opened as theirs. Historical
runs keep the destination they started with. If that destination is deleted,
their execution threads become visible so results and approvals remain
reachable; future runs report into the main thread. No existing user
conversation is silently deleted or filed.

An unconfirmed proposal is not an active routine. A run marked **Waiting** is
not necessarily asking the user for approval: its attention text can explain
that work it handed to teammates is still outstanding — the job runtime has
assignments open for the run's thread (docs/runtime-contract.md §9), and the
run completes when their results have resumed it as a routine turn. Status,
result and scheduled/manual trigger must agree with the saved server record.

## Run on startup

A repeating routine's **Advanced** section offers **Also run when Sagax
starts**. In the isolated renderer, create a daily routine with it ticked, then
reopen the editor: the box stays ticked. A one-time routine does not offer it.
Startup needs a restart on the same data, which this launcher does not do;
`server/routines-startup.test.ts` restarts a real fixture server on its own
store and requires exactly one completed **On startup** run.

The desktop gives every server child of one launch the same
`SAGAX_DESKTOP_LAUNCH_ID`, and `routines.json` records the launch whose startup
runs were queued. A crash recovery or switching back to a workspace within
that launch queues none; the next launch does. A server without the variable,
such as a standalone one, counts every process start.

```sh
pnpm exec vitest run server/routines.test.ts server/routines-startup.test.ts server/routine-requests.test.ts server/drivers/agents-proxy.test.ts shared/package-format.test.ts server/package-export.test.ts server/package-import.test.ts
node --test electron/server-child-launch.node-test.mjs
```

## Evidence and cleanup

Keep screenshots or a browser action transcript for renderer checks, and the
final startup JSON. For bounded chat evidence, copy the exact fixture bot and
execution-thread IDs into the shared control commands:

```sh
pnpm control:omb wait --bot BOT_ID --task THREAD_ID --timeout 30 --url http://127.0.0.1:PORT
pnpm control:omb messages --bot BOT_ID --task THREAD_ID --limit 20 --url http://127.0.0.1:PORT
```

Use only the printed fixture server URL. The browser interaction checklist is
not automatically asserted by the launcher. On Ctrl-C, the launcher writes
`<logPath>.json` containing setup mutation evidence and the final `/api/routines`
snapshot (or a separately labelled `persisted` snapshot if Ctrl-C already stopped
the API), closes Vite and the exact child server, and removes only its temporary
data. The server log and adjacent JSON remain. Close the dedicated browser tab;
never kill processes by name or delete a broad temporary root.

## Automated regressions

In the editor's Advanced section, recurring routines offer **Skip this
occurrence** (the default) or **Queue one run**. The queued scheduled run waits
for the same routine to finish, including the assignments its run still has
outstanding on the job runtime; extra occurrences are skipped, not
accumulated. Manual runs and webhook deliveries remain independent. Pausing
still cancels queued work. The cron renderer test changes this option, saves
it, opens the editor again and switches it back.

The List view and `list_routines` expose saved skipped-occurrence counts and
recent consecutive failures. Skips count occurrences observed by the scheduler
while busy, not every interval elapsed while offline. Failure streaks are
derived from retained terminal receipts (up to the existing history limit),
ignore cancelled/missed runs, and reset only after the whole run succeeds—not
an intermediate turn waiting for a teammate. Neither indicator pauses work
automatically. The scheduler tests cover bounded queues, daily/cron/interval
parity, restart recovery, duplicate completion events and atomic cursor/counter
rollback on a failed save. The MCP fixture verifies reviewed policy changes
and the listing through the actual tool and API, using no live accounts.

The routine tool defaults to `maus` (the bot's configured model and computer,
including VPS); `box` explicitly selects the bot's Boat cloud computer, which the
bot's own model drives through its computer tools. Legacy `cloud`
values remain accepted without migrating existing routines. The cron tool
fixture checks this default and the missing-Boat-account recovery instruction.
The VPS fixture runs an actual scheduled execution with fake ACP/SSH and checks
that the same VPS computer tools reach the agent without a Boat key. These are
deterministic routing checks, not a live model-choice or real VPS acceptance test.

```sh
pnpm exec vitest run server/vps-routing.test.ts server/routine-cron.e2e.test.ts
```

```sh
pnpm exec vitest run server/routines.test.ts server/routines-startup.test.ts server/routine-results.e2e.test.ts server/routine-delegation.e2e.test.ts server/drivers/agents-proxy.test.ts
pnpm exec vitest run src/components/routines/RoutineViews.test.ts src/components/routines/ResultsDestination.test.ts src/components/bot-settings/RoutinesSection.test.ts src/components/RoutineRunCard.test.ts src/components/BotProjects.test.ts src/lib/folder-read.test.ts src/lib/computer-panel-view.test.ts src/state/store.test.ts
```

The hand-off integration tests (`server/routine-delegation.e2e.test.ts`,
`server/runtime-paths.e2e.test.ts`) launch their own shared-control fixtures.
A routine turn hands work on with `coordinate_bots`; the run's root on the
job runtime names the run as its
requester with routine lineage (docs/runtime-contract.md §9). They verify a
busy peer delaying completion until its result resumes the same run as a
routine turn, a denied hand-off refused with that outcome and no assignment
written, a run that stays waiting through a restart while its cut teammate
turn runs again once (§5), and the one-time import of a pre-runtime
`delegations.json` at boot (`server/routines-startup.test.ts`). They print
retained server-log and JSON evidence paths. These complement the scheduler,
proposal and renderer tests; they do not prove real-provider tool selection,
actual desktop work, or packaged Electron behavior.

Webhook delivery IDs are committed atomically with their execution receipt.
Retries keep the same run ID for seven days, independently of run-log pruning;
unfinished work remains deduplicated beyond that window. A full retry ledger
rejects new work rather than discarding identities that senders may still retry.

```sh
pnpm exec vitest run server/webhook-idempotency.test.ts server/webhook-restart.e2e.test.ts
```

The restart test launches a disposable fake-engine server, creates a webhook,
then exits an owned worker between the execution and ingress commits. It restarts
that same isolated server and checks that redelivery returns the original run ID
with one execution. Its retained JSON evidence includes the receipt and transcript.

The results integration fixture additionally proves fresh provider contexts,
saved destination snapshots, dated result cards, approval links, deleted-thread
fallback, and continued user conversations staying visible. Native decoding and
thread-list tests retain hidden execution records for direct navigation and
approvals while omitting them from ordinary iOS/Android thread pickers.

## Slice 6: rate limits at Perspicax

Perspicax answers an OAuth call over its budget with 429
`{"error":"rate_limited","message":"too many requests; slow down"}` and
`Retry-After` in seconds (60 today). `/oauth/token` (code exchange and
refresh) and `/oauth/revoke` without the link's Basic header share 60 calls a
minute per client address, and every call a Sagax server makes comes from one
address. The link-authenticated token exchange and its revocations have their
own budget (600 a minute per linked server) and are not paced by Sagax. A 429
means nothing happened: no revocation, no code consumed, no refresh token
rotated.

What Sagax does:

- **Its own budget.** `SAGAX_PERSPICAX_TOKEN_BUDGET` (a whole number from 1 to
  60, default 45) caps Sagax's token and revocation calls per rolling minute
  (`server/idp-token-pacer.ts`). A code exchange always goes (someone waits at
  the browser). A refresh waits at most 5 s for a slot, else it is deferred as
  rate limited without a call. Revocations use only what leaves 10 slots free
  (1 on a budget below 11), one at a time. Any 429 pauses refreshes and
  revocations for its `Retry-After` (read as seconds or an HTTP-date, clamped
  to 1 s to 10 min, 60 s when missing).
- **Never an outage.** A rate-limited refresh is retried after max(60 s,
  `Retry-After`); it never counts toward the 24 hour unreachable grace, so a
  session is never ended by rate limits (`idp: renewal deferred (Perspicax is
  rate limiting this server; retry in N s)`). A turn whose Perspicax tools are
  refused by a rate limit says "Perspicax is rate limiting this server; try
  again in a minute" in its system note and on its activity row
  (`Perspicax: <profiles> unavailable for <person>: Perspicax is rate limiting
  this server; try again in a minute`), never "could not be reached". The log
  says when a 429 pauses calls (`perspicax token budget: ...`), when a refresh
  is deferred without a call, and when a revocation is queued, rate limited or
  waiting for the budget (`idp revocations: ...`).
- **Routine runs.** A run whose delegation renewal is rate limited stays
  queued (`admitAfter`, `admitAttempts` on the run) and is retried at most 3
  times, after max(`Retry-After`, 60 s x 2^n), capped at 10 minutes.
  Occurrences that fall due while it waits fold into it (counted as skipped,
  as for any overlap), so a per-minute routine still gets its retries. Then it
  fails with "Perspicax is rate limiting this server; this run is skipped". A
  routine is never paused for a rate limit; a real outage keeps "Perspicax is
  unreachable; this run is skipped".
- **Sign-in.** A rate-limited code exchange comes back as
  `/pair#signin_error=rate_limited` ("Perspicax is busy right now. Wait a
  minute and try again."). The routine delegation has no consent of its own
  since 2026-10-08: it is issued from the sign-in (see below).
- **Durable revocations.** Every revocation at Perspicax (a session that
  ends, a refused sign-in, a replaced routine delegation, a rotated token
  nobody can keep) goes through a queue sealed with
  the sign-in vault key in `idp-revocations.enc` (0600, own AAD,
  `server/idp-revocations.ts`). It is paced by the budget above, retried until
  a 2xx or a definitive 400 (`invalid_request`, `unsupported_token_type`),
  waits a 429's `Retry-After`, backs off 30 s doubling to 10 minutes on other
  failures, resumes on boot, and drops entries after 30 days or past 5000
  (oldest first; only the count is logged). When the vault cannot seal, one
  attempt is made at once and the log says the entry was not kept. No token is
  ever logged.
- **Routines act in their owner's name (2026-10-08, JC).** On an
  organization server a routine always acts in its owner's name; there is no
  consent, no switch and no "Reconnect my routines". Sagax issues the
  routine delegation itself, through the link, by RFC 8693 token exchange of
  the person's live sign-in access token
  (`requested_token_type=urn:ietf:params:oauth:token-type:refresh_token`,
  `scope=openid profile email offline_access pulsabot:routines`, `resource`
  the server's origin; `PerspicaxDirectory.issueRoutineDelegation`): at every
  sign-in (web, desktop, phone), at each sign-in renewal while the person
  keeps using Sagax (a delegation older than a day slides with it), and at a
  run that finds none. A family Perspicax ended (a console revoke seen in the
  directory, an `invalid_grant`) is issued again at the next run. A run
  that cannot get one (nobody signed in since, or a Perspicax that refuses the
  exchange: up to 1.8.13 it answers `invalid_request`) fails with
  "Perspicax did not issue <name>'s routine access yet; this run is skipped
  and the next one tries again" and the routine stays active. Only a person
  Perspicax put out (`person_out`) or without `run` on the bot (`no_right`)
  pauses a routine, with one neutral line in its thread. A routine paused
  for a delegation before 2026-10-08 resumes from now when the server
  starts.

Who reaches `/api/org/routine-delegation` (GET only, read-only status):

| Caller | Answer |
|---|---|
| Organization server, service loopback trust (the default), no session | 403 from the auth gate: "forbidden: on this shared server a local request without a session may only use the service routes; ..." |
| A session that expired or was revoked | 401 from the auth gate: "unauthorized: this session has expired or was revoked; ..." |
| `SAGAX_LOOPBACK_TRUST=owner`, loopback without a session | 401 `{code:"session_required"}` from the route |
| A session without a principal or provider account, or a solo server | 403 `identity_perspicax` |

```sh
pnpm exec vitest run server/oidc-rp.test.ts server/idp-token-pacer.test.ts \
  server/idp-revocations.test.ts server/idp-session.test.ts \
  server/org-routine-consent.test.ts server/routines.test.ts \
  server/perspicax-mcp.test.ts server/oidc-login.test.ts \
  server/perspicax-org-routes.test.ts server/org-routines.e2e.test.ts \
  server/perspicax-link.test.ts \
  src/pair/PairPage.test.ts src/components/routines/RoutineOwnerName.test.ts
```

- `server/idp-token-pacer.test.ts`: with a budget of 5 the sixth refresh is
  deferred without a call; a 429 pauses refreshes and revocations, never a
  code exchange; revocations keep the reserve free.
- `server/idp-revocations.test.ts`: a 429 with `Retry-After: 60` delays the
  next attempt 60 s; a restart sends what was pending; the sealed file and
  the log never hold a token; the 30 day and 5000 entry limits.
- `server/idp-session.test.ts` ("rate limits"): 25 hours of 429 answers never
  end a session while 25 hours of network errors still do; 120 releases in
  one tick send at most 35 revocations per rolling minute with a budget of
  45, all within 4 minutes.
- `server/routines.test.ts` ("slice 6"): a rate-limited run retried three
  times with back-off, then skipped without pausing the routine.
- `server/org-routines.e2e.test.ts`: the gate's 401 and 403 above on a real
  server.
