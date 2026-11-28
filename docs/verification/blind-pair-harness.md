# Blind-pair harness (#5533)

Offline fixture harness for the measured comparison protocol of
[#2644](https://github.com/pulsatrixtechnologies/sagax/issues/2644) (P-1 to
P-4). It freezes the task grid under a sha256 manifest, runs two scripted
assistants with the same prompt and context, anonymizes the sides as
Assistant A / Assistant B, and scores with a deterministic fixture judge.
No live LLM and no network. Owner sittings on a real pair still follow
[owner-device-runs.md](owner-device-runs.md) Slot C; this recipe is the
harness those sittings wait on.

## Commands

```sh
pnpm eval:blind-pair
pnpm eval:blind-pair -- --family P-1
pnpm eval:blind-pair -- --seed 5533 --out /tmp/sagax-blind-pair --reveal
pnpm exec vitest run --config evals/vitest.config.ts evals/blind-pair/blind-pair.test.ts
```

`pnpm eval:blind-pair` is
`node --experimental-strip-types evals/blind-pair/run-blind-pair.ts`.
`--family` accepts a comma list (`P-1,P-2`). `--reveal` unseals which
fixture sat on which side after the judge has scored; the default report
keeps that mapping sealed. `--out` writes `blind-pair-<seed>-<manifest>.json`
and a matching `.md` under `evals/reports/runs/` when omitted.

## What it freezes

- Rubric files under `evals/blind-pair/rubric/tasks-p{1,2,3,4}.json`, each
  with at least five tasks.
- `evals/blind-pair/rubric/manifest.json` pins every file's sha256. The
  loader refuses a mismatched or missing file before any pair runs
  (`evals/blind-pair/protocol.ts`), the same idea as the live judge
  manifest in `evals/live/judge/judge.ts`.
- Two scripted fixtures in `evals/blind-pair/fixtures/assistants.ts`:
  `sagax-fixture` and `reference-fixture`. Both see the same frozen
  prompt and context; neither calls a provider.

## What the judge reports

The fixture judge (`evals/blind-pair/judge.ts`) applies deterministic
rules per family:

| Family | Criteria |
| --- | --- |
| P-1 | exactness, completeness |
| P-2 | language, format, length |
| P-3 | latency, exactness |
| P-4 | refusal, exactness |

Gaps are listed per criterion for Assistant A and Assistant B. There is
no overall score. Anonymization (`evals/blind-pair/anonymize.ts`) shuffles
the sides with a seeded coin flip and scrubs fixture markers from the
text before judgment.

## Layout

- `evals/blind-pair/protocol.ts`: load and verify the frozen grid
- `evals/blind-pair/anonymize.ts`: side shuffle and scrubbing
- `evals/blind-pair/fixtures/assistants.ts`: scripted pair
- `evals/blind-pair/judge.ts`: deterministic rubric rules
- `evals/blind-pair/run-blind-pair.ts`: CLI runner and report writer
- `evals/blind-pair/blind-pair.test.ts`: hermetic gate
- `evals/blind-pair/rubric/`: tasks + sha256 manifest

## Related

- Calendar and owner rows: [owner-device-runs.md](owner-device-runs.md)
- Offline behavior evals: `evals/README.md` (`pnpm eval`)
- Voice acceptance (same "no live device" idea): [voice-acceptance.md](voice-acceptance.md)
