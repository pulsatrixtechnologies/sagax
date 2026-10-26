# Routine schedules

Ask a bot in ordinary language, for example:

> Prepare a report at 9 am on the first of every month, in Asia/Kolkata.

The bot turns calendar timing into a cron expression, and Sagax validates
it. The existing confirmation card shows the rule, its timezone and the next
three dates. Nothing is scheduled until you confirm. The scheduler wakes the
bot at the matching time; no model runs in the background to check the date.

In **Automations → Schedule**, choose **Monthly**, **Yearly**, or **Custom cron
(advanced)** in the existing routine editor. Monthly offers days 1–31 and
**Last day**. The timezone defaults to your browser's zone for a new preset and
can be changed. Saved cron routines retain their own zone even on another
computer. Editing just a title or instructions preserves the exact schedule.

## Advanced cron

Cron uses five fields: **minute hour day-of-month month day-of-week**.
An explicit IANA timezone such as `America/New_York`, `Asia/Kolkata`, or `UTC`
is required. Examples:

| Timing | Expression |
| --- | --- |
| First of each month at 09:00 | `0 9 1 * *` |
| Last day of each month at 09:00 | `0 9 L * *` |
| Second Monday of each month at 09:00 | `0 9 * * MON#2` |
| January 1 at 09:00 each year | `0 9 1 1 *` |
| Weekdays at 09:00 and 17:00 | `0 9,17 * * MON-FRI` |
| Every 15 minutes during weekday working hours | `*/15 9-16 * * MON-FRI` |

The app uses [Croner](https://github.com/Hexagon/croner) to calculate dates,
shared by the server and preview. It does not create a second timer service.
Lists, ranges, steps, `L`, `W`, and `#` follow that library's calendar semantics.
As with standard cron, restricting both day-of-month and day-of-week means
**either** field may match; leave one as `*` when you intend just the other.
Seconds, year fields, macros such as `@reboot`, shell commands, and arbitrary
code are not accepted. The finest resolution is one minute.

For elapsed-time repetition such as **every 90 minutes**, use the existing
interval schedule. Cron fields describe calendar positions: `*/90` in the
minutes field does not mean every 90 elapsed minutes. Holidays, external events,
and conditions such as "after a payment arrives" are not calendar expressions;
use an appropriate event/webhook workflow instead of a fake weekly schedule.

## Dates, clock changes and downtime

- Dates that do not exist are skipped: the 31st skips shorter months and
  February 29 runs in leap years. **Last day** handles every month.
- Daylight-saving gaps move the chosen wall-clock time forward through the
  gap. During a repeated hour, a matching clock time runs once, at its first
  occurrence. The preview uses the same calculation as execution.
- Routine execution defaults to **Bot’s current setup**: its selected model and
  configured computer, including a self-hosted VPS. No Boat key is needed for
  that VPS. **Boat cloud computer** is a separate, explicit choice: the bot's
  own model works on its Boat. The agent tools call these `run_on: "maus"` and
  `run_on: "box"`; legacy stored `runOn: "cloud"` still means Boat and is not
  migrated to a different runner.
- Sagax must be running to dispatch routines, including cloud-targeted
  routines. There is no external always-on scheduling service: the schedule
  runs inside the app on your computer — it is not Grok's or anyone's cloud —
  so a sleeping computer or a quit app runs nothing, and the app cannot wake
  a sleeping Mac. The desktop app does the one thing it can: while plugged
  in, it keeps the computer from idle-sleeping for the hour before a due
  routine and while one runs (Automations → *Keep this computer awake for
  routines*, on by default; a closed lid still sleeps). For true 24/7, run
  Sagax on a VPS — see [deploy-vps.md](deploy-vps.md).
- Existing catch-up policy remains: up to 12 hours late, one missed occurrence
  can be dispatched; older work receives a missed-run receipt. The next date
  advances without replaying every missed minute. Queued/running/waiting work
  for the same cron routine does not accumulate overlapping copies (a run is
  waiting while teammates still owe it results on the job runtime,
  docs/runtime-contract.md §9).
- A run waiting on the person (a question, an approval) gives way to its
  routine's next occurrence once it has waited more than 30 minutes before that
  occurrence came due and no hand-off to another bot is still open: it stops
  with "Stopped waiting: the next scheduled run of this routine started
  instead". An occurrence skipped behind a wait that is still held leaves one
  Missed receipt per wait, so the owner hears of it.
- An unattended bot run recovers from a passing failure by itself
  (`server/routine-recovery.ts`):
  - Its engine stalled, the provider rate-limited it or failed for a moment
    (or Sagax restarted while it ran): it starts once more in the same
    conversation after a short wait (15 s; a minute after a rate limit), told
    to check what its first start already did. A second failure fails it:
    "Failed after one automatic retry: ...".
  - Its bot or conversation was busy when it started: it waits there,
    checking every 30 s, for up to an hour.
  - Signed out, out of credit, a usage limit or an engine that needs setting
    up: no retry. The owner gets one notification per bot and cause saying
    what to do, and no more until one of that bot's runs completes. A usage
    limit that says when it resets (Claude Code does) puts the run back for
    just after the reset, if that is within 12 hours.
  - The log says what happened ("Retried after the engine stalled · Completed"),
    and each routine shows "N of M runs OK this week".
- Existing one-time, daily/weekday and interval schedules are not migrated or
  reinterpreted. Team exports retain cron expressions and zones; imports remain
  paused until enabled. Older phone apps safely treat cron as a newer schedule;
  use chat or the desktop/web editor for it, rather than converting it to daily.

Cron series are edited through the routine editor rather than calendar dragging,
which could otherwise ambiguously change an entire expression. Dense calendar
projections are bounded per day; Run logs remain the source of actual outcomes.

## Exact or flexible timing

A repeating routine starts at its scheduled time, or inside a window around
that time. A one-time routine always starts at the time that was chosen.

Flexible timing has an early window and a late window, in whole minutes.
When neither is given, both are 15. The minutes are stored as written.
When a start is placed they are capped at half the gap between consecutive
scheduled times, so two windows cannot overlap. A daily gap is the shortest
distance between the selected weekdays. An interval gap is its cadence. A
cron gap is the shortest real time between consecutive runs. It comes
from the minute and hour grid and the distance between matching days,
including the step back to the next hour and the step from the last
restricted day onto the next one. Month and weekday names, in any case,
including a range, a list, or a step, are read as numbers. A spring-forward
from 2024 through 2031 shortens a gap that contains the skipped minutes, and
a time inside those minutes is counted at the later instant the clock jumps to.
A day-of-month expression whose only spring-forward falls outside that span
keeps the wall-clock gap. The repeated hour when the clocks fall back does
not shorten a gap. The result does not depend on when it is measured, and it
is remembered for that expression and zone. A field that is not a number or
a three-letter name is still walked, and a cycle longer than 2,500 steps
can be cut short. A late window of 0 means the
run is ready by the scheduled time.

The start inside the window is chosen from the routine and the scheduled
slot. It stays the same after a restart. The following slot is computed
from the scheduled time, not from the shifted start. A slot that already
fired is not placed again, including after a pause, a schedule edit, a
restart, a time-zone change, or a suspension from an older build being
cleared, while its window is still open.

The editor offers Exact or Flexible on a repeating routine. A flexible
schedule reads "around HH:MM (-E/+L min)".

An older build does not know these fields. The first time that build saves
the routine, it drops the timing settings.

## Webhooks: always a bearer token

Webhooks are the way to start a routine-style task from an event outside the
app (a build finishing, a payment arriving) instead of faking a schedule. The
receiver listens on its own port (`SAGAX_WEBHOOK_PORT`, default the app port
plus one) and every webhook needs a bearer token; there is no unauthenticated
mode.

```sh
curl -X POST https://<your-host>/hooks/<endpoint-id> \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"task":"Check the failed build"}'
```

- The token is created with the webhook and shown **once** in the editor, with
  a copy button. Afterwards only its last 4 characters are shown. **Regenerate**
  asks for confirmation and the old token stops working immediately.
- The token is read only from the `Authorization` header. A token in the URL
  path, the query string or the body is refused with `401`, and so is a missing
  or wrong one. The answer never says which part was wrong.
- A source that fails authentication 10 times in a minute gets `429` until the
  minute has passed.
- Upgrading: a webhook created before this rule gets a new token when the
  server starts, and its old URL (the secret used to be part of the path) stops
  working. Open the webhook in the editor and copy the token once ("This
  webhook now needs a bearer token; copy it here"), then update each sender.
