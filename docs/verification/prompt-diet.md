# Prompt diet (#1997)

The neutral builder benchmark covers 20 drivers and four turn kinds (80
cases). Every case reduces both Sagax's fixed instructions and its skills
index by at least 40%, measured separately. The combined prompt falls by
40.43% to 63.04% in UTF-8 bytes and 41.51% to 66.19% in comparison tokens.

Baseline: `08d438abb`, before implementation, with the engine matrix extended
to the remaining registered drivers using identical fixture inputs. The
fixture has eight capabilities with twelve references each, neutral package
instructions, a browser, Data, a private VM and one peer. It uses the real
builders and existing cold-turn budgets. Room fixtures omit rich-output;
sub-agent fixtures carry the assignment trust note. Selected native helper
agents still inherit their engine's own instructions.

These are deterministic representative fixtures, not captures of an operator's
live configuration. Engine-native prompts, native Claude plugin discovery,
tool schemas, history, variable memory volume and subsequent reference reads
are outside these figures. No provider token counter or paid model was called.
Tokens below use `tiktoken 0.14.0`, `o200k_base`, consistently for comparison
across engines. They are not Claude/xAI/provider-native billing counts. The
snapshot's `approxTokens` remains the application's existing bytes/4 estimate.

| Builder family | Turn | Bytes before | Bytes after | Tokens before | Tokens after | Byte reduction | Token reduction |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| File | Chat | 62,102 | 22,954 | 13,772 | 4,656 | 63.04% | 66.19% |
| File | Routine | 19,007 | 11,190 | 3,966 | 2,286 | 41.13% | 42.36% |
| File | Room | 51,771 | 21,827 | 11,239 | 4,425 | 57.84% | 60.63% |
| File | Sub-agent | 59,893 | 22,577 | 13,279 | 4,580 | 62.30% | 65.51% |
| API | Chat | 56,278 | 22,729 | 11,685 | 4,610 | 59.61% | 60.55% |
| API | Routine | 18,407 | 10,965 | 3,830 | 2,240 | 40.43% | 41.51% |
| API | Room | 45,947 | 21,602 | 9,152 | 4,379 | 52.98% | 52.15% |
| API | Sub-agent | 54,069 | 22,352 | 11,192 | 4,534 | 58.66% | 59.49% |

File drivers: `claudeAgent`, `codex`, `piAgent`, `grokAgent`, `geminiAgent`,
`kimiAgent`, `opencodeGo`, `antigravityAgent`, `droidAgent`, `cursorAgent`,
`qwenAgent`, `hermesAgent`, `clineAgent`, `customAcp`. API drivers: `grok`,
`openai-compat`, `minimax`, `mistral`, `cerebras`, `groq`.

The standalone index falls from 30,306 bytes / 6,779 tokens (file engines)
or 25,249 bytes / 4,878 tokens (API instructions) to 10,783 bytes / 2,175
tokens. Routine indexes already used file-style discovery before the cold
budget replaced oversized indexes with the existing lazy discovery note.
The smallest separate reduction is 40.76% bytes / 41.86% tokens for fixed
instructions, and 57.29% bytes / 55.41% tokens for the standalone index.

The [machine-readable measurements](prompt-diet.json) contain each engine,
turn kind and section, byte and token counts, stable/volatile sizes, section
hashes and stable-prefix hashes. Section token counts need not sum exactly
to the concatenated token count because token boundaries can cross sections.

The implementation keeps the full reference strings as the source of truth.
`sagax_help` with `question: "prompt:<id>"` returns them intact, including CSS
classes, examples, record schemas, scheduling details and report markers.
No new tool or permission was added. Compaction requires that this exact
tool be available under the turn's existing tool scope; otherwise full text
stays inline. Security, approval levels, personal instructions and untrusted
data boundaries stay inline. Local foreground restrictions are unchanged.
The sign-in policy is emitted once, intact, including on cold turns.

Managed skill indexes contain name and one-line discovery copy. `skills_list`
retains the full description, scope and exact alias; `workspace_read` retains
all existing assignment, integrity, shadowing and person checks. File tools
remain the fallback for file engines, and API engines without managed reads
retain whole-file delivery. Indexing never opens instruction bodies when
retrieval is available. Native Claude plugin loading is unchanged.

The core guidance was reviewed for retained behavior: own-tool execution,
verification, actionable decision cards, scoped authenticated GO, no repeated
permission questions, language/brevity, search before asking, error recovery
and honest incomplete results. Long reference texts were not rewritten.
The deliberate snapshot diff changes their byte counts and the core wording,
adds the remaining seven drivers, and moves surface/routine/selected-skill/
playbook/cwd/group-memory context into the volatile half on every engine.
Security policy, identity, soul and approval section hashes remain unchanged.

Cache friendliness is an invariant test, not an observed provider cache-hit
rate: changing the fixture's working folder, current surface and memory now
leaves the stable prefix byte-identical in 80/80 cases, compared with 4/80
before (Claude already made the surface volatile). Ordering remains
deterministic. Real cache hits also depend on the engine's native prompt,
tools, cache policy, lifetime and account.

Reproduce the current captures:

```sh
SAGAX_PROMPT_MEASURE=/tmp/sagax-prompt-after.json pnpm exec vitest run server/context/prompt-budget.test.ts
```

For the baseline, use a detached temporary worktree at `08d438abb`, extend
only its fixture's `ENGINES` array to the twenty names above, link its
`node_modules` to the installed dependencies, and run that same single test
with `SAGAX_PROMPT_MEASURE=/tmp/sagax-prompt-before.json` and `--update`.
Remove that temporary worktree after measuring.

With `tiktoken==0.14.0` installed in a temporary Python environment:

```sh
python scripts/measure-prompt-tokens.py /tmp/sagax-prompt-before.json /tmp/sagax-prompt-after.json docs/verification/prompt-diet.json
```

The comparison script checks the 40% byte/token reductions separately and
the stable-prefix invariant. The builder snapshots pin all 80 cases. Unit
tests retain decision/GO rules, exact reference bytes, no rewriting of
personal data or roster/browser suffixes, tool-scope fallbacks, per-capability
budgets and skill pagination. Isolated real-server tests exercise the actual
MCP reference read, API index/list/read sequence, room delivery, skill
disablement, engine switch and limit failover. All fixture servers, proxies
and fake engines close in `finally`; no live data or visible window is used.
