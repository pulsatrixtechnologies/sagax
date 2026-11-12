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
- A push to main that touches `ios/`, `shared/` or a file the Swift tests
  read (the list is in `scripts/ci-scope.mjs`) runs `swift test --package-path
  ios` once, in the `Swift package tests` job on one macOS runner. So does any
  push whose previous commit has no green CI run of its own (its run was
  replaced), or whose previous run cannot be read. The CI gate waits for this
  job through `known-failures`, but its result does not change the gate; a red
  one opens a `regression` issue. Risk: while no macOS runner comes, the gate
  is delayed as long as the job waits for one.
- A manual dispatch and the nightly schedule run every platform. Merge groups run the Linux suite
  only, the same as a pull request or a push to main. An empty or unreadable
  diff, or a previous commit whose CI cannot be read, still runs the runtime
  jobs, and still does not add Windows or macOS.

PR selection uses a local merge-base diff with rename detection disabled, so
moving a source file into documentation still selects its original runtime
path. There is no changed-files API truncation or new action dependency.

The single `CI` gate keeps the existing required dependencies. It accepts a
skipped runtime job only when static validation passed and explicitly selected
the docs-only path. A failed `static` fails the gate even when the vitest jobs,
which still run after it, pass. Failures, cancellations, missing selection and unexpected
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
median seconds across runs, where one run counts a file at its slowest
platform (a POSIX-only file that skips itself on Windows still takes minutes
on Linux), for every file over five seconds and every e2e file. A file not in it counts one second, or the median e2e time if
it is an e2e file. Every file still runs exactly once, and each shard job logs
a `duration-sequencer:` line with its share.

### Shard count and caps

The suite runs in twenty shards per platform, with a 30 minute cap on Linux
and 45 on Windows and macOS. In November 2026 it had grown to about 2,900
files and three hours of tests on one runner, and its four shards no longer
fit: every Linux shard was cancelled at 30 minutes with most of its files
never run, and the Windows shards that finished took 42 to 45 of their 45
(#3521). The count is sized from measured runs, not guessed:
`scripts/testing/duration-sequencer.test.ts` plans the shards from the
recorded seconds and fails when the slowest one, at 1.1 times its recorded
seconds (vitest's own overhead on CI) plus two minutes of setup, would take
more than 60% of the Linux cap. When the suite grows past that, add shards
rather than raising the cap. The count is written in three places in
`ci.yml` (the matrix, the `--shard` flag with the job name, and the
`known failures` job's expected result count); `scripts/ci-workflow.test.ts`
keeps them equal.

How long a run takes now, measured on the first complete run of every
platform (November 2026, 3,579 test files): each Linux shard took 8 to 12
minutes, each Windows shard 7 to 15 and each macOS shard 8 to 15, with
setup. A push to main runs the twenty Linux shards side by side, so its
tests finish in about 15 minutes after `typecheck + lint`. A run of every
platform (the nightly run, a manual run) takes longer, because the macOS
shards run three at a time (see "macOS runners").

Refresh the times from a few recent runs when shards drift apart (a
cancelled shard's finished files count too):

```sh
node scripts/testing/update-shard-weights.mjs --run <run id> --run <run id> --run <run id>
```

Deleting or renaming a test file in the weights fails
`scripts/testing/duration-sequencer.test.ts` until its entry is removed or
refreshed. A refresh moves some files to other shards; a failure that appears
only after one is a real ordering dependency between test files.

## macOS runners

The account runs at most five macOS jobs at a time, and a PR used to queue
seven (four Vitest shards at the time, two smokes, the iOS job with its
hour-long simulator suite). With 25 open PRs the macOS jobs waited a median of six and a
half hours. Now:

- Pull requests, pushes to main and merge groups run the Vitest shards on
  Ubuntu only. Windows, macOS and iOS run only from a manual dispatch or the
  nightly schedule, except the one `Swift package tests` job of a push that
  touches the package (#3678).
- The macOS packaged-server and Electron smokes, and the Windows CUA smoke,
  run only from a manual dispatch or the nightly schedule.
- The macOS Vitest shards run in their own job, `vitest-macos`, with the
  same shards and steps as `vitest` (YAML anchors) and `max-parallel: 3`.
  GitHub allows five hosted macOS jobs at a time on Free, Pro and Team plans
  ("Actions limits" in GitHub's documentation), and the macOS smokes and the
  Swift job take one each. When all twenty macOS shards were asked for at
  once, the last ones waited about an hour and GitHub dropped six of them and
  the Swift job unstarted ("not acquired by Runner of type hosted even after
  multiple attempts", #3672). A shard that has not started now waits in the
  workflow, not in GitHub's runner queue. No paid runner is used.
- `ci-stop-closed.yml` cancels a PR's CI run when the PR is merged or closed. PR runs share a group named by the PR number (`ci-pr-<n>`), never by `github.ref`: a merged PR's closed event reports the base branch as `github.ref`, which made every merge cancel main's CI (fixed Oct 3 2026).

## Main and releases

Main keeps one CI run going and one waiting. Each merge replaces the waiting
run, and the running one always finishes, so a burst of merges costs two full
runs instead of one per merge (fifteen queued behind each other in October
2026, with the release waiting behind them).

`release.yml` ships only a commit whose code passed CI
(`scripts/release-ci.mjs`, overlapping the platform builds). A run counts only
when its `CI` gate passed, at least one vitest job ran, and every vitest job
that ran passed. A skipped vitest job (`vitest-macos` on a Linux-only run) is
a platform the run did not cover, and a scoped run (docs- or version-only,
vitest skipped) is never proof. A push run whose `Swift package tests` job
started and did not pass is red; skipped or with no runner, it stays green. The script
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
Linux shard past its cap, and a timed-out job loses the failing
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
   test, plus `(whole file)` for a file that did not load, plus one row for
   the vitest run itself (`(vitest run)`): a failure when vitest exited
   non-zero with no failing test (an unhandled error), a pass otherwise, so
   its issue can close like any test's. A job that crashed or timed out sends nothing, and so does a job
   that never got a runner.
2. The `known failures` job (`report`) reads every job's results and the
   run's job list (`--jobs`, from the Actions API). The run is red when a
   failure is not in the list, or when a job ran and sent no results (it
   crashed or timed out). A test job with no started step and no results
   got no runner (the release gate's own rule, `neverStarted`): the summary says, per platform, how many jobs and which shards
   did not run, and that this is not a test failure. The `CI` gate still
   reads the unstarted job itself as not passed. Each unlisted failure is an
   error annotation and a row of the job summary. The `CI` gate requires
   this job.
3. Only a run on every platform (the nightly schedule or a manual dispatch;
   `report --platforms`) shrinks the list: a listed test that passed there
   leaves it, the job uploads the shrunk file as the `known-failures`
   artifact and names the entries in its summary. Commit that file. A listed
   test whose file did not run on one of the platforms (its job got no
   runner) stays, and the summary counts it. A push
   runs Linux only, so a listed test that passes on a push stays listed (the
   summary says so): it may still fail on Windows or macOS. The list can only shrink: on a
   push, `check-shrink` compares the list at the commit before the push and
   turns the run red if an entry was added by hand.
4. On main (pushes and the nightly run), a failure not in the list is
   remembered from run to run (the `known-failures-sightings` artifact). The
   second run that sees it opens one issue per test with the label
   `regression`, unless an open issue already carries that test's marker
   (the step prints `Tracked by open issue #<n>` for it). A sighting whose
   issue was closed counts again from its next failure, so a test that
   still fails after its fix gets a new issue once seen twice more.
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
   keeps its count through it, and so does a test whose file did not run on
   one platform of a nightly run. Nothing here blocks a merge.

   When more than a handful of tests (`GROUP_ABOVE`, 5) are due in one run,
   they open one issue for the run instead of one each (#4037): its commit,
   the run, the tests grouped by file as a checklist, the first failing
   assertion of each file, and one bisect on the file with the most
   failures. Each test's marker is on its line, so a later run never opens a
   second issue for it.

   A file whose checklist does not fit under GitHub's body limit keeps one
   line with its count; its tests stay tied to the issue by the sightings.

   Every run on main then reads the open `regression` issues against its
   results (`planRegressionUpdates`, #4052). One rule says green
   (`isGreen`): the test passed and failed in no job, on each runner it
   failed on (the sighting's `failedOn`); with no runner on record, the run
   covers every platform and the test's file ran on each, so a test that
   runs on one platform only is green from where it ran. The same rule
   forgets a sighting. An issue's tests are the markers in its body and the
   sightings tied to it, listed or not: it closes, with the run as evidence,
   once each is green in this run or ticked by an earlier one. A run's issue
   ticks each green test and unticks one that fails again. A test that did
   not run leaves its issue as it is.

   `scripts/testing/close-green-regressions.mjs --run <id> --repo <owner/name>`
   does the same by hand, with the same function, for the issues opened one
   per test before this: it reads the open issues against the results and
   the sightings of a named green run on main and closes those the rail
   would close, with the run as evidence. A test seen failing on one
   platform closes only from a run that covers that platform. It lists them
   by default and closes them with `--close`.
5. Red Swift package tests on main (`Swift package tests` after a merge, the
   Swift step of the nightly's iOS job) open one `regression` issue at the
   first failure, or comment on the open one, with the commit, the failing
   test cases from the uploaded log and the run: a package that does not
   compile is not a flaky test. A Swift job that got no runner opens nothing.

The Linux package smoke installs its tools with apt retries
(`Acquire::Retries=3`), each attempt bounded by `timeout`, three attempts
with a pause, and a 13 minute cap on the step: a resolver that stops
answering cannot take the job's 25 minutes (#3672).

A red quick check does not hide the tests (#3493). The vitest jobs and the
`known failures` job need `static` only for its selection: they run whenever
the selection step set `runtime` to `true`, even when a later step of
`typecheck + lint` (the documentation references, the locale catalogs, the
typecheck, the lint) failed. That holds for every event of this workflow (a
push to main, the nightly run, a manual run); pull requests do not run it.
The `CI` gate still requires `static` to pass, so such a run stays red, but
its test results and verdict are there to read. The other runtime jobs
(smokes, evals, packaging) still wait for a green `static`.

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
