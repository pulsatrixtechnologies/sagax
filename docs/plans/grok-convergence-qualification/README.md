# Lot 6: reliability qualification

Status 2026-11-01. This folder holds the repeatable measurement of lot 6 of the
[Grok convergence](../2026-10-31-grok-convergence.md): the same synthetic task
corpus, run against Sagax by a script and against Grok Bot by hand, reported in
one format. It measures; it does not claim parity. The baseline below is a fake
engine run: it proves the server and runtime paths, not any model's quality or
a provider's uptime.

| File | What it is |
|---|---|
| `corpus-v1.md` | The task corpus, generated from `scripts/qualification/corpus.ts` (`--emit-corpus`). |
| `baseline-fake-engines.md` and `baseline-fake-engines.json` | The committed baseline of the fake run (numbers, per task rows, defects). |
| `grok-bot-template.json` | The blank manual report for Grok Bot, one row per task. |
| `defects.md` | Defects the baseline revealed (D1/D2 held-message restart loss, now fixed), each with its reproduction. |

## What is measured

Per task, recorded by the runner (`scripts/qualification/`):

| Field | Meaning |
|---|---|
| completed | The task reached the state the corpus says it must, with no failed check and no defect. |
| lost accepted messages | A send the server acknowledged (HTTP 202) whose message is missing from its thread, or never reached an engine and was not stopped by the person. |
| duplicate replies | The same request answered by two replies (a marker echoed twice, or more bot replies than the task expects). |
| duplicate dispatches | The same request given to an engine more than the task allows. Delegation is judged on the runtime's assignment records instead, because a delegated turn quotes the person's request by design. |
| restart recovery | After a server stop during a tool call: `recovered` means the bot is idle (or resumed and finished), the accepted message is kept, the cut turn is answered or visibly marked as cut, and a message sent behind it is delivered. |
| stuck | A bot still busy, or a steer queue still holding words, 20 seconds after the task ended. |
| time to first token | From the send to the first streamed assistant text or whole reply text, from the event stream. |
| time to final reply | From the send to the last reply or turn end of the task. |

Latency is a sample per timed send and joins p50 and p95 (nearest rank) only for
tasks with no deliberate hold. The fake `slow` engine holds every reply for 800
ms and the fake `stream` engine answers at once, so fake-engine latency measures
server and event-stream overhead. Never compare it to a manual Grok Bot run;
compare a Grok Bot run to a Sagax run on a real engine.

## Run the corpus (fake engines, default)

```sh
node --experimental-strip-types scripts/qualification/run.ts --out /absolute/path/to/report
```

Options: `--only ID,ID`, `--category NAME,NAME`, `--label TEXT`. One isolated
server per task (temporary home and data, free ports, fake engines only), stopped
and deleted afterwards. Exit code 1 when a task fails, so a CI job can gate on
it. Typical duration is a few minutes.

## Run it against real engines (opt-in, your own keys)

Never run by tests or by an agent. Provider charges may apply to your account.

```sh
QUALIFY_REAL_ENGINE=1 MY_ENGINE_KEY=... node --experimental-strip-types scripts/qualification/run.ts \
  --engines real --confirm-real-spend \
  --real-cli /absolute/path/to/engine-cli --real-model MODEL_ID \
  --real-pass-env MY_ENGINE_KEY --label "Claude Code, model X, my key" --out /absolute/path/to/report
```

All of these are required. `--real-pass-env` takes variable names, never values:
the runner copies those variables from its own environment into the isolated
server's temporary, mode 0600 config (the Claude driver drops an inherited
`ANTHROPIC_API_KEY`, so the engine instance must carry it) and deletes it with
the run. Values are never printed or logged. Tasks that need a fault only a fake
engine can inject (a held tool, a usage limit, a restart, a scripted team) are
recorded as skipped on a real engine; the rest run unchanged. Without
`QUALIFY_REAL_ENGINE=1` and `--confirm-real-spend` the runner refuses.

## Comparison slot for Grok Bot (manual protocol)

Grok Bot cannot be driven from a script here, so a person runs the same corpus by
hand and types the numbers into the same report format.

1. Generate the blank report: `node --experimental-strip-types scripts/qualification/run.ts --emit-grok-template grok-bot.json`.
   It holds one row per task with its manual steps in `notes`. Open `corpus-v1.md`
   for the table of steps and expected results.
2. Use a fresh Grok Bot conversation per task, the same synthetic prompts, and a
   dedicated test account. Never use real customer data. Record the Grok Bot
   version, the device, the network and the date in `engineLabel`.
3. For each task, with a phone or desktop stopwatch (or the screen recording
   timeline at 30 fps): `ttftMs` is from pressing Send to the first visible reply
   text, `finalMs` to the last visible reply (or the end of the last turn).
   Repeat a timed task three times and enter the median. Tasks marked
   `timed: false` need no latency.
4. Set per task: `status` (`completed`, `failed`, or `skipped` with `skipReason`
   when Grok Bot has no equivalent, for example the injected limit), `completed`,
   `acceptedSends`, `lostAccepted` (a message you sent that vanished or was never
   answered), `duplicateReplies` (the same request answered twice),
   `duplicateDispatches` (only if you can see it, otherwise leave 0 and say so in
   `notes`), `restartRecovery` (`recovered`, `not-recovered`, or `n/a`), `stuck`
   (still busy 20 seconds after it should have ended), and what you saw in
   `defects` and `notes`. Leave `samples` empty: `ttftMs` and `finalMs` are read
   as the one sample.
5. Merge: `node --experimental-strip-types scripts/qualification/run.ts --engines real ... --compare grok-bot.json`
   (or `--only` a subset) writes `comparison.md` next to the Sagax report, with
   the summary side by side and one row per task. The merge refuses a manual file
   that is incomplete (every corpus task must appear), names an unknown task, or
   claims an engine other than `grok-manual`, and prints a warning instead of a
   comparison when the corpus versions differ.

A manual measurement carries human timing error (about a few hundred ms) and no
dispatch visibility; state both when quoting a comparison. The restart, limit and
held-tool tasks are listed with their manual steps where Grok Bot allows them and
as skipped where it does not.

## Report format

`report.json` (schema 1): `corpusVersion`, `engine` (`fake`, `real`,
`grok-manual`), `engineLabel`, `startedAt`, `finishedAt`, `revision`, `node`,
`tasks[]` (one record per task with the fields above plus `samples`, `defects`,
`notes`, `skipReason`) and `summary` (completion rate, lost, duplicates, restart
recovery rate, stuck, p50 and p95 of first token and final reply overall and per
category). `report.md` renders the same numbers. Both Sagax and Grok Bot reports
use this one shape, so a merged table is a join on task id.

## Changing the corpus

Any change to a task, its prompt or its expectation changes `CORPUS_VERSION` in
`scripts/qualification/corpus.ts`, because a Grok Bot run is comparable only to a
Sagax run of the same version. Regenerate `corpus-v1.md` and the template with
`--emit-corpus` and `--emit-grok-template`.

## Limits of the baseline

- Fake engines. They prove delivery, state machine and recovery, not model
  quality, provider rate limits or network behaviour.
- One server per task: this does not measure a loaded server.
- Real voice with enforcement and the physical iPhone and Watch approval checks
  of lot 6 are separate (see the status page); this harness does not cover them.
