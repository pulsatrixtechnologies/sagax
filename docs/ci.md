# CI job selection

`ci.yml` starts on three events: a push to `main` (after each merge, Linux
jobs only), a nightly schedule at 07:17 UTC (every operating system), and a
manual dispatch (every operating system, used for a release candidate). It
does not start on a pull request or the merge queue, and it never blocks a
merge: pull requests keep their quick checks (typecheck, lint, terms), and
every test runs after the merge, off the developer's machine (owner's
decision of 2026-11-09, issue #3482). See "Known failures" below.

When it runs on a pull request's diff, it runs the workflow and its static checks: locale validation,
typecheck, lint, Electron checks, the UI build, CI-selection tests and the
verification-documentation checks. Selection never skips the entire workflow.

- Root Markdown files, Markdown under `docs/`, and `.github/FUNDING.yml` alone
  do not run the runtime jobs.
- Any other change runs the runtime suite.
- A push to main is scoped by its own commits (`before..after`): docs only,
  or a `package.json` change that only bumps `"version"` (the release bump),
  skips the runtime jobs. It does so only when the commit before the push has
  a green CI run of its own. Main's waiting run is replaced by each push, so
  without that check a replaced run's code would never be tested.
- A manual dispatch and the nightly schedule run every platform. Merge groups run the Linux suite
  only, the same as a pull request or a push to main. An empty or unreadable
  diff, or a previous commit whose CI cannot be read, still runs the runtime
  jobs, and still does not add Windows or macOS.

PR selection uses a local merge-base diff with rename detection disabled, so
moving a source file into documentation still selects its original runtime
path. There is no changed-files API truncation or new action dependency.

The single `CI` gate keeps the existing required dependencies. It accepts a
skipped runtime job only when static validation passed and explicitly selected
the docs-only path. Failures, cancellations, missing selection and unexpected
skips fail the gate. Existing advisory jobs remain advisory.

The separate shared-terminal smoke workflow is manual-only. The Windows
Vitest and Electron jobs that cover those tests also run only on a manual
dispatch.

## Vitest shards

The suite runs one file at a time, so a shard takes as long as its files added
up. Vitest's own `--shard` deals out equal numbers of files, and in October
2026 that put three of the four slowest e2e files in one shard: about 24
minutes of tests on Windows against 13 to 16 for the others, and every PR
waited for it. `scripts/testing/duration-sequencer.ts` deals the files out by
recorded time instead, slowest first, each to the shard with the least time so
far. The times are `scripts/testing/vitest-shard-weights.json`: each file's
median seconds on the Windows runners, for every file over five seconds and
every e2e file. A file not in it counts one second, or the median e2e time if
it is an e2e file. Every file still runs exactly once, and each shard job logs
a `duration-sequencer:` line with its share.

Refresh the times from a few recent green runs when shards drift apart:

```sh
node scripts/testing/update-shard-weights.mjs --run <run id> --run <run id> --run <run id>
```

Deleting or renaming a test file in the weights fails
`scripts/testing/duration-sequencer.test.ts` until its entry is removed or
refreshed. A refresh moves some files to other shards; a failure that appears
only after one is a real ordering dependency between test files.

## macOS runners

The account runs at most five macOS jobs at a time, and a PR used to queue
seven (four Vitest shards, two smokes, the iOS job with its hour-long
simulator suite). With 25 open PRs the macOS jobs waited a median of six and a
half hours. Now:

- Pull requests, pushes to main and merge groups run the Vitest shards on
  Ubuntu only. Windows, macOS and iOS run only from a manual dispatch or the
  nightly schedule.
- The macOS packaged-server and Electron smokes, and the Windows CUA smoke,
  run only from a manual dispatch or the nightly schedule.
- `ci-stop-closed.yml` cancels a PR's CI run when the PR is merged or closed. PR runs share a group named by the PR number (`ci-pr-<n>`), never by `github.ref`: a merged PR's closed event reports the base branch as `github.ref`, which made every merge cancel main's CI (fixed Oct 3 2026).

## Main and releases

Main keeps one CI run going and one waiting. Each merge replaces the waiting
run, and the running one always finishes, so a burst of merges costs two full
runs instead of one per merge (fifteen queued behind each other in October
2026, with the release waiting behind them).

`release.yml` ships only a commit whose code passed CI
(`scripts/release-ci.mjs`, overlapping the platform builds). A run counts only
when its `CI` gate passed and every vitest job actually ran and passed, so a
scoped run (docs- or version-only, vitest skipped) is never proof. The script
accepts, in order:

1. a finished run on the release commit itself;
2. a finished push, merge-queue or manual run on any commit with the same git
   tree. This is the all-OS manual run `prepare-release.yml` starts on the
   `release/v<version>` branch, whenever main did not move before the merge;
3. when the release commit's only change from its parent is `package.json`'s
   `"version"` (all the bump touches), the parent's proof by 1 or 2. A parent
   run still going is waited for; a red parent, or one that skipped its
   tests, never counts.

If none of these exists and main's run for the commit was replaced, never ran
or skipped the tests, the script starts CI on the commit in its own lane: a
`release-ci/v<version>` branch that no merge can touch, deleted afterwards. A
red verdict stops the release; re-run the failed CI jobs
(`gh run rerun <id> --failed`), and the waiting release picks up the new
attempt. A red where every failed job never started a step (a macOS runner
"failed to be acquired") is not a verdict. On the release lane's own run the
script re-runs the failed jobs once itself
(`POST /actions/runs/<id>/rerun-failed-jobs`, which the job's
`actions: write` allows) and keeps waiting. Main's run is never re-run that
way: a re-run joins main's concurrency group, where it would cancel the
newest merge's waiting run and re-run main-only deploys from an older tree.
The script starts CI in the lane instead. A manual release can skip the
wait with `ship_without_ci`, for emergencies only.

That gate does not see Windows or macOS on a push or a merge group. Those
events schedule Ubuntu vitest only, and a run whose scheduled vitest jobs
passed is still proof to `release-ci.mjs`. Before tagging, dispatch CI on
the release candidate SHA and wait until the Windows and macOS vitest jobs
on that SHA have succeeded. `ship_without_ci` does not replace that
dispatch.

## Flaky tests and Windows timeouts

Known flaky tests are listed in `scripts/testing/ci-retry-list.json`: file,
full test name (describe blocks and test joined with ` > `), owner, the
evidence, and the date it was listed. In CI only (`CI=true`), the repo's
vitest runner (`scripts/testing/ci-retry-runner.ts`) gives each listed test
two retries; nothing else is retried, and local runs never retry. Retries
are bounded per file: once a listed test fails all three attempts, that is a
real failure, and the file's later listed tests get no retry. Otherwise a
regression that breaks a whole fixture (six listed tests share
`server/context/delta-context.e2e.test.ts`) would triple their wall time and push the
Linux shard past its 20-minute cap, and a timed-out job loses the failing
tests' annotations and this summary. The cost: a real flake listed after a
broken test in the same file is not retried in that run. A listed
test that needed a retry is written to the vitest job's summary and raised as
a warning annotation (`scripts/testing/ci-retry-summary.mjs`), so a flake
that passed is still seen. Fix the test, then delete its entry;
`scripts/testing/ci-retry-list.test.ts` fails on an entry whose test no longer
exists.

Windows runners run the suite about 1.45x slower than Linux. Every test and
hook timeout doubles there (`server/testing/host-timeout.ts`): the defaults in
`vite.config.ts`, and a test's own timeout written as `hostTimeout(ms)`. Linux
and macOS keep the strict numbers, such as the 120 s budget for the
3,000-file checkpoints test.

The packaged-server smoke asks the OS for free ports (listen on port 0)
instead of picking them at random: a random pick inside a range Windows
reserves failed with `listen EACCES 127.0.0.1:497xx`.

## Known failures

`scripts/testing/known-failures.json` lists the tests that fail on main
today, in the shape of `ci-retry-list.json` (file, full test name with
describe blocks joined by ` > `, owner, reason, date). A run is green when
every failure it sees is in that list.

How a run decides (`scripts/testing/known-failures.mjs`):

1. Each vitest job writes vitest's JSON report, records the exit code
   instead of failing, and uploads its results (`extract`): one entry per
   test, plus `(whole file)` for a file that did not load, plus a failure of
   its own when vitest exited non-zero with no failing test (an unhandled
   error). A job that crashed or timed out sends nothing.
2. The `known failures` job (`report`) reads every job's results. The run is
   red when a failure is not in the list, or when fewer jobs sent results
   than were scheduled. Each unlisted failure is an error annotation and a
   row of the job summary. The `CI` gate requires this job.
3. Only a run on every platform (the nightly schedule or a manual dispatch;
   `report --platforms`) shrinks the list: a listed test that passed there
   leaves it, the job uploads the shrunk file as the `known-failures`
   artifact and names the entries in its summary. Commit that file. A push
   runs Linux only, so a listed test that passes on a push stays listed (the
   summary says so): it may still fail on Windows or macOS. The list can only shrink: on a
   push, `check-shrink` compares the list at the commit before the push and
   turns the run red if an entry was added by hand.
4. On main (pushes and the nightly run), a failure not in the list is
   remembered from run to run (the `known-failures-sightings` artifact). The
   second run that sees it opens one issue per test with the label
   `regression`, unless an open issue already carries that test's marker.
   Before opening it, `scripts/stability/bisect.mjs` runs only that test
   file on main's merges between the last run where it passed and the first
   where it failed, halving the interval, and the issue names the pull
   request it found. Bisect runs once per file in a run, shared by all of
   that file's tests, and all bisects of one run share 25 minutes: past
   that, the issue still opens, without the pull request, with the bisect
   command to run by hand. A sighting counts once per commit: a second run
   on the same commit (a nightly run on a day with no merge, a re-run) does
   not add to the count, so it does not confirm a failure a push saw; the
   next merge's run does. A test that passes again is forgotten only by a run
   on every platform (`open-issues --platforms`, the same rule as the list):
   a push runs Linux only, so a test that fails only on Windows or macOS
   keeps its count through it. Nothing here blocks a merge.

The first fill: the list starts empty. One manual run with
`fill_known_failures` writes every failure of that run to the
`known-failures` artifact with a `seeded` field and stays green; commit that
file as is. That is the only time the list may grow.

```sh
gh workflow run ci.yml --repo <owner>/<repo> --ref main -f fill_known_failures=true
```

Bisect by hand, from any checkout with `node_modules`:

```sh
node scripts/stability/bisect.mjs --file server/index.test.ts --good <sha where it passed> --bad <sha where it fails>
```

It works in a scratch worktree it removes at the end, and prints the first
failing merge and its pull request (`--json` for the full result). `--run`
replaces the command (`pnpm exec vitest run {file}` by default).

## Required check

The `main-ci-gate` ruleset requires the single `CI` check (it replaced the
three legacy `typecheck + test (<os>)` names in September 2026). Renaming the
`gate` job needs the ruleset updated first, or every PR waits forever.
